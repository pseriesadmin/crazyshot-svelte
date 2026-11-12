import { describe, it, expect } from 'vitest'
import { resolveLockerInfo, type LockerRowInput } from '$lib/utils/lockerInfoVisibility'

// 기준: 수령 2026-11-20 10:00 KST(= 01:00 UTC), 반납 2026-11-22 18:00 KST(= 09:00 UTC)
const kst = (s: string): Date => new Date(`${s}+09:00`)
const row = (o: Partial<LockerRowInput> = {}): LockerRowInput => ({
  id: '10', locker_number: '7', locker_password: '1234', locker_guide_legs: 'both', ...o,
})
const base: { status: string; cancelling: boolean; startDate: string | null; endDate: string | null; pickupTime: string | null; returnTime: string | null } = {
  status: 'confirmed',
  cancelling: false,
  startDate: '2026-11-20',
  endDate: '2026-11-22',
  pickupTime: '10:00',
  returnTime: '18:00',
}
const run = (over: Partial<typeof base> & { rows?: LockerRowInput[]; now: Date }) =>
  resolveLockerInfo({ ...base, rows: [row()], ...over })

describe('resolveLockerInfo — 수령 1시간 전 경계', () => {
  it('60분 전 정각부터 노출(= 09:00)', () => {
    expect(run({ now: kst('2026-11-20T09:00:00') })).toEqual({ number: '7', password: '1234' })
  })
  it('61분 전은 아직 숨김', () => {
    expect(run({ now: kst('2026-11-20T08:59:00') })).toBeNull()
  })
  it('59분 전은 노출', () => {
    expect(run({ now: kst('2026-11-20T09:01:00') })).not.toBeNull()
  })
  it('59초 모자라면 숨김(09:00:00 직전)', () => {
    expect(run({ now: new Date(kst('2026-11-20T09:00:00').getTime() - 1) })).toBeNull()
  })
})

describe('유지 — 한 번 노출되면 계속', () => {
  it('수령 시각이 이미 지나도 유지', () => {
    expect(run({ now: kst('2026-11-21T12:00:00') })).not.toBeNull()
  })
  it('반납 시각이 지나고 완료 상태여도 유지', () => {
    expect(run({ status: 'completed', now: kst('2026-12-30T12:00:00') })).not.toBeNull()
  })
})

describe('취소·만료', () => {
  it.each(['cancelled', 'expired'])('%s 이면 숨김', (status) => {
    expect(run({ status, now: kst('2026-11-21T12:00:00') })).toBeNull()
  })
  it('취소중이면 숨김', () => {
    expect(run({ cancelling: true, now: kst('2026-11-21T12:00:00') })).toBeNull()
  })
})

describe('legs 4종', () => {
  const rowsOf = (legs: string | null) => [row({ locker_guide_legs: legs })]
  it('pickup: 수령 1시간 전부터', () => {
    expect(run({ rows: rowsOf('pickup'), now: kst('2026-11-20T09:00:00') })).not.toBeNull()
    expect(run({ rows: rowsOf('pickup'), now: kst('2026-11-20T08:59:00') })).toBeNull()
  })
  it('return: 수령 때는 숨김, 반납 1시간 전(17:00)부터', () => {
    expect(run({ rows: rowsOf('return'), now: kst('2026-11-20T09:30:00') })).toBeNull()
    expect(run({ rows: rowsOf('return'), now: kst('2026-11-22T16:59:00') })).toBeNull()
    expect(run({ rows: rowsOf('return'), now: kst('2026-11-22T17:00:00') })).not.toBeNull()
  })
  it('both: 더 이른 시각(수령)부터', () => {
    expect(run({ rows: rowsOf('both'), now: kst('2026-11-20T09:00:00') })).not.toBeNull()
  })
  it('NULL: 둘 다 적용(수령 시각에 노출)', () => {
    expect(run({ rows: rowsOf(null), now: kst('2026-11-20T09:00:00') })).not.toBeNull()
  })
  it('알 수 없는 값은 숨김', () => {
    expect(run({ rows: rowsOf('weird'), now: kst('2026-11-22T20:00:00') })).toBeNull()
  })
})

describe('수령시각 없음 / 반납시각 규칙', () => {
  it('pickup_time NULL 이면 수령 구간 건너뜀 — both 라도 반납 1시간 전부터', () => {
    expect(run({ pickupTime: null, now: kst('2026-11-20T09:30:00') })).toBeNull()
    expect(run({ pickupTime: null, now: kst('2026-11-22T17:00:00') })).not.toBeNull()
  })
  it('pickup_time NULL + legs=pickup 이면 끝내 숨김', () => {
    expect(run({ pickupTime: null, rows: [row({ locker_guide_legs: 'pickup' })], now: kst('2026-12-01T00:00:00') })).toBeNull()
  })
  it('반납시각 24:00 은 다음날 00:00 — 1시간 전 = 23:00', () => {
    const o = { pickupTime: null, returnTime: '24:00' }
    expect(run({ ...o, now: kst('2026-11-22T22:59:00') })).toBeNull()
    expect(run({ ...o, now: kst('2026-11-22T23:00:00') })).not.toBeNull()
  })
  it('반납시각 없음·형식 오류는 18:00 대체(17:00 부터)', () => {
    for (const returnTime of [null, '', 'abc', '25:00']) {
      const o = { pickupTime: null, returnTime }
      expect(run({ ...o, now: kst('2026-11-22T16:59:00') })).toBeNull()
      expect(run({ ...o, now: kst('2026-11-22T17:00:00') })).not.toBeNull()
    }
  })
  it('초 단위(HH:MM:SS) 시각도 해석', () => {
    expect(run({ pickupTime: '10:00:00', now: kst('2026-11-20T09:00:00') })).not.toBeNull()
  })
})

describe('KST 자정 경계', () => {
  it('수령 00:30 → 노출은 전날 23:30 KST', () => {
    const o = { pickupTime: '00:30' }
    expect(run({ ...o, now: kst('2026-11-19T23:29:00') })).toBeNull()
    expect(run({ ...o, now: kst('2026-11-19T23:30:00') })).not.toBeNull()
  })
})

describe('값 검사·주문 단위 세트', () => {
  const now = kst('2026-11-21T00:00:00')
  it('번호만 있거나 비밀번호만 있으면 숨김', () => {
    expect(run({ rows: [row({ locker_password: null })], now })).toBeNull()
    expect(run({ rows: [row({ locker_number: null })], now })).toBeNull()
    expect(run({ rows: [row({ locker_number: '  ' })], now })).toBeNull()
  })
  it('행이 없으면 숨김', () => {
    expect(run({ rows: [], now })).toBeNull()
  })
  it('일부 행에만 값이 있으면 그 행의 세트를 쓴다', () => {
    const rows = [row({ id: '5', locker_number: null, locker_password: null }), row({ id: '6', locker_number: '3', locker_password: '9999' })]
    expect(run({ rows, now })).toEqual({ number: '3', password: '9999' })
  })
  it('서로 다른 번호가 섞이면 id 가 가장 작은 행(입력 순서와 무관, 숫자 비교)', () => {
    const rows = [row({ id: '100', locker_number: '2', locker_password: 'b' }), row({ id: '9', locker_number: '1', locker_password: 'a' })]
    expect(run({ rows, now })).toEqual({ number: '1', password: 'a' })
  })
  it('시작일 형식 오류면 수령 구간 건너뜀', () => {
    expect(run({ startDate: null, now: kst('2026-11-20T09:30:00') })).toBeNull()
  })
})
