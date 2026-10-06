/**
 * renderPdf.ts — HTML → PDF (서버 Chromium)
 *
 * 환경별 실행 파일:
 *   - Vercel/Lambda(`VERCEL` 또는 `AWS_LAMBDA_FUNCTION_NAME`): @sparticuz/chromium(압축 바이너리, /tmp에 풀림)
 *   - 로컬 개발·스파이크: `CONTRACT_PDF_CHROME_PATH` 또는 macOS 기본 Chrome 경로
 * puppeteer-core·@sparticuz/chromium은 동적 import — 이 모듈을 쓰지 않는 라우트의 번들·콜드스타트에 영향이 없다.
 *
 * 외부 네트워크 요청 금지: 계약서 HTML은 data URI 이미지·임베드 폰트만 쓴다. 요청 가로채기로 data:/about: 외
 * 모든 요청을 차단해, 저장된 HTML에 외부 URL(추적 픽셀 등)이 섞여 있어도 PDF 생성 중 외부로 나가지 않는다.
 */
import type { Browser } from 'puppeteer-core'

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export interface RenderPdfResult {
  pdf: Uint8Array
  /** 단계별 소요(ms) — 스파이크·운영 모니터링용 */
  timings: { launchMs: number; renderMs: number; totalMs: number }
  blockedRequests: string[]
}

function isServerless(): boolean {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
}

async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import('puppeteer-core')).default
  if (isServerless()) {
    const chromium = (await import('@sparticuz/chromium')).default
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: 'shell',
    })
  }
  return puppeteer.launch({
    executablePath: process.env.CONTRACT_PDF_CHROME_PATH ?? MAC_CHROME,
    headless: true,
    args: ['--no-sandbox'],
  })
}

export async function renderHtmlToPdf(html: string, opts: { timeoutMs?: number } = {}): Promise<RenderPdfResult> {
  const timeout = opts.timeoutMs ?? 45_000
  const t0 = Date.now()
  const blockedRequests: string[] = []
  const browser = await launchBrowser()
  const tLaunched = Date.now()
  try {
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const url = req.url()
      if (url.startsWith('data:') || url.startsWith('about:')) {
        void req.continue()
      } else {
        blockedRequests.push(url.slice(0, 200))
        void req.abort()
      }
    })
    await page.setContent(html, { waitUntil: 'load', timeout })
    // 임베드 폰트·이미지 디코딩 완료까지 대기
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(
        Array.from(document.images).map((img) =>
          img.complete ? Promise.resolve() : new Promise<void>((resolve) => { img.onload = img.onerror = () => resolve() }),
        ),
      )
    })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      timeout,
    })
    const tDone = Date.now()
    return {
      pdf,
      timings: { launchMs: tLaunched - t0, renderMs: tDone - tLaunched, totalMs: tDone - t0 },
      blockedRequests,
    }
  } finally {
    await browser.close().catch(() => undefined)
  }
}
