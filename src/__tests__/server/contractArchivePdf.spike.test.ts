import { describe, it, expect } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { buildArchiveHtml } from '$lib/server/contractArchive/archiveHtml'
import { ARCHIVE_FONT_CSS } from '$lib/server/contractArchive/fontCss'
import { renderHtmlToPdf } from '$lib/server/contractArchive/renderPdf'
import { inlineStorageImages } from '$lib/server/contractArchive/inlineImages'

/**
 * 최종본 PDF 엔진 스파이크 (D0) — 로컬 Chrome으로 렌더링 품질을 확인한다.
 * 실행: RUN_PDF_SPIKE=1 CONTRACT_PDF_OUT=/경로/spike.pdf npx vitest run src/__tests__/server/contractArchivePdf.spike.test.ts
 * 기본 실행(CI·일반 테스트)에서는 건너뛴다 — Chrome 실행 파일과 Stage DB가 필요하다.
 * 입력: Stage의 서명 완료 html 계약서(서명 이미지 합성본). 읽기 전용, 파일 출력은 CONTRACT_PDF_OUT 한 곳뿐.
 */
const SAMPLE_CONTRACT_ID = '83a9556d-e63f-472e-b7e9-15269b669963'

describe.skipIf(!process.env.RUN_PDF_SPIKE)('최종본 PDF 렌더링 스파이크', () => {
  it('서명 합성 계약서 + 증적 요약 + 약관 부록을 한글 임베드 폰트로 PDF 렌더링한다', async () => {
    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data, error } = await admin.from('contracts').select('html_document').eq('id', SAMPLE_CONTRACT_ID).single()
    expect(error).toBeNull()
    const rawHtml = data!.html_document as string
    expect(rawHtml).toContain('alt="예약자 서명"')
    // 발행자 직인 등 Storage 외부 URL 이미지를 생성 시점에 내장(렌더러는 외부 요청을 전부 차단)
    const inlined = await inlineStorageImages(rawHtml, { allowedBase: `${PUBLIC_SUPABASE_URL}/storage/v1/object/public/` })
    const contractHtml = inlined.html
    console.info('[PDF spike] inlined', JSON.stringify({ inlined: inlined.inlined.map((i) => ({ bytes: i.bytes, sha: i.sha256.slice(0, 12) })), failed: inlined.failed }))

    const html = buildArchiveHtml({
      contractHtml,
      evidence: {
        contractId: SAMPLE_CONTRACT_ID,
        signingId: 'a7c2648f-2006-48f8-b565-1ff3417a9ef9',
        reservationCode: 'CS26090000',
        signedAtKst: '2026.09.15 12:55',
        ipAddress: '211.234.198.124',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        finalHtmlSha256: 'a'.repeat(64),
        termsSha256: 'b'.repeat(64),
        refundSha256: 'c'.repeat(64),
        privacySha256: 'd'.repeat(64),
        source: 'original',
        generatedAtKst: '2026.10.06 21:00',
      },
      terms: {
        terms: '제1조(목적) 이 정책은 크레이지샷의 장비 대여 서비스 이용 조건을 정합니다.\n제2조(정의) “대여”란 고객이 장비를 일정 기간 사용하는 것을 말합니다. ※ 뷁 똠 쀍 같은 희귀 음절도 표시됩니다.',
        refund: '환불규정 시험 본문 ▣ △ ※ (VAT 포함)',
        privacy: '개인정보처리방침 시험 본문',
      },
      fontCss: ARCHIVE_FONT_CSS,
    })

    const out = process.env.CONTRACT_PDF_OUT ?? '/tmp/contract-spike.pdf'
    const result = await renderHtmlToPdf(html)
    mkdirSync(out.substring(0, out.lastIndexOf('/')), { recursive: true })
    writeFileSync(out, result.pdf)

    console.info('[PDF spike]', JSON.stringify({ bytes: result.pdf.byteLength, ...result.timings, blocked: result.blockedRequests, htmlBytes: html.length }))
    expect(result.pdf.byteLength).toBeGreaterThan(10_000)
    expect(Buffer.from(result.pdf.subarray(0, 5)).toString()).toBe('%PDF-')
    expect(result.blockedRequests).toEqual([])
  }, 120_000)
})
