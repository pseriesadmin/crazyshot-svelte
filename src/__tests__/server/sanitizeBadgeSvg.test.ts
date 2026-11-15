import { describe, it, expect } from 'vitest'
import { sanitizeBadgeSvg, MAX_BADGE_SVG_BYTES } from '$lib/server/sanitizeBadgeSvg'

const OK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#f00"/></svg>'

describe('sanitizeBadgeSvg', () => {
  it('정상 SVG 는 그대로(viewBox 유지) 통과한다', () => {
    const r = sanitizeBadgeSvg(OK)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.svg).toContain('viewBox="0 0 24 24"')
  })

  it('script 태그를 제거한다', () => {
    const r = sanitizeBadgeSvg(OK.replace('<rect', '<script>alert(1)</script><rect'))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.svg.toLowerCase()).not.toContain('script')
  })

  it('on* 이벤트 속성을 제거한다', () => {
    const r = sanitizeBadgeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" onload="alert(1)"><rect onclick="x()" width="1" height="1"/></svg>')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.svg.toLowerCase()).not.toMatch(/\son\w+\s*=/)
  })

  it('foreignObject·iframe·embed 를 제거한다', () => {
    const r = sanitizeBadgeSvg(OK.replace('<rect', '<foreignObject><iframe src="x"/></foreignObject><rect'))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.svg.toLowerCase()).not.toMatch(/foreignobject|iframe|embed/)
  })

  it('외부 href·javascript: 참조를 제거하고 내부 #id 참조만 허용한다', () => {
    const r = sanitizeBadgeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><defs><g id="a"/></defs><use href="#a"/><use href="https://evil.example/x.svg#a"/><a href="javascript:alert(1)"><rect width="1" height="1"/></a><image href="https://evil.example/p.png"/></svg>')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.svg).toContain('href="#a"')
      expect(r.svg).not.toContain('evil.example')
      expect(r.svg.toLowerCase()).not.toContain('javascript:')
    }
  })

  it('style 안의 외부 url()·@import 를 거절하거나 제거한다', () => {
    const r = sanitizeBadgeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><style>@import url(https://evil.example/a.css); rect{fill:url(https://evil.example/x)}</style><rect width="1" height="1"/></svg>')
    if (r.ok) expect(r.svg).not.toContain('evil.example')
  })

  it('크기 한도(200KB)를 넘으면 거절한다', () => {
    expect(MAX_BADGE_SVG_BYTES).toBe(200 * 1024)
    const big = OK.replace('</svg>', `<!--${'a'.repeat(MAX_BADGE_SVG_BYTES)}--></svg>`)
    const r = sanitizeBadgeSvg(big)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('200KB')
  })

  it('정사각이 아닌 비율도 허용하고, 잘못된 viewBox 만 거절한다', () => {
    expect(sanitizeBadgeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24"/></svg>').ok).toBe(true)
    expect(sanitizeBadgeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 24"><rect width="60" height="24"/></svg>').ok).toBe(true)
    expect(sanitizeBadgeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="24" viewBox="0 0 60 24"><rect/></svg>').ok).toBe(true)
    expect(sanitizeBadgeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24"><rect/></svg>').ok).toBe(false)
    expect(sanitizeBadgeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0"><rect/></svg>').ok).toBe(false)
  })

  it('요소가 너무 많은(복잡한) SVG 는 거절한다', () => {
    const many = OK.replace('</svg>', `${'<rect width="1" height="1"/>'.repeat(600)}</svg>`)
    expect(sanitizeBadgeSvg(many).ok).toBe(false)
  })

  it('viewBox 가 없으면 거절한다', () => {
    expect(sanitizeBadgeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>').ok).toBe(false)
  })

  it('SVG 가 아닌 입력은 거절한다', () => {
    expect(sanitizeBadgeSvg('<html><body>x</body></html>').ok).toBe(false)
    expect(sanitizeBadgeSvg('').ok).toBe(false)
  })
})
