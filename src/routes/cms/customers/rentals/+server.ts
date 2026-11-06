import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { fetchCmsProfileByAuthId } from '$lib/server/cmsProfile'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { RequestHandler } from './$types'
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'

// GET /cms/customers/rentals?userId=<user_profiles.id>
// CMS 관리자 전용(manager 이상): 고객 상품 대여 이력 조회 (service_role, RLS 우회)
export const GET: RequestHandler = async ({ locals, url }) => {
  const denied = await requireMenuAccessApi(locals, 'customers.list')
  if (denied) return denied
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 403 })

  const profile = await fetchCmsProfileByAuthId(locals.supabase, session.user.id)
  if (!hasSettingsAccess(profile?.cms_role ?? '')) return json({ error: '권한 없음' }, { status: 403 })

  const userId = url.searchParams.get('userId')
  if (!userId) return json({ error: 'userId 필수' }, { status: 400 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  // userId = user_profiles.id (PK). rental_reservations.user_id → auth.users.id 이므로 변환 필요
  const { data: profileRow, error: profErr } = await admin
    .from('user_profiles')
    .select('user_id')
    .eq('id', userId)
    .single()

  if (profErr || !profileRow) return json({ error: 'profile_not_found' }, { status: 404 })

  const authUserId = profileRow.user_id as string

  const { data, error } = await admin
    .from('rental_reservations')
    .select(`
      id,
      status,
      reservation_code,
      start_date,
      end_date,
      rental_days,
      duration_type,
      pickup_method,
      return_method,
      created_at,
      products!rental_reservations_product_id_fkey(name, product_code, parent_product_id)
    `)
    .eq('user_id', authUserId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return json({ error: error.message }, { status: 500 })

  // 자식 재고의 이름은 부모 값을 따른다(품번은 자식 고유값 — 자식 재고 부모 참조 전환 Phase 3-D)
  await applyParentFieldsToRowProducts(data ?? [], ['name'], admin)

  // 연체료 기록(2026-11-03, Stephen 지시) — 대여 카드마다 그 예약의 연체료(예약당 1건)를 붙인다. 조회 실패는 이력 표시를 막지 않는다(연체료만 빠짐).
  const reservations = (data ?? []) as Array<{ id: number }>
  const lateFeeByReservation = new Map<number, { fee_amount: number; hours_late: number; is_paid: boolean; paid_at: string | null }>()
  if (reservations.length > 0) {
    const { data: lateFees, error: lateFeeError } = await admin
      .from('late_fees')
      .select('reservation_id, fee_amount, hours_late, is_paid, paid_at')
      .in('reservation_id', reservations.map((r) => r.id))
    if (lateFeeError) {
      console.error('[cms/customers/rentals] 연체료 조회 실패(fail-soft):', lateFeeError.message)
    } else {
      for (const fee of (lateFees ?? []) as Array<{ reservation_id: number; fee_amount: number; hours_late: number; is_paid: boolean; paid_at: string | null }>) {
        lateFeeByReservation.set(fee.reservation_id, { fee_amount: Number(fee.fee_amount), hours_late: fee.hours_late, is_paid: fee.is_paid, paid_at: fee.paid_at })
      }
    }
  }

  return json((data ?? []).map((row: { id: number }) => ({ ...row, late_fee: lateFeeByReservation.get(row.id) ?? null })))
}
