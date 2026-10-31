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

describe('parseLeadRuleText — "당일" 정형 문구(방문 수령 당일 예약, 2026-10-30)', () => {
  it('운영 방문 문구 "당일 예약은 오후 6시까지" → 0일·18시', () => {
    expect(parseLeadRuleText('당일 예약은 오후 6시까지')).toEqual({ leadDays: 0, cutoffHour: 18 })
  })
  it('오전·오후 12시와 마감 표기', () => {
    expect(parseLeadRuleText('당일 오후 12시 마감')).toEqual({ leadDays: 0, cutoffHour: 12 })
    expect(parseLeadRuleText('당일 오전 11시까지')).toEqual({ leadDays: 0, cutoffHour: 11 })
    expect(parseLeadRuleText('당일 오전 12시까지')).toEqual({ leadDays: 0, cutoffHour: 0 })
  })
  it('24시간제 "당일 18:00까지"', () => {
    expect(parseLeadRuleText('당일 18:00까지 신청')).toEqual({ leadDays: 0, cutoffHour: 18 })
  })
  it('CMS 에 입력하기로 한 문구: 무인보관함 "당일 예약은 오후 6시까지" → 0일·18시, 퀵 "당일 예약은 오후 7시까지" → 0일·19시', () => {
    expect(parseLeadRuleText('당일 예약은 오후 6시까지')).toEqual({ leadDays: 0, cutoffHour: 18 })
    expect(parseLeadRuleText('당일 예약은 오후 7시까지')).toEqual({ leadDays: 0, cutoffHour: 19 })
  })
  it('운영 퀵 문구("당일 오후 12시부터 … 오후 8시내에 …")는 해석하지 않는다 — 12시부터를 마감으로 오해하지 않음', () => {
    expect(parseLeadRuleText('당일 오후 12시부터 오후 8시내에 예약시간 설정 시점 기준으로 최소 3시간 전 부터 가능')).toBeNull()
  })
  it('"N일 전"이 있으면 기존 규칙이 우선(택배·무인보관함 불변)', () => {
    expect(parseLeadRuleText('예약일 2일 전 19:00까지 마감.')).toEqual({ leadDays: 2, cutoffHour: 19 })
    expect(parseLeadRuleText('예약 대여일 1일 전 오후 7시까지')).toEqual({ leadDays: 1, cutoffHour: 19 })
    expect(parseLeadRuleText('당일이 아닌 1일 전 오후 7시까지')).toEqual({ leadDays: 1, cutoffHour: 19 })
  })
  it('시각이 없거나 숫자가 끼어 멀리 떨어진 "당일"은 해석하지 않는다', () => {
    expect(parseLeadRuleText('당일 예약 가능')).toBeNull()
    expect(parseLeadRuleText('당일 3건 한정, 오후 6시까지')).toBeNull()
  })
})

describe('당일 규칙(0일·18시)의 수령일 선택 가능 범위 — 마감 전 오늘, 마감 후 내일', () => {
  const rule = { leadDays: 0, cutoffHour: 18 }
  it('17:59 → 오늘 선택 가능', () => {
    const now = kst(2026, 10, 30, 17, 59)
    expect(minPickupDate(rule, now)).toBe('2026-10-30')
    expect(isPickupDateBlocked('2026-10-30', rule, now)).toBe(false)
  })
  it('18:00 → 오늘은 마감, 내일부터', () => {
    const now = kst(2026, 10, 30, 18, 0)
    expect(minPickupDate(rule, now)).toBe('2026-10-31')
    expect(isPickupDateBlocked('2026-10-30', rule, now)).toBe(true)
    expect(isPickupDateBlocked('2026-10-31', rule, now)).toBe(false)
  })
  it('resolveLeadRule 이 당일 문구를 기본값(1일 전 19시)보다 우선한다', () => {
    expect(resolveLeadRule({ isDeliveryType: false, deadlineText: '당일 예약은 오후 6시까지' })).toEqual({ leadDays: 0, cutoffHour: 18 })
    expect(resolveLeadRule({ isDeliveryType: false, deadlineText: '당일 오후 12시부터 오후 8시내에 …' })).toEqual({ leadDays: 1, cutoffHour: 19 })
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

describe('퀵서비스 당일 신청 마감 18시 — 수령일 선택 가능 범위(문구 "당일 예약은 오후 6시까지")', () => {
  const quick = resolveLeadRule({ isDeliveryType: false, deadlineText: '당일 예약은 오후 6시까지' })
  it('17:59 → 오늘 선택 가능, 18:00 → 오늘은 마감(내일부터)', () => {
    expect(isPickupDateBlocked('2026-10-30', quick, kst(2026, 10, 30, 17, 59))).toBe(false)
    expect(isPickupDateBlocked('2026-10-30', quick, kst(2026, 10, 30, 18, 0))).toBe(true)
    expect(minPickupDate(quick, kst(2026, 10, 30, 18, 0))).toBe('2026-10-31')
  })
})

describe('parseLeadRuleText — 폭넓은 표기 인식(2026-10-30 확장, 서버 parse_lead_rule_text 와 동일 규칙)', () => {
  const R = (leadDays: number, cutoffHour: number) => ({ leadDays, cutoffHour })

  it('붙여쓰기·띄어쓰기·"이전" 표기: 1일전, 1 일 전, 1일 이전', () => {
    expect(parseLeadRuleText('대여일 1일전 오후 7시까지')).toEqual(R(1, 19))
    expect(parseLeadRuleText('대여일 1 일 전 오후 7시까지')).toEqual(R(1, 19))
    expect(parseLeadRuleText('대여일 2일 이전 오후 7시까지')).toEqual(R(2, 19))
  })
  it('한글 날짜: 하루 전·전날·이틀 전·사흘 전·나흘 전', () => {
    expect(parseLeadRuleText('하루 전 오후 7시까지')).toEqual(R(1, 19))
    expect(parseLeadRuleText('전날 오후 7시까지')).toEqual(R(1, 19))
    expect(parseLeadRuleText('이틀 전 19:00까지')).toEqual(R(2, 19))
    expect(parseLeadRuleText('사흘 전 오후 6시까지')).toEqual(R(3, 18))
    expect(parseLeadRuleText('나흘 전 오전 10시까지')).toEqual(R(4, 10))
  })
  it('D-N 표기: D-2 19:00, d - 1 오후 7시', () => {
    expect(parseLeadRuleText('D-2 19:00까지')).toEqual(R(2, 19))
    expect(parseLeadRuleText('d - 1 오후 7시까지')).toEqual(R(1, 19))
  })
  it('붙여쓴 시각: 오후7시, 오후 7 시', () => {
    expect(parseLeadRuleText('1일 전 오후7시까지')).toEqual(R(1, 19))
    expect(parseLeadRuleText('1일 전 오후 7 시까지')).toEqual(R(1, 19))
  })
  it('오후/오전 + 시:분 (예전엔 오후 7:00 을 오전 7시로 잘못 읽음)', () => {
    expect(parseLeadRuleText('1일 전 오후 7:00까지')).toEqual(R(1, 19))
    expect(parseLeadRuleText('1일 전 오전 9:30까지')).toEqual(R(1, 9))
  })
  it('시와 분: 오후 6시 30분 → 시 단위만 사용(18시)', () => {
    expect(parseLeadRuleText('1일 전 오후 6시 30분까지')).toEqual(R(1, 18))
  })
  it('저녁·밤·낮·아침·새벽·정오 표현', () => {
    expect(parseLeadRuleText('1일 전 저녁 7시까지')).toEqual(R(1, 19))
    expect(parseLeadRuleText('1일 전 밤 9시까지')).toEqual(R(1, 21))
    expect(parseLeadRuleText('1일 전 낮 12시까지')).toEqual(R(1, 12))
    expect(parseLeadRuleText('1일 전 아침 9시까지')).toEqual(R(1, 9))
    expect(parseLeadRuleText('1일 전 새벽 2시까지')).toEqual(R(1, 2))
    expect(parseLeadRuleText('1일 전 정오까지')).toEqual(R(1, 12))
  })
  it('24시간 "19시" 표기(13~23시는 오전·오후 없이도 확실)', () => {
    expect(parseLeadRuleText('2일 전 19시까지')).toEqual(R(2, 19))
    expect(parseLeadRuleText('2일 전 19시 마감')).toEqual(R(2, 19))
  })
  it('오전·오후가 없는 1~12시("7시")는 어느 쪽인지 알 수 없어 해석하지 않는다(안전)', () => {
    expect(parseLeadRuleText('1일 전 7시까지')).toBeNull()
    expect(parseLeadRuleText('1일 전 12시까지')).toBeNull()
  })
  it('영문 am/pm: 7pm, 7 PM, 6:30pm', () => {
    expect(parseLeadRuleText('1일 전 7pm까지')).toEqual(R(1, 19))
    expect(parseLeadRuleText('1일 전 7 PM까지')).toEqual(R(1, 19))
    expect(parseLeadRuleText('1일 전 6:30pm까지')).toEqual(R(1, 18))
    expect(parseLeadRuleText('1일 전 9am까지')).toEqual(R(1, 9))
  })
  it('한글 숫자 시각: 오후 일곱 시, 오후 여섯시, 오전 열 시, 열두 시', () => {
    expect(parseLeadRuleText('1일 전 오후 일곱 시까지')).toEqual(R(1, 19))
    expect(parseLeadRuleText('1일 전 오후 여섯시까지')).toEqual(R(1, 18))
    expect(parseLeadRuleText('1일 전 오전 열 시까지')).toEqual(R(1, 10))
    expect(parseLeadRuleText('1일 전 오후 열두 시까지')).toEqual(R(1, 12))
  })
  it('전각 숫자·콜론도 읽는다: １일 전 １９：００', () => {
    expect(parseLeadRuleText('１일 전 １９：００까지')).toEqual(R(1, 19))
  })
  it('당일 표기 확장: 오늘·같은 날·저녁·24시간·시분·이전', () => {
    expect(parseLeadRuleText('오늘 오후 6시까지')).toEqual(R(0, 18))
    expect(parseLeadRuleText('수령 당일 저녁 7시 이전')).toEqual(R(0, 19))
    expect(parseLeadRuleText('당일 18시 마감')).toEqual(R(0, 18))
    expect(parseLeadRuleText('당일 오후 6시 30분까지')).toEqual(R(0, 18))
    expect(parseLeadRuleText('당일 6pm까지')).toEqual(R(0, 18))
    expect(parseLeadRuleText('같은 날 오후 5시까지')).toEqual(R(0, 17))
  })
  it('당일 문구는 끝맺음(까지·마감·이전)이 없으면 읽지 않는다(퀵 "12시부터" 오해 방지)', () => {
    expect(parseLeadRuleText('당일 오후 12시부터 오후 8시내에 예약시간 설정 시점 기준으로 최소 3시간 전 부터 가능')).toBeNull()
    expect(parseLeadRuleText('당일 오후 6시')).toBeNull()
  })
  it('기존 거부 사례는 그대로 거부', () => {
    expect(parseLeadRuleText('20:00 마감 임박')).toBeNull()
    expect(parseLeadRuleText('15:00 마감')).toBeNull()
    expect(parseLeadRuleText('대여일 2일 전까지')).toBeNull()
    expect(parseLeadRuleText('3시간 전까지')).toBeNull()
    expect(parseLeadRuleText('밤 12시까지 1일 전')).toBeNull()
  })
  it('기존 정형 문구는 결과 불변', () => {
    expect(parseLeadRuleText('예약일 2일 전 19:00까지 마감.')).toEqual(R(2, 19))
    expect(parseLeadRuleText('예약 대여일 1일 전 오후 7시까지')).toEqual(R(1, 19))
    expect(parseLeadRuleText('당일 예약은 오후 6시까지')).toEqual(R(0, 18))
  })
})

describe('parseLeadRuleText — 보완(2026-10-31, 서버 #785와 동일 규칙)', () => {
  const R = (leadDays: number, cutoffHour: number) => ({ leadDays, cutoffHour })

  it('터무니없이 큰 일수는 해석하지 않는다(상한 365일) — 달력 오류 방지, 서버와 같은 결과', () => {
    expect(parseLeadRuleText('99999999999일 전 오후 7시')).toBeNull()
    expect(parseLeadRuleText('2147483648일 전 오후 7시')).toBeNull()
    expect(parseLeadRuleText('366일 전 오후 7시까지')).toBeNull()
    expect(parseLeadRuleText('365일 전 오후 7시까지')).toEqual(R(365, 19))
    expect(parseLeadRuleText('0007일 전 오후 7시까지')).toEqual(R(7, 19))
  })

  it('당일 문구 사이의 글자 수(12자)는 이모지도 1글자로 센다 — 서버와 같은 결과', () => {
    expect(parseLeadRuleText(`당일 ${'😀'.repeat(10)} 오후 6시까지`)).toEqual(R(0, 18))
    expect(parseLeadRuleText(`당일 ${'😀'.repeat(11)} 오후 6시까지`)).toBeNull()
  })

  it('PM/AM이 시각 앞에 오는 표기: PM 6:00 → 18시, AM 9:30 → 9시', () => {
    expect(parseLeadRuleText('1일 전 PM 6:00까지')).toEqual(R(1, 18))
    expect(parseLeadRuleText('1일 전 pm 6까지')).toEqual(R(1, 18))
    expect(parseLeadRuleText('1일 전 AM 9:30까지')).toEqual(R(1, 9))
    expect(parseLeadRuleText('1일 전 PM 12:00까지')).toEqual(R(1, 12))
    expect(parseLeadRuleText('1일 전 AM 12:00까지')).toEqual(R(1, 0))
    expect(parseLeadRuleText('1일 전 PM 13:00까지')).toBeNull()
    expect(parseLeadRuleText('당일 PM 6:00까지')).toEqual(R(0, 18))
    expect(parseLeadRuleText('당일 AM 10시까지')).toEqual(R(0, 10))
  })

  it('PM 앞 표기 추가가 기존 표기를 바꾸지 않는다', () => {
    expect(parseLeadRuleText('1일 전 7pm까지')).toEqual(R(1, 19))
    expect(parseLeadRuleText('1일 전 6:30pm까지')).toEqual(R(1, 18))
    expect(parseLeadRuleText('1일 전 19:00까지')).toEqual(R(1, 19))
    expect(parseLeadRuleText('1일 전 오후 7:00까지')).toEqual(R(1, 19))
  })

  it('밤 12:00 / 밤 12:30 은 자정인지 모호해 해석하지 않는다(밤 12시와 같게)', () => {
    expect(parseLeadRuleText('1일 전 밤 12:00까지')).toBeNull()
    expect(parseLeadRuleText('1일 전 밤 12:30까지')).toBeNull()
    expect(parseLeadRuleText('1일 전 밤 12시까지')).toBeNull()
    expect(parseLeadRuleText('1일 전 밤 9:00까지')).toEqual(R(1, 21))
    expect(parseLeadRuleText('1일 전 밤 11:30까지')).toEqual(R(1, 23))
  })
})
