/**
 * sealArchive.ts — 최종본 PDF에 서명 봉인을 만들고 점검한다
 *
 * sealFinalDocument : 보관 직후(또는 뒤늦게) 봉인 1건 생성. 쪽별 지문 지도는 PDF 바이트에서 뽑는다.
 *   지도 추출이 실패해도(암호화·손상 등) 봉인은 만든다 — 빈 지도로 봉인하고 변경 위치 분석만 불가가 된다.
 * checkSeal         : 현재 DB 기록으로 봉인 메시지를 다시 만들어 서명을 검증한다.
 *   DB의 PDF 지문·증적·보관본 기록 중 하나라도 봉인 이후 바뀌면 'invalid' — 내부자가 DB를 고쳐도 비밀키 없이는 새 서명을 못 만든다.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildPageMap, extractPageTexts, pageMapSha256, parsePageMap, type PageMap } from './pdfFingerprint'
import { buildSealMessage, SEAL_ALGORITHM, SEAL_VERSION, signSeal, verifySealSignature, type SealKey, type SealPublicKey } from './seal'

export interface SealTarget {
  finalDocumentId: string
  contractId: string
  evidenceId: string
  signingId: string
  signedAt: string
  pdfSha256: string
  source: 'original' | 'regenerated'
}

/**
 * 봉인 기록(감사로그 표식) — 봉인 행과 별도 테이블에 "이 보관본은 봉인됐다"는 사실을 남긴다.
 * 봉인 행이 지워진 보관본(unsealed로 위장)에 크론이 새 서명을 찍어 주지 못하게 하는 장치다.
 *
 * 방어가 성립하는 전제와 남는 한계(정직한 표기):
 *  - 전제: DB 쓰기 권한자도 서버 비밀키(ARCHIVE_SEAL_KEY)는 갖지 못한다. 이미 만들어진 봉인은 키 없이 위조할 수 없다.
 *  - 한계 ①: 봉인 행·이 표식(감사로그)·보관 파일·DB 지문·생성 시각(generated_at)을 모두 고칠 수 있는 내부자가 있으면,
 *    자동 봉인 구간(최근 6시간) 안에서 변조본을 봉인시킬 수 있다 — 봉인은 "그 시점의 DB 기록과 파일이 같다"만 증명한다.
 *  - 한계 ②: 수동 봉인도 같다 — DB의 pdf_sha256 자체가 이미 조작됐다면 파일 지문 일치 검사는 변조본을 통과시킨다.
 *  - 이 표식은 감사로그 행이라 같은 권한자가 지울 수 있다. 변조 난이도를 한 단계 올리는 보조 장치일 뿐 완전 방어가 아니다.
 *
 * 조회 오류는 "표식 없음"으로 보지 않고 예외로 올린다(fail-closed) — 일시 DB 오류가 재봉인 허용으로 이어지지 않게 한다.
 */
export async function hasSealMarker(admin: SupabaseClient, finalDocumentId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('contract_audit_log')
    .select('id')
    .eq('event_type', 'archive_created')
    .eq('metadata->>kind', 'sealed')
    .eq('metadata->>final_document_id', finalDocumentId)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`seal_marker_lookup_failed: ${(error as { message?: string }).message ?? ''}`)
  return !!data
}

/** 봉인 표식을 기록한다(1회 재시도). 끝내 실패하면 경보를 남기고 false — 그 보관본은 표식 보호를 받지 못한다. */
async function recordSealMarker(admin: SupabaseClient, target: SealTarget, keyId: string): Promise<boolean> {
  const row = {
    contract_id: target.contractId, event_type: 'archive_created', actor_type: 'system', actor_id: null, ip_address: null,
    metadata: { kind: 'sealed', final_document_id: target.finalDocumentId, key_id: keyId },
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { error } = await admin.from('contract_audit_log').insert(row)
      if (!error) return true
      console.error('[contractArchive] 봉인 표식 기록 실패:', target.finalDocumentId, (error as { message?: string }).message)
    } catch (e) {
      console.error('[contractArchive] 봉인 표식 기록 예외:', target.finalDocumentId, e instanceof Error ? e.message : e)
    }
  }
  try {
    const { error } = await admin.from('contract_audit_log').insert({
      contract_id: target.contractId, event_type: 'evidence_failed', actor_type: 'system', actor_id: null, ip_address: null,
      metadata: { stage: 'seal', reason: 'seal_marker_missing', final_document_id: target.finalDocumentId },
    })
    if (error) console.error('[contractArchive] 봉인 표식 실패 경보 기록 실패:', target.finalDocumentId, (error as { message?: string }).message)
  } catch (e) {
    console.error('[contractArchive] 봉인 표식 실패 경보 기록 예외:', target.finalDocumentId, e instanceof Error ? e.message : e)
  }
  return false
}

/** markerRecorded=false: 봉인은 만들어졌지만 표식 기록이 실패했다(경보가 남음) */
export type SealResult = { ok: true; alreadySealed: boolean; markerRecorded?: boolean } | { ok: false; reason: string }

/** PDF 바이트에서 지도를 만든다. 추출 실패 시 빈 지도(변경 위치 분석 불가)로 대체한다. */
export async function buildPageMapFromPdf(bytes: Uint8Array): Promise<{ map: PageMap; extracted: boolean }> {
  try {
    return { map: await buildPageMap(await extractPageTexts(bytes)), extracted: true }
  } catch (e) {
    // 조용히 삼키지 않는다 — 배포 환경에서만 실패하던 결함(pdf.worker 번들 누락)이 오래 눈에 안 띄었다. 봉인은 빈 지도로라도 만든다(변경 위치 분석만 불가).
    console.error('[contractArchive] 쪽별 지문 지도 추출 실패(빈 지도로 진행):', e instanceof Error ? e.message : e)
    return { map: await buildPageMap([]), extracted: false }
  }
}

export async function sealFinalDocument(admin: SupabaseClient, target: SealTarget, bytes: Uint8Array, key: SealKey): Promise<SealResult> {
  try {
    const { data: existing } = await admin.from('contract_final_document_seals').select('id').eq('final_document_id', target.finalDocumentId).maybeSingle()
    if (existing) return { ok: true, alreadySealed: true }
    // 봉인된 적이 있는데 봉인 행이 없다 = 기록 삭제 의심 — 새 서명을 찍어 주지 않는다
    if (await hasSealMarker(admin, target.finalDocumentId)) return { ok: false, reason: 'seal_missing_after_sealed' }

    const { map } = await buildPageMapFromPdf(bytes)
    const mapSha = await pageMapSha256(map)
    const message = buildSealMessage({
      contractId: target.contractId,
      evidenceId: target.evidenceId,
      signingId: target.signingId,
      finalDocumentId: target.finalDocumentId,
      signedAt: new Date(target.signedAt).toISOString(),
      pdfSha256: target.pdfSha256,
      pageMapSha256: mapSha,
      source: target.source,
    })
    const { error } = await admin.from('contract_final_document_seals').insert({
      final_document_id: target.finalDocumentId,
      contract_id: target.contractId,
      seal_version: SEAL_VERSION,
      algorithm: SEAL_ALGORITHM,
      key_id: key.keyId,
      message,
      signature: signSeal(key, message),
      page_map: map,
      page_map_sha256: mapSha,
    })
    if (error) {
      if ((error as { code?: string }).code === '23505') return { ok: true, alreadySealed: true }
      return { ok: false, reason: `seal_insert_failed: ${error.message}` }
    }
    // 표식 단계의 실패는 봉인 결과를 바꾸지 않는다(봉인 행은 이미 만들어졌다)
    const markerRecorded = await recordSealMarker(admin, target, key.keyId)
    return { ok: true, alreadySealed: false, markerRecorded }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

export type SealStatus =
  | 'valid'     // 서명이 현재 DB 기록과 일치한다
  | 'invalid'   // 서명·기록 불일치 — 봉인 이후 DB 기록이 바뀌었거나 서명이 위조됐다(운영 경보 대상)
  | 'unsealed'  // 봉인이 아직 없다(소급분·생성 직후)
  | 'unknown'   // 봉인 표식 조회 오류 등 일시적으로 판단할 수 없다(경보 대상 아님, 다시 확인)
  | 'no_key'    // 봉인은 있으나 이 서버에 해당 공개키가 없어 확인할 수 없다(설정 점검 필요)

export interface SealCheck {
  status: SealStatus
  keyId: string | null
  sealedAt: string | null
  pageMap: PageMap | null
}

interface SealRow {
  seal_version: number
  algorithm: string
  key_id: string
  message: string
  signature: string
  page_map: unknown
  page_map_sha256: string
  sealed_at: string
}

export async function checkSeal(admin: SupabaseClient, finalDocumentId: string, publicKeys: SealPublicKey[]): Promise<SealCheck> {
  const unknown: SealCheck = { status: 'unknown', keyId: null, sealedAt: null, pageMap: null }
  const [{ data: sealData, error: sealErr }, { data: docData, error: docErr }] = await Promise.all([
    admin.from('contract_final_document_seals').select('seal_version, algorithm, key_id, message, signature, page_map, page_map_sha256, sealed_at').eq('final_document_id', finalDocumentId).maybeSingle(),
    admin.from('contract_final_documents').select('id, contract_id, signing_id, evidence_id, pdf_sha256, source').eq('id', finalDocumentId).maybeSingle(),
  ])
  // 조회 오류는 "없음"으로 보지 않는다 — 일시 DB 오류가 invalid 오경보나 unsealed 위장으로 이어지지 않게 unknown(fail-closed)
  if (sealErr || docErr) return unknown
  const seal = sealData as SealRow | null
  const doc = docData as { id: string; contract_id: string; signing_id: string; evidence_id: string; pdf_sha256: string; source: 'original' | 'regenerated' } | null
  if (!doc) return { status: 'unsealed', keyId: null, sealedAt: null, pageMap: null }
  if (!seal) {
    // 봉인된 적이 있는데 봉인 행이 없으면 삭제·변조 의심(invalid), 한 번도 봉인된 적 없으면 unsealed
    try {
      return { status: (await hasSealMarker(admin, finalDocumentId)) ? 'invalid' : 'unsealed', keyId: null, sealedAt: null, pageMap: null }
    } catch {
      return unknown
    }
  }

  const pageMap = parsePageMap(seal.page_map)
  const base = { keyId: seal.key_id, sealedAt: seal.sealed_at, pageMap }
  const key = publicKeys.find((k) => k.keyId === seal.key_id)
  if (!key) return { status: 'no_key', ...base }

  const { data: evData, error: evErr } = await admin.from('contract_signature_evidence').select('signed_at').eq('id', doc.evidence_id).maybeSingle()
  if (evErr) return { ...unknown, keyId: seal.key_id, sealedAt: seal.sealed_at }
  const ev = evData as { signed_at: string } | null
  if (!ev || !pageMap) return { status: 'invalid', ...base }

  // 지도 해시는 저장된 지도에서 다시 계산한다(저장된 해시 열을 믿지 않는다)
  const recomputedMapSha = await pageMapSha256(pageMap)
  const expected = buildSealMessage({
    contractId: doc.contract_id,
    evidenceId: doc.evidence_id,
    signingId: doc.signing_id,
    finalDocumentId: doc.id,
    signedAt: new Date(ev.signed_at).toISOString(),
    pdfSha256: doc.pdf_sha256,
    pageMapSha256: recomputedMapSha,
    source: doc.source,
  })
  const ok = seal.message === expected && seal.page_map_sha256 === recomputedMapSha && verifySealSignature(key.publicKey, expected, seal.signature)
  return { status: ok ? 'valid' : 'invalid', ...base }
}
