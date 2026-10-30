/**
 * POST /api/cms/contract-templates/export-pdf — 계약서 양식 "파일 저장 > PDF" (2026-10-29)
 *
 * 편집 중인 양식(완성된 HTML 문서 1개)을 서버의 Chromium 엔진(renderHtmlToPdf)으로 PDF로 바꿔 내려준다. 저장하지 않는다.
 * 입력은 관리자가 편집한 임의 HTML이라 방어를 겹친다:
 *   ① 권한: 계약서양식 메뉴(rental.contracts) + 매니저 이상(양식 화면과 동일 기준)
 *   ② 크기: 본문 4MB·문자 200만 자 상한(이미지 data URL 포함)
 *   ③ 정화: sanitizeArchiveHtml(스크립트·이벤트 속성·외부 로딩 요소 제거) + 스크립트·외부 요청을 막는 CSP 주입
 *   ④ 렌더러가 data:/about: 외 모든 외부 요청을 차단(renderPdf.ts)
 *   ⑤ 남용 방지: 관리자별 분당 6회(인스턴스 메모리, 최선 노력)
 * 내용은 로그에 남기지 않는다.
 */
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { createRateLimiter } from '$lib/server/simpleRateLimit'
import { BodyTooLargeError, EXPORT_PDF_MAX_BODY_BYTES, EXPORT_PDF_MAX_CONCURRENT, buildLockedDocument, readLimitedText } from '$lib/server/contractTemplateExport'
import { renderHtmlToPdf } from '$lib/server/contractArchive/renderPdf'
import { EXPORT_HTML_MAX_CHARS } from '$lib/utils/docExport/exportHtml'

// PDF 엔진(Chromium) 기동·렌더 여유 — 전용 함수로 분리된다(adapter-vercel 라우트별 설정)
export const config = { maxDuration: 120 }

const MAX_BODY_BYTES = EXPORT_PDF_MAX_BODY_BYTES
const limiter = createRateLimiter(6, 60_000)
let activeRenders = 0 // 이 인스턴스에서 PDF 를 만드는 중인 건수(동시 상한)

export const POST: RequestHandler = async ({ request, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.contracts')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole || !hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })

  const { session } = await locals.safeGetSession()
  if (!limiter.allow(session?.user?.id ?? 'unknown')) {
    return json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' }, { status: 429 })
  }

  let html: unknown
  try {
    const text = await readLimitedText(request, MAX_BODY_BYTES)
    html = (JSON.parse(text) as { html?: unknown }).html
  } catch (e) {
    if (e instanceof BodyTooLargeError) return json({ error: '문서가 너무 커서 PDF로 저장할 수 없어요. 이미지를 줄여 주세요.' }, { status: 413 })
    return json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }
  if (typeof html !== 'string' || !html.trim()) return json({ error: '저장할 내용이 없습니다.' }, { status: 400 })
  if (html.length > EXPORT_HTML_MAX_CHARS) return json({ error: '문서가 너무 커서 PDF로 저장할 수 없어요. 이미지를 줄여 주세요.' }, { status: 413 })

  if (activeRenders >= EXPORT_PDF_MAX_CONCURRENT) {
    return json({ error: '지금 다른 PDF를 만드는 중이에요. 잠시 후 다시 시도해 주세요.' }, { status: 429 })
  }
  activeRenders += 1
  try {
    const { pdf } = await renderHtmlToPdf(buildLockedDocument(html))
    return new Response(pdf as BodyInit, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="contract-template.pdf"',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return json({ error: 'PDF로 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  } finally {
    activeRenders -= 1
  }
}
