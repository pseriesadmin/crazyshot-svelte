import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session || !locals.cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data, error } = await admin
    .from('payment_transactions')
    .select(`
      payment_key,
      payment_method,
      total_amount,
      paid_amount,
      point_amount,
      coupon_discount,
      confirmed_at,
      toss_response
    `)
    .eq('reservation_id', Number(params.id))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return json({ error: error.message }, { status: 500 })
  return json({ payment: data ?? null })
}
