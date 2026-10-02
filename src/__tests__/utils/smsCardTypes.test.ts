import { describe, it, expect } from 'vitest'
import { smsNotifyTypesForCard } from '$lib/utils/smsCardTypes'

// send_rental_chat_notification(Migration 494)이 저장하는 action_payload.type 기준 매핑 검증
describe('smsNotifyTypesForCard — 대화카드 type → SMS notify_type 후보', () => {
  it('notify_type을 그대로 type으로 저장하는 6종은 자기 자신', () => {
    for (const t of ['contract_link', 'contract_signed', 'reservation_approval', 'shipment_notify', 'tracking_notify', 'return_remind']) {
      expect(smsNotifyTypesForCard(t)).toEqual([t])
    }
  })

  it('RETURN_REGISTRATION_CARD → return_registration (BLOCKING 회귀 방지)', () => {
    expect(smsNotifyTypesForCard('RETURN_REGISTRATION_CARD')).toEqual(['return_registration'])
  })

  it('RESERVATION_STATUS_CARD → reservation_cancelled·dhero_place_guide 후보', () => {
    expect(smsNotifyTypesForCard('RESERVATION_STATUS_CARD')).toEqual(['reservation_cancelled', 'dhero_place_guide'])
  })

  it('SMS 대상이 아닌 카드·빈 값은 후보 없음', () => {
    for (const t of ['reservation_hold', 'rental_confirm', 'COUPON_GIFT_CARD', 'product_link', '', null, undefined]) {
      expect(smsNotifyTypesForCard(t)).toEqual([])
    }
  })
})
