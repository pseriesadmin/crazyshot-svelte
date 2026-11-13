import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { COURIER_BAR_START_MINUTE, parseReturnBarTimer, pickReturnRegisterBarItems, toReturnBarReservations, type ReturnBarReservation } from '$lib/utils/returnRegisterBar'

const kst = (iso: string) => new Date(`${iso}+09:00`).getTime()
const row = (over: Partial<ReturnBarReservation> = {}): ReturnBarReservation => ({ id: 1, end_date: '2026-12-03', return_method: 'visit', status: 'in_use', return_record_exempt: false, ...over })
const TIMER = parseReturnBarTimer({ visit: '18:00', quick: '10:00', locker: '24:00' })
const none = new Set<number>()

describe('returnRegisterBar — 반납정보 등록하기 안내바 대상 규칙', () => {
  it('방문·퀵·무인함: 반납일 당일 지정 시각 전에는 숨기고, 시각부터 등록할 때까지 계속 띄운다', () => {
    expect(pickReturnRegisterBarItems([row()], none, TIMER, kst('2026-12-03T17:59:00'))).toEqual([])
    expect(pickReturnRegisterBarItems([row()], none, TIMER, kst('2026-12-03T18:00:00'))).toHaveLength(1)
    expect(pickReturnRegisterBarItems([row()], none, TIMER, kst('2026-12-05T03:00:00'))).toHaveLength(1) // 발송용 1시간 상한은 적용하지 않는다
  })

  it("'24:00' 은 당일 23:50, 방식별로 서로 다른 시각을 쓴다", () => {
    const locker = row({ id: 2, return_method: 'locker' })
    expect(pickReturnRegisterBarItems([locker], none, TIMER, kst('2026-12-03T23:49:00'))).toEqual([])
    expect(pickReturnRegisterBarItems([locker], none, TIMER, kst('2026-12-03T23:50:00'))).toHaveLength(1)
    const quick = row({ id: 3, return_method: 'quick' })
    expect(pickReturnRegisterBarItems([quick], none, TIMER, kst('2026-12-03T10:00:00'))).toHaveLength(1)
  })

  it('그 방식의 지정 시각이 없음(null·옛 숫자 형식)이면 안내하지 않는다 — 요청도 보내지 않는 방식', () => {
    const t = parseReturnBarTimer({ visit: null, quick: 12, locker: 'abc' })
    for (const m of ['visit', 'quick', 'locker']) expect(pickReturnRegisterBarItems([row({ return_method: m })], none, t, kst('2026-12-10T12:00:00'))).toEqual([])
  })

  it('택배류는 반납일 당일 09:00 부터', () => {
    expect(COURIER_BAR_START_MINUTE).toBe(540)
    for (const m of ['epost', 'delivery', 'crazydelivery', 'airport']) {
      const r = row({ return_method: m })
      expect(pickReturnRegisterBarItems([r], none, TIMER, kst('2026-12-03T08:59:00'))).toEqual([])
      expect(pickReturnRegisterBarItems([r], none, TIMER, kst('2026-12-03T09:00:00'))).toHaveLength(1)
    }
  })

  it('이미 등록(기록 있음)·면제·대여중/반납요청 아닌 상태·방식 미지정·반납일 없음은 제외', () => {
    const now = kst('2026-12-04T12:00:00')
    expect(pickReturnRegisterBarItems([row()], new Set([1]), TIMER, now)).toEqual([])
    expect(pickReturnRegisterBarItems([row({ return_record_exempt: true })], none, TIMER, now)).toEqual([])
    for (const status of ['hold', 'confirmed', 'shipped', 'returned', 'completed', 'cancelled']) expect(pickReturnRegisterBarItems([row({ status })], none, TIMER, now)).toEqual([])
    expect(pickReturnRegisterBarItems([row({ return_method: null })], none, TIMER, now)).toEqual([])
    expect(pickReturnRegisterBarItems([row({ end_date: null })], none, TIMER, now)).toEqual([])
    expect(pickReturnRegisterBarItems([row({ end_date: '12/03' })], none, TIMER, now)).toEqual([])
  })

  it('반납요청 상태도 대상이고, 시작 시각이 이른 건이 앞에 오며 이동 주소는 반납등록 화면이다', () => {
    const rows = [row({ id: 9, end_date: '2026-12-05', status: 'return_requested' }), row({ id: 4, end_date: '2026-12-03' })]
    const items = pickReturnRegisterBarItems(rows, none, TIMER, kst('2026-12-06T00:00:00'))
    expect(items.map((i) => i.reservationId)).toEqual([4, 9])
    expect(items[0].href).toBe('/account/rental/4/return-submit')
  })
})

describe('toReturnBarReservations — DB 결과 타입 좁히기', () => {
  it('형식이 맞는 행만 남기고 알 수 없는 값은 안전하게 비운다', () => {
    const out = toReturnBarReservations([{ id: '7', end_date: '2026-12-03', return_method: 'quick', status: 'in_use', return_record_exempt: true }, { id: 'x' }, null, 'str', { id: 8, end_date: 5, return_method: null, status: 3 }])
    expect(out).toEqual([
      { id: 7, end_date: '2026-12-03', return_method: 'quick', status: 'in_use', return_record_exempt: true },
      { id: 8, end_date: null, return_method: null, status: null, return_record_exempt: false },
    ])
    expect(toReturnBarReservations(null)).toEqual([])
  })
})

describe('배선', () => {
  const chat = readFileSync('src/lib/components/chat/ChatWindow.svelte', 'utf-8')
  const api = readFileSync('src/routes/api/chat/return-register-bar/+server.ts', 'utf-8')
  it('API 는 서버가 검증한 user.id 만 쓰고 읽기 전용이다', () => {
    expect(api).toContain('safeGetSession')
    expect(api).toContain(".eq('user_id', user.id)")
    expect(api).not.toMatch(/\.(insert|update|delete|upsert)\(/)
    expect(api).not.toContain('request.json')
    expect(api).not.toContain('as unknown as')
  })
  it('채팅창은 채팅을 열 때마다 안내바 대상을 조회하고 반납등록 화면으로 연결한다', () => {
    expect(chat).toContain('/api/chat/return-register-bar')
    expect(chat).toContain('반납정보 등록하기')
  })
})
