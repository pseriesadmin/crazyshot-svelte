/**
 * 고객용 카드 영수증·취소내역 — 순수 함수 (2026-10-26)
 *
 * ⛔ toss_response(토스 승인 응답 원본)에는 secret·카드번호 등 민감값이 들어 있다 — 클라이언트로 그대로 내려보내지 않고
 * 여기서 필요한 값(영수증 주소·상태·금액)만 골라낸다. 반환 객체에는 결제 키·secret·카드 정보가 없다.
 */
import type { PgCancelSummary } from '$lib/utils/pgCancelStatus'

/** 토스 영수증(매출전표) 주소만 허용 — https + tosspayments.com 도메인(하위 도메인 포함) */
export function safeReceiptUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) return null
  let u: URL
  try { u = new URL(value) } catch { return null }
  if (u.protocol !== 'https:') return null
  // 사용자 정보(user:pw@)·포트가 붙은 주소는 매출전표 주소가 아니다
  if (u.username || u.password || u.port) return null
  const host = u.hostname.toLowerCase()
  if (host !== 'tosspayments.com' && !host.endsWith('.tosspayments.com')) return null
  return u.toString()
}

export interface ReceiptTxRow {
  status?: string | null
  total_amount?: number | null
  paid_amount?: number | null
  toss_response?: unknown
  pg_cancelled_at?: string | null
  cancelled_at?: string | null
  cancel_reason?: string | null // 고객 응답에는 쓰지 않는다(위 buildCancelDetail 주석)
}

export interface PaymentReceiptInfo {
  /** 카드 매출전표 주소(허용 도메인만, 없으면 null) */
  receiptUrl: string | null
  /** 결제가 취소(전액)된 건 */
  cancelled: boolean
  /** 부분 취소된 건 — 현재는 실행 경로가 없어 표시 장치만 준비 */
  partial: boolean
}

function receiptUrlOf(tossResponse: unknown): string | null {
  if (!tossResponse || typeof tossResponse !== 'object') return null
  const receipt = (tossResponse as { receipt?: unknown }).receipt
  if (!receipt || typeof receipt !== 'object') return null
  return safeReceiptUrl((receipt as { url?: unknown }).url)
}

/** 결제 행 → 카드에 노출할 최소 정보. 결제 행이 없으면 null(버튼 숨김) */
export function extractReceiptInfo(tx: ReceiptTxRow | null | undefined): PaymentReceiptInfo | null {
  if (!tx) return null
  const status = tx.status ?? ''
  return {
    receiptUrl: receiptUrlOf(tx.toss_response),
    cancelled: status === 'cancelled',
    partial: status === 'partial_cancelled',
  }
}

export interface CancelDetail {
  status: '승인취소' | '부분취소'
  cancelledAt: string | null
  cancelAmount: number | null
  balanceAmount: number | null
  receiptUrl: string | null
  /** 토스 실시간 조회 값인지, 조회 실패로 DB 값을 대신 쓴 것인지 */
  source: 'toss' | 'db'
}

/**
 * 취소내역 — 토스 조회 요약이 취소 상태면 그 값을, 아니면 DB 값으로 대체.
 * ⛔ 취소 사유는 고객에게 보여주지 않는다(Stephen 2026-10-26) — 관리자 입력 문구가 내부 메모일 수 있어 응답에 싣지 않는다.
 */
export function buildCancelDetail(tx: ReceiptTxRow, toss?: PgCancelSummary | null): CancelDetail {
  const receiptUrl = receiptUrlOf(tx.toss_response)
  if (toss && (toss.state === 'cancelled' || toss.state === 'partial_cancelled')) {
    const total = toss.totalAmount
    return {
      status: toss.state === 'partial_cancelled' ? '부분취소' : '승인취소',
      cancelledAt: toss.lastCancelledAt,
      cancelAmount: toss.cancelledAmount,
      balanceAmount: total != null ? Math.max(total - toss.cancelledAmount, 0) : null,
      receiptUrl,
      source: 'toss',
    }
  }
  const partial = tx.status === 'partial_cancelled'
  // 결제 금액이 비어 있으면 금액을 모른다고 표시한다(total_amount 는 포인트·쿠폰이 포함될 수 있어 환불 금액으로 쓰지 않는다)
  const paid = tx.paid_amount ?? null
  return {
    status: partial ? '부분취소' : '승인취소',
    cancelledAt: tx.pg_cancelled_at ?? tx.cancelled_at ?? null,
    cancelAmount: partial ? null : paid,
    balanceAmount: partial ? null : 0,
    receiptUrl,
    source: 'db',
  }
}

/** 취소내역을 보여줄 수 있는 결제 상태인가 */
export function isCancelDetailAvailable(tx: ReceiptTxRow | null | undefined): boolean {
  const s = tx?.status ?? ''
  return s === 'cancelled' || s === 'partial_cancelled'
}
