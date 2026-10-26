import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { loadPaymentReceipts, type CardPaymentInfo } from '$lib/server/account/loadPaymentReceipts'

export interface MyCancel {
  id:               string
  status:           string
  reservation_code: string
  start_date:       string | null
  end_date:         string | null
  created_at:       string
  /** 카드 취소내역 버튼 정보 — 카드 결제 취소 건만(없으면 null) */
  payment:          CardPaymentInfo | null
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, `/auth/login?redirect=${encodeURIComponent(url.pathname)}`)

  const { data, error } = await locals.supabase
    .from('rental_reservations')
    .select('id, status, reservation_code, start_date, end_date, created_at:submitted_at')
    .eq('user_id', session.user.id)
    .in('status', ['cancelled'])
    // 취소중(고객 취소 후 관리자 확인 전)은 대여 목록(/account/rental)에 남아 있다가 확인되면 이곳으로 이동
    .or('customer_cancelled_at.is.null,cancel_confirmed_at.not.is.null')
    .order('submitted_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[account/cancel] load error:', error.message)
    return { cancels: [] as MyCancel[] }
  }

  const rows = (data ?? []) as Array<Omit<MyCancel, 'payment'>>
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  const payments = serviceRoleKey
    ? await loadPaymentReceipts(createClient(getSupabaseUrl(), serviceRoleKey), session.user.id, rows.map(r => r.id))
    : new Map<string, CardPaymentInfo>()

  return { cancels: rows.map(r => ({ ...r, payment: payments.get(String(r.id)) ?? null })) as MyCancel[] }
}
