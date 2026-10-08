/**
 * POST /api/cms/contracts/[id]/compare-file — 받은 PDF와 보관 원본을 비교해 진위·변경 위치를 분석한다 (관리자 전용)
 *
 * 입력: multipart/form-data, file = 제출된 PDF(최대 25MB).
 * 출력: 진위 판정(파일 지문 대조 — authentic/superseded/modified) + 서명 봉인 상태 + 쪽별 변경 위치(참고 분석).
 * ⛔ 변경 위치(쪽·바뀐 줄 원문)는 이 관리자 엔드포인트에서만 제공한다. 고객·공개 확인 화면에는 지도 대조 결과를 주지 않는다.
 * 쪽별 분석은 "진본 판정"이 아니라 참고용이다 — 판정은 파일 지문과 서명 봉인으로만 한다.
 */
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { recordAuditLog } from '$lib/contract-signature/auditLog'
import { loadLatestArchivedPdf, sha256OfBytes } from '$lib/server/contractArchive/loadArchivedPdf'
import { verifyOwnerFile } from '$lib/server/contractArchive/verifyArchive'
import { buildPageMap, comparePageMaps, extractPageTexts, parsePageMap, type PageMapComparison } from '$lib/server/contractArchive/pdfFingerprint'
import { buildPageMapFromPdf, checkSeal } from '$lib/server/contractArchive/sealArchive'
import { getSealPublicKeys } from '$lib/server/contractArchive/sealEnv'

const MAX_BYTES = 25 * 1024 * 1024
const NO_STORE = { 'cache-control': 'private, no-store' }

export const POST: RequestHandler = async ({ params, locals, request, getClientAddress }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 403 })

  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES + 1024 * 1024) {
    return json({ error: 'PDF 파일은 25MB 이하만 확인할 수 있습니다.' }, { status: 413, headers: NO_STORE })
  }
  let file: File | null = null
  try {
    const form = await request.formData()
    const f = form.get('file')
    file = f instanceof File ? f : null
  } catch {
    return json({ error: '요청이 올바르지 않습니다.' }, { status: 400, headers: NO_STORE })
  }
  if (!file || file.size === 0) return json({ error: '확인할 PDF 파일을 선택해 주세요.' }, { status: 400, headers: NO_STORE })
  if (file.size > MAX_BYTES) return json({ error: 'PDF 파일은 25MB 이하만 확인할 수 있습니다.' }, { status: 413, headers: NO_STORE })
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') return json({ error: 'PDF 파일이 아닙니다.' }, { status: 400, headers: NO_STORE })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const pdf = await loadLatestArchivedPdf(admin, [params.id])
  if (!pdf) return json({ error: '보관된 최종본 PDF가 아직 없습니다.' }, { status: 404, headers: NO_STORE })

  const submittedSha = await sha256OfBytes(bytes)
  const sealKeys = getSealPublicKeys()
  const verdict = await verifyOwnerFile(admin, pdf, [pdf.contractId], submittedSha, sealKeys)
  const seal = await checkSeal(admin, pdf.finalDocumentId, sealKeys)

  // 쪽별 변경 위치(참고 분석) — 완전 일치(authentic)면 비교할 필요가 없다
  let comparison: PageMapComparison | null = null
  let comparisonNote: string | null = null
  if (verdict.status !== 'authentic') {
    try {
      // 기준 지도: 봉인이 유효하면 봉인된 지도, 아니면 보관 파일이 기록과 같을 때만 보관 파일에서 즉석 추출(훼손된 기준으로 비교하지 않는다)
      let recorded = seal.status === 'valid' ? parsePageMap(seal.pageMap) : null
      if (!recorded && verdict.archiveIntact !== false) recorded = (await buildPageMapFromPdf(pdf.bytes)).map
      if (!recorded) {
        comparisonNote = '기준이 되는 보관본의 무결성을 확인할 수 없어 변경 위치를 분석하지 않았습니다.'
      } else {
        const texts = await extractPageTexts(bytes)
        const submittedMap = await buildPageMap(texts)
        if (submittedMap.pages.every((p) => p.chars === 0)) {
          comparisonNote = '제출된 파일에서 텍스트를 읽지 못했습니다(스캔·이미지 PDF이거나 암호화된 파일일 수 있습니다).'
        } else {
          comparison = await comparePageMaps(recorded, submittedMap, texts)
        }
      }
    } catch {
      comparisonNote = '제출된 파일의 내용을 분석하지 못했습니다(손상되었거나 암호화된 파일일 수 있습니다).'
    }
  }

  const { session } = await locals.safeGetSession()
  let ip: string | null = null
  try { ip = getClientAddress() } catch { ip = null }
  await recordAuditLog(admin as Parameters<typeof recordAuditLog>[0], {
    contractId: params.id,
    eventType: 'viewed',
    actorType: 'admin',
    actorId: session?.user?.id ?? null,
    ipAddress: ip,
    metadata: { kind: 'compare_file', status: verdict.status, seal: seal.status, archive_intact: verdict.archiveIntact, submitted_sha256: submittedSha, final_document_id: pdf.finalDocumentId },
  })
  if (seal.status === 'invalid' || verdict.archiveIntact === false) {
    await recordAuditLog(admin as Parameters<typeof recordAuditLog>[0], {
      contractId: params.id, eventType: 'evidence_failed', actorType: 'system', actorId: null, ipAddress: null,
      metadata: { stage: 'verify', reason: seal.status === 'invalid' ? 'seal_invalid' : 'archive_hash_mismatch', final_document_id: pdf.finalDocumentId, via: 'admin' },
    })
  }

  return json({
    status: verdict.status,
    archiveIntact: verdict.archiveIntact,
    seal: seal.status,
    submittedSha256: submittedSha,
    recordedSha256: pdf.recordedSha256,
    source: pdf.source,
    comparison,
    comparisonNote,
  }, { headers: NO_STORE })
}
