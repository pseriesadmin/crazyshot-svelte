import { describe, it, expect } from 'vitest'
import { pickDeliveryMemo } from '../../lib/server/dheroMemo'

describe('pickDeliveryMemo — 두발히어로 접수 메모 원천 (③)', () => {
  it('DM-1: 새 수령용 요청사항(pickup_request_note)을 우선 쓴다', () => {
    expect(pickDeliveryMemo({ pickupRequestNote: ' 공동현관 1234* ', notes: '옛 메모' })).toBe('공동현관 1234*')
  })
  it('DM-2: 새 요청사항이 없으면 옛 notes 로 대체한다', () => {
    expect(pickDeliveryMemo({ pickupRequestNote: null, notes: '경비실' })).toBe('경비실')
    expect(pickDeliveryMemo({ pickupRequestNote: '   ', notes: '경비실' })).toBe('경비실')
  })
  it('DM-3: 둘 다 없으면 undefined (반납용 요청사항은 배송 접수에 싣지 않는다)', () => {
    expect(pickDeliveryMemo({ pickupRequestNote: null, notes: null })).toBeUndefined()
    expect(pickDeliveryMemo({})).toBeUndefined()
  })
})
