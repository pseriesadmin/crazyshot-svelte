/**
 * TDD: offHoursTime.test.ts — 질문 속 시각을 공식 영업시간(09:00 ~ 22:00)과 비교해 "영업 외 시간"이면 표식 단어를 붙인다 (2026-10-08)
 * 이유: 빠른답변 매처는 "11시" 같은 숫자 표현을 핵심 단어에서 제외한다 → "밤 11시에 대여 가능해요?"는 일반어만 남아 매칭되지 않았다.
 * 규칙: 시각이 확정되는 표현만 판정(오전/오후/새벽/밤/저녁/아침 + N시, 13~24시·0시, HH:MM). 애매한 "10시"는 판정하지 않는다.
 *       영업시간은 [09:00, 22:00) — 22:00 정각부터 영업 외, 09:00 정각부터 영업 중.
 */
import { describe, it, expect } from 'vitest'
import {
  OFFICE_OPEN_HOUR, OFFICE_CLOSE_HOUR, OFF_HOURS_MARKER, extractClockHours, hasOffHoursWord, isOutsideOfficeHours, withOffHoursMarker,
} from '$lib/server/offHoursTime'

describe('상수', () => {
  it('공식 영업시간은 09:00 ~ 22:00', () => {
    expect(OFFICE_OPEN_HOUR).toBe(9)
    expect(OFFICE_CLOSE_HOUR).toBe(22)
    expect(OFF_HOURS_MARKER).toBe('영업외시간대')
  })
})

describe('isOutsideOfficeHours (시각 → 영업 외 여부)', () => {
  it('경계: 09:00 영업 중 / 08:59 영업 외 / 21:59 영업 중 / 22:00 영업 외', () => {
    expect(isOutsideOfficeHours(9, 0)).toBe(false)
    expect(isOutsideOfficeHours(8, 59)).toBe(true)
    expect(isOutsideOfficeHours(21, 59)).toBe(false)
    expect(isOutsideOfficeHours(22, 0)).toBe(true)
  })
  it('자정 전후는 영업 외', () => {
    expect(isOutsideOfficeHours(0, 0)).toBe(true)
    expect(isOutsideOfficeHours(24, 0)).toBe(true)
    expect(isOutsideOfficeHours(3, 30)).toBe(true)
  })
})

describe('extractClockHours (확정되는 시각만 추출)', () => {
  const h = (s: string) => extractClockHours(s).map((t) => t.hour * 60 + t.minute)
  it('오전/오후 + N시', () => {
    expect(h('오후 11시에 가능해요?')).toEqual([23 * 60])
    expect(h('오전 7시에 수령하고 싶어요')).toEqual([7 * 60])
    expect(h('오후 10시 30분')).toEqual([22 * 60 + 30])
    expect(h('오전 12시')).toEqual([0])
    expect(h('오후 12시')).toEqual([12 * 60])
  })
  it('새벽/아침/저녁/밤 + N시', () => {
    expect(h('새벽 3시에 대여')).toEqual([3 * 60])
    expect(h('아침 8시에 픽업')).toEqual([8 * 60])
    expect(h('저녁 9시에 반납')).toEqual([21 * 60])
    expect(h('밤 11시에 대여 가능해요?')).toEqual([23 * 60])
    expect(h('밤 12시')).toEqual([0])
    expect(h('밤 1시')).toEqual([1 * 60])
  })
  it('24시간제: 13~24시, 0시, HH:MM', () => {
    expect(h('23시에 가능한가요')).toEqual([23 * 60])
    expect(h('24시에 반납')).toEqual([24 * 60])
    expect(h('0시에 가능해요')).toEqual([0])
    expect(h('22:30에 가도 되나요')).toEqual([22 * 60 + 30])
    expect(h('07:00 수령')).toEqual([7 * 60])
  })
  it('애매한 시각은 판정하지 않는다(오전/오후 불명확한 1~12시)', () => {
    expect(h('10시에 가능해요?')).toEqual([])
    expect(h('9시 이후')).toEqual([])
    expect(h('3시에 반납')).toEqual([])
  })
  it('시각이 아닌 숫자는 무시(날짜·기간·금액)', () => {
    expect(h('10월 20일 대여')).toEqual([])
    expect(h('3일 대여 가격')).toEqual([])
    expect(h('24시간 대여')).toEqual([])
    expect(h('12시간 대여')).toEqual([])
    expect(h('1000원')).toEqual([])
  })
  it('시각이 여러 개면 모두 추출', () => {
    expect(h('오전 7시에 받고 오후 11시에 반납')).toEqual([7 * 60, 23 * 60])
  })
})

describe('withOffHoursMarker (영업 외 시각이 있으면 표식 단어를 붙임)', () => {
  it('영업 외 시각이 있으면 끝에 표식을 붙인다', () => {
    expect(withOffHoursMarker('밤 11시에 대여 가능해요?')).toBe('밤 11시에 대여 가능해요? 영업외시간대')
    expect(withOffHoursMarker('새벽 3시에 수령')).toBe('새벽 3시에 수령 영업외시간대')
    expect(withOffHoursMarker('22:00에 반납해도 되나요')).toBe('22:00에 반납해도 되나요 영업외시간대')
    expect(withOffHoursMarker('오전 8시에 픽업')).toBe('오전 8시에 픽업 영업외시간대')
  })
  it('영업시간 안의 시각이면 그대로', () => {
    expect(withOffHoursMarker('오후 3시에 가능해요?')).toBe('오후 3시에 가능해요?')
    expect(withOffHoursMarker('오전 9시에 수령')).toBe('오전 9시에 수령')
    expect(withOffHoursMarker('21:59에 반납')).toBe('21:59에 반납')
  })
  it('시각이 없거나 애매하면 그대로', () => {
    expect(withOffHoursMarker('대여 가능한가요')).toBe('대여 가능한가요')
    expect(withOffHoursMarker('10시에 가능해요?')).toBe('10시에 가능해요?')
    expect(withOffHoursMarker('')).toBe('')
  })
  it('한 문장에 영업 중·영업 외 시각이 섞이면 영업 외가 하나라도 있을 때 붙인다', () => {
    expect(withOffHoursMarker('오후 2시에 받고 밤 11시에 반납')).toBe('오후 2시에 받고 밤 11시에 반납 영업외시간대')
  })
  it('이미 표식이 있으면 중복해서 붙이지 않는다', () => {
    expect(withOffHoursMarker('밤 11시 영업외시간대')).toBe('밤 11시 영업외시간대')
  })
})

describe('hasOffHoursWord (단어형 영업 외 표현)', () => {
  it('새벽·심야·한밤·밤늦게·자정·야간·늦은 시간·이른 아침·영업시간 외/이후', () => {
    for (const t of ['새벽에 대여 가능해요?', '심야에 반납해도 되나요', '한밤중에 가능한가요', '밤늦게 가도 되나요', '자정에 받을 수 있나요', '야간에 수령 가능한가요', '늦은 시간에 문의해도 되나요', '늦은 밤에 반납', '이른 아침에 픽업', '아침 일찍 받을 수 있나요', '영업시간 외에 가능한가요', '영업시간 이후에 반납', '영업 끝난 뒤에 가도 되나요', '밤에 대여할 수 있나요', '밤중에 반납해도 되나요']) {
      expect(hasOffHoursWord(t), t).toBe(true)
    }
  })
  it('촬영·배송 맥락의 단어는 영업 외 질문이 아니다', () => {
    for (const t of ['새벽 촬영하기 좋은 카메라 추천해줘', '야간 촬영용 렌즈 있나요', '밤 촬영에 쓸 장비', '새벽배송 되나요', '새벽 배송으로 받을 수 있나요', '야경 찍을 건데 추천해줘']) {
      expect(hasOffHoursWord(t), t).toBe(false)
    }
  })
  it('관련 없는 문장·한 글자 오탐 방지', () => {
    for (const t of ['대여 가능한가요', '밤새 걱정했어요', '율밤 구워 먹었어요', '반납 어떻게 해요', '오전에 가능해요', '']) {
      expect(hasOffHoursWord(t), t).toBe(false)
    }
  })
})

describe('withOffHoursMarker — 단어형 표현도 표식으로 매핑', () => {
  it('단어형 영업 외 표현이 있으면 표식을 붙인다', () => {
    expect(withOffHoursMarker('밤에 대여할 수 있나요?')).toBe('밤에 대여할 수 있나요? 영업외시간대')
    expect(withOffHoursMarker('새벽에 반납해도 되나요')).toBe('새벽에 반납해도 되나요 영업외시간대')
  })
  it('촬영·배송 맥락이면 붙이지 않는다', () => {
    expect(withOffHoursMarker('새벽 촬영하기 좋은 카메라 추천해줘')).toBe('새벽 촬영하기 좋은 카메라 추천해줘')
  })
  it('숫자 시각(영업 외)은 촬영이 들어 있어도 판정한다', () => {
    expect(withOffHoursMarker('밤 11시에 촬영 장비 반납해도 되나요')).toBe('밤 11시에 촬영 장비 반납해도 되나요 영업외시간대')
  })
})

// ── QA(sp3) 마이너 1·2 후속 (2026-10-08) ──
describe('extractClockHours — 숫자 경계·비정상 시각 (QA 마이너 1·2)', () => {
  const h = (s: string) => extractClockHours(s).map((t) => t.hour * 60 + t.minute)
  it('숫자가 이어진 "100시"·"2100시"·"1000시"는 뒤의 두 자리만 시각으로 읽지 않는다', () => {
    expect(h('100시에 대여 가능해요?')).toEqual([])
    expect(h('2100시에 반납')).toEqual([])
    expect(h('1000시')).toEqual([])
    expect(h('2026년 10월 100시')).toEqual([])
  })
  it('숫자 경계를 추가해도 정상 시각은 그대로 읽는다', () => {
    expect(h('오후 3시에 가능해요')).toEqual([15 * 60])
    expect(h('23시에 가능한가요')).toEqual([23 * 60])
    expect(h('10월 3일 오후 3시에 대여')).toEqual([15 * 60])
    expect(h('3일 대여하고 오후 11시에 반납')).toEqual([23 * 60])
  })
  it('24시는 분이 0일 때만 인정한다(24:30·24시 30분은 비정상)', () => {
    expect(h('24:30에 가도 되나요')).toEqual([])
    expect(h('24시 30분에 반납')).toEqual([])
    expect(h('24:00에 가도 되나요')).toEqual([24 * 60])
    expect(h('24시에 반납')).toEqual([24 * 60])
  })
  it('분이 59를 넘으면 비정상 시각으로 본다', () => {
    expect(h('오후 3시 75분')).toEqual([])
    expect(h('22:75에 반납')).toEqual([])
    expect(h('오후 3시 59분')).toEqual([15 * 60 + 59])
  })
})

describe('withOffHoursMarker — 비정상 시각은 표식을 붙이지 않는다 (QA 마이너 1·2)', () => {
  it('"100시"·"24:30"·"24시 30분"은 원문 그대로', () => {
    expect(withOffHoursMarker('100시에 대여 가능해요?')).toBe('100시에 대여 가능해요?')
    expect(withOffHoursMarker('24:30에 가도 되나요')).toBe('24:30에 가도 되나요')
    expect(withOffHoursMarker('24시 30분에 반납')).toBe('24시 30분에 반납')
  })
  it('"24:00"·"24시"는 영업 외로 판정한다', () => {
    expect(withOffHoursMarker('24:00에 가도 되나요')).toBe('24:00에 가도 되나요 영업외시간대')
    expect(withOffHoursMarker('24시에 반납')).toBe('24시에 반납 영업외시간대')
  })
})
