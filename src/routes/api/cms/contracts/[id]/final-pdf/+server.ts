import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { recordAuditLog } from '$lib/contract-signature/auditLog'
import { loadLatestArchivedPdf, pdfResponse } from '$lib/server/contractArchive/loadArchivedPdf'

// GET /api/cms/contracts/[id]/final-pdf — 서명 완료 계약서의 최종본 PDF(서명 합성본 + 증적 요약 + 약관 사본)
// 열람 정책은 content/+server.ts의 "서명 완료건 읽기전용 열람"과 같다: 메뉴 권한(rental.reservation) + CMS 직원이면 열람 가능.
// PDF는 비공개 버킷에서 서버가 읽어 그대로 내려준다(공개 URL 없음). 열람은 감사로그(viewed, kind=final_pdf)에 남긴다.
export const GET: RequestHandler = async ({ params, locals, url, getClientAddress }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 403 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const pdf = await loadLatestArchivedPdf(admin, [params.id])
  if (!pdf) return json({ error: '최종본 PDF가 아직 없습니다.' }, { status: 404 })

  const { session } = await locals.safeGetSession()
  let ip: string | null = null
  try { ip = getClientAddress() } catch { ip = null }
  await recordAuditLog(admin as Parameters<typeof recordAuditLog>[0], {
    contractId: params.id,
    eventType: 'viewed',
    actorType: 'admin',
    actorId: session?.user?.id ?? null,
    ipAddress: ip,
    metadata: { kind: 'final_pdf', final_document_id: pdf.finalDocumentId, source: pdf.source },
  })

  const download = url.searchParams.get('download') === '1'
  return pdfResponse(pdf, `contract-${params.id}.pdf`, download ? 'attachment' : 'inline')
}
