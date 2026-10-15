import { env } from '$env/dynamic/private'

export interface TossPaymentCancelResult {
  ok: boolean
  pgCancelledAt?: string
  /** 토스에서 이미 취소돼 있던 결제 — 우리 DB만 뒤처진 상태라 성공으로 보고 DB 반영을 이어가게 한다 */
  alreadyCanceled?: boolean
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
    // 토스에는 이미 취소된 결제인데 우리 DB가 아직 'done'인 경우(과거 테스트·수동 취소 등) — 에러로 막으면 예약취소가 영원히 실패한다.
    // 실제 취소 시각만 조회해 돌려주고 성공으로 처리한다(호출부가 DB 반영을 이어간다, 2026-10-15)
    if (code === 'ALREADY_CANCELED_PAYMENT') {
      let canceledAt: string | undefined
      try {
        const getRes = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}`, { headers: { Authorization: tossAuth } })
        if (getRes.ok) {
          const pay = (await getRes.json()) as { cancels?: Array<{ canceledAt?: string }> }
          canceledAt = pay.cancels?.[0]?.canceledAt
        }
      } catch { /* 취소 시각 조회 실패 — 시각 없이 성공 처리 */ }
      return { ok: true, alreadyCanceled: true, ...(canceledAt ? { pgCancelledAt: canceledAt } : {}) }
    }
    return { ok: false, error: `[${code}] ${message}` }
  }

  const cancels = tossData.cancels as Array<{ canceledAt?: string }> | undefined
  const pgCancelledAt = cancels?.[0]?.canceledAt
  return { ok: true, ...(pgCancelledAt ? { pgCancelledAt } : {}) }
}
