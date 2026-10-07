/**
 * generateArchive.ts — 서명 완료 계약서의 최종본 PDF 생성·불변 보관
 *
 * 입력은 서명 증적 행(contract_signature_evidence, 서명 이벤트 1건 = 1행). 처리:
 *   서명 합성본 HTML 확정 → 스크립트 제거 → 직인 이미지 내장 → 증적 요약·약관 부록 조립 → PDF 렌더 →
 *   비공개 버킷에 upsert:false로 저장 → contract_final_documents 기록(추가 전용) → contracts.document_url 갱신 → 감사 이벤트.
 *
 * 원본/재생성 구분(source):
 *   - original    : 서명 시점에 저장된 최종본 HTML(contracts.html_document)의 SHA-256이 증적의 final_html_sha256과 같을 때
 *   - regenerated : 그 외 — 서명 시점 스냅샷 + 저장된 서명 이미지로 다시 만든 사본(소급·해시 불일치·되굽기 실패).
 *                   증적에 동의 기록이 없는 소급 증적(consent_log 빈 배열)은 항상 regenerated.
 * 재생성본은 서명 당시 약관 사본 기록이 없으면 약관 부록을 넣지 않는다(현재 약관을 당시 교부본처럼 첨부 금지).
 *
 * 멱등: 같은 증적을 다시 처리해도 중복 행을 만들지 않는다(evidence_id UNIQUE, 버킷 upsert:false — 이미 올라간
 * 파일이 있으면 그 바이트를 그대로 채택해 기록만 이어서 만든다).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { applyCustomerSignatureMarker } from '$lib/utils/contract-substitution'
import { formatKstDateTimeDot } from '$lib/utils/kstDate'
import { recordAuditLog } from '$lib/contract-signature/auditLog'
import { sha256Hex } from '$lib/contract-signature/signatureEvidence'
import { buildArchiveHtml, type ArchiveTerms } from './archiveHtml'
import { ARCHIVE_FONT_CSS } from './fontCss'
import { inlineStorageImages, type ImageFetcher } from './inlineImages'
import { renderHtmlToPdf } from './renderPdf'
import { sanitizeArchiveHtml } from './sanitizeArchiveHtml'

export const ARCHIVE_BUCKET = 'contract-archives'
export const ARCHIVE_GENERATOR_VERSION = 'archive-v1/chromium-153'
const MARKER = '<!--CUSTOMER_SIGNATURE-->'

export interface EvidenceRecord {
  id: string
  contract_id: string
  signing_id: string
  reservation_id: number | string | null
  signed_at: string
  ip_address: string | null
  user_agent: string | null
  consent_log: unknown
  final_html_sha256: string | null
  terms_text: string | null
  refund_text: string | null
  privacy_text: string | null
  terms_sha256: string | null
  refund_sha256: string | null
  privacy_sha256: string | null
}

export const EVIDENCE_COLUMNS =
  'id, contract_id, signing_id, reservation_id, signed_at, ip_address, user_agent, consent_log, final_html_sha256, terms_text, refund_text, privacy_text, terms_sha256, refund_sha256, privacy_sha256'

export type ArchiveResult =
  | { ok: true; finalDocumentId: string | null; source: 'original' | 'regenerated'; pdfPath: string; bytes: number; alreadyArchived: boolean }
  | { ok: false; reason: string; permanent?: boolean }

/** 다시 시도해도 결과가 같은 실패 사유 — 큐에서 제외해 뒤 건이 막히지 않게 한다(일시 오류는 재시도 대상). */
export const PERMANENT_FAILURE_REASONS = [
  'contract_not_found',
  'signing_not_found',
  'signing_changed_after_evidence',
  'signature_data_missing',
  'unsupported_authoring_mode',
] as const

export interface ArchiveDeps {
  render?: (html: string) => Promise<{ pdf: Uint8Array }>
  fetchImage?: ImageFetcher
  now?: () => Date
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface ConsentEntry { label: string; checked: boolean; textSha256: string | null }

function parseConsentLog(raw: unknown): ConsentEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.map((e) => {
    const o = (e ?? {}) as { label?: unknown; checked?: unknown; text_sha256?: unknown }
    return { label: typeof o.label === 'string' ? o.label : '', checked: o.checked === true, textSha256: typeof o.text_sha256 === 'string' ? o.text_sha256 : null }
  })
}

function isLegacyEvidence(ev: EvidenceRecord): boolean {
  return !Array.isArray(ev.consent_log) || ev.consent_log.length === 0
}

interface SourceDocument {
  html: string
  source: 'original' | 'regenerated'
}

/** 서명 합성본 HTML을 확정한다. 확정할 수 없으면 사유 문자열을 던진다(호출부가 ok:false로 변환). */
async function resolveSourceDocument(admin: SupabaseClient, ev: EvidenceRecord): Promise<SourceDocument> {
  const [{ data: contract }, { data: signing }] = await Promise.all([
    admin.from('contracts').select('authoring_mode, html_document').eq('id', ev.contract_id).maybeSingle(),
    admin.from('contract_signings').select('signed_at, signature_data, signed_content_snapshot').eq('id', ev.signing_id).maybeSingle(),
  ])
  const live = contract as { authoring_mode: string | null; html_document: unknown } | null
  if (!live) throw new Error('contract_not_found')

  // 1) 서명 시점 원본: 저장된 최종본이 증적의 해시와 일치
  if (!isLegacyEvidence(ev) && ev.final_html_sha256 && typeof live.html_document === 'string' && live.authoring_mode === 'html') {
    if ((await sha256Hex(live.html_document)) === ev.final_html_sha256) {
      return { html: live.html_document, source: 'original' }
    }
  }

  // 2) 재생성: 서명 시점 스냅샷 + 저장된 서명 이미지
  const sig = signing as { signed_at: string | null; signature_data: string | null; signed_content_snapshot: unknown } | null
  if (!sig || !sig.signed_at) throw new Error('signing_not_found')
  if (new Date(sig.signed_at).getTime() !== new Date(ev.signed_at).getTime()) throw new Error('signing_changed_after_evidence')
  if (!sig.signature_data) throw new Error('signature_data_missing')
  const snapshot = (sig.signed_content_snapshot ?? null) as { authoring_mode?: string | null; html_document?: unknown } | null
  const snapHtml = snapshot?.html_document
  if (!snapshot || snapshot.authoring_mode !== 'html' || typeof snapHtml !== 'string') throw new Error('unsupported_authoring_mode')
  const baked = snapHtml.includes(MARKER) ? applyCustomerSignatureMarker(snapHtml, sig.signature_data) : snapHtml
  return { html: baked, source: 'regenerated' }
}

export async function archiveEvidence(admin: SupabaseClient, ev: EvidenceRecord, deps: ArchiveDeps = {}): Promise<ArchiveResult> {
  const now = deps.now ?? (() => new Date())
  try {
    const { data: existing } = await admin.from('contract_final_documents').select('id, pdf_path, size_bytes, source').eq('evidence_id', ev.id).maybeSingle()
    if (existing) {
      const row = existing as { id: string; pdf_path: string; size_bytes: number; source: 'original' | 'regenerated' }
      return { ok: true, finalDocumentId: row.id, source: row.source, pdfPath: row.pdf_path, bytes: row.size_bytes, alreadyArchived: true }
    }

    const doc = await resolveSourceDocument(admin, ev)
    const storedHtmlSha = await sha256Hex(doc.html)

    let reservationCode: string | null = null
    if (ev.reservation_id != null) {
      const { data: r } = await admin.from('rental_reservations').select('reservation_code').eq('id', ev.reservation_id).maybeSingle()
      reservationCode = (r as { reservation_code: string | null } | null)?.reservation_code ?? null
    }

    const inlined = await inlineStorageImages(sanitizeArchiveHtml(doc.html), {
      allowedBase: `${getSupabaseUrl()}/storage/v1/object/public/`,
      fetchImage: deps.fetchImage,
    })

    const hasTerms = ev.terms_text != null || ev.refund_text != null || ev.privacy_text != null
    const terms: ArchiveTerms | null = hasTerms ? { terms: ev.terms_text, refund: ev.refund_text, privacy: ev.privacy_text } : null

    const archiveHtml = buildArchiveHtml({
      contractHtml: inlined.html,
      evidence: {
        contractId: ev.contract_id,
        signingId: ev.signing_id,
        reservationCode,
        signedAtKst: formatKstDateTimeDot(new Date(ev.signed_at)),
        ipAddress: ev.ip_address,
        userAgent: ev.user_agent,
        finalHtmlSha256: ev.final_html_sha256,
        archivedHtmlSha256: storedHtmlSha,
        consents: parseConsentLog(ev.consent_log),
        termsSha256: ev.terms_sha256,
        refundSha256: ev.refund_sha256,
        privacySha256: ev.privacy_sha256,
        source: doc.source,
        generatedAtKst: formatKstDateTimeDot(now()),
      },
      terms,
      fontCss: ARCHIVE_FONT_CSS,
    })

    const render = deps.render ?? ((html: string) => renderHtmlToPdf(html))
    const { pdf } = await render(archiveHtml)
    if (!pdf || pdf.byteLength < 1000 || Buffer.from(pdf.subarray(0, 5)).toString() !== '%PDF-') throw new Error('invalid_pdf_output')

    // 같은 서명 이벤트를 두 번 올리지 않는다 — 경로에 증적 id를 넣어 재서명(같은 signing_id, 다른 signed_at)과도 겹치지 않는다
    const pdfPath = `${ev.contract_id}/${ev.id}.pdf`
    let bytes: Uint8Array = pdf
    const up = await admin.storage.from(ARCHIVE_BUCKET).upload(pdfPath, pdf, { contentType: 'application/pdf', upsert: false })
    if (up.error) {
      const msg = String((up.error as { message?: string }).message ?? '')
      if (!/already exists|duplicate|409/i.test(msg)) throw new Error(`storage_upload_failed: ${msg}`)
      // 이전 시도에서 파일만 올라가고 기록이 실패한 경우 — 올라간 파일을 그대로 채택한다(불변)
      const dl = await admin.storage.from(ARCHIVE_BUCKET).download(pdfPath)
      if (dl.error || !dl.data) throw new Error('storage_existing_unreadable')
      bytes = new Uint8Array(await dl.data.arrayBuffer())
    }

    const { data: inserted, error: insErr } = await admin
      .from('contract_final_documents')
      .insert({
        evidence_id: ev.id,
        contract_id: ev.contract_id,
        signing_id: ev.signing_id,
        pdf_path: pdfPath,
        pdf_sha256: await sha256Bytes(bytes),
        html_sha256: storedHtmlSha,
        size_bytes: bytes.byteLength,
        source: doc.source,
        generator_version: ARCHIVE_GENERATOR_VERSION,
      })
      .select('id')
      .single()
    if (insErr) {
      if ((insErr as { code?: string }).code === '23505') {
        return { ok: true, finalDocumentId: null, source: doc.source, pdfPath, bytes: bytes.byteLength, alreadyArchived: true }
      }
      throw new Error(`final_document_insert_failed: ${insErr.message}`)
    }
    const finalDocumentId = (inserted as { id: string }).id

    // 뷰어가 쓰는 주소(안정적인 내부 경로) — 실패해도 보관 자체는 완료된 것으로 본다
    const { error: urlErr } = await admin.from('contracts').update({ document_url: `/api/cms/contracts/${ev.contract_id}/final-pdf` }).eq('id', ev.contract_id)
    if (urlErr) console.error('[contractArchive] document_url 갱신 실패(fail-soft):', urlErr.message)

    const audit = admin as Parameters<typeof recordAuditLog>[0]
    await recordAuditLog(audit, {
      contractId: ev.contract_id, eventType: 'archive_created', actorType: 'system', actorId: null, ipAddress: null,
      metadata: { final_document_id: finalDocumentId, source: doc.source, bytes: bytes.byteLength, generator: ARCHIVE_GENERATOR_VERSION, images_inlined: inlined.inlined.length, images_failed: inlined.failed.length },
    })
    // 교부 기록 — 서명 당시 약관 사본이 든 PDF를 고객이 받을 수 있게 된 시점(마이페이지 계약서 화면의 사본 받기 링크)
    await recordAuditLog(audit, {
      contractId: ev.contract_id, eventType: 'copy_sent', actorType: 'system', actorId: null, ipAddress: null,
      metadata: { final_document_id: finalDocumentId, kind: 'available', channel: 'account_contract_page', has_terms_appendix: hasTerms },
    })

    return { ok: true, finalDocumentId, source: doc.source, pdfPath, bytes: bytes.byteLength, alreadyArchived: false }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    return { ok: false, reason, permanent: (PERMANENT_FAILURE_REASONS as readonly string[]).includes(reason) }
  }
}

/**
 * 실패한 건의 재시도 대기 시간 — 실패 횟수가 늘수록 길어지되(10분·20분·40분·80분·이후 2시간) 상한이 있어 영구 정지는 없다.
 * 일시 장애(Chromium 기동 실패·Storage/DB 오류 등)는 장애가 풀리면 늦어도 2시간 안에 스스로 복구된다.
 * 독성 건(계속 실패하는 건)은 2시간에 1번만 시도해 큐를 막지 못한다.
 */
export function archiveRetryDelayMs(failCount: number): number {
  if (failCount <= 0) return 0
  return Math.min(10 * 60_000 * 2 ** (failCount - 1), 2 * 60 * 60_000)
}

/** 이 횟수 이상 실패한 건은 "오래 막힌 건"으로 모니터링(크론 응답 stalled·서버 로그)한다. */
export const STALLED_FAILURE_COUNT = 5

/**
 * 보관 실패를 감사로그에 남긴다(증적 행은 수정할 수 없어 별도 기록으로 큐 순서·제외를 관리한다).
 * 기록 자체가 실패하면 false — 호출부가 서버 로그로 남긴다.
 */
export async function recordArchiveFailure(admin: SupabaseClient, ev: EvidenceRecord, reason: string, permanent: boolean): Promise<boolean> {
  const { error } = await admin.from('contract_audit_log').insert({
    contract_id: ev.contract_id, event_type: 'evidence_failed', actor_type: 'system', actor_id: null, ip_address: null,
    metadata: { stage: 'archive', evidence_id: ev.id, reason, permanent },
  })
  if (error) console.error('[contractArchive] 실패 기록 저장 실패:', ev.id, (error as { message?: string }).message)
  return !error
}

export interface PendingEvidenceResult {
  /** 지금 시도할 증적(실패가 적은 건 우선, 같으면 오래된 순) */
  items: EvidenceRecord[]
  /** 재시도 대기 시간이 아직 안 지나 이번에는 건너뛴 건수 */
  waiting: number
  /** 실패가 STALLED_FAILURE_COUNT회 이상 쌓인 건수(모니터링 대상) */
  stalled: number
}

// URL 길이 한도(약 8KB)를 넘지 않도록 .in()에 넣는 id 수를 작게 유지한다(UUID 50개 ≈ 1.9KB)
const QUERY_PAGE = 50
const MAX_SCAN_PAGES = 40

/**
 * 보관본이 아직 없는 서명 증적.
 * "보관본 없음"은 DB에서 한 번에 거른다(contract_final_documents.evidence_id FK를 이용한 anti-join) — 보관 완료 건이 늘어도
 * 매번 처음부터 훑지 않는다. 계약이 삭제된 증적(원본 없음)·영구 실패 건은 제외하고, 실패 이력이 있는 건은 재시도 대기 시간이
 * 지난 뒤에만 다시 돌려준다(ignoreBackoff면 대기 무시 — 운영자 수동 재시도).
 */
export async function listPendingEvidence(
  admin: SupabaseClient,
  limit: number,
  opts: { now?: Date; ignoreBackoff?: boolean } = {},
): Promise<PendingEvidenceResult> {
  const now = (opts.now ?? new Date()).getTime()
  const gather = limit * 2 // 우선순위 정렬을 위해 여유 있게 모은 뒤 limit만큼 자른다
  const eligible: { ev: EvidenceRecord; fails: number }[] = []
  let waiting = 0
  let stalled = 0

  for (let page = 0; page < MAX_SCAN_PAGES && eligible.length < gather; page++) {
    const from = page * QUERY_PAGE
    const { data, error } = await admin
      .from('contract_signature_evidence')
      .select(`${EVIDENCE_COLUMNS}, contract_final_documents!left(id)`)
      .is('contract_final_documents', null)
      .order('captured_at', { ascending: true })
      .range(from, from + QUERY_PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = ((data ?? []) as (EvidenceRecord & { contract_final_documents?: unknown })[]).map((r) => {
      const { contract_final_documents: _joined, ...ev } = r
      void _joined
      return ev as EvidenceRecord
    })
    if (rows.length === 0) break

    const contractIds = [...new Set(rows.map((r) => r.contract_id))]
    // 계약이 삭제된 증적은 PDF를 만들 원본이 없다(증적은 계약과 FK가 없어 남는다) — 제외
    const { data: alive, error: aliveErr } = await admin.from('contracts').select('id').in('id', contractIds)
    if (aliveErr) throw new Error(aliveErr.message)
    const aliveIds = new Set(((alive ?? []) as { id: string }[]).map((c) => c.id))
    const { data: logs, error: logErr } = await admin.from('contract_audit_log').select('metadata, created_at').eq('event_type', 'evidence_failed').in('contract_id', contractIds)
    if (logErr) throw new Error(logErr.message)
    const failCount = new Map<string, number>()
    const lastFailAt = new Map<string, number>()
    const permanentIds = new Set<string>()
    for (const l of (logs ?? []) as { metadata: { stage?: string; evidence_id?: string; permanent?: boolean } | null; created_at: string }[]) {
      const m = l.metadata
      if (m?.stage !== 'archive' || !m.evidence_id) continue
      failCount.set(m.evidence_id, (failCount.get(m.evidence_id) ?? 0) + 1)
      lastFailAt.set(m.evidence_id, Math.max(lastFailAt.get(m.evidence_id) ?? 0, new Date(l.created_at).getTime()))
      if (m.permanent) permanentIds.add(m.evidence_id)
    }

    for (const ev of rows) {
      if (!aliveIds.has(ev.contract_id) || permanentIds.has(ev.id)) continue
      const fails = failCount.get(ev.id) ?? 0
      if (fails >= STALLED_FAILURE_COUNT) stalled++
      const dueAt = (lastFailAt.get(ev.id) ?? 0) + archiveRetryDelayMs(fails)
      if (!opts.ignoreBackoff && fails > 0 && now < dueAt) { waiting++; continue }
      eligible.push({ ev, fails })
    }
    if (rows.length < QUERY_PAGE) break
  }

  eligible.sort((a, b) => a.fails - b.fails) // Array.sort는 안정 정렬 — 같은 횟수면 오래된 순(수집 순서) 유지
  return { items: eligible.slice(0, limit).map((e) => e.ev), waiting, stalled }
}

interface LegacySigning {
  id: string
  contract_id: string
  signed_at: string
  ip_address: string | null
  content_hash: string | null
  signature_data: string | null
}

/**
 * 소급(서명 증적 도입 전 서명 건): 증적 행이 없는 서명 완료 건에 "소급 증적"을 만든다.
 * 동의 기록·UA·약관 스냅샷은 당시 기록이 없으므로 비워 둔다(consent_log 빈 배열 = 소급 표시). 서명 일시·IP·서명 이미지 해시는 실제 값.
 * 서명 완료 건을 오래된 순으로 50건씩 끝까지 훑는다(.in()에 많은 id를 넣어 URL 한도를 넘지 않게, 처음 N건만 보고 끝내지 않게).
 */
export async function listLegacySignings(admin: SupabaseClient, limit: number): Promise<LegacySigning[]> {
  const out: LegacySigning[] = []
  for (let page = 0; page < 200 && out.length < limit; page++) {
    const from = page * QUERY_PAGE
    const { data, error } = await admin
      .from('contract_signings')
      .select('id, contract_id, signed_at, ip_address, content_hash, signature_data')
      .not('signed_at', 'is', null)
      .order('signed_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + QUERY_PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as LegacySigning[]
    if (rows.length === 0) break
    const { data: evs, error: evErr } = await admin.from('contract_signature_evidence').select('signing_id, signed_at').in('signing_id', rows.map((r) => r.id))
    if (evErr) throw new Error(evErr.message)
    const have = new Set(((evs ?? []) as { signing_id: string; signed_at: string }[]).map((e) => `${e.signing_id}|${new Date(e.signed_at).getTime()}`))
    for (const r of rows) if (!have.has(`${r.id}|${new Date(r.signed_at).getTime()}`)) out.push(r)
    if (rows.length < QUERY_PAGE) break
  }
  return out.slice(0, limit)
}

export async function createLegacyEvidence(admin: SupabaseClient, s: LegacySigning): Promise<EvidenceRecord | null> {
  const { data: contract } = await admin.from('contracts').select('reservation_id').eq('id', s.contract_id).maybeSingle()
  const row = {
    contract_id: s.contract_id,
    signing_id: s.id,
    reservation_id: (contract as { reservation_id: number | null } | null)?.reservation_id ?? null,
    signed_at: s.signed_at,
    ip_address: s.ip_address,
    user_agent: null,
    consent_log: [],
    content_hash: s.content_hash,
    final_html_sha256: null,
    signature_image_sha256: s.signature_data ? await sha256Hex(s.signature_data) : null,
  }
  const { data, error } = await admin.from('contract_signature_evidence').insert(row).select(EVIDENCE_COLUMNS).single()
  if (error) {
    if ((error as { code?: string }).code === '23505') return null
    throw new Error(error.message)
  }
  return data as EvidenceRecord
}
