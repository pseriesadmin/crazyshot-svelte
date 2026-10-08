/**
 * GET /api/cms/contracts/[id]/seal — 현재 유효한 최종본의 서명 봉인 증명서(관리자 전용)
 * 서명 대상 원문·서명·공개키를 그대로 내려준다 — 서버 DB 없이도 (공개키, 원문, 서명) 세 가지로 누구나 서명을 검증할 수 있다.
 */
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { findCurrentFinalDocument, sha256OfBytes } from '$lib/server/contractArchive/loadArchivedPdf'
import { checkSeal, sealFinalDocument } from '$lib/server/contractArchive/sealArchive'
import { getSealKey, getSealPublicKeys } from '$lib/server/contractArchive/sealEnv'
import { ARCHIVE_BUCKET } from '$lib/server/contractArchive/generateArchive'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { recordAuditLog } from '$lib/contract-signature/auditLog'

export const GET: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 403 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const doc = await findCurrentFinalDocument(admin, [params.id])
  if (!doc) return json({ error: '최종본 PDF가 아직 없습니다.' }, { status: 404 })

  const keys = getSealPublicKeys()
  const check = await checkSeal(admin, doc.id, keys)
  const { data } = await admin.from('contract_final_document_seals').select('algorithm, key_id, message, signature, sealed_at').eq('final_document_id', doc.id).maybeSingle()
  const row = data as { algorithm: string; key_id: string; message: string; signature: string; sealed_at: string } | null
  const key = row ? keys.find((k) => k.keyId === row.key_id) : null
  return json({
    status: check.status,
    certificate: row ? { algorithm: row.algorithm, keyId: row.key_id, message: row.message, signature: row.signature, sealedAt: row.sealed_at, publicKeyPem: key?.publicKeyPem ?? null } : null,
  }, { headers: { 'cache-control': 'private, no-store' } })
}

/**
 * POST /api/cms/contracts/[id]/seal — 봉인이 없는 보관본을 관리자가 직접 확인 후 봉인한다(매니저 이상)
 * 자동 봉인(크론)은 방금 만든 보관본만 대상이다 — 키 도입 전에 만든 오래된 보관본은 여기서 수동으로 봉인한다.
 * 보관 파일의 실제 지문이 기록과 같을 때만 봉인하고, 이미 봉인됐거나 봉인된 적이 있는 보관본(기록 삭제 의심)은 거부한다.
 */
export const POST: RequestHandler = async ({ params, locals, getClientAddress }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole || !hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })

  const key = getSealKey()
  if (!key) return json({ error: '서명 봉인 키가 설정되지 않았습니다.' }, { status: 503 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const cur = await findCurrentFinalDocument(admin, [params.id])
  if (!cur) return json({ error: '최종본 PDF가 아직 없습니다.' }, { status: 404 })
  const { data: row } = await admin.from('contract_final_documents').select('id, contract_id, signing_id, evidence_id, pdf_path, pdf_sha256, source').eq('id', cur.id).maybeSingle()
  const doc = row as { id: string; contract_id: string; signing_id: string; evidence_id: string; pdf_path: string; pdf_sha256: string; source: 'original' | 'regenerated' } | null
  if (!doc) return json({ error: '최종본 PDF가 아직 없습니다.' }, { status: 404 })

  const check = await checkSeal(admin, doc.id, getSealPublicKeys())
  if (check.status !== 'unsealed') {
    const message =
      check.status === 'invalid' ? '봉인 기록에 이상이 있어 새로 봉인할 수 없습니다. 개발자 확인이 필요합니다.'
      : check.status === 'unknown' ? '봉인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'
      : '이미 봉인된 보관본입니다.'
    return json({ error: message, status: check.status }, { status: 409 })
  }

  const [{ data: ev }, dl] = await Promise.all([
    admin.from('contract_signature_evidence').select('signed_at').eq('id', doc.evidence_id).maybeSingle(),
    admin.storage.from(ARCHIVE_BUCKET).download(doc.pdf_path),
  ])
  const signedAt = (ev as { signed_at: string } | null)?.signed_at
  if (!signedAt || dl.error || !dl.data) return json({ error: '보관 파일을 읽지 못했습니다.' }, { status: 500 })
  const bytes = new Uint8Array(await dl.data.arrayBuffer())
  if ((await sha256OfBytes(bytes)) !== doc.pdf_sha256) return json({ error: '보관 파일이 기록된 지문과 달라 봉인할 수 없습니다. 훼손이 의심됩니다.' }, { status: 409 })

  const r = await sealFinalDocument(admin, { finalDocumentId: doc.id, contractId: doc.contract_id, evidenceId: doc.evidence_id, signingId: doc.signing_id, signedAt, pdfSha256: doc.pdf_sha256, source: doc.source }, bytes, key)
  if (!r.ok) return json({ error: '봉인에 실패했습니다.', reason: r.reason }, { status: 500 })

  const { session } = await locals.safeGetSession()
  let ip: string | null = null
  try { ip = getClientAddress() } catch { ip = null }
  await recordAuditLog(admin as Parameters<typeof recordAuditLog>[0], {
    contractId: params.id, eventType: 'viewed', actorType: 'admin', actorId: session?.user?.id ?? null, ipAddress: ip,
    metadata: { kind: 'seal_manual', final_document_id: doc.id, key_id: key.keyId },
  })
  return json({ ok: true, status: 'valid', markerRecorded: r.alreadySealed ? undefined : r.markerRecorded !== false }, { headers: { 'cache-control': 'private, no-store' } })
}
