import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 상품상세 — 배지는 제목 카드(.title-card 의 title-block)에만 노출한다 — 대표 이미지(ProductHero)에는 겹치지 않는다(2026-11-14 Stephen 지시: 중복 노출 제거).
 */
const page = readFileSync(path.resolve(process.cwd(), 'src/routes/products/[id]/+page.svelte'), 'utf8')

describe('상품상세 배지 — 제목 영역', () => {
  it('제목 카드 title-block 안에서 배지를 그린다(상품명보다 위)', () => {
    const block = page.slice(page.indexOf('<div class="title-block">'), page.indexOf('<h1 class="product-name">'))
    expect(block).toContain('titleBadges')
    expect(block).toContain('<BadgeChip')
  })

  it('개수 상한 없이 전부 보여 주고(배지목록×배지타입 키), 대표 이미지에는 배지를 넘기지 않는다', () => {
    expect(page).toMatch(/titleBadges = \$derived\(data\.productBadges\?\.\[data\.productId\] \?\? \[\]\)/)
    expect(page).not.toContain('MAX_VISIBLE_BADGES')
    expect(page).toContain('{#each titleBadges as b (`${b.badge_id}:${b.template_id}`)}')
    expect(page).not.toMatch(/<ProductHero[^>]*badges=/)
    const hero = readFileSync(path.resolve(process.cwd(), 'src/lib/components/products/ProductHero.svelte'), 'utf8')
    expect(hero).not.toMatch(/badge/i)
  })
})
