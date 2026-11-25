import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, fetch, url, request }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/cms/login')

  const initialSessionId = url.searchParams.get('session') ?? null

  // 스마트폰으로 열면(푸시 알림 링크 등) 모바일 전용 상담 화면으로 보낸다 — 태블릿·PC는 기존 화면 유지
  if (/iPhone|iPod|Android.+Mobile/i.test(request.headers.get('user-agent') ?? '')) {
    throw redirect(303, `/cms/mobile/chat${initialSessionId ? `?session=${encodeURIComponent(initialSessionId)}` : ''}`)
  }

  const res = await fetch('/api/chat/sessions')
  if (!res.ok) return { sessions: [], initialSessionId }
  const { sessions } = await res.json().catch(() => ({ sessions: [] }))
  return { sessions: sessions ?? [], initialSessionId }
}
