import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** 상품 카드(ProductDPCard) — 이미지형 배지는 좌상단, 바(텍스트)형 배지는 하단 중앙(여백 10px)에 둔다. 표시 상한 3개는 합산. */
const src = readFileSync(path.resolve(process.cwd(), 'src/lib/components/products/ProductDPCard.svelte'), 'utf8')

describe('상품 카드 배지 위치', () => {
  it('이미지형/바형을 나눠 그린다(일반·thumb 두 곳 모두)', () => {
    expect(src).toContain("const iconBadges = $derived(shownBadges.filter((b) => b.kind !== 'textbar'))")
    expect(src).toContain("const barBadges = $derived(shownBadges.filter((b) => b.kind === 'textbar'))")
    expect(src.match(/class="pc-badges-bar"/g)?.length).toBe(2)
    expect(src.match(/class="pc-badges"/g)?.length).toBe(2)
  })

  it('바형 배지는 하단 중앙 + 여백', () => {
    const css = src.slice(src.indexOf('.pc-badges-bar {'))
    const rule = css.slice(0, css.indexOf('}'))
    expect(rule).toMatch(/bottom:\s*10px/)
    expect(rule).toMatch(/left:\s*50%/)
    expect(rule).toMatch(/translateX\(-50%\)/)
  })
})
