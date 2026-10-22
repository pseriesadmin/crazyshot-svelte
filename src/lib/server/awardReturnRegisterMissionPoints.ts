// 반납등록 미션(return_register_mission) 포인트 자동적립 — fail-soft 헬퍼 (Migration #739, 2026-10-22).
// 지급 시점(2026-10-22 Stephen 확정): 고객이 반납정보를 등록한 즉시가 아니라 **관리자 검수 승인 후** — approveInspection 이 호출한다.
// 예약당 1회 — 멱등·동시 호출 방지는 DB(ref_type/ref_id 유일 인덱스 + 예약 단위 잠금, Migration #741)가 보장.
// H-01: 직접 DML 금지 — award_return_register_mission_points RPC 경유만 허용(service_role 전용).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

export interface ReturnMissionAward {
  /** 이번 호출로 지급된 포인트(이미 지급됐거나 규칙이 꺼져 있으면 0) */
  awarded: number
  newBalance: number | null
}

export async function awardReturnRegisterMissionPoints(
  admin: AnyClient,
  reservationId: number,
): Promise<ReturnMissionAward> {
  try {
    const { data, error } = await admin.rpc('award_return_register_mission_points', {
      p_reservation_id: reservationId,
    })
    if (error) {
      console.error('[return-mission] award rpc error:', error.message)
      return { awarded: 0, newBalance: null }
    }
    const res = data as { success?: boolean; amount?: number; new_balance?: number; already_granted?: boolean } | null
    if (res?.success && !res.already_granted && typeof res.amount === 'number' && res.amount > 0) {
      return { awarded: res.amount, newBalance: typeof res.new_balance === 'number' ? res.new_balance : null }
    }
  } catch (e) {
    // 포인트 적립 실패는 검수 승인 흐름에 영향을 주지 않음(fail-soft) — 로그만 남긴다
    console.error('[return-mission] award failed:', e instanceof Error ? e.message : e)
  }
  return { awarded: 0, newBalance: null }
}

/**
 * 검수 승인으로 완료된 예약들에 반납등록 미션 포인트를 지급한다.
 * 고객이 직접 반납정보를 등록한 예약(reservation_return_submissions 행 존재)만 대상 — 방문 반납 등 등록이 없는 예약은 지급하지 않는다.
 */
export async function awardReturnMissionForApproved(admin: AnyClient, reservationIds: number[]): Promise<void> {
  if (reservationIds.length === 0) return
  try {
    const { data } = await admin.from('reservation_return_submissions').select('reservation_id').in('reservation_id', reservationIds)
    const registered = ((data ?? []) as Array<{ reservation_id: number }>).map((r) => r.reservation_id)
    for (const id of registered) await awardReturnRegisterMissionPoints(admin, id)
  } catch (e) {
    console.error('[return-mission] approve award failed:', e instanceof Error ? e.message : e)
  }
}

/** 소개·완료 카드에 보여줄 미션 포인트 — 규칙이 켜져 있고 금액이 0보다 클 때만 값을 돌려준다(아니면 null → 포인트 문구 숨김) */
export async function loadReturnMissionPoints(admin: AnyClient): Promise<number | null> {
  try {
    const { data } = await admin
      .from('point_earn_rules')
      .select('amount, is_active')
      .eq('event_type', 'return_register_mission')
      .maybeSingle()
    const r = data as { amount: number; is_active: boolean } | null
    return r && r.is_active && r.amount > 0 ? r.amount : null
  } catch {
    return null
  }
}
