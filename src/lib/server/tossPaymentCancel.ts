import { env } from '$env/dynamic/private'

export interface TossPaymentCancelResult {
  ok: boolean
  pgCancelledAt?: string
  error?: string
}

/**
 * Toss 결제 취소 API 호출 — paymentKey 기준 전액 취소.
 * 성공 시 cancels[0].canceledAt을 pgCancelledAt으로 반환(pg_cancelled_at 기록용).
 * payment_transactions 업데이트는 호출부(changeReservation 액션) 책임.
 */
export async function tossPaymentCancel(
  paymentKey: string,
  cancelReason: string,
): Promise<TossPaymentCancelResult> {
  const tossSecretKey = env.TOSS_SECRET_KEY
  if (!tossSecretKey) return { ok: false, error: '서버 설정 오류' }

  const tossAuth = 'Basic ' + Buffer.from(`${tossSecretKey}:`).toString('base64')
  const tossRes = await fetch(
    `https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}/cancel`,
    {
      method: 'POST',
      headers: { Authorization: tossAuth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancelReason }),
    },
  )
  const tossData = (await tossRes.json()) as Record<string, unknown>
  if (!tossRes.ok) {
    const code = (tossData.code as string) ?? 'TOSS_ERROR'
    const message = (tossData.message as string) ?? '결제 취소에 실패했습니다.'
    return { ok: false, error: `[${code}] ${message}` }
  }

  const cancels = tossData.cancels as Array<{ canceledAt?: string }> | undefined
  const pgCancelledAt = cancels?.[0]?.canceledAt
  return { ok: true, ...(pgCancelledAt ? { pgCancelledAt } : {}) }
}
