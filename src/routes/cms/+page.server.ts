import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ fetch }) => {
  const res = await fetch('/api/chat/sessions')
  if (!res.ok) return { sessions: [] }
  const { sessions } = await res.json().catch(() => ({ sessions: [] }))
  return { sessions: sessions ?? [] }
}
