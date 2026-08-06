import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, fetch, url }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/cms/login')

  const initialSessionId = url.searchParams.get('session') ?? null

  const res = await fetch('/api/chat/sessions')
  if (!res.ok) return { sessions: [], initialSessionId }
  const { sessions } = await res.json().catch(() => ({ sessions: [] }))
  return { sessions: sessions ?? [], initialSessionId }
}
