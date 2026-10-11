import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 결제 확정 시 주문 포인트 차감 공용 헬퍼 (2026-10-04, sp3 QA M-2 보완)
 *
 * 문제: 결제(토스 승인)가 끝난 뒤 use_points가 실패해도(잔액 부족 등) 결과를 확인하지 않아, 포인트 할인만큼 덜 낸 채
 *       확정되는 손실을 아무도 모르는 채 방치될 수 있었다.
 * 해결: 차감 결과(rpc error / {ok:false})를 반드시 확인하고, 실패하면 서버 로그 + 관리자 푸시로 즉시 알린다.
 *       (이미 결제가 끝난 경로에서는 확정을 되돌릴 수 없으므로 알림이 최선 — 운영자가 고객 포인트를 수동 정리)
 * 차감량은 호출부가 넘기는 값이 아니라 반드시 주문 저장값(orders.selected_points)이어야 한다.
 */
export interface DeductPointsResult {
  ok: boolean
  /** 실제 차감된 포인트 */
  deducted: number
  /** 실패 사유 코드(INSUFFICIENT_POINTS · POINTS_EXCEED_ORDER · RPC_ERROR 등) */
  error?: string
}

export async function deductOrderPoints(
  admin: SupabaseClient,
  opts: {
    userId: string
    orderId: number
    points: number
    /** 관리자 알림 링크용(선택) */
    reservationId?: number
    /** 로그 접두어 */
    source: string
    /** 결제가 이미 끝난 경로(실패 시 관리자 알림)는 true, 확정 전 사전 차감 경로는 false */
    alertAdminOnFailure: boolean
  },
): Promise<DeductPointsResult> {
  const points = Math.max(0, Math.trunc(Number(opts.points) || 0))
  if (points <= 0) return { ok: true, deducted: 0 }

  let result: DeductPointsResult
  try {
    const { data, error } = await admin.rpc('use_points', {
      p_user_id: opts.userId,
      p_points: points,
      p_order_id: opts.orderId,
    })
    if (error) {
      result = { ok: false, deducted: 0, error: 'RPC_ERROR' }
      console.error(`[${opts.source}] use_points 실패:`, error.message)
    } else {
      const r = data as { ok?: boolean; error?: string; deducted?: number } | null
      result = r?.ok
        ? { ok: true, deducted: r.deducted ?? points }
        : { ok: false, deducted: 0, error: r?.error ?? 'UNKNOWN' }
      if (!r?.ok) console.error(`[${opts.source}] use_points 거부:`, result.error)
    }
  } catch (err) {
    result = { ok: false, deducted: 0, error: 'RPC_EXCEPTION' }
    console.error(`[${opts.source}] use_points 예외:`, err instanceof Error ? err.message : err)
  }

  if (!result.ok && opts.alertAdminOnFailure) {
    try {
      const { sendPushToAdmins } = await import('$lib/server/push')
      await sendPushToAdmins('payment_completed', {
        title: '포인트 차감 실패 — 확인 필요',
        body: `주문 #${opts.orderId}: 결제는 완료됐으나 고객 포인트 ${points.toLocaleString('ko-KR')}P 차감에 실패했습니다(${result.error}). 고객 포인트를 확인해 수동으로 정리해주세요.`,
        link: opts.reservationId ? `/cms/reservation?selected=${opts.reservationId}` : '/cms/reservation',
      })
    } catch (pushErr) {
      console.error(`[${opts.source}] 관리자 알림 오류(fail-soft):`, pushErr instanceof Error ? pushErr.message : pushErr)
    }
  }
  return result
}
