/**
 * GET /api/account/rental/[id]/contract-pdf — 고객 본인의 서명 완료 계약서 최종본 PDF(약관 사본 포함) 내려받기
 *
 * [id] = 예약 ID. 소유권은 고객 세션 클라이언트(RLS)로 확인한다 — 타 고객 예약 ID는 존재 여부도 노출하지 않는다(404).
 * 같은 주문의 형제 예약이 계약을 대표로 가질 수 있어(/account/rental/[id]/contract 와 같은 규칙) 주문 전체의 계약을 대상으로 찾는다.
 * 현재 유효한 서명의 보관본만 내려준다(재서명 전 취소된 서명본 제외). 보관본별 최초 다운로드는 감사로그(copy_downloaded)에 시각·IP와 함께 남긴다(약관 사본 교부 증빙).
 */
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { recordAuditLog } from '$lib/contract-signature/auditLog'
import { loadLatestArchivedPdf, pdfResponse } from '$lib/server/contractArchive/loadArchivedPdf'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ params, locals, getClientAddress }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const reservationId = Number.parseInt(params.id, 10)
  if (!Number.isFinite(reservationId) || reservationId <= 0) return json({ error: '유효하지 않은 예약 ID입니다.' }, { status: 400 })

  const { data: reservation } = await locals.supabase
    .from('rental_reservations')
    .select('id')
    .eq('id', reservationId)
    .eq('user_id', session.user.id)
    .maybeSingle()
  if (!reservation) return json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let reservationIds: (string | number)[] = [reservationId]
  const { data: item } = await admin.from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle()
  const orderId = (item as { order_id?: string | number | null } | null)?.order_id
  if (orderId != null) {
    const { data: siblings } = await admin.from('order_items').select('reservation_id').eq('order_id', orderId)
    const ids = ((siblings ?? []) as { reservation_id: string | number | null }[]).map((r) => r.reservation_id).filter((v): v is string | number => v != null)
    if (ids.length > 0) reservationIds = ids
  }

  const { data: contracts } = await admin.from('contracts').select('id').in('reservation_id', reservationIds)
  const contractIds = ((contracts ?? []) as { id: string }[]).map((c) => c.id)

  // 이 고객의 서명이 아닌 계약의 PDF가 내려가지 않도록 서명자 본인 확인
  const { data: mySignings } = await admin.from('contract_signings').select('contract_id').in('contract_id', contractIds.length ? contractIds : ['00000000-0000-0000-0000-000000000000']).eq('user_id', session.user.id).not('signed_at', 'is', null)
  const ownContractIds = ((mySignings ?? []) as { contract_id: string }[]).map((s) => s.contract_id)

  const pdf = await loadLatestArchivedPdf(admin, ownContractIds)
  if (!pdf) return json({ error: '계약서 사본(PDF)을 준비 중입니다. 잠시 후 다시 시도해 주세요.' }, { status: 404 })

  const audit = admin as Parameters<typeof recordAuditLog>[0]
  // 최초 다운로드만 기록 — 보관본(final_document_id) 단위로 판정해 재서명·재생성으로 새 보관본이 생기면 그 최초 다운로드도 남는다
  const { data: prior, error: priorErr } = await admin.from('contract_audit_log').select('metadata').eq('contract_id', pdf.contractId).eq('event_type', 'copy_downloaded')
  if (priorErr) console.error('[contract-pdf] 기존 다운로드 기록 조회 실패(fail-soft):', priorErr.message)
  const already = ((prior ?? []) as { metadata: { final_document_id?: string } | null }[]).some((r) => r.metadata?.final_document_id === pdf.finalDocumentId)
  if (!already) {
    let ip: string | null = null
    try { ip = getClientAddress() } catch { ip = null }
    await recordAuditLog(audit, {
      contractId: pdf.contractId,
      eventType: 'copy_downloaded',
      actorType: 'customer',
      actorId: session.user.id,
      ipAddress: ip,
      metadata: { final_document_id: pdf.finalDocumentId, source: pdf.source },
    })
  }

  return pdfResponse(pdf, `crazyshot-contract-${reservationId}.pdf`, 'attachment')
}
