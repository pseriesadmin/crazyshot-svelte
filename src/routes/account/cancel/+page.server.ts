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

export const load: PageServerLoad = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/auth/login')

  const { data, error } = await locals.supabase
    .from('rental_reservations')
    .select('id, status, reservation_code, start_date, end_date, created_at')
    .eq('user_id', session.user.id)
    .in('status', ['cancelled'])
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[account/cancel] load error:', error.message)
    return { cancels: [] as MyCancel[] }
  }

  return { cancels: (data ?? []) as MyCancel[] }
}
