/**
 * 관리대상(관리고객) 표식을 예약대여현황 목록 행에 붙인다 (2026-11-25).
 * 관리대상 = user_profiles.blacklisted = true (고객 상세 '관리대상' 탭의 등록/해제와 같은 기준).
 * 예약 → 고객(user_id) → blacklisted 순으로 서버에서만 조회하고, 브라우저에는 행별 true/false 표식만 내려간다
 * (관리대상 명단·사유는 내려가지 않는다). 조회 실패는 표식 없이 진행(fail-soft — 목록 자체는 항상 보인다).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export async function attachManagedCustomer<T extends { reservation_id: number; managed_customer?: boolean }>(
  admin: SupabaseClient,
  rows: T[],
): Promise<void> {
  const ids = rows.map((r) => r.reservation_id)
  if (ids.length === 0) return
  const { data: resv, error: e1 } = await admin.from('rental_reservations').select('id, user_id').in('id', ids)
  if (e1) {
    console.error('[attachManagedCustomer] 예약 조회 실패:', e1.message)
    return
  }
  const userOf = new Map<number, string>()
  for (const r of (resv ?? []) as Array<{ id: number; user_id: string | null }>) {
    if (r.user_id) userOf.set(r.id, r.user_id)
  }
  const userIds = [...new Set(userOf.values())]
  if (userIds.length === 0) return
  const { data: profiles, error: e2 } = await admin.from('user_profiles').select('id').in('id', userIds).eq('blacklisted', true)
  if (e2) {
    console.error('[attachManagedCustomer] 고객 조회 실패:', e2.message)
    return
  }
  const managed = new Set(((profiles ?? []) as Array<{ id: string }>).map((p) => p.id))
  for (const r of rows) {
    const uid = userOf.get(r.reservation_id)
    if (uid && managed.has(uid)) r.managed_customer = true
  }
}
