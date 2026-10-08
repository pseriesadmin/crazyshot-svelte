// requests.ts — 관리자 접수 큐 카드 구성 (서버 전용, 순수 함수)
//
// chat_agent_requests의 "대기" 건을 CMS 카드로 보여줄 때 쓰는 값만 골라 담는다.
// 고객 원문·연락처·주소는 카드에 싣지 않는다(원문은 session/message로 상담 화면에서 연다).

import { AGENT_REQUEST_KIND_LABEL } from './action'
import { groupReservations, type ReservationRowForQuery } from './query'

export interface AgentRequestRow {
  id: string
  created_at: string
  user_id: string
  session_id: string
  message_id: string
  kind: 'time_change' | 'extend'
  reservation_code: string | null
}

export interface AgentRequestCard {
  id: string
  kind: 'time_change' | 'extend'
  kind_label: string
  reservation_code: string | null
  created_at: string
  session_id: string
  message_id: string
  customer_name: string
  /** 요청한 고객의 해당 예약 현재 단계(없으면 null) */
  reservation_stage: string | null
  /** 예약이 이미 취소·만료·반납·종료돼 처리할 일이 없을 가능성이 큰 경우 */
  reservation_closed: boolean
}

const CLOSED_STAGES = new Set(['cancelled', 'expired', 'returned', 'completed'])

export type ReservationRowWithUser = ReservationRowForQuery & { user_id: string }

export function buildRequestCards(
  requests: readonly AgentRequestRow[],
  profiles: ReadonlyArray<{ id: string; full_name: string | null }>,
  reservations: readonly ReservationRowWithUser[],
): AgentRequestCard[] {
  const nameById = new Map(profiles.map((p) => [p.id, p.full_name ?? '']))
  return requests.map((r) => {
    let stage: string | null = null
    if (r.reservation_code) {
      // 다른 고객의 같은 번호 행이 섞이지 않도록 요청한 고객의 행만 본다
      const own = reservations.filter((x) => x.user_id === r.user_id)
      const group = groupReservations(own, r.reservation_code)[0]
      stage = group?.stage ?? null
    }
    return {
      id: r.id,
      kind: r.kind,
      kind_label: AGENT_REQUEST_KIND_LABEL[r.kind],
      reservation_code: r.reservation_code,
      created_at: r.created_at,
      session_id: r.session_id,
      message_id: r.message_id,
      customer_name: nameById.get(r.user_id) || '고객',
      reservation_stage: stage,
      reservation_closed: stage !== null && CLOSED_STAGES.has(stage),
    }
  })
}
