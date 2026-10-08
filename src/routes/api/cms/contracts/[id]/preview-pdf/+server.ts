/**
 * GET /api/cms/contracts/[id]/preview-pdf — 관리자 계약서 탭 PDF 뷰어 전용: 최종본이 있으면 최종본, 없으면 임시 미리보기 PDF (2026-10-08)
 *
 * 최종본(현재 유효한 서명의 보관본)이 있으면 그대로 내려주고(x-pdf-kind: final), 아직 없으면(서명 직후 생성 대기·서명 증적 도입 전 서명 건)
 * 서명된 계약서를 즉석에서 PDF로 만들어 내려준다(x-pdf-kind: preview — 저장하지 않음, 증적·약관 부록 없음, 법적 증빙 아님).
 * 권한: 메뉴 rental.reservation + CMS 직원(final-pdf와 같은 열람 기준). 열람은 감사로그(viewed)에 남긴다. PDF 엔진을 쓰므로 전용 함수로 분리(maxDuration).
 * 남용 방지: 관리자별 분당 6회(인스턴스 메모리, 최선 노력).
 */
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { recordAuditLog } from '$lib/contract-signature/auditLog'
import { createRateLimiter } from '$lib/server/simpleRateLimit'
import { loadLatestArchivedPdf } from '$lib/server/contractArchive/loadArchivedPdf'
import { renderSignedContractPreview } from '$lib/server/contractArchive/previewPdf'

// PDF 엔진(Chromium) 기동·렌더 여유 — 전용 함수로 분리된다(adapter-vercel 라우트별 설정)
export const config = { maxDuration: 120 }

const limiter = createRateLimiter(6, 60_000)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function pdfBody(bytes: Uint8Array, kind: 'final' | 'preview', name: string): Response {
  return new Response(bytes as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${name}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'x-pdf-kind': kind,
    },
  })
}

export const GET: RequestHandler = async ({ params, locals, getClientAddress }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 403 })

  if (!UUID_RE.test(params.id)) return json({ error: '유효하지 않은 계약 ID입니다.' }, { status: 400 })

  const { session } = await locals.safeGetSession()
  if (!limiter.allow(session?.user?.id ?? 'unknown')) {
    return json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' }, { status: 429 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  let ip: string | null = null
  try { ip = getClientAddress() } catch { ip = null }
  const audit = (kind: string, extra: Record<string, unknown> = {}) =>
    recordAuditLog(admin as Parameters<typeof recordAuditLog>[0], {
      contractId: params.id, eventType: 'viewed', actorType: 'admin', actorId: session?.user?.id ?? null, ipAddress: ip, metadata: { kind, ...extra },
    })

  const finalPdf = await loadLatestArchivedPdf(admin, [params.id])
  if (finalPdf) {
    await audit('final_pdf', { final_document_id: finalPdf.finalDocumentId, source: finalPdf.source })
    return pdfBody(finalPdf.bytes, 'final', `contract-${params.id}.pdf`)
  }

  const preview = await renderSignedContractPreview(admin, params.id)
  if (!preview.ok) return json({ error: preview.message, reason: preview.reason }, { status: preview.status })
  await audit('preview_pdf')
  return pdfBody(preview.pdf, 'preview', `contract-preview-${params.id}.pdf`)
}
