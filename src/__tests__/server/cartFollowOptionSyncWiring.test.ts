import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 장바구니 — 본상품 수량 변경 시 "수량 본상품 연동" 옵션 수량 동기화 배선 점검 (2026-10-26)
 * 순수 규칙은 followOptionSync.test.ts, 여기서는 장바구니 화면이 그 규칙을 실제로 호출하는지 소스로 확인한다.
 */
const CART = readFileSync('src/routes/cart/+page.svelte', 'utf8')

function fnBody(src: string, header: string): string {
  const start = src.indexOf(header)
  expect(start, `${header} 가 있어야 한다`).toBeGreaterThan(-1)
  const open = src.indexOf('{', src.indexOf(')', start))
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  throw new Error(`${header} 본문을 찾지 못했다`)
}

describe('장바구니 연동 옵션 동기화 배선', () => {
  it('순수 규칙 유틸을 가져온다', () => {
    expect(CART).toContain("from '$lib/utils/followOptionSync'")
  })

  it('수량 확정(flushQtyChange) 뒤에 연동 옵션을 서버에도 맞춘다', () => {
    const body = fnBody(CART, 'async function flushQtyChange(')
    expect(body).toContain('await syncFollowOptionsToMainQty(canonicalId)')
    // 반복(수량 증감) 루프가 끝난 뒤에 호출되어야 한다
    expect(body.indexOf('syncFollowOptionsToMainQty')).toBeGreaterThan(body.indexOf('for (let i = 0; i < steps; i++)'))
  })

  it('동기화는 확정값(groupsBaseById)으로 판단하고 set_reservation_options 로 저장한다', () => {
    const body = fnBody(CART, 'async function syncFollowOptionsToMainQty(')
    expect(body).toContain('groupsBaseById.get(canonicalId)')
    expect(body).not.toContain('groupsById.get(')
    expect(body).toContain('planFollowOptionSync(')
    expect(body).toContain("'set_reservation_options'")
    expect(body).toContain('await invalidateAll()')
  })

  it('화면 표시용 groupsById 는 미확정 수량 변경도 연동 옵션 수량에 즉시 반영한다', () => {
    const start = CART.indexOf('const groupsById = $derived(')
    expect(start).toBeGreaterThan(-1)
    const block = CART.slice(start, start + 900)
    expect(block).toContain('withFollowOptionQty(')
  })

  it('표시 보정은 서버에서 불러온 본상품 수량과 같으면 건드리지 않고, 보정 시 hold 는 자기 옵션 수량을 재고 상한에 포함한다 (sp3 MAJOR-2)', () => {
    const start = CART.indexOf('const groupsById = $derived(')
    const block = CART.slice(start, start + 1600)
    expect(block).toContain('serverMainQty')
    expect(block).toContain("includeOwnQty: base.status === 'hold'")
  })

  it('동기화도 hold 는 자기 옵션 수량을 재고 상한에 포함한다', () => {
    const body = fnBody(CART, 'async function syncFollowOptionsToMainQty(')
    expect(body).toContain("includeOwnQty: fresh.status === 'hold'")
  })

  it('다른 옵션 변경이 처리 중이라 건너뛰면 잠시 뒤 다시 시도한다 (조용히 포기하지 않음)', () => {
    const body = fnBody(CART, 'async function syncFollowOptionsToMainQty(')
    expect(body).toContain('setTimeout(')
    expect(body).toMatch(/attempt/)
  })

  it('주문 생성 거절 OPTION_DELIVERY_DISABLED 를 안내 문구로 보여준다 (sp3 MINOR)', () => {
    expect(CART).toContain("rejected?.code === 'OPTION_DELIVERY_DISABLED'")
    const api = readFileSync('src/routes/api/reservations/create-order/+server.ts', 'utf8')
    expect(api).toContain("errMessage.includes('OPTION_DELIVERY_DISABLED')")
    expect(api).toContain("code: 'OPTION_DELIVERY_DISABLED'")
  })

  it('재시도 타이머는 화면을 벗어날 때 정리한다 (sp3 M-3)', () => {
    const body = fnBody(CART, 'async function syncFollowOptionsToMainQty(')
    expect(body).toContain('followSyncTimers.add(')
    expect(CART).toMatch(/followSyncTimers\.forEach\(clearTimeout\)/)
  })
})
