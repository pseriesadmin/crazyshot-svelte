// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

/**
 * BadgeChip — 이미지형은 <img> 로만, 텍스트바형은 색을 입힌 span 으로 렌더한다(인라인 SVG 삽입 금지)
 * 실행: npm run test:component (CS_COMPONENT_TEST=1)
 */
const { default: BadgeChip } = await import('$lib/components/cms/badge/BadgeChip.svelte')

let target: HTMLElement
let app: ReturnType<typeof mount> | null = null
function setup(props: Record<string, unknown>) {
  target = document.createElement('div')
  document.body.appendChild(target)
  app = mount(BadgeChip, { target, props: props as never })
  flushSync()
}
afterEach(() => { if (app) unmount(app); app = null; target?.remove() })

describe.skipIf(!process.env.CS_COMPONENT_TEST)('BadgeChip', () => {
  it('이미지형: <img> 로만 렌더하고 svg 요소를 직접 넣지 않는다', () => {
    setup({ kind: 'image', svg_url: 'https://x.supabase.co/storage/v1/object/public/badge-icons/badges/a.svg' })
    const img = target.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toContain('/badge-icons/badges/a.svg')
    expect(img?.getAttribute('alt')).toBe('')
    // 이미지형은 정사각 칸(한 변 = size × 1.5, 기본 24 → 36px)
    expect(img?.style.width).toBe('36px')
    expect(img?.style.height).toBe('36px')
    expect(target.querySelector('svg')).toBeNull()
  })

  it('텍스트바형: 문구·배경색·글자색이 적용된다', () => {
    setup({ kind: 'textbar', text: 'NEW', bg_color: '#3B2F8A', text_color: '#FFFFFF' })
    const bar = target.querySelector<HTMLElement>('.badge-bar')
    expect(bar?.textContent).toBe('NEW')
    expect(bar?.style.background).toMatch(/rgb\(59, 47, 138\)|#3b2f8a/i)
    expect(bar?.style.color).toMatch(/rgb\(255, 255, 255\)|#ffffff/i)
  })

  it('필수 값이 없으면 아무것도 그리지 않는다', () => {
    setup({ kind: 'image', svg_url: null })
    expect(target.querySelector('img')).toBeNull()
    unmount(app!); app = null; target.remove()
    setup({ kind: 'textbar', text: '' })
    expect(target.querySelector('.badge-bar')).toBeNull()
  })
})
