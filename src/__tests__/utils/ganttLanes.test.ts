import { describe, it, expect } from 'vitest'
import { assignLanes, type LaneRow } from '$lib/utils/ganttLanes'

const r = (id: number, s: string, e: string, code: string | null = `C${id}`): LaneRow => ({ reservation_id: id, reservation_code: code, rental_start: s, rental_end: e })
const ids = (lanes: LaneRow[][]): number[][] => lanes.map((l) => l.map((x) => x.reservation_id))

describe('assignLanes — 홈 간트 레인 배치', () => {
  const FROM = '2026-11-24', TO = '2026-12-07'

  it('겹치지 않는 예약은 한 줄에 모인다(줄 수 = 동시 진행 최대 건수)', () => {
    const lanes = assignLanes([r(1, '2026-11-24', '2026-11-25'), r(2, '2026-11-26', '2026-11-27'), r(3, '2026-11-29', '2026-11-30')], FROM, TO)
    expect(ids(lanes)).toEqual([[1, 2, 3]])
  })
  it('같은 날 끝나는 예약과 시작하는 예약은 같은 칸을 쓰므로 다른 줄에 놓인다', () => {
    expect(ids(assignLanes([r(1, '2026-11-24', '2026-11-26'), r(2, '2026-11-26', '2026-11-28')], FROM, TO))).toEqual([[1], [2]])
  })
  it('겹치는 예약은 줄이 나뉘고, 빈 자리가 생기면 다시 위 줄을 쓴다', () => {
    const lanes = assignLanes([r(1, '2026-11-24', '2026-11-30'), r(2, '2026-11-25', '2026-11-26'), r(3, '2026-11-27', '2026-11-28'), r(4, '2026-12-01', '2026-12-02')], FROM, TO)
    expect(ids(lanes)).toEqual([[1, 4], [2, 3]])
  })
  it('같은 주문(같은 코드)이 같은 날 시작하면 이웃한 줄에 놓인다', () => {
    const lanes = assignLanes([r(9, '2026-11-26', '2026-11-27', 'CS-B'), r(7, '2026-11-26', '2026-11-27', 'CS-A'), r(8, '2026-11-26', '2026-11-27', 'CS-A')], FROM, TO)
    expect(ids(lanes)).toEqual([[7], [8], [9]])
  })
  it('불러온 구간 밖 예약은 건너뛰고, 경계에 걸친 예약은 구간 안 부분으로 배치한다', () => {
    const lanes = assignLanes([r(1, '2026-10-01', '2026-10-05'), r(2, '2026-11-20', '2026-11-25'), r(3, '2026-12-06', '2026-12-20'), r(4, '2027-01-01', '2027-01-02')], FROM, TO)
    expect(ids(lanes)).toEqual([[2, 3]])
  })
  it('결과는 입력 순서와 무관하다(결정적)', () => {
    const rows = [r(5, '2026-11-25', '2026-11-27'), r(2, '2026-11-24', '2026-11-30'), r(8, '2026-11-28', '2026-11-29'), r(3, '2026-11-25', '2026-11-26')]
    expect(ids(assignLanes([...rows].reverse(), FROM, TO))).toEqual(ids(assignLanes(rows, FROM, TO)))
  })
  it('예약이 없으면 줄도 없다', () => {
    expect(assignLanes([], FROM, TO)).toEqual([])
  })
  it('예약 수백 건도 한 줄 수는 동시 진행 건수로 묶인다(행 폭증 방지)', () => {
    const rows: LaneRow[] = []
    for (let i = 0; i < 300; i++) { const d = 24 + (i % 12); rows.push(r(i + 1, `2026-11-${d}`, `2026-11-${d}`)) }
    const lanes = assignLanes(rows, FROM, TO)
    expect(lanes.length).toBe(25)
    expect(lanes.reduce((n, l) => n + l.length, 0)).toBe(300)
  })
})
