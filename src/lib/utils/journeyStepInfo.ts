/**
 * 마이페이지 대여 카드 — 단계 배지(예약신청·계약완료·반출중·…)를 눌렀을 때 배지 아래에 보여줄 설명 텍스트 (2026-10-26)
 * 단계별 고정 안내문 + 그 단계의 실제 정보(있는 것만). 순수 함수 — 화면은 이 결과를 RentalJourneyStepper 의 details 로 넘긴다.
 */

export type JourneyDetailKey = 'hold' | 'confirmed' | 'shipped' | 'in_use' | 'return_requested' | 'returned'

export interface JourneyInfoInput {
  status: string
  start_date: string | null
  end_date: string | null
  created_at?: string | null
  return_time?: string | null
  tracking_number?: string | null
  courier_code?: string | null
}

const ORDER: JourneyDetailKey[] = ['hold', 'confirmed', 'shipped', 'in_use', 'return_requested', 'returned']

const day = (v: string | null | undefined): string | null => (v ? v.slice(0, 10) : null)

/** 택배사 · 운송장 번호 표기용 — 둘 중 있는 것만 */
export function formatTrackingLines(courier: string | null | undefined, trackingNumber: string | null | undefined): string[] {
  const out: string[] = []
  const c = courier?.trim()
  const t = trackingNumber?.trim()
  if (c) out.push(`택배사: ${c}`)
  if (t) out.push(`운송장 번호: ${t}`)
  return out
}

/** 현재 상태가 가리키는 단계 위치(완료·반납완료는 마지막). 알 수 없는 상태는 -1 */
function currentIndex(status: string): number {
  if (status === 'completed') return ORDER.length - 1
  return ORDER.indexOf(status as JourneyDetailKey)
}

export function buildJourneyStepDetails(r: JourneyInfoInput): Partial<Record<JourneyDetailKey, string[]>> {
  const cur = currentIndex(r.status)
  const period = day(r.start_date) && day(r.end_date) ? `대여기간: ${day(r.start_date)} ~ ${day(r.end_date)}` : null
  const reached = (k: JourneyDetailKey): boolean => cur >= ORDER.indexOf(k)
  const NOT_YET = ['아직 진행 전이에요.']

  const out: Partial<Record<JourneyDetailKey, string[]>> = {}

  out.hold = reached('hold')
    ? ['예약신청이 접수되었어요.', ...(day(r.created_at) ? [`신청일: ${day(r.created_at)}`] : [])]
    : NOT_YET

  out.confirmed = reached('confirmed')
    ? ['전자계약 서명과 결제가 완료되어 예약이 확정되었어요.', ...(period ? [period] : [])]
    : ['전자계약 서명과 결제가 끝나면 예약이 확정돼요.']

  if (reached('shipped')) {
    const tracking = formatTrackingLines(r.courier_code, r.tracking_number)
    out.shipped = tracking.length > 0
      ? ['배송이 시작되었어요.', ...tracking]
      : ['대여 장비를 준비·전달하고 있어요.', '운송장이 등록되면 채팅으로 알려드려요.']
  } else {
    out.shipped = NOT_YET
  }

  out.in_use = reached('in_use')
    ? ['대여 중이에요.', ...(day(r.end_date) ? [`반납 기한: ${day(r.end_date)}${r.return_time ? ` ${r.return_time}` : ''}`] : [])]
    : NOT_YET

  out.return_requested = reached('return_requested')
    ? ['반납 절차가 진행 중이에요.']
    : NOT_YET

  out.returned = reached('returned')
    ? ['반납이 완료되었어요. 장비 검수 후 대여가 마무리돼요.']
    : NOT_YET

  return out
}
