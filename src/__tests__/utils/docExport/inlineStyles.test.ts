// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { applyComputedStylesInline } from '$lib/utils/docExport/inlineStyles'

/** HTML형 양식은 서식이 전부 클래스 CSS라 한글 엔진이 못 읽는다 — 계산된 서식을 요소 style 속성으로 풀어 넣는지 확인 */
function load(html: string, css: string): Document {
  const doc = document.implementation.createHTMLDocument('t')
  doc.head.innerHTML = `<style>${css}</style>`
  doc.body.innerHTML = html
  // jsdom 은 defaultView 가 있는 문서에서만 서식을 계산한다 — 실제 문서에 붙여서 쓴다
  const iframe = document.createElement('iframe')
  document.body.appendChild(iframe)
  const d = iframe.contentDocument!
  d.open(); d.write(`<!DOCTYPE html><html><head><style>${css}</style></head><body>${html}</body></html>`); d.close()
  return d
}

describe('applyComputedStylesInline', () => {
  const css = `
    .title { text-align: center; font-weight: bold; font-size: 22px; color: #112233; }
    .cell { border: 1px solid #000000; padding: 4px; background-color: #eeeeee; }
    .plain { margin: 0; }
  `
  const html = `<h1 class="title">제목</h1><table><tr><td class="cell">칸</td></tr></table><p class="plain">본문</p>`

  it('글자 속성·배경·테두리·안쪽 여백이 style 속성으로 옮겨진다', () => {
    const d = load(html, css)
    applyComputedStylesInline(d)
    const h1 = d.querySelector('h1')!.getAttribute('style') ?? ''
    expect(h1).toMatch(/text-align:\s*center/)
    expect(h1).toMatch(/font-weight:\s*(bold|700)/)
    expect(h1).toMatch(/font-size:\s*22px/)
    expect(h1).toContain('color:#112233')
    const td = d.querySelector('td')!.getAttribute('style') ?? ''
    expect(td).toContain('background-color:#eeeeee')
    expect(td).toMatch(/border:\s*1px solid #000000/)
    expect(td).toMatch(/padding:\s*4px/)
  })

  it('클래스·<style>는 지운다(엔진은 읽지 못하므로 남길 이유가 없다)', () => {
    const d = load(html, css)
    applyComputedStylesInline(d)
    expect(d.querySelector('style')).toBeNull()
    expect(d.querySelector('[class]')).toBeNull()
  })

  it('텍스트 내용은 바뀌지 않는다', () => {
    const d = load(html, css)
    applyComputedStylesInline(d)
    expect(d.body.textContent).toBe('제목칸본문')
  })
})
