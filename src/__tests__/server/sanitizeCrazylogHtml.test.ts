import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { sanitizeCrazylogHtml, sanitizeCrazylogBlocks } from '$lib/server/sanitizeCrazylogHtml'

/**
 * 크레이지로그 본문 정화(2026-10-05) — 저장형 XSS 방지. 에디터가 만드는 서식은 보존하고, 스크립트·이벤트 속성·위험 링크는 제거한다.
 */
describe('sanitizeCrazylogHtml — 위험 요소 제거', () => {
  it('script 태그와 그 내용을 제거', () => {
    const out = sanitizeCrazylogHtml('<p>안녕</p><script>alert(1)</script>')
    expect(out).toBe('<p>안녕</p>')
  })
  it('이벤트 속성(onerror·onclick 등) 제거', () => {
    const out = sanitizeCrazylogHtml('<div onclick="x()" style="text-align:center">a</div><img src=x onerror=alert(1)>')
    expect(out).not.toMatch(/onclick|onerror|<img/i)
    expect(out).toContain('text-align:center')
  })
  it('javascript: / data: 링크 제거', () => {
    expect(sanitizeCrazylogHtml('<a href="javascript:alert(1)">x</a>')).not.toMatch(/javascript/i)
    expect(sanitizeCrazylogHtml('<a href="data:text/html;base64,AAAA">x</a>')).not.toMatch(/data:/i)
    expect(sanitizeCrazylogHtml('<a href="JaVaScRiPt:alert(1)">x</a>')).not.toMatch(/javascript/i)
  })
  it('iframe·object·embed·style 태그·form 제거', () => {
    const out = sanitizeCrazylogHtml('<iframe src="https://evil"></iframe><object data="x"></object><embed src="x"><style>body{display:none}</style><form action="x"><input></form>')
    expect(out).not.toMatch(/<(iframe|object|embed|style|form|input)/i)
    expect(out).not.toContain('display:none')
  })
  it('위험한 style 값(url·expression·허용 밖 속성) 제거', () => {
    const out = sanitizeCrazylogHtml('<div style="background:url(javascript:alert(1));position:fixed;width:expression(alert(1));text-align:center">a</div>')
    expect(out).not.toMatch(/url\(|expression|position|javascript/i)
    expect(out).toContain('text-align:center')
  })
  it('문자열이 아닌 입력은 빈 문자열', () => {
    expect(sanitizeCrazylogHtml(undefined)).toBe('')
    expect(sanitizeCrazylogHtml(null)).toBe('')
    expect(sanitizeCrazylogHtml(123)).toBe('')
    expect(sanitizeCrazylogHtml('')).toBe('')
  })
})

describe('sanitizeCrazylogHtml — 우회 변종 입력(sp3 검수 재현 사례)', () => {
  const bad = /<script|<svg|<math|<iframe|<noscript|<textarea|<style|<form|onerror|onload|javascript:|srcdoc|mglyph/i
  it.each([
    ['svg onload', '<svg onload=alert(1)><circle/></svg>'],
    ['math/mglyph 변종', '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>'],
    ['공백·탭·개행이 섞인 javascript: 링크', '<a href="  java\nscript:alert(1)">x</a>'],
    ['javascript: 엔티티 인코딩', '<a href="&#106;avascript:alert(1)">x</a>'],
    ['iframe srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
    ['중첩 우회 scr<script>ipt', '<scr<script>ipt>alert(1)</scr</script>ipt>'],
    ['noscript 속성 탈출', '<noscript><p title="</noscript><img src=x onerror=alert(1)>">'],
    ['프로토콜 상대 링크', '<a href="//evil.example/x">x</a>'],
  ])('%s', (_name, html) => {
    const out = sanitizeCrazylogHtml(html)
    expect(out).not.toMatch(bad)
    expect(out).not.toContain('//evil.example')
  })
})

describe('sanitizeCrazylogHtml — 에디터 서식 보존', () => {
  it('굵게·기울임·밑줄·목록·인용·제목', () => {
    const html = '<h2>제목</h2><p><b>굵게</b> <i>기울임</i> <u>밑줄</u></p><ul><li>하나</li></ul><ol><li>둘</li></ol><blockquote>인용</blockquote>'
    expect(sanitizeCrazylogHtml(html)).toBe(html)
  })
  it('정렬·글자 크기·서체 style 유지(실데이터 형태)', () => {
    const html = '<div style="text-align: center;"><span style="font-size: 17px;">텍스트</span></div>'
    const out = sanitizeCrazylogHtml(html)
    expect(out).toContain('text-align:center')
    expect(out).toContain('font-size:17px')
    expect(sanitizeCrazylogHtml('<span style="font-family:\'Noto Sans KR\', sans-serif">a</span>')).toContain('font-family')
  })
  it('빈 줄(br)·nbsp 유지', () => {
    expect(sanitizeCrazylogHtml('<div>a<br></div>')).toContain('<br />')
    expect(sanitizeCrazylogHtml('<div>a&nbsp;b</div>').replace(/\s/g, ' ')).toContain('a b') // nbsp는 공백류로 유지
  })
  it('표(에디터 삽입 형태) 유지', () => {
    const html = '<table class="cs-contract-table" style="width:100%;border-collapse:collapse;"><tbody><tr><th style="padding:6px 10px;border:1px solid #ddd;background:#f6f6f6;font-weight:700;text-align:left;">항목1</th></tr><tr><td style="padding:6px 10px;border:1px solid #ddd;">값</td></tr></tbody></table>'
    const out = sanitizeCrazylogHtml(html)
    expect(out).toContain('cs-contract-table')
    expect(out).toContain('border-collapse:collapse')
    expect(out).toContain('background:#f6f6f6')
    expect(out).toContain('항목1')
  })
  it('https 링크는 유지하되 새 창·opener 차단 속성을 강제', () => {
    const out = sanitizeCrazylogHtml('<a href="https://example.com/x" target="_self" rel="opener">링크</a>')
    expect(out).toContain('href="https://example.com/x"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('noopener')
    expect(out).not.toContain('target="_self"')
  })
  it('mailto·tel 링크 허용', () => {
    expect(sanitizeCrazylogHtml('<a href="mailto:a@b.kr">m</a>')).toContain('mailto:a@b.kr')
    expect(sanitizeCrazylogHtml('<a href="tel:0212345678">t</a>')).toContain('tel:0212345678')
  })
})

describe('sanitizeCrazylogHtml — 새 에디터(RichContentEditor) 서식 보존', () => {
  const html =
    '<p style="text-align: center; padding-left: 2em"><span style="font-size: 24px; color: #ff0000; background-color: #ffc107">크게</span><s>취소</s></p>' +
    '<h3 style="text-align: right">제목</h3>' +
    '<table style="min-width: 75px"><colgroup><col style="min-width: 25px"></colgroup><tbody><tr><th colspan="1" rowspan="1"><p>칸</p></th></tr></tbody></table>'
  it('글자색·배경색·크기·정렬·들여쓰기·취소선·제목·표 글자 유지', () => {
    const out = sanitizeCrazylogHtml(html)
    expect(out).toContain('padding-left:2em')
    expect(out).toContain('font-size:24px')
    expect(out).toContain('color:#ff0000')
    expect(out).toContain('background-color:#ffc107')
    expect(out).toContain('text-align:center')
    expect(out).toContain('<s>취소</s>')
    expect(out).toContain('<h3')
    expect(out).toContain('칸')
  })
  it('비정상적인 들여쓰기 값은 제거', () => {
    expect(sanitizeCrazylogHtml('<p style="padding-left: 999em">a</p>')).not.toContain('padding-left')
    expect(sanitizeCrazylogHtml('<p style="padding-left: 2em; position: fixed">a</p>')).not.toContain('position')
  })
})

describe('sanitizeCrazylogBlocks', () => {
  it('text·html 블록만 정화하고 이미지·유튜브·구분선은 그대로', () => {
    const image = { type: 'image', layout: 'individual', images: [{ url: 'https://x/y.webp', alt: 'a' }] }
    const youtube = { type: 'youtube', videoId: 'abcdefghijk', url: 'https://youtu.be/abcdefghijk' }
    const divider = { type: 'divider' }
    const blocks = [
      { type: 'text', html: '<p>ok</p><script>alert(1)</script>' },
      image, youtube, divider,
      { type: 'html', content: '<img src=x onerror=alert(1)>' },
    ]
    const out = sanitizeCrazylogBlocks(blocks) as Array<Record<string, unknown>>
    expect(out[0].html).toBe('<p>ok</p>')
    expect(out[1]).toBe(image)
    expect(out[2]).toBe(youtube)
    expect(out[3]).toBe(divider)
    expect(String(out[4].content)).not.toMatch(/onerror|<img/i)
  })
  it('원본 배열은 바꾸지 않는다', () => {
    const blocks = [{ type: 'text', html: '<script>x</script>a' }]
    sanitizeCrazylogBlocks(blocks)
    expect(blocks[0].html).toBe('<script>x</script>a')
  })
  it('배열이 아니면 그대로 반환, 이상한 요소는 건너뜀', () => {
    expect(sanitizeCrazylogBlocks(null)).toBeNull()
    expect(sanitizeCrazylogBlocks('x')).toBe('x')
    expect(sanitizeCrazylogBlocks([null, 1, { type: 'text' }])).toEqual([null, 1, { type: 'text', html: '' }])
  })
})

describe('배선 — 글을 화면으로 내려보내는 두 로더가 정화를 거친다', () => {
  const read = (p: string): string => readFileSync(p, 'utf-8')
  it('상세 로더', () => {
    const s = read('src/routes/crazylog/view/[slug]/+page.server.ts')
    expect(s).toContain("from '$lib/server/sanitizeCrazylogHtml'")
    expect(s).toContain('contentBlocks: sanitizeCrazylogBlocks(postData.content_blocks)')
  })
  it('작성·수정 로더(에디터 innerHTML 주입 경로)', () => {
    const s = read('src/routes/crazylog/[slug]/+page.server.ts')
    expect(s).toContain("from '$lib/server/sanitizeCrazylogHtml'")
    expect(s).toContain('content_blocks: sanitizeCrazylogBlocks(postData.content_blocks)')
  })
})
