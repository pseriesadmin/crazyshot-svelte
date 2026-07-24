import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

export const GET: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })

  const userId = params.id
  if (!userId) return json({ error: 'id required' }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data, error } = await admin
    .from('cs_posts')
    .select('id, title, content, category, status, created_at, cs_inquiries(id, response, is_resolution, created_at)')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return json({ error: error.message }, { status: 500 })
  return json(data ?? [])
}
