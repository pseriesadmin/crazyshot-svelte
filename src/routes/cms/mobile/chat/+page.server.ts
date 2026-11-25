import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { hasMenuAccess } from '$lib/constants/cmsMenus'

// 모바일 전용 상담 화면 — 데이터 조회는 PC 상담(/cms/chat)과 같은 /api/chat/sessions 를 쓴다(상담 메뉴 권한도 같은 기준)
export const load: PageServerLoad = async ({ locals, fetch, url, parent }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/cms/login')
  const { cmsRole, menuPermissionOverrides } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')
  if (!hasMenuAccess(cmsRole, menuPermissionOverrides, 'consulting.chat')) throw redirect(303, '/cms/mobile?notice=access_denied')

  const initialSessionId = url.searchParams.get('session') ?? null
  const res = await fetch('/api/chat/sessions')
  if (!res.ok) return { sessions: [], initialSessionId }
  const { sessions } = await res.json().catch(() => ({ sessions: [] }))
  return { sessions: sessions ?? [], initialSessionId }
}
