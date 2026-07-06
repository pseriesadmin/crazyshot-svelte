import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) {
    return json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = locals.supabase as unknown as any

  const { data: profile } = await admin
    .from('user_profiles')
    .select('cms_role')
    .eq('id', session.user.id)
    .single()

  if (!profile?.cms_role) {
    return json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await admin.rpc('refresh_user_segments')

  if (error) {
    return json({ success: false, error: error.message }, { status: 500 })
  }

  return json({ success: true, ...(data as object) })
}
