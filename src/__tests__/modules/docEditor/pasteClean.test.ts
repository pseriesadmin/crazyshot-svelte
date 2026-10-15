import { describe, it, expect } from 'vitest'
import { cleanPastedHtml } from '$lib/modules/doc-editor/core/pasteClean'

describe('cleanPastedHtml', () => {
  it('주석·style·script·meta·link·MS 전용 스타일·원본 서체를 제거하고 본문은 보존한다', () => {
    const html =
      '<!--StartFragment--><meta charset="utf-8"><style>p{color:red}</style><link rel="x" href="y">' +
      '<p style="font-family: Gulim; mso-line-height-rule:exactly; color:#111">본문</p><script>alert(1)</script>'
    const out = cleanPastedHtml(html)
    expect(out).not.toMatch(/StartFragment|<meta|<style|<link|<script|font-family|mso-/i)
    expect(out).toContain('본문')
    expect(out).toContain('color:#111')
  })
  it('편집기 안에서 복사한 조각(data-pm-slice)은 서체를 포함해 그대로 둔다', () => {
    const html = '<p data-pm-slice="1 1 []" style="font-family: Georgia">내부</p>'
    expect(cleanPastedHtml(html)).toBe(html)
  })
  it('깨끗한 HTML은 그대로 둔다', () => {
    const html = '<p>안녕 <strong>세계</strong></p>'
    expect(cleanPastedHtml(html)).toBe(html)
  })
})
