import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export interface MyCancel {
  id:               string
  status:           string
  reservation_code: string
  start_date:       string | null
  end_date:         string | null
  created_at:       string
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, `/auth/login?redirect=${encodeURIComponent(url.pathname)}`)

  const { data, error } = await locals.supabase
    .from('rental_reservations')
    .select('id, status, reservation_code, start_date, end_date, created_at')
    .eq('user_id', session.user.id)
    .in('status', ['cancelled'])
    // 취소중(고객 취소 후 관리자 확인 전)은 대여 목록(/account/rental)에 남아 있다가 확인되면 이곳으로 이동
    .or('customer_cancelled_at.is.null,cancel_confirmed_at.not.is.null')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[account/cancel] load error:', error.message)
    return { cancels: [] as MyCancel[] }
  }

  return { cancels: (data ?? []) as MyCancel[] }
}
