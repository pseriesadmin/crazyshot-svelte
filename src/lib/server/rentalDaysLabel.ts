import type { SupabaseClient } from '@supabase/supabase-js'
import { calcRentalMinutes, calcRentalPeriodParts } from '$lib/utils/cartRentalFee'

interface RowForRentalDaysLabel {
  pickup_method: string | null
  rental_start: string
  rental_end: string
  pickup_time: string | null
  return_time: string | null
  rental_days_label?: string
}

/**
 * "대여일수" 표시 라벨(예: "12시간"·"1일"·"1일 12시간")을 각 행에 rental_days_label로 채운다.
 *
 * 배경(2026-09-07 Stephen 발견): rental_reservations.rental_days는 GENERATED 컬럼으로
 * `end_date - start_date`(단순 캘린더 일수차)일 뿐이라, rental-fee-policy.md §3에 확정된
 * 실제 청구 산식(12시간 블록 올림)과 다르다 — 방문(비배송) 당일 12시간 이내 대여는
 * 캘린더 일수차가 0이라 CMS 화면에 "0일"로 잘못 보였다. cart/+page.svelte·
 * account/rental/+page.server.ts가 이미 쓰는 것과 동일한 calcRentalMinutes/
 * calcRentalPeriodParts + is_delivery_type 판정을 그대로 재사용해 산식 이원화를 방지한다.
 */
export async function attachRentalDaysLabel<T extends RowForRentalDaysLabel>(
  admin: SupabaseClient,
  rows: T[],
): Promise<void> {
  const uniqueMethods = [...new Set(
    rows.map(r => r.pickup_method).filter((m): m is string => !!m),
  )]

  const deliveryTypeByMethod = new Map<string, boolean>()
  if (uniqueMethods.length > 0) {
    const { data: methodOpts } = await admin
      .from('rental_method_options')
      .select('method_key, is_delivery_type')
      .in('method_key', uniqueMethods)
    for (const opt of (methodOpts ?? []) as { method_key: string; is_delivery_type: boolean | null }[]) {
      deliveryTypeByMethod.set(opt.method_key, opt.is_delivery_type === true)
    }
  }

  for (const row of rows) {
    const deliveryLocked = row.pickup_method ? (deliveryTypeByMethod.get(row.pickup_method) ?? false) : false
    const totalMinutes = calcRentalMinutes(row.rental_start, row.rental_end, row.pickup_time, row.return_time, deliveryLocked)
    const parts = calcRentalPeriodParts(totalMinutes)
    row.rental_days_label = parts.length > 0 ? parts.map(p => `${p.num}${p.unit}`).join(' ') : '-'
  }
}
