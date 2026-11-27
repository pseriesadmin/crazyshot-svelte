// 홈 간트 '레인' 배치 — 서로 겹치지 않는 예약을 같은 줄(레인)에 모아, 줄 수가 예약 건수가 아니라 '동시에 진행되는 최대 건수'가 되게 한다.
// (2026-11-27, Stephen 확정: 좌측 목록 제거, 일정 확인용). 순수 함수 — 화면·시험에서 같이 쓴다.
//  · 예약은 날짜 칸 단위로 자리를 차지한다(시작일~종료일 포함). 같은 날 시작·종료가 겹치면 다른 레인.
//  · 불러온 범위(rangeFrom~rangeTo)와 겹치지 않는 예약은 건너뛴다. 범위 밖으로 걸친 예약은 범위 안 부분만으로 배치한다.
//  · 결정적 순서: 시작 빠른 순 → 긴 예약 먼저 → 예약코드 → id. 같은 주문(같은 코드)의 상품은 이웃한 레인에 놓인다.

export interface LaneRow {
  reservation_id: number
  reservation_code: string | null
  rental_start: string
  rental_end: string
}

function dayNum(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
}

export function assignLanes<T extends LaneRow>(rows: T[], rangeFrom: string, rangeTo: string): T[][] {
  const from = dayNum(rangeFrom)
  const to = dayNum(rangeTo)
  const items = rows
    .map((row) => ({ row, s: Math.max(dayNum(row.rental_start), from), e: Math.min(dayNum(row.rental_end), to) }))
    .filter((it) => it.s <= it.e)
    .sort((a, b) =>
      (a.s - b.s) ||
      (b.e - a.e) ||
      (a.row.reservation_code ?? '').localeCompare(b.row.reservation_code ?? '') ||
      (a.row.reservation_id - b.row.reservation_id))

  const lanes: T[][] = []
  const laneEnd: number[] = []
  for (const it of items) {
    let idx = laneEnd.findIndex((end) => end < it.s)
    if (idx === -1) {
      idx = lanes.length
      lanes.push([])
      laneEnd.push(Number.NEGATIVE_INFINITY)
    }
    lanes[idx].push(it.row)
    laneEnd[idx] = it.e
  }
  return lanes
}
