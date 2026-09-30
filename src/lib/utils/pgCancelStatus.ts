/**
 * Toss 결제 조회 응답(GET /v1/payments/{paymentKey}) → 관리자 화면용 "취소 실행 상태" 요약 (순수 함수)
 *  status: READY / IN_PROGRESS / WAITING_FOR_DEPOSIT / DONE / CANCELED / PARTIAL_CANCELED / ABORTED / EXPIRED
 *  cancels[]: { cancelAmount, canceledAt, cancelReason, cancelStatus('DONE' 등) }
 */
export interface TossPaymentLike {
  status?: string
  totalAmount?: number
  balanceAmount?: number
  cancels?: Array<{
    cancelAmount?: number
    canceledAt?: string
    cancelReason?: string
    cancelStatus?: string
  }> | null
}

export type PgCancelState = 'not_cancelled' | 'cancelled' | 'partial_cancelled' | 'in_progress' | 'not_paid' | 'unknown'

export interface PgCancelSummary {
  pgStatus: string
  state: PgCancelState
  label: string
  totalAmount: number | null
  cancelledAmount: number
  lastCancelledAt: string | null
  cancels: Array<{ amount: number; canceledAt: string | null; reason: string | null; status: string | null }>
}

export function summarizeTossPayment(p: TossPaymentLike): PgCancelSummary {
  const pgStatus = p.status ?? 'UNKNOWN'
  const cancels = (p.cancels ?? []).map(c => ({
    amount: Number(c.cancelAmount ?? 0),
    canceledAt: c.canceledAt ?? null,
    reason: c.cancelReason ?? null,
    status: c.cancelStatus ?? null,
  }))
  const cancelledAmount = cancels.filter(c => !c.status || c.status === 'DONE').reduce((sum, c) => sum + c.amount, 0)
  const lastCancelledAt = cancels.map(c => c.canceledAt).filter((v): v is string => !!v).sort().at(-1) ?? null

  let state: PgCancelState
  let label: string
  switch (pgStatus) {
    case 'CANCELED': state = 'cancelled'; label = '취소 완료 (PG 전액 취소)'; break
    case 'PARTIAL_CANCELED': state = 'partial_cancelled'; label = '부분 취소 (PG)'; break
    case 'DONE': state = 'not_cancelled'; label = '취소 미실행 (결제 유지)'; break
    case 'IN_PROGRESS': state = 'in_progress'; label = '결제 진행 중'; break
    case 'READY':
    case 'WAITING_FOR_DEPOSIT':
    case 'ABORTED':
    case 'EXPIRED': state = 'not_paid'; label = '결제 미완료'; break
    default: state = 'unknown'; label = `확인 필요 (${pgStatus})`
  }
  return { pgStatus, state, label, totalAmount: p.totalAmount ?? null, cancelledAmount, lastCancelledAt, cancels }
}
