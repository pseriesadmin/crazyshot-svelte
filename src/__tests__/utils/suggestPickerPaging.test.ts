import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** SuggestPicker 점진 노출(pageSize) — 기본 0(기존 동작 그대로), 배지 패널의 쿠폰·상품·카테고리 선택은 10개씩 */
const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), 'utf8')
const picker = read('src/lib/components/common/SuggestPicker.svelte')

describe('SuggestPicker pageSize', () => {
  it('기본값 0 = 전체 노출(다른 화면 영향 없음)', () => {
    expect(picker).toContain('pageSize = 0,')
    expect(picker).toContain('pageSize > 0 ? suggestions.slice(0, shown || pageSize) : suggestions')
  })
  it('새 목록 계산 시 첫 페이지로 되돌리고, 아래로 스크롤할 때만 추가 노출한다', () => {
    expect(picker).toContain('shown = pageSize')
    expect(picker).toContain('const down = el.scrollTop > lastScrollTop')
    expect(picker).toContain('if (down && el.scrollTop + el.clientHeight >= el.scrollHeight - 24) showMore()')
    expect(picker).toContain('onscroll={handleLayerScroll}')
  })
  it('키보드 ↓ 도 아직 안 그린 항목이 있으면 더 그린다', () => {
    expect(picker).toMatch(/visible\.length < suggestions\.length\) \{\s*showMore\(\)/)
  })
  it('배지 패널의 쿠폰·상품·카테고리 선택은 10개씩', () => {
    expect(read('src/lib/components/cms/badge/CouponPicker.svelte')).toContain('pageSize={10}')
    const rule = read('src/lib/components/cms/badge/BadgeRulePanel.svelte')
    expect(rule.match(/pageSize=\{10\}/g)?.length).toBe(2)
  })
})
