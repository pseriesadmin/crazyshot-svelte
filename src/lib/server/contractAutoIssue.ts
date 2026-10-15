/**
 * contractAutoIssue.ts — 예약 승인 시 전자계약 자동발행 (2026-10-15, Stephen 확정)
 *
 * 계약서 양식 화면에서 '자동발행 표준양식'으로 지정된 양식(contract_templates.auto_issue_default, 단독 1개)이 있으면,
 * 예약목록의 '예약승인' 때 그 양식으로 계약서를 만들어 고객에게 서명 요청(채팅 카드)까지 자동으로 보낸다.
 *  · 지정된 양식이 없으면 = 기능 꺼짐(status 'off') — 호출부는 기존 승인 동작을 그대로 한다
 *  · 발행·발송에 성공하면 'sent' — 예약 확정(계약완료)은 고객의 서명·결제 후(호출부가 확정을 하지 않는다)
 *  · 발행하지 못하면 'skipped' + 사유 — 호출부는 기존처럼 승인을 진행하고 사유를 관리자에게 안내한다
 *
 * 수동 발행(ContractTemplatePreviewModal)과 같은 API(init-contract → PATCH content → send-chat)를 같은 순서로 호출해 같은 결과를 만든다.
 * 호출에는 관리자 세션이 필요하므로 SvelteKit 이벤트의 fetch 를 주입한다(그래서 해당 API의 권한 게이트가 그대로 적용된다).
 * ⚠️ 양식 종류별 치환·표식 적용 로직은 ContractTemplatePreviewModal.applySelectedTemplate() 과 같은 규칙이다 — 한쪽을 바꾸면 다른 쪽도 확인할 것.
 */

import { normalizeContractSpecs, mergeContractSpecs } from '$lib/utils/contractSpecs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatKstDateDot } from '$lib/utils/kstDate'
import {
  substituteVariables,
  substituteSpreadsheetDocument,
  substituteHtmlDocument,
  findHtmlUnresolvedVariables,
  applyIssuerSignatureMarker,
  applySpecialNotesMarker,
  applyContractTermsMarker,
  applyPrivacyTermsMarker,
  type AnyContentBlock,
} from '$lib/utils/contract-substitution'
import { applyContractTemplate } from '$lib/utils/contract-apply-template'
import { isSpreadsheetDocument, isHtmlDocument } from '$lib/types/contract-document'
import type { ContractSubstitutionData } from '$lib/types/contract-module'
import { DEFAULT_RENTAL_CONTRACT_HTML } from '$lib/components/cms/contract-editor/templates/defaultRentalContractHtml'

export type AutoIssueSkipReason =
  | 'contract_exists'
  | 'issuer_signature_required'
  | 'contract_data_unavailable'
  | 'unresolved_variables'
  | 'template_invalid'
  | 'issue_failed'
  | 'send_failed'

export type AutoIssueResult =
  | { status: 'off' }
  | { status: 'sent'; contractId: string; templateTitle: string }
  | { status: 'skipped'; reason: AutoIssueSkipReason; message: string }

export interface AutoIssueDeps {
  admin: SupabaseClient
  /** SvelteKit 이벤트 fetch(관리자 세션 쿠키 포함) */
  fetch: typeof fetch
  now?: Date
}

interface TemplateRow {
  id: string
  title: string
  content_blocks: unknown[] | null
  specifications: Array<{ key: string; value: string }> | null
  authoring_mode: 'flow' | 'canvas' | 'spreadsheet' | 'html' | null
  requires_issuer_signature: boolean | null
  canvas_document: unknown
  spreadsheet_document: unknown
  html_document: string | null
  html_issuer_signature_url: string | null
  html_issuer_signature_width: number | null
  html_issuer_signature_offset_x: number | null
  html_issuer_signature_offset_y: number | null
  contract_terms_text: string | null
  privacy_terms_text: string | null
}

const skip = (reason: AutoIssueSkipReason, message: string): AutoIssueResult => ({ status: 'skipped', reason, message })

/** 같은 주문(장바구니 1회 신청)에 속한 예약 id 전부 — 계약서는 주문당 1건이다(init-contract 와 같은 규칙) */
async function orderReservationIds(admin: SupabaseClient, reservationId: number): Promise<number[]> {
  const ids = [reservationId]
  const { data: own } = await admin.from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle()
  const orderId = (own as { order_id: number | null } | null)?.order_id
  if (orderId == null) return ids
  const { data: sibs } = await admin.from('order_items').select('reservation_id').eq('order_id', orderId)
  for (const r of (sibs ?? []) as Array<{ reservation_id: number | null }>) {
    if (r.reservation_id != null && !ids.includes(r.reservation_id)) ids.push(r.reservation_id)
  }
  return ids
}

/** 자동발행 표준양식이 지정돼 있는지(토글 ON) — 예약승인 분기·버튼 상태 표시가 같은 기준을 쓴다(조회 실패는 꺼짐으로 본다). */
export async function hasAutoIssueTemplate(admin: SupabaseClient): Promise<boolean> {
  const { data, error } = await admin
    .from('contract_templates')
    .select('id')
    .eq('auto_issue_default', true)
    .eq('status', 'active')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  return !error && !!data
}

export async function autoIssueContractOnApproval(deps: AutoIssueDeps, reservationId: number): Promise<AutoIssueResult> {
  const { admin } = deps
  const doFetch = deps.fetch
  const now = deps.now ?? new Date()

  // 1) 표준양식 — 없으면 기능 꺼짐
  const { data: tplData, error: tplErr } = await admin
    .from('contract_templates')
    .select('id, title, content_blocks, specifications, authoring_mode, requires_issuer_signature, canvas_document, spreadsheet_document, html_document, html_issuer_signature_url, html_issuer_signature_width, html_issuer_signature_offset_x, html_issuer_signature_offset_y, contract_terms_text, privacy_terms_text')
    .eq('auto_issue_default', true)
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle()
  if (tplErr) return skip('template_invalid', '표준양식을 불러오지 못해 계약서를 자동발행하지 못했어요.')
  const tpl = tplData as TemplateRow | null
  if (!tpl) return { status: 'off' }

  const mode = tpl.authoring_mode ?? 'flow'

  // 2) 이 주문에 이미 계약서가 있으면(발송 전 초안 포함) 덮어쓰거나 중복 발행하지 않는다
  const ids = await orderReservationIds(admin, reservationId)
  // 내용이 없고 발송된 적도 없는 빈 초안(예: 발행 모달만 열었다가 닫아 남은 행)은 '계약서 있음'으로 보지 않고 그 행을 재사용한다 — 빈 초안 때문에 자동발행이 막히던 문제(2026-10-15)
  const { data: existingRows } = await admin
    .from('contracts')
    .select('id, title, content_blocks, canvas_document, spreadsheet_document, html_document')
    .in('reservation_id', ids)
    .is('deleted_at', null)
  let reuseContractId: string | null = null
  for (const row of (existingRows ?? []) as Array<{ id: string; title: string | null; content_blocks: unknown[] | null; canvas_document: unknown; spreadsheet_document: unknown; html_document: string | null }>) {
    const hasContent = (row.content_blocks?.length ?? 0) > 0 || !!row.canvas_document || !!row.spreadsheet_document || !!row.html_document || !!row.title
    const { data: sign } = await admin.from('contract_signings').select('sent_at, signed_at').eq('contract_id', row.id)
    const used = ((sign ?? []) as Array<{ sent_at: string | null; signed_at: string | null }>).some(x => x.sent_at || x.signed_at)
    if (hasContent || used) return skip('contract_exists', '이 주문에는 이미 계약서가 있어 자동발행하지 않았어요.')
    if (!reuseContractId) reuseContractId = row.id
  }

  // 3) 발행자 서명 필수 양식 — HTML 양식만 양식에 저장한 서명 이미지로 충족된다(그 외 종류는 발송 단계에서 항상 차단됨)
  if (tpl.requires_issuer_signature) {
    if (mode !== 'html' || !tpl.html_issuer_signature_url) {
      return skip('issuer_signature_required', '표준양식이 발행자 서명·직인을 필수로 요구하는데 서명이 등록되어 있지 않아 자동발행하지 못했어요.')
    }
  }

  // 4) 치환용 예약 데이터
  let subData: ContractSubstitutionData
  try {
    const res = await doFetch(`/api/cms/reservations/${reservationId}/contract-data`)
    if (!res.ok) return skip('contract_data_unavailable', res.status === 403 ? '이 계정은 계약서를 발행할 권한이 없어 자동발행하지 못했어요.' : '예약 데이터를 불러오지 못해 계약서를 자동발행하지 못했어요.')
    subData = (await res.json()) as ContractSubstitutionData
  } catch {
    return skip('contract_data_unavailable', '예약 데이터를 불러오지 못해 계약서를 자동발행하지 못했어요.')
  }

  // 5) 양식 종류별 치환 — 발행일은 발행 실행 순간의 한국 날짜(ContractTemplatePreviewModal 과 같음)
  const issueSubData = { ...subData, 계약서발행일: formatKstDateDot(now) } as ContractSubstitutionData
  // 예약별 사전 등록 특약(Migration #720)을 양식 특약 뒤에 이어 붙인다 — 컬럼이 없거나 조회 실패면 양식 특약만 쓴다
  let reservationSpecs: Array<{ key: string; value: string }> = []
  try {
    // 화면은 대표 행 기준으로 저장하므로 주문의 어느 예약에 저장돼 있어도 읽는다(자동발행 대상 id와 어긋나도 누락되지 않게)
    const { data: rs, error: rsErr } = await admin.from('rental_reservations').select('id, contract_specifications').in('id', ids)
    if (!rsErr) {
      const rows = ((rs ?? []) as Array<{ id: number; contract_specifications?: unknown }>)
      const own = rows.find(r => r.id === reservationId)
      // 결정적 선택: 자기 예약 → 없으면 id가 가장 작은 예약의 값(조회 순서에 의존하지 않는다)
      const pick = [own, ...[...rows].sort((a, b) => a.id - b.id)].find(r => r && normalizeContractSpecs(r.contract_specifications).length > 0)
      reservationSpecs = normalizeContractSpecs(pick?.contract_specifications)
    }
  } catch { /* 사전 등록 특약 조회 실패 — 양식 특약만 사용 */ }
  const specs = mergeContractSpecs(tpl.specifications, reservationSpecs)
  const isCanvas = mode === 'canvas'
  const isSpreadsheet = mode === 'spreadsheet'
  const isHtml = mode === 'html'

  let htmlSource: string | null = null
  if (isHtml) {
    // html 양식은 DB 스냅샷이 아니라 코드 상수가 정본이다(/api/cms/contract-templates 와 같은 규칙)
    const withSig = applyIssuerSignatureMarker(
      DEFAULT_RENTAL_CONTRACT_HTML,
      tpl.html_issuer_signature_url,
      tpl.html_issuer_signature_width,
      tpl.html_issuer_signature_offset_x,
      tpl.html_issuer_signature_offset_y,
    )
    htmlSource = applyPrivacyTermsMarker(
      applyContractTermsMarker(applySpecialNotesMarker(withSig, specs), tpl.contract_terms_text),
      tpl.privacy_terms_text,
    )
    const missing = findHtmlUnresolvedVariables(DEFAULT_RENTAL_CONTRACT_HTML, issueSubData)
    if (missing.length > 0) {
      return skip('unresolved_variables', `계약서에 채워지지 않은 항목이 있어 자동발행하지 못했어요: ${missing.join(', ')}`)
    }
  }

  const substitutedBlocks: unknown[] =
    isCanvas || isSpreadsheet || isHtml ? [] : substituteVariables((tpl.content_blocks ?? []) as AnyContentBlock[], issueSubData)
  const substitutedSpreadsheet =
    isSpreadsheet && isSpreadsheetDocument(tpl.spreadsheet_document)
      ? substituteSpreadsheetDocument(tpl.spreadsheet_document, issueSubData)
      : undefined
  const substitutedHtml = isHtml && htmlSource && isHtmlDocument(htmlSource) ? substituteHtmlDocument(htmlSource, issueSubData) : undefined
  if ((isSpreadsheet && !substitutedSpreadsheet) || (isHtml && !substitutedHtml)) {
    return skip('template_invalid', '표준양식의 내용이 올바르지 않아 자동발행하지 못했어요.')
  }

  // 6) 계약서 생성 + 내용 저장(수동 발행과 같은 API 순서)
  const applied = await applyContractTemplate({
    contractId: reuseContractId,
    reservationId,
    title: tpl.title,
    contentBlocks: substitutedBlocks,
    specifications: specs,
    templateId: tpl.id,
    authoring_mode: mode,
    canvasDocument: isCanvas ? tpl.canvas_document : undefined,
    spreadsheetDocument: substitutedSpreadsheet,
    htmlDocument: substitutedHtml,
    htmlIssuerSignatureUrl: isHtml ? (tpl.html_issuer_signature_url ?? null) : undefined,
    htmlIssuerSignatureWidth: isHtml ? (tpl.html_issuer_signature_width ?? null) : undefined,
    htmlIssuerSignatureOffsetX: isHtml ? (tpl.html_issuer_signature_offset_x ?? null) : undefined,
    htmlIssuerSignatureOffsetY: isHtml ? (tpl.html_issuer_signature_offset_y ?? null) : undefined,
    contractTermsText: isHtml ? (tpl.contract_terms_text ?? null) : undefined,
    privacyTermsText: isHtml ? (tpl.privacy_terms_text ?? null) : undefined,
    fetchFn: doFetch,
  })
  if (applied.error || !applied.contractId) {
    return skip('issue_failed', `계약서를 만들지 못해 자동발행하지 못했어요: ${applied.error ?? '알 수 없는 오류'}`)
  }
  const contractId = applied.contractId

  // 7) 고객에게 발송(서명 링크 + 채팅 카드) — 실패하면 방금 만든 초안을 되돌려 '발행된 것처럼' 남지 않게 한다
  let sendError: string | null = null
  try {
    const sendRes = await doFetch(`/api/cms/contracts/${contractId}/send-chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    if (!sendRes.ok) {
      const body = (await sendRes.json().catch(() => ({}))) as { error?: string }
      sendError = body.error ?? '발송 실패'
    }
  } catch (e) {
    sendError = e instanceof Error ? e.message : '발송 실패'
  }
  if (sendError) {
    // 되돌리기 결과를 확인한다 — send-chat 이 서명 링크(sent_at)를 먼저 기록한 뒤 채팅 전달에서 실패했다면 되돌리기가 거부되어
    // 계약서가 일부 발행된 상태로 남는다. 이때는 '아무것도 안 됐다'고 안내하면 안 된다.
    const del = await doFetch(`/api/cms/contracts/${contractId}/content`, { method: 'DELETE' }).catch(() => null)
    if (del && del.ok) return skip('send_failed', `계약서를 고객에게 발송하지 못해 자동발행하지 못했어요: ${sendError}`)
    return skip('send_failed', `계약서 발송 중 오류가 나 일부만 발행되었을 수 있어요. 예약의 '계약서' 탭에서 발송 상태를 확인해 주세요: ${sendError}`)
  }

  return { status: 'sent', contractId, templateTitle: tpl.title }
}
