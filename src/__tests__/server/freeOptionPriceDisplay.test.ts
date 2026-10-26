import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 무료 제공(is_free) 옵션은 '요금정보' 자리에 "무료제공"을 보여준다 — 상품상세·장바구니 (2026-10-26, Stephen 지시)
 * (과거에는 "Day 0원 / 12H 0원"으로 표시됐다). 금액 계산(0원 고정)은 서버·화면 모두 기존대로.
 */
const DETAIL = readFileSync('src/routes/products/[id]/+page.svelte', 'utf8')
const CART = readFileSync('src/routes/cart/+page.svelte', 'utf8')
const CART_SERVER = readFileSync('src/routes/cart/+page.server.ts', 'utf8')
const GROUPING = readFileSync('src/lib/utils/cartLineGrouping.ts', 'utf8')

describe('상품상세 — 무료 제공 옵션 요금 표시', () => {
  it('opt.is_free 이면 요금 숫자 대신 "무료제공"을 보여준다', () => {
    const row = DETAIL.slice(DETAIL.indexOf('<div class="option-bottom-row">'), DETAIL.indexOf('class="qty-control small"'))
    expect(row).toMatch(/\{#if opt\.is_free\}[\s\S]*무료제공[\s\S]*\{:else\}[\s\S]*option-dual-price/)
  })
})

describe('장바구니 — 무료 제공 옵션 요금 표시', () => {
  it('서버가 옵션별 무료 여부(isFree)를 내려준다', () => {
    expect(CART_SERVER).toMatch(/isFree:\s*isFreeForThisMain/)
  })

  it('그룹 병합이 isFree 를 보존한다', () => {
    expect(GROUPING).toContain('isFree')
  })

  it('두 옵션 행(PC·모바일 스니펫) 모두 opt.isFree 이면 "무료제공"을 보여준다', () => {
    const count = CART.split(/\{#if opt\.isFree\}[\s\S]{0,200}?무료제공/).length - 1
    expect(count).toBe(2)
  })

  it('무료 옵션도 수량 컨트롤과 이름·배지는 그대로 둔다 (요금 영역만 대체)', () => {
    expect(CART).toContain('opt-qty-ctrl')
    // 요금 행 래퍼(레이아웃)는 무료·유료 모두 유지: 스니펫 2곳 × (무료 1 + 유료 1)
    expect(CART.split('class="dual-price-row dual-price-row--opt"').length - 1).toBe(4)
  })
})
