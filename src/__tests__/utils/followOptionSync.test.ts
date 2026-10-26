import { describe, it, expect } from 'vitest'
import { planFollowOptionSync, withFollowOptionQty, type FollowSyncOption } from '$lib/utils/followOptionSync'

// 장바구니: 본상품 수량이 바뀌면 "수량 본상품 연동"(qty_follows_main) 옵션 수량도 본상품 수량에 맞춘다 (2026-10-26)
// 규칙(상품상세 OPT-QTYLOCK-1과 동일): 필수 연동 옵션은 항상 본상품 수량, 선택 연동 옵션은 고객이 담은 경우(qty>0)에만 따라간다.
// 재고가 모자라면 min(본상품 수량, 재고) — 재고가 0이면 그 옵션은 건드리지 않는다.
const opt = (over: Partial<FollowSyncOption> = {}): FollowSyncOption => ({
  optionProductId: 'o1',
  name: '배터리',
  qty: 1,
  unitPrice: 3000,
  qtyFollowsMain: true,
  isRequired: false,
  ...over,
})
const cap = (n: number) => () => n

describe('planFollowOptionSync', () => {
  it('선택 연동 옵션(담김)은 본상품 수량으로 맞춘다', () => {
    const r = planFollowOptionSync([opt({ qty: 1 })], 3, cap(10))
    expect(r.changed).toBe(true)
    expect(r.payload).toEqual([{ option_product_id: 'o1', option_name: '배터리', qty: 3, unit_price: 3000 }])
  })

  it('본상품 수량을 줄이면 같이 줄어든다', () => {
    const r = planFollowOptionSync([opt({ qty: 3 })], 2, cap(10))
    expect(r.changed).toBe(true)
    expect(r.payload[0].qty).toBe(2)
  })

  it('필수 연동 옵션은 담긴 수량과 상관없이 본상품 수량과 같다', () => {
    const r = planFollowOptionSync([opt({ qty: 1, isRequired: true })], 4, cap(10))
    expect(r.payload[0].qty).toBe(4)
  })

  it('이미 같으면 변경 없음(서버 호출 불필요)', () => {
    const r = planFollowOptionSync([opt({ qty: 2 })], 2, cap(10))
    expect(r.changed).toBe(false)
  })

  it('재고가 모자라면 min(본상품 수량, 재고)', () => {
    const r = planFollowOptionSync([opt({ qty: 1 })], 5, cap(3))
    expect(r.payload[0].qty).toBe(3)
  })

  it('재고가 0이면 그 옵션은 건드리지 않는다', () => {
    const r = planFollowOptionSync([opt({ qty: 2 })], 5, cap(0))
    expect(r.changed).toBe(false)
    expect(r.payload[0].qty).toBe(2)
  })

  it('연동이 아닌 옵션은 그대로 둔다', () => {
    const r = planFollowOptionSync([opt({ qtyFollowsMain: false, qty: 1 })], 4, cap(10))
    expect(r.changed).toBe(false)
    expect(r.payload[0].qty).toBe(1)
  })

  it('옵션이 여러 개면 연동 옵션만 바꾸고 나머지를 같은 순서·값으로 함께 보낸다 (set_reservation_options 는 옵션 목록 전체를 교체한다)', () => {
    const r = planFollowOptionSync(
      [opt({ optionProductId: 'a', name: 'A', qty: 1, qtyFollowsMain: false, unitPrice: 100 }), opt({ optionProductId: 'b', name: 'B', qty: 1, unitPrice: 200 })],
      3,
      cap(10),
    )
    expect(r.payload).toEqual([
      { option_product_id: 'a', option_name: 'A', qty: 1, unit_price: 100 },
      { option_product_id: 'b', option_name: 'B', qty: 3, unit_price: 200 },
    ])
  })

  it('옵션 id 가 없는 항목은 건드리지 않는다', () => {
    const r = planFollowOptionSync([opt({ optionProductId: null })], 4, cap(10))
    expect(r.changed).toBe(false)
  })

  it('원본 옵션 배열을 바꾸지 않는다', () => {
    const src = [opt({ qty: 1 })]
    planFollowOptionSync(src, 3, cap(10))
    expect(src[0].qty).toBe(1)
  })
})

describe('withFollowOptionQty — 화면 표시용 (본상품 수량 변경 즉시 반영)', () => {
  it('연동 옵션 수량만 본상품 수량으로 바꾼 새 목록을 돌려주고 다른 필드는 그대로', () => {
    const src = [
      { ...opt({ optionProductId: 'a', qty: 1, qtyFollowsMain: false }), imageUrl: 'x.png' },
      { ...opt({ optionProductId: 'b', qty: 1 }), imageUrl: 'y.png' },
    ]
    const out = withFollowOptionQty(src, 3, cap(10))
    expect(out.map((o) => o.qty)).toEqual([1, 3])
    expect(out[1].imageUrl).toBe('y.png')
    expect(src[1].qty).toBe(1)
  })

  it('바뀔 옵션이 없으면 같은 배열 참조를 그대로 돌려준다 (불필요한 재계산 방지)', () => {
    const src = [opt({ qty: 2 })]
    expect(withFollowOptionQty(src, 2, cap(10))).toBe(src)
  })

  it('선택 연동 옵션을 담지 않은 경우(qty 0)는 0 유지', () => {
    const out = withFollowOptionQty([opt({ qty: 0 })], 4, cap(10))
    expect(out[0].qty).toBe(0)
  })
})

describe('재고 상한에 이 그룹이 이미 가진 옵션 수량 포함 (sp3 MAJOR-2, 2026-10-26)', () => {
  // 장바구니의 "남은 재고" 숫자는 이 그룹이 이미 점유한 옵션 수량을 뺀 값이다 — 서버는 자기 몫을 빼지 않고 계산한다.
  it('includeOwnQty: 남은 재고 2 + 자기 옵션 3 = 상한 5 → 본상품 3이면 옵션 3 유지(2로 줄지 않음)', () => {
    const src = [opt({ qty: 3 })]
    expect(withFollowOptionQty(src, 3, cap(2), { includeOwnQty: true })).toBe(src)
    expect(planFollowOptionSync(src, 3, cap(2), { includeOwnQty: true }).changed).toBe(false)
  })

  it('includeOwnQty 가 없으면 기존처럼 남은 재고만 상한 (임시예약 등 점유가 없는 경우)', () => {
    const out = withFollowOptionQty([opt({ qty: 3 })], 3, cap(2))
    expect(out[0].qty).toBe(2)
  })

  it('includeOwnQty 여도 본상품 수량을 넘지 않는다', () => {
    const out = withFollowOptionQty([opt({ qty: 3 })], 2, cap(2), { includeOwnQty: true })
    expect(out[0].qty).toBe(2)
  })

  it('serverMainQty: 본상품 수량이 서버에서 불러온 값과 같으면 서버 저장 수량을 그대로 둔다', () => {
    const src = [opt({ qty: 3 })]
    expect(withFollowOptionQty(src, 3, cap(0), { serverMainQty: 3 })).toBe(src)
  })

  it('serverMainQty 와 다르면(수량 변경 중) 규칙대로 보정', () => {
    const out = withFollowOptionQty([opt({ qty: 3 })], 4, cap(10), { serverMainQty: 3 })
    expect(out[0].qty).toBe(4)
  })
})
