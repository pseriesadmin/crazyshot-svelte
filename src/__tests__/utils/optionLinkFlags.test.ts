import { describe, it, expect } from 'vitest'
import { applyOptionFlag } from '$lib/utils/optionLinkFlags'

// 상품 등록 > 옵션상품: 일괄 적용 콤보를 누르면 모든 옵션 카드의 같은 설정이 함께 바뀐다 (2026-10-26)
type Opt = { id: string; is_required: boolean; is_free: boolean; qty_follows_main: boolean }

const base = (): Opt[] => [
  { id: 'a', is_required: false, is_free: true, qty_follows_main: false },
  { id: 'b', is_required: true, is_free: false, qty_follows_main: false },
]

describe('applyOptionFlag — 일괄 적용 콤보 즉시 동반 적용', () => {
  it('켜면 모든 카드의 해당 설정이 켜진다 (이미 켜진 카드는 그대로)', () => {
    const out = applyOptionFlag(base(), 'is_required', true)
    expect(out.map((o) => o.is_required)).toEqual([true, true])
  })

  it('끄면 모든 카드의 해당 설정이 꺼진다', () => {
    const out = applyOptionFlag(base(), 'is_free', false)
    expect(out.map((o) => o.is_free)).toEqual([false, false])
  })

  it('다른 설정과 다른 필드는 건드리지 않는다', () => {
    const out = applyOptionFlag(base(), 'qty_follows_main', true)
    expect(out.map((o) => o.is_required)).toEqual([false, true])
    expect(out.map((o) => o.is_free)).toEqual([true, false])
    expect(out.map((o) => o.id)).toEqual(['a', 'b'])
  })

  it('원본 배열·객체를 바꾸지 않고 새 객체를 돌려준다 (Svelte 반응성)', () => {
    const src = base()
    const out = applyOptionFlag(src, 'is_required', true)
    expect(out).not.toBe(src)
    expect(out[0]).not.toBe(src[0])
    expect(src[0].is_required).toBe(false)
  })

  it('빈 목록은 빈 목록', () => {
    expect(applyOptionFlag([] as Opt[], 'is_required', true)).toEqual([])
  })
})
