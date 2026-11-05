// chatReservationCard.test.ts — ensureReservationCard: 예약 단위 중복 방지 + 마이그레이션 793·794 소스 가드
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ensureReservationCard } from '../../lib/server/chatReservationCard'

let existingCard: unknown = null
let reservationRow: unknown = { reservation_code: 'CSRSV26110006', product_id: null, start_date: '2026-11-10', end_date: '2026-11-12' }
const inserted: Array<Record<string, unknown>> = []
const dedupeCalls: Array<{ content?: unknown; contains?: unknown }> = []

function fakeAdmin() {
  return {
    from: (table: string) => {
      const q: { content?: unknown; contains?: unknown } = {}
      const b = {
        select: () => b,
        eq: (k: string, v: unknown) => { if (k === 'content') q.content = v; return b },
        contains: (_c: string, v: unknown) => { q.contains = v; return b },
        limit: () => b,
        maybeSingle: async () => {
          if (table === 'chat_messages') { dedupeCalls.push(q); return { data: existingCard } }
          if (table === 'rental_reservations') return { data: reservationRow }
          return { data: null }
        },
        insert: async (row: Record<string, unknown>) => { inserted.push(row); return { error: null } },
      }
      return b
    },
  }
}

beforeEach(() => {
  existingCard = null
  reservationRow = { reservation_code: 'CSRSV26110006', product_id: null, start_date: '2026-11-10', end_date: '2026-11-12' }
  inserted.length = 0
  dedupeCalls.length = 0
})

describe('ensureReservationCard', () => {
  it('같은 예약의 상담 시작 카드가 이미 있으면 새로 넣지 않는다', async () => {
    existingCard = { id: 'm1' }
    await ensureReservationCard(fakeAdmin(), 's1', 364)
    expect(inserted).toHaveLength(0)
  })
  it('없으면 예약 번호·안내 문구가 들어간 카드를 한 장 넣는다', async () => {
    await ensureReservationCard(fakeAdmin(), 's1', 364)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      session_id: 's1',
      message_type: 'action_card',
      content: '예약번호 CSRSV26110006 상담을 시작합니다.',
      action_payload: { type: 'RESERVATION_STATUS_CARD', reservation_id: '364' },
    })
  })
  it('중복 판정은 예약 번호(문자열)와 상담 안내 문구 두 가지로 좁혀 조회한다(상태 알림 카드와 구분)', async () => {
    await ensureReservationCard(fakeAdmin(), 's1', 364)
    expect(dedupeCalls[0].contains).toEqual({ type: 'RESERVATION_STATUS_CARD', reservation_id: '364' })
    expect(dedupeCalls[0].content).toBe('예약번호 CSRSV26110006 상담을 시작합니다.')
  })
  it('예약이 없으면 아무것도 넣지 않는다', async () => {
    reservationRow = null
    await ensureReservationCard(fakeAdmin(), 's1', 999)
    expect(inserted).toHaveLength(0)
  })
  it('예약 코드가 없으면 일반 문구를 쓴다', async () => {
    reservationRow = { reservation_code: null, product_id: null, start_date: null, end_date: null }
    await ensureReservationCard(fakeAdmin(), 's1', 1)
    expect(inserted[0].content).toBe('예약 상담을 시작합니다.')
  })
})

describe('마이그레이션 소스 가드(#793·#794)', () => {
  const read = (f: string) => readFileSync(resolve(__dirname, '../../../supabase/migrations', f), 'utf8')
  it('#793: 예약 세션만 대상이고 일반 세션이 없는 고객은 건너뛰며 합치기 함수 재사용', () => {
    const sql = read('20261105120000_793_merge_reservation_chat_sessions_into_general.sql')
    expect(sql).toContain("context_type = 'reservation'")
    expect(sql).toContain("context_type = 'general'")
    expect(sql).toContain('CONTINUE WHEN v_into IS NULL')
    expect(sql).toContain('private.merge_chat_session_into')
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.chat_(messages|sessions)/i)
  })
  it('#794: 대여완료 자동종료는 reservation 세션만 닫는다', () => {
    const sql = read('20261105130000_794_auto_close_chat_reservation_sessions_only.sql')
    expect(sql).toContain("AND context_type = 'reservation'")
    expect(sql).toContain("status IN ('open', 'pending')")
  })
})
