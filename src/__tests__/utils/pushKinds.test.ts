import { describe, it, expect } from 'vitest'
import { PUSH_KINDS, OTHER_KIND, pushKindOf, mergeTabOrder } from '$lib/utils/pushKinds'

// Stage·Production 의 고객 알림 32종(Migration #181~#788 기준) — 새 유형이 생기면 이 목록과 분류표를 함께 갱신한다
const LIFECYCLE_TYPES = [
  'reservation_hold', 'reservation_approval', 'rental_confirm', 'shipment_notify', 'return_registration', 'return_remind',
  'rental_complete', 'admin_chat_reply', 'chat_unanswered', 'contract_sent', 'identity_approved', 'reservation_cancelled',
  'damage_claimed', 'tracking_notify', 'locker_guide', 'dhero_place_guide', 'payment_cancelled_reissue', 'contract_signed_customer',
  'identity_request', 'late_fee_paid', 'ai_auto_reply', 'canned_auto_reply', 'return_notice_courier', 'return_notice_quick_5h',
  'return_notice_quick_2h', 'return_notice_quick_1h', 'return_notice_locker', 'inspection_pass', 'inspection_issue',
  'issue_report_request', 'locker_return_guide', 'late_fee_request',
]

describe('푸시알림 종류(서류철) 분류', () => {
  it('고객 알림 32종이 모두 기타가 아닌 종류에 들어간다', () => {
    expect(LIFECYCLE_TYPES).toHaveLength(32)
    for (const t of LIFECYCLE_TYPES) expect(pushKindOf(t)).not.toBe(OTHER_KIND.id)
  })

  it('분류 결과는 정의된 종류 id 안에서만 나온다', () => {
    const ids = new Set(PUSH_KINDS.map((k) => k.id))
    for (const t of LIFECYCLE_TYPES) expect(ids.has(pushKindOf(t))).toBe(true)
  })

  it('알 수 없는 새 유형은 기타로 모은다', () => {
    expect(pushKindOf('brand_new_type')).toBe(OTHER_KIND.id)
    expect(pushKindOf('toString')).toBe(OTHER_KIND.id) // 객체 기본 속성 이름이 분류로 오인되지 않는다
  })

  it('무인보관함 3종: 수령 안내는 수령·배송, 반납 두 가지는 반납', () => {
    expect(pushKindOf('locker_guide')).toBe('pickup')
    expect(pushKindOf('locker_return_guide')).toBe('return')
    expect(pushKindOf('return_notice_locker')).toBe('return')
  })
})

describe('서류철 안 순서 변경을 전체 순서에 합치기', () => {
  const row = (t: string) => ({ notify_type: t })
  const all = ['a1', 'b1', 'a2', 'b2', 'a3'].map(row)

  it('같은 서류철 항목이 차지하던 자리에 새 순서로 채우고, 다른 서류철 위치는 그대로 둔다', () => {
    const merged = mergeTabOrder(all, ['a3', 'a1', 'a2'])
    expect(merged.map((r) => r.notify_type)).toEqual(['a3', 'b1', 'a1', 'b2', 'a2'])
  })

  it('순서가 같으면 전체가 그대로', () => {
    expect(mergeTabOrder(all, ['a1', 'a2', 'a3']).map((r) => r.notify_type)).toEqual(['a1', 'b1', 'a2', 'b2', 'a3'])
  })

  it('전체 목록에 없는 유형·개수 불일치·중복이면 전체를 바꾸지 않는다(오래된 화면 방어)', () => {
    const base = ['a1', 'b1', 'a2', 'b2', 'a3']
    expect(mergeTabOrder(all, ['a1', 'zzz']).map((r) => r.notify_type)).toEqual(base)
    expect(mergeTabOrder(all, ['a1', 'a1']).map((r) => r.notify_type)).toEqual(base)
  })

  it('원본 배열을 건드리지 않는다', () => {
    const before = all.map((r) => r.notify_type)
    mergeTabOrder(all, ['a3', 'a2', 'a1'])
    expect(all.map((r) => r.notify_type)).toEqual(before)
  })
})
