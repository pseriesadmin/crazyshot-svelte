import { describe, it, expect } from 'vitest'
import { ganttPriority, sortGanttRows, GANTT_RANK, type GanttSortRow } from '$lib/utils/dashboardGanttSort'

const TODAY = '2026-11-20'
let seq = 0
function row(p: Partial<GanttSortRow>): GanttSortRow {
  seq += 1
  return {
    reservation_id: seq, reservation_code: `C${seq}`, status: 'confirmed',
    rental_start: '2026-11-25', rental_end: '2026-11-27', product_name: '상품', created_at: '2026-11-10T00:00:00Z', ...p,
  }
}

describe('ganttPriority — 상태 우선순위(CSV 홈 항목)', () => {
  it('신청대기 → 연체·지연 → 당일 출고 → 당일 반납 → 검수대기 → 그 밖 → 종결', () => {
    expect(ganttPriority(row({ status: 'hold' }), TODAY)).toBe(GANTT_RANK.pending)
    expect(ganttPriority(row({ status: 'in_use', rental_end: '2026-11-19' }), TODAY)).toBe(GANTT_RANK.overdue)
    expect(ganttPriority(row({ status: 'confirmed', rental_start: '2026-11-18' }), TODAY)).toBe(GANTT_RANK.overdue)
    expect(ganttPriority(row({ status: 'confirmed', rental_start: TODAY }), TODAY)).toBe(GANTT_RANK.todayPickup)
    expect(ganttPriority(row({ status: 'in_use', rental_end: TODAY }), TODAY)).toBe(GANTT_RANK.todayReturn)
    expect(ganttPriority(row({ status: 'return_requested', rental_end: TODAY }), TODAY)).toBe(GANTT_RANK.todayReturn)
    expect(ganttPriority(row({ status: 'returned' }), TODAY)).toBe(GANTT_RANK.inspection)
    expect(ganttPriority(row({ status: 'in_use' }), TODAY)).toBe(GANTT_RANK.ongoing)
    for (const s of ['completed', 'expired', 'cancelled', 'damage_claimed']) {
      expect(ganttPriority(row({ status: s }), TODAY)).toBe(GANTT_RANK.done)
    }
  })
})

describe('sortGanttRows', () => {
  it('우선순위가 앞선 행이 먼저 온다', () => {
    const done = row({ status: 'completed' })
    const pending = row({ status: 'hold' })
    const overdue = row({ status: 'in_use', rental_end: '2026-11-18' })
    expect(sortGanttRows([done, overdue, pending], TODAY).map((r) => r.reservation_id)).toEqual([pending.reservation_id, overdue.reservation_id, done.reservation_id])
  })

  it('같은 예약코드의 상품·고객은 다른 코드 사이에 끼지 않고 붙는다(상품명 순이 아님)', () => {
    const a1 = row({ reservation_code: 'A', product_name: '나', status: 'hold', created_at: '2026-11-12T00:00:00Z' })
    const b1 = row({ reservation_code: 'B', product_name: '다', status: 'hold', created_at: '2026-11-11T00:00:00Z' })
    const a2 = row({ reservation_code: 'A', product_name: '가', status: 'hold', created_at: '2026-11-12T00:00:00Z' })
    const out = sortGanttRows([a1, b1, a2], TODAY).map((r) => r.reservation_code)
    expect(out).toEqual(['A', 'A', 'B'])
  })

  it('같은 코드 안에서 단계가 달라도 묶음이 흩어지지 않는다(가장 앞선 순위가 묶음 순위)', () => {
    const x1 = row({ reservation_code: 'X', status: 'hold' })
    const y = row({ reservation_code: 'Y', status: 'in_use', rental_end: '2026-11-18' })
    const x2 = row({ reservation_code: 'X', status: 'confirmed' })
    expect(sortGanttRows([x2, y, x1], TODAY).map((r) => r.reservation_code)).toEqual(['X', 'X', 'Y'])
  })

  it('같은 순위에서는 신청일 최신순(기본)·오래된 순 전환', () => {
    const old = row({ status: 'hold', created_at: '2026-11-01T00:00:00Z' })
    const recent = row({ status: 'hold', created_at: '2026-11-15T00:00:00Z' })
    expect(sortGanttRows([old, recent], TODAY).map((r) => r.reservation_id)).toEqual([recent.reservation_id, old.reservation_id])
    expect(sortGanttRows([recent, old], TODAY, 'oldest').map((r) => r.reservation_id)).toEqual([old.reservation_id, recent.reservation_id])
  })

  it('입력 배열을 바꾸지 않는다', () => {
    const rows = [row({ status: 'completed' }), row({ status: 'hold' })]
    const before = rows.map((r) => r.reservation_id)
    sortGanttRows(rows, TODAY)
    expect(rows.map((r) => r.reservation_id)).toEqual(before)
  })
})
