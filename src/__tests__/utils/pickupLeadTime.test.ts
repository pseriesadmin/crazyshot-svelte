import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LEAD_RULE,
  DELIVERY_LEAD_RULE,
  parseLeadRuleText,
  resolveLeadRule,
  minPickupDate,
  isPickupDateBlocked,
  maxReturnDate,
  leadTimeMessage,
  stripServerGuardPrefix,
} from '$lib/utils/pickupLeadTime'

// KST 시각을 UTC epoch ms로 만든다(테스트 실행 환경 타임존과 무관하게 검증하기 위함)
const kst = (y: number, m: number, d: number, h: number, min = 0): number =>
  Date.UTC(y, m - 1, d, h - 9, min)

describe('minPickupDate — "N일 전 오후 H시까지" 규칙 (KST 기준)', () => {
  it('방문·퀵(1일 전 19시): 9/30 18:59 → 내일(10/1) 선택 가능', () => {
    expect(minPickupDate(DEFAULT_LEAD_RULE, kst(2026, 9, 30, 18, 59))).toBe('2026-10-01')
  })
  it('방문·퀵(1일 전 19시): 9/30 19:00 → 모레(10/2)부터', () => {
    expect(minPickupDate(DEFAULT_LEAD_RULE, kst(2026, 9, 30, 19, 0))).toBe('2026-10-02')
  })
  it('택배(2일 전 19시): 9/30 18:59 → 10/2부터 (오늘·내일 불가)', () => {
    expect(minPickupDate(DELIVERY_LEAD_RULE, kst(2026, 9, 30, 18, 59))).toBe('2026-10-02')
  })
  it('택배(2일 전 19시): 9/30 19:00 → 10/3부터', () => {
    expect(minPickupDate(DELIVERY_LEAD_RULE, kst(2026, 9, 30, 19, 0))).toBe('2026-10-03')
  })
  it('KST 자정 직후(00:00)는 KST 날짜 기준으로 계산한다 (UTC 전날이어도)', () => {
    // KST 10/1 00:30 = UTC 9/30 15:30
    expect(minPickupDate(DEFAULT_LEAD_RULE, kst(2026, 10, 1, 0, 30))).toBe('2026-10-02')
  })
  it('월말 경계: 10/31 19시 이후 방문 → 11/2', () => {
    expect(minPickupDate(DEFAULT_LEAD_RULE, kst(2026, 10, 31, 20))).toBe('2026-11-02')
  })
  it('isPickupDateBlocked: 최소일 미만만 차단', () => {
    const now = kst(2026, 9, 30, 10)
    expect(isPickupDateBlocked('2026-09-30', DEFAULT_LEAD_RULE, now)).toBe(true)
    expect(isPickupDateBlocked('2026-10-01', DEFAULT_LEAD_RULE, now)).toBe(false)
    expect(isPickupDateBlocked('2026-10-01', DELIVERY_LEAD_RULE, now)).toBe(true)
    expect(isPickupDateBlocked('2026-10-02', DELIVERY_LEAD_RULE, now)).toBe(false)
  })
})

describe('parseLeadRuleText — CMS 안내문구에서 규칙 추출 (정형 문구만)', () => {
  it('"예약 대여일 2일 전 오후 7시까지" → 2일·19시', () => {
    expect(parseLeadRuleText('예약 대여일 2일 전 오후 7시까지')).toEqual({ leadDays: 2, cutoffHour: 19 })
  })
  it('"예약 대여일 1일 전 오후 7시까지" → 1일·19시', () => {
    expect(parseLeadRuleText('예약 대여일 1일 전 오후 7시까지')).toEqual({ leadDays: 1, cutoffHour: 19 })
  })
  it('24시간제 표기: "3일 전 18:00까지" → 3일·18시', () => {
    expect(parseLeadRuleText('대여일 3일 전 18:00까지')).toEqual({ leadDays: 3, cutoffHour: 18 })
  })
  it('오전/오후 12시 처리', () => {
    expect(parseLeadRuleText('1일 전 오후 12시까지')).toEqual({ leadDays: 1, cutoffHour: 12 })
    expect(parseLeadRuleText('1일 전 오전 9시까지')).toEqual({ leadDays: 1, cutoffHour: 9 })
  })
  it('"N일 전"이 없는 자유 문구는 해석하지 않는다 (Stage의 "20:00 마감 임박" 등)', () => {
    expect(parseLeadRuleText('20:00 마감 임박')).toBeNull()
    expect(parseLeadRuleText('15:00 마감')).toBeNull()
    expect(parseLeadRuleText('')).toBeNull()
    expect(parseLeadRuleText(null)).toBeNull()
  })
  it('시각이 없는 문구는 해석하지 않는다', () => {
    expect(parseLeadRuleText('대여일 2일 전까지')).toBeNull()
  })
})

describe('resolveLeadRule — 배송형은 기본 2일, 그 외 1일 / 정형 문구가 있으면 우선', () => {
  it('문구 없음: 배송형=2일 19시, 비배송=1일 19시', () => {
    expect(resolveLeadRule({ isDeliveryType: true })).toEqual({ leadDays: 2, cutoffHour: 19 })
    expect(resolveLeadRule({ isDeliveryType: false })).toEqual({ leadDays: 1, cutoffHour: 19 })
  })
  it('자유 문구는 기본값 사용', () => {
    expect(resolveLeadRule({ isDeliveryType: false, deadlineText: '20:00 마감 임박' })).toEqual({ leadDays: 1, cutoffHour: 19 })
  })
  it('정형 문구는 기본값보다 우선', () => {
    expect(resolveLeadRule({ isDeliveryType: false, deadlineText: '예약 대여일 3일 전 오후 6시까지' })).toEqual({ leadDays: 3, cutoffHour: 18 })
  })
})

describe('maxReturnDate — 최대 대여일 상한 (요금 산식과 정합)', () => {
  it('일반 방식(차이×24h): 10/2 수령, 최대 15일 → 10/17까지 (정확히 15일)', () => {
    expect(maxReturnDate('2026-10-02', 15, false)).toBe('2026-10-17')
  })
  it('배송형(날짜차+1일 청구): 10/2 수령, 최대 15일 → 10/16까지 (포함 15일)', () => {
    expect(maxReturnDate('2026-10-02', 15, true)).toBe('2026-10-16')
  })
  it('수령일·최대일 미설정이면 제한 없음', () => {
    expect(maxReturnDate('', 15, false)).toBeUndefined()
    expect(maxReturnDate('2026-10-02', null, false)).toBeUndefined()
    expect(maxReturnDate('2026-10-02', 0, true)).toBeUndefined()
  })
})

describe('leadTimeMessage', () => {
  it('안내 문구 생성', () => {
    expect(leadTimeMessage(DELIVERY_LEAD_RULE)).toBe('선택한 수령일은 신청 마감(대여일 2일 전 오후 7시)이 지났습니다.')
    expect(leadTimeMessage({ leadDays: 1, cutoffHour: 9 })).toBe('선택한 수령일은 신청 마감(대여일 1일 전 오전 9시)이 지났습니다.')
  })
})

describe('stripServerGuardPrefix', () => {
  it('서버 예외 접두사만 제거', () => {
    expect(stripServerGuardPrefix('PICKUP_LEAD_TIME: 선택한 수령일은 신청 마감(대여일 1일 전 오후 7시)이 지났습니다.')).toBe('선택한 수령일은 신청 마감(대여일 1일 전 오후 7시)이 지났습니다.')
    expect(stripServerGuardPrefix('RENTAL_PERIOD_EXCEEDED: 최대 대여기간(15일)을 초과했습니다.')).toBe('최대 대여기간(15일)을 초과했습니다.')
    expect(stripServerGuardPrefix('해당 기간에 예약 가능한 재고가 없습니다.')).toBe('해당 기간에 예약 가능한 재고가 없습니다.')
    expect(stripServerGuardPrefix(null)).toBeUndefined()
  })
})
