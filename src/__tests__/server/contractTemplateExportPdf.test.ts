// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import {
  BodyTooLargeError,
  buildLockedDocument,
  readLimitedText,
  stripEventHandlerAttributes,
  wrapWithLockdown,
} from '$lib/server/contractTemplateExport'

/**
 * 계약서 양식 "파일 저장 > PDF" 서버 안전장치 (2026-10-29, sp5 보안 검수 반영)
 * 편집한 임의 HTML이 서버 Chromium 에서 렌더링되므로 ① 권한 ② 크기 ③ 정화 ④ CSP 를 겹쳐 둔다.
 */
const CSP_AT_START = /^<!DOCTYPE html><html lang="ko"><head><meta http-equiv="Content-Security-Policy"/

describe('buildLockedDocument — PDF 엔진에 넣기 전 잠금', () => {
  it('스크립트·이벤트 속성·javascript: 주소를 제거하고 data: 이미지는 남긴다', () => {
    const out = buildLockedDocument('<html><head></head><body><script>fetch("//evil")</script><img src="data:image/png;base64,AAAA" onerror="x()"><a href="javascript:alert(1)">a</a></body></html>')
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toMatch(/onerror/i)
    expect(out).not.toMatch(/javascript:/i)
    expect(out).toContain('data:image/png;base64,AAAA')
  })

  it('CSP 메타는 항상 우리 <head> 맨 앞에 있다(입력의 <head> 글자에 속지 않는다)', () => {
    const hostile = [
      '<!-- <head> --><html><body><p>x</p></body></html>', // 주석 속 <head> (SEC-1)
      '<title><head></title><body>x</body>',                // <title> 속 <head> (SEC-1)
      '<p>head 없음</p>',
      '<HEAD><meta http-equiv="Content-Security-Policy" content="default-src *"></HEAD><body>x</body>', // 허용적 CSP 끼워 넣기
    ]
    for (const h of hostile) {
      const out = buildLockedDocument(h)
      expect(out).toMatch(CSP_AT_START)
      expect(out.match(/<head\b/gi)).toHaveLength(1) // 우리 <head> 하나뿐
    }
  })

  it('CSP 는 스크립트를 허용하지 않고 외부 요청을 막는다', () => {
    const out = buildLockedDocument('<p>x</p>')
    expect(out).toContain("default-src 'none'")
    expect(out).toContain('img-src data:')
    expect(out).not.toContain('script-src')
  })

  it('<style> 서식은 그대로 문서에 남는다(양식 모양 유지)', () => {
    const out = buildLockedDocument('<html><head><style>.a{color:red}</style></head><body><p class="a">x</p></body></html>')
    expect(out).toContain('<style>.a{color:red}</style>')
    expect(out).toContain('<p class="a">x</p>')
  })
})

describe('stripEventHandlerAttributes — 따옴표에 붙은 on* 속성(SEC-2)', () => {
  it('따옴표 바로 뒤에 붙은 onerror 를 지우고 앞 속성은 그대로 둔다', () => {
    const out = stripEventHandlerAttributes('<img src="x"onerror="alert(1)">')
    expect(out).not.toMatch(/onerror/i)
    expect(out).toContain('src="x"')
  })
  it('공백·슬래시·작은따옴표·따옴표 없는 값 변형도 지운다', () => {
    for (const h of ['<a href=\'#\'onclick=\'x()\'>t</a>', '<svg/onload=alert(1)>', '<img src=x onerror=alert(1) alt=a>', '<div class="a"onmouseover="x">t</div>']) {
      expect(stripEventHandlerAttributes(h)).not.toMatch(/\son[a-z]+\s*=|["'/]on[a-z]+\s*=/i)
    }
  })
  it('글자 안의 "on…=" 모양(본문 텍스트)은 건드리지 않는다', () => {
    const text = '<p>version=1, option=2 and onboarding=yes</p>'
    expect(stripEventHandlerAttributes(text)).toBe(text)
  })
})

describe('CSP 단독 방어 — 정화가 뚫려도 실제 Chromium 에서 스크립트가 실행되지 않는다', () => {
  const chrome = process.env.CONTRACT_PDF_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  it.skipIf(!existsSync(chrome))('정화를 거치지 않은 입력(스크립트·on* 속성)을 wrapWithLockdown 만으로 렌더해도 실행 표식이 생기지 않는다', async () => {
    const puppeteer = (await import('puppeteer-core')).default
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] })
    try {
      const page = await browser.newPage()
      const html = wrapWithLockdown('<script>window.__pwned=1</script><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onload="window.__pwned=2"><svg onload="window.__pwned=3"></svg><p>x</p>')
      await page.setContent(html, { waitUntil: 'load' })
      expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined()
    } finally {
      await browser.close()
    }
  }, 60_000)
})

describe('실제 PDF 생성 — 잠금 문서로도 양식이 그대로 PDF 가 된다', () => {
  const chrome = process.env.CONTRACT_PDF_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  it.skipIf(!existsSync(chrome))('기본 계약서 HTML(<style> 포함)이 유효한 PDF(%PDF)로 만들어지고 외부 요청은 아예 시작되지 않는다', async () => {
    const { renderHtmlToPdf } = await import('$lib/server/contractArchive/renderPdf')
    const { DEFAULT_RENTAL_CONTRACT_HTML } = await import('$lib/components/cms/contract-editor/templates/defaultRentalContractHtml')
    const { wrapHtmlDocument } = await import('$lib/utils/docExport/exportHtml')
    const hostile = DEFAULT_RENTAL_CONTRACT_HTML + '<img src="https://evil.example/pixel.png">'
    const r = await renderHtmlToPdf(buildLockedDocument(wrapHtmlDocument({ title: 't', bodyHtml: hostile })))
    expect(Buffer.from(r.pdf.subarray(0, 5)).toString()).toBe('%PDF-')
    expect(r.pdf.length).toBeGreaterThan(5000)
    // CSP(img-src data:)가 외부 이미지 요청을 시작 전에 막는다 — 렌더러의 요청 차단 목록에도 찍히지 않는다(두 겹 중 앞의 겹이 먼저 막음, 2026-10-29 실측)
    expect(r.blockedRequests).toEqual([])
  }, 90_000)
})

describe('readLimitedText — 본문 읽기 상한', () => {
  const req = (body: string, headers: Record<string, string> = {}) => new Request('http://x/', { method: 'POST', body, headers })
  it('한도 안이면 전체를 돌려준다(한글 포함)', async () => {
    expect(await readLimitedText(req('{"html":"가나다"}'), 1000)).toBe('{"html":"가나다"}')
  })
  it('Content-Length 가 한도를 넘으면 읽기 전에 거절한다', async () => {
    await expect(readLimitedText(req('x', { 'content-length': '999999' }), 100)).rejects.toBeInstanceOf(BodyTooLargeError)
  })
  it('Content-Length 가 없어도(청크 전송) 읽는 도중 한도를 넘으면 중단한다', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) { for (let i = 0; i < 20; i++) c.enqueue(new TextEncoder().encode('x'.repeat(50))); c.close() },
    })
    const chunked = new Request('http://x/', { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
    await expect(readLimitedText(chunked, 300)).rejects.toBeInstanceOf(BodyTooLargeError)
  })
})

describe('export-pdf 엔드포인트 소스 점검', () => {
  const src = readFileSync('src/routes/api/cms/contract-templates/export-pdf/+server.ts', 'utf8')
  it('메뉴 권한(rental.contracts)·매니저 이상·요청 한도·동시 상한·크기 상한·잠금 문서를 모두 거친다', () => {
    expect(src).toMatch(/requireMenuAccessApi\(locals, 'rental\.contracts'\)/)
    expect(src).toMatch(/hasSettingsAccess\(cmsRole\)/)
    expect(src).toMatch(/limiter\.allow\(/)
    expect(src).toMatch(/activeRenders >= EXPORT_PDF_MAX_CONCURRENT/)
    expect(src).toMatch(/readLimitedText\(request, MAX_BODY_BYTES\)/)
    expect(src).toMatch(/status: 413/)
    expect(src).toMatch(/buildLockedDocument\(html\)/)
  })
  it('권한 확인이 비싼 작업(본문 읽기·렌더)보다 앞이다', () => {
    expect(src.indexOf('requireMenuAccessApi')).toBeLessThan(src.indexOf('readLimitedText(request'))
    expect(src.indexOf('hasSettingsAccess(cmsRole)')).toBeLessThan(src.indexOf('renderHtmlToPdf('))
  })
  it('HTTP 메서드·config 외 export 가 없다(SvelteKit +server.ts 규칙)', () => {
    const exports = [...src.matchAll(/^export\s+(?:const|function|async function)\s+(\w+)/gm)].map((m) => m[1])
    expect(exports.sort()).toEqual(['POST', 'config'])
  })
  it('응답은 캐시하지 않고 첨부로 내려주며, 동시 상한 카운터는 finally 에서 반드시 내린다', () => {
    expect(src).toContain("'cache-control': 'private, no-store'")
    expect(src).toContain('attachment;')
    expect(src).toMatch(/finally \{\s*activeRenders -= 1/)
  })
})
