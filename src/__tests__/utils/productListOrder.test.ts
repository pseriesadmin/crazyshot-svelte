import { describe, it, expect } from 'vitest'
import { orderByOnceSeed, isValidOnceSeed, newOnceSeed } from '$lib/utils/productListOrder'

const ITEMS = Array.from({ length: 12 }, (_, i) => ({ id: `p${i + 1}` }))

describe('orderByOnceSeed — 1회 랜덤노출 정렬', () => {
  it('같은 시드·같은 목록이면 항상 같은 순서(다시 들어와도 유지)', () => {
    const a = orderByOnceSeed(ITEMS, 'abc123xy', 'md').map((x) => x.id)
    const b = orderByOnceSeed(ITEMS, 'abc123xy', 'md').map((x) => x.id)
    expect(a).toEqual(b)
  })

  it('항목을 빠뜨리거나 늘리지 않는 순열이다', () => {
    const out = orderByOnceSeed(ITEMS, 'seedseed1', 'hero').map((x) => x.id)
    expect([...out].sort()).toEqual(ITEMS.map((x) => x.id).sort())
  })

  it('시드가 다르면 순서가 달라지고(섞임), 목록 구분(salt)이 다르면 서로 다르게 섞인다', () => {
    const base = orderByOnceSeed(ITEMS, 'aaaaaa11', 'md').map((x) => x.id).join()
    expect(orderByOnceSeed(ITEMS, 'bbbbbb22', 'md').map((x) => x.id).join()).not.toBe(base)
    expect(orderByOnceSeed(ITEMS, 'aaaaaa11', 'hero').map((x) => x.id).join()).not.toBe(base)
  })

  it('원본 배열을 바꾸지 않는다', () => {
    const copy = ITEMS.map((x) => ({ ...x }))
    orderByOnceSeed(ITEMS, 'seed0000', 'md')
    expect(ITEMS).toEqual(copy)
  })

  it('항목이 하나 빠져도 남은 항목끼리의 상대 순서는 유지된다', () => {
    const full = orderByOnceSeed(ITEMS, 'stable01', 'md').map((x) => x.id)
    const without = orderByOnceSeed(ITEMS.filter((x) => x.id !== 'p5'), 'stable01', 'md').map((x) => x.id)
    expect(without).toEqual(full.filter((id) => id !== 'p5'))
  })
})

describe('시드 검증', () => {
  it('새로 만든 시드는 형식에 맞고, 조작된 값은 거절한다', () => {
    expect(isValidOnceSeed(newOnceSeed())).toBe(true)
    expect(isValidOnceSeed('')).toBe(false)
    expect(isValidOnceSeed('ab')).toBe(false)
    expect(isValidOnceSeed('<script>alert(1)</script>')).toBe(false)
    expect(isValidOnceSeed(undefined)).toBe(false)
  })
})
