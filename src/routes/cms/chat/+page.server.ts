import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, fetch }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/cms/login')

  const res = await fetch('/api/chat/sessions')
  if (!res.ok) return { sessions: [] }
  const { sessions } = await res.json().catch(() => ({ sessions: [] }))
  return { sessions: sessions ?? [] }
}
