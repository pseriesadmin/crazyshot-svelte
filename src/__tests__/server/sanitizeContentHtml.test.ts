// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { cleanStyleAttribute, sanitizeContentBlocks, sanitizeContentHtml } from '$lib/server/sanitizeContentHtml'

/**
 * 상품설명·구독 설명 고객 화면용 정화(2026-10-06) — CMS 작성 콘텐츠(Gemini·imweb 붙여넣기 포함)의 겉모양은 유지하고 실행 가능한 요소만 제거.
 */
describe('sanitizeContentHtml — 겉모양 유지(CMS 붙여넣기 서식)', () => {
  it('font·sup·sub·h4·pre·code·표·class·style·data-* 를 그대로 둔다', () => {
    const html =
      '<h4 class="t">제목</h4><p style="color:#f00;font-size:12pt;line-height:1.6">빨강 <font color="#00f" face="Gulim">파랑</font> m<sup>2</sup></p>' +
      '<pre><code>a = 1</code></pre><table class="x"><colgroup><col width="50%"></colgroup><tbody><tr><td colspan="2" style="border:1px solid #ddd">칸</td></tr></tbody></table><div data-x="1">d</div>'
    const out = sanitizeContentHtml(html).replace(/\s*([:;])\s*/g, '$1') // 라이브러리가 style을 재직렬화(공백 제거)하므로 공백 무시
    for (const frag of ['<h4 class="t">', 'color:#f00', 'font-size:12pt', 'line-height:1.6', '<font color="#00f" face="Gulim">', '<sup>2</sup>', '<pre><code>', '<table class="x">', 'colspan="2"', 'border:1px solid #ddd', 'data-x="1"']) {
      expect(out, frag).toContain(frag)
    }
  })

  it('알 수 없는 커스텀 요소(Gemini 인용 칩)는 태그만 버리고 글자는 유지', () => {
    const out = sanitizeContentHtml('<p>앞<source-inline-chip _ngcontent-ng-c1 ng-version="19">출처 A</source-inline-chip> 뒤</p>')
    expect(out).toBe('<p>앞출처 A 뒤</p>')
  })

  it('https 이미지·링크 유지, 새 창 링크에는 opener 차단', () => {
    const out = sanitizeContentHtml('<img src="https://x/a.png" alt="a"><a href="https://e.com" target="_blank">l</a><a href="mailto:a@b.kr">m</a>')
    expect(out).toContain('src="https://x/a.png"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
    expect(out).toContain('mailto:a@b.kr')
  })
})

describe('sanitizeContentHtml — 위험 요소 제거', () => {
  const bad = /<script|<svg|<math|<iframe|<object|<embed|<noscript|<textarea|<style|<form|<input|<link|<meta|<base|onerror|onload|onclick|javascript:|srcdoc|mglyph/i
  it.each([
    ['script', '<p>ok</p><script>alert(1)</script>'],
    ['이벤트 속성', '<div onclick="x()" onmouseover="y()">a</div><img src="https://x/a.png" onerror="alert(1)">'],
    ['javascript 링크', '<a href="javascript:alert(1)">x</a>'],
    ['javascript 링크(대소문자·공백·개행)', '<a href="  JaVa\nScRiPt:alert(1)">x</a>'],
    ['javascript 링크(엔티티)', '<a href="&#106;avascript:alert(1)">x</a>'],
    ['data 링크', '<a href="data:text/html;base64,AAAA">x</a>'],
    ['svg onload', '<svg onload=alert(1)><circle/></svg>'],
    ['math/mglyph 변종', '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>'],
    ['iframe·srcdoc', '<iframe src="https://evil"></iframe><iframe srcdoc="<script>1</script>"></iframe>'],
    ['object·embed', '<object data="x"></object><embed src="x">'],
    ['style 태그', '<style>body{display:none}</style><p>a</p>'],
    ['form·input', '<form action="https://evil"><input name=p></form>'],
    ['중첩 우회', '<scr<script>ipt>alert(1)</scr</script>ipt>'],
    ['noscript 탈출', '<noscript><p title="</noscript><img src=x onerror=alert(1)>">'],
    ['link·meta·base', '<link rel=stylesheet href=//evil><meta http-equiv=refresh content="0;url=//evil"><base href="//evil">'],
    ['프로토콜 상대 링크·이미지', '<a href="//evil.example/x">x</a><img src="//evil.example/p.png">'],
    ['data 이미지', '<img src="data:image/svg+xml;base64,PHN2Zz4=">'],
  ])('%s', (_name, html) => {
    const out = sanitizeContentHtml(html)
    // 속성 값 안에 이스케이프된 글자(&lt;img … onerror …)는 실행되지 않는 단순 텍스트 — 실제 태그·속성이 남았는지는 DOM으로 확인
    const dom = new DOMParser().parseFromString(`<body>${out}</body>`, 'text/html')
    expect(dom.body.querySelector('script,svg,math,iframe,object,embed,noscript,textarea,style,form,input,link,meta,base,img[onerror]')).toBeNull()
    for (const el of Array.from(dom.body.querySelectorAll('*'))) {
      for (const a of Array.from(el.attributes)) {
        expect(a.name.startsWith('on'), `${el.tagName}.${a.name}`).toBe(false)
        if (a.name === 'href' || a.name === 'src') expect(a.value).not.toMatch(/^\s*(javascript|data|vbscript):/i)
      }
    }
    expect(out).not.toMatch(/<script|<iframe|<svg|javascript:/i)
    expect(out).not.toContain('//evil')
    expect(out).not.toContain('data:')
  })

  it('style의 위험 선언만 제거하고 나머지는 유지', () => {
    const out = sanitizeContentHtml('<div style="color:red;background:url(javascript:alert(1));width:expression(alert(1));position:fixed;margin:0 auto;behavior:url(x.htc)">a</div>')
    expect(out.replace(/\s*([:;])\s*/g, '$1')).toContain('color:red')
    expect(out.replace(/\s*([:;])\s*/g, '$1')).toContain('margin:0 auto')
    expect(out).not.toMatch(/url\(|expression|position|behavior|javascript/i)
  })

  it('position:fixed/sticky는 !important·주석·대소문자 변형도 제거, relative는 유지', () => {
    for (const v of ['fixed !important', 'FIXED!important', '/**/fixed', 'sticky ! important', 'fixed/*x*/']) {
      const out = sanitizeContentHtml(`<p style="color:red;position:${v};top:0">x</p>`)
      expect(out).not.toMatch(/position/i)
      expect(out.replace(/\s*([:;])\s*/g, '$1')).toContain('color:red')
    }
    expect(sanitizeContentHtml('<p style="position:relative">x</p>').replace(/\s/g, '')).toContain('position:relative')
  })

  it('속성명 역슬래시 이스케이프·-webkit-sticky 우회도 제거', () => {
    const a = sanitizeContentHtml('<p style="color:red;pos\\69tion:fixed;top:0">x</p>')
    expect(a).not.toMatch(/pos|fixed/i)
    expect(a.replace(/\s*([:;])\s*/g, '$1')).toContain('color:red')
    expect(sanitizeContentHtml('<p style="position:-webkit-sticky;top:0">x</p>')).not.toMatch(/sticky|position/i)
    expect(sanitizeContentHtml('<p style="--tw-ring: 0px;margin:0">x</p>').replace(/\s/g, '')).toContain('--tw-ring:0px')
  })

  it('문자열이 아닌 입력은 빈 문자열', () => {
    for (const v of [undefined, null, 1, {}, [], '']) expect(sanitizeContentHtml(v)).toBe('')
  })
})

describe('cleanStyleAttribute', () => {
  it('Gemini 스타일(CSS 변수·초기값 선언)은 그대로 유지', () => {
    const s = '--tw-ring-offset-width: 0px; border: 0 solid; margin: 0px; padding: 0px; font-size: 100%'
    expect(cleanStyleAttribute(s)).toBe('--tw-ring-offset-width: 0px; border: 0 solid; margin: 0px; padding: 0px; font-size: 100%')
  })
  it('url()·역슬래시 이스케이프·@import 선언은 제거', () => {
    expect(cleanStyleAttribute('background: url(https://x/a.png); color: red')).toBe('color: red')
    expect(cleanStyleAttribute('color: \\72ed; margin: 0')).toBe('margin: 0')
    expect(cleanStyleAttribute('x: @import "a"; margin: 0')).toBe('margin: 0')
  })
})

describe('sanitizeContentBlocks', () => {
  it('text·html 블록 정화, 이미지 폭·정렬 정규화, 유튜브 ID·링크 주소 검증, 알 수 없는 type 제거', () => {
    const out = sanitizeContentBlocks([
      { type: 'text', html: '<p>ok</p><script>1</script>' },
      { type: 'html', content: '<img src=x onerror=1>' },
      { type: 'image', layout: 'weird', images: [{ url: 'https://x/a.png', alt: 'a', isHead: true }, { url: 'javascript:1', alt: 'b' }, { url: '//evil/p.png', alt: 'c' }], width: '9999px', align: 'evil' },
      { type: 'image', layout: 'collage', images: [{ url: 'https://x/b.png', alt: 'b' }] },
      { type: 'youtube', videoId: 'dQw4w9WgXcQ', url: 'https://youtu.be/dQw4w9WgXcQ' },
      { type: 'youtube', videoId: 'abc"><script>', url: '' },
      { type: 'link-entry', url: 'javascript:alert(1)', text: 'x' },
      { type: 'link-entry', url: 'https://ok.example', text: 'ok' },
      { type: 'divider' },
      { type: 'evil', html: '<script>' },
      'not-an-object',
      null,
    ])
    expect(out.map((b) => b.type)).toEqual(['text', 'html', 'image', 'image', 'youtube', 'link-entry', 'divider'])
    expect(out[0]).toEqual({ type: 'text', html: '<p>ok</p>' })
    expect((out[1] as { content: string }).content).not.toMatch(/onerror/i)
    expect(out[2]).toEqual({ type: 'image', layout: 'individual', images: [{ url: 'https://x/a.png', alt: 'a', isHead: true }], width: 100, align: 'center' })
    expect('width' in out[3]).toBe(false) // 폭·정렬이 없던 블록은 그대로(기존 글 무변경)
    expect(out[5]).toEqual({ type: 'link-entry', url: 'https://ok.example', text: 'ok' })
  })
  it('배열이 아니면 빈 배열', () => {
    for (const v of [undefined, null, 'x', 1, {}]) expect(sanitizeContentBlocks(v)).toEqual([])
  })
})

describe('배선 — 고객 화면 로더가 정화를 거친다', () => {
  const read = (p: string): string => readFileSync(p, 'utf-8')
  it('상품 상세 로더', () => {
    const s = read('src/routes/products/[id]/+page.server.ts')
    expect(s).toContain("from '$lib/server/sanitizeContentHtml'")
    expect(s).toContain('content_blocks: sanitizeContentBlocks(row.content_blocks)')
  })
  it('구독 상세 로더', () => {
    const s = read('src/routes/subscribe/[planId]/+page.server.ts')
    expect(s).toContain("from '$lib/server/sanitizeContentHtml'")
    expect(s).toContain('content_blocks: sanitizeContentBlocks(plan.content_blocks)')
  })
})
