/**
 * [임시] 최종본 PDF 엔진 스파이크 점검 경로 — Vercel 프리뷰에서 Chromium 기동·한글 폰트·번들 크기를 확인한다.
 * 스파이크가 끝나면 이 폴더 전체를 삭제한다(TASK.md 기록). 마스터(superadmin) 전용, 합성 샘플만 사용(개인정보 없음).
 *
 *   GET /cms/dev/pdf-spike         → 샘플 PDF 다운로드(inline)
 *   GET /cms/dev/pdf-spike?json=1  → 소요 시간·환경 정보(JSON)
 */
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { requireTrueSuperadmin } from '$lib/server/requireTrueSuperadmin'
import { buildArchiveHtml } from '$lib/server/contractArchive/archiveHtml'
import { ARCHIVE_FONT_CSS } from '$lib/server/contractArchive/fontCss'
import { renderHtmlToPdf } from '$lib/server/contractArchive/renderPdf'

// adapter-vercel 라우트별 함수 설정 — Chromium 기동·렌더링 여유 시간
export const config = { maxDuration: 60 }

const SAMPLE_CONTRACT_HTML = `<style>.contract-wrap { font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 12px; max-width: 794px; margin: 0 auto; padding: 40px 30px; }
.contract-wrap table { width: 100%; border-collapse: collapse; } .contract-wrap td { border: 1px solid #333; padding: 6px 8px; }</style>
<div class="contract-wrap"><h1 style="text-align:center">임 대 차 계 약 서 (스파이크 샘플)</h1>
<table><tr><td><b>예약자</b></td><td>홍길동 (인)</td></tr><tr><td><b>희귀 음절</b></td><td>뷁 똠 쀍 꽥 읊 닭 값 ※ ▣ △ (VAT포함)</td></tr>
<tr><td><b>금액</b></td><td>185,000원 (▣VAT포함) 0123456789 ABCabc</td></tr></table>
<p>이 문서는 서버에서 한글 폰트가 정상 임베드되는지 확인하는 합성 샘플이며 개인정보를 포함하지 않습니다.</p></div>`

export const GET: RequestHandler = async ({ locals, url }) => {
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const denied = await requireTrueSuperadmin(locals, admin)
  if (denied) return json({ error: denied }, { status: 403 })

  const html = buildArchiveHtml({
    contractHtml: SAMPLE_CONTRACT_HTML,
    evidence: {
      contractId: 'spike', signingId: 'spike', reservationCode: 'SPIKE', signedAtKst: '2026.10.06 21:00',
      ipAddress: '203.0.113.7', userAgent: 'spike', finalHtmlSha256: 'a'.repeat(64),
      termsSha256: 'b'.repeat(64), refundSha256: 'c'.repeat(64), privacySha256: 'd'.repeat(64),
      source: 'original', generatedAtKst: '2026.10.06 21:00',
    },
    terms: { terms: '서비스이용정책 샘플', refund: '환불규정 샘플', privacy: '개인정보처리방침 샘플' },
    fontCss: ARCHIVE_FONT_CSS,
  })

  try {
    const result = await renderHtmlToPdf(html)
    if (url.searchParams.get('json') === '1') {
      return json({
        ok: true,
        bytes: result.pdf.byteLength,
        timings: result.timings,
        blockedRequests: result.blockedRequests,
        env: { vercel: !!process.env.VERCEL, node: process.version, region: process.env.VERCEL_REGION ?? null },
        rssMb: Math.round(process.memoryUsage().rss / 1048576),
      })
    }
    return new Response(result.pdf as BodyInit, {
      headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="pdf-spike.pdf"', 'cache-control': 'no-store' },
    })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack?.split('\n').slice(0, 6) : null }, { status: 500 })
  }
}
