/**
 * sealPending.ts — 봉인이 없는 "최근" 보관본에 봉인을 만든다(크론 보강)
 *
 * 대상 제한(2026-10-08, sp3 MAJOR-1 / Stephen A안): 방금 만들어진 보관본(기본 6시간 이내)만 자동으로 봉인한다.
 *   키가 크론에 있어서, 오래된 미봉인 문서를 자동으로 봉인하면 "파일과 DB 지문을 함께 바꾼 변조본"에도 정식 서명이 찍힐 수 있다.
 *   그보다 오래된 미봉인 문서(키 도입 전 생성분 등)는 관리자가 직접 확인 후 수동 봉인한다(seal API POST).
 * 이미 봉인된 적이 있는 보관본(봉인 표식 있음)의 봉인 행이 없으면 다시 봉인하지 않고 경보만 남긴다.
 * 보관 파일의 지문이 기록과 다르면 봉인하지 않고 경보(같은 보관본은 24시간에 1회만 기록)를 남긴다.
 * 처리 실패(증적·파일 읽기, 봉인 저장 오류)도 경보를 남긴다 — 6시간이 지나 자동 대상에서 빠지면 수동 봉인 대상이 되므로 미리 알린다.
 *
 * 방어가 성립하는 전제와 남는 한계(정직한 표기):
 *  - 전제: DB 쓰기 권한자도 서버 비밀키는 갖지 못한다. 크론은 "파일 지문 = DB 기록 지문"만 확인하므로,
 *    봉인 행·감사로그 표식·보관 파일·DB 지문·generated_at을 모두 고칠 수 있는 내부자는 최근 6시간 구간 안에서
 *    변조본을 봉인시킬 수 있다(윈도우 안에서 파일과 지문을 함께 바꾼 경우 포함). 자세한 한계는 sealArchive.ts hasSealMarker 주석.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAuditLog } from '$lib/contract-signature/auditLog'
import { ARCHIVE_BUCKET } from './generateArchive'
import { sha256OfBytes } from './loadArchivedPdf'
import { hasSealMarker, sealFinalDocument } from './sealArchive'
import type { SealKey } from './seal'

export const SEAL_AUTO_WINDOW_MS = 6 * 60 * 60_000
const ALARM_DEDUPE_MS = 24 * 60 * 60_000

export interface SealPendingResult {
  sealed: number
  failed: number
  skippedMismatch: number
  skippedMissingAfterSealed: number
  /** 계약이 삭제돼 건너뛴 건수 */
  skippedContractGone: number
  /** 시간 예산이 다 돼 이번에 처리하지 못한 건수 */
  deferred: number
}

export async function sealPendingDocuments(
  admin: SupabaseClient,
  key: SealKey,
  limit: number,
  opts: { now?: Date; windowMs?: number; deadlineMs?: number } = {},
): Promise<SealPendingResult> {
  const now = (opts.now ?? new Date()).getTime()
  const out: SealPendingResult = { sealed: 0, failed: 0, skippedMismatch: 0, skippedMissingAfterSealed: 0, skippedContractGone: 0, deferred: 0 }
  const cutoff = new Date(now - (opts.windowMs ?? SEAL_AUTO_WINDOW_MS)).toISOString()
  const { data, error } = await admin
    .from('contract_final_documents')
    .select('id, contract_id, signing_id, evidence_id, pdf_path, pdf_sha256, source, contract_final_document_seals!left(id)')
    .is('contract_final_document_seals', null)
    .gte('generated_at', cutoff)
    .order('generated_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)
  const docs = (data ?? []) as { id: string; contract_id: string; signing_id: string; evidence_id: string; pdf_path: string; pdf_sha256: string; source: 'original' | 'regenerated' }[]

  // 계약이 삭제된 보관본은 봉인하지 않는다 — 증적·보관본은 계약과 FK가 없어 남지만, 감사로그(계약 FK)에 표식·경보를 기록할 수 없고
  // 봉인할 실익도 없다(Stage 종단 확인에서 발견, listPendingEvidence의 "계약 삭제 건 제외"와 같은 규칙)
  const contractIds = [...new Set(docs.map((d) => d.contract_id))]
  let aliveIds = new Set<string>()
  if (contractIds.length > 0) {
    const { data: alive, error: aliveErr } = await admin.from('contracts').select('id').in('id', contractIds)
    if (aliveErr) throw new Error(aliveErr.message)
    aliveIds = new Set(((alive ?? []) as { id: string }[]).map((c) => c.id))
  }

  // 같은 경보를 반복 기록하지 않는다(24시간에 1회)
  const alarmedRecently = async (docId: string, reason: string): Promise<boolean> => {
    const since = new Date(Date.now() - ALARM_DEDUPE_MS).toISOString()
    const { data: rows, error: lookupErr } = await admin.from('contract_audit_log').select('id')
      .eq('event_type', 'evidence_failed').eq('metadata->>stage', 'seal').eq('metadata->>reason', reason).eq('metadata->>final_document_id', docId).gte('created_at', since).limit(1)
    if (lookupErr) {
      // 감사로그 조회가 실패한 동안에는 경보 기록도 실패할 가능성이 높다 — 크론마다 재시도하지 않고 건너뛴다(복구 후 다음 실행에서 기록)
      console.error('[contractArchive] 경보 중복 조회 실패(경보 건너뜀):', docId, reason, (lookupErr as { message?: string }).message)
      return true
    }
    return ((rows ?? []) as unknown[]).length > 0
  }
  const alarm = async (doc: { id: string; contract_id: string }, reason: string): Promise<void> => {
    if (await alarmedRecently(doc.id, reason)) return
    await recordAuditLog(admin as Parameters<typeof recordAuditLog>[0], {
      contractId: doc.contract_id, eventType: 'evidence_failed', actorType: 'system', actorId: null, ipAddress: null,
      metadata: { stage: 'seal', reason, final_document_id: doc.id },
    })
  }

  for (let i = 0; i < docs.length; i++) {
    if (opts.deadlineMs != null && Date.now() > opts.deadlineMs) { out.deferred = docs.length - i; break }
    const doc = docs[i]
    if (!aliveIds.has(doc.contract_id)) { out.skippedContractGone++; continue }
    let marked: boolean
    try { marked = await hasSealMarker(admin, doc.id) } catch (e) {
      // 표식 조회 오류는 "표식 없음"으로 보지 않는다(fail-closed) — 이번 턴은 건너뛰고 다음 턴에 다시 본다
      out.failed++
      console.error('[contractArchive] 봉인 표식 조회 실패(건너뜀):', doc.id, e instanceof Error ? e.message : e)
      await alarm(doc, 'seal_marker_lookup_failed') // 계속 실패하다 6시간 창을 벗어나는 일을 놓치지 않게(24시간 1회)
      continue
    }
    if (marked) { out.skippedMissingAfterSealed++; await alarm(doc, 'seal_missing_after_sealed'); continue }
    const [{ data: ev }, dl] = await Promise.all([
      admin.from('contract_signature_evidence').select('signed_at').eq('id', doc.evidence_id).maybeSingle(),
      admin.storage.from(ARCHIVE_BUCKET).download(doc.pdf_path),
    ])
    const signedAt = (ev as { signed_at: string } | null)?.signed_at
    if (!signedAt || dl.error || !dl.data) { out.failed++; await alarm(doc, signedAt ? 'archive_file_unreadable' : 'evidence_missing'); continue }
    const bytes = new Uint8Array(await dl.data.arrayBuffer())
    if ((await sha256OfBytes(bytes)) !== doc.pdf_sha256) {
      out.skippedMismatch++
      await alarm(doc, 'archive_hash_mismatch')
      continue
    }
    const r = await sealFinalDocument(admin, {
      finalDocumentId: doc.id, contractId: doc.contract_id, evidenceId: doc.evidence_id, signingId: doc.signing_id,
      signedAt, pdfSha256: doc.pdf_sha256, source: doc.source,
    }, bytes, key)
    if (r.ok) { if (!r.alreadySealed) out.sealed++ } else { out.failed++; console.error('[contractArchive] 봉인 실패:', doc.id, r.reason); await alarm(doc, 'seal_failed') }
  }
  return out
}
