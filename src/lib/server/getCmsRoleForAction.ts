import { fetchCmsProfileByAuthId } from './cmsProfile'
import type { RequestEvent } from '@sveltejs/kit'

/**
 * Form action에서 cmsRole을 안전하게 가져오는 헬퍼.
 * +layout.server.ts:load가 먼저 실행됐으면 locals.cmsRole 직접 반환.
 * form action 요청처럼 layout load가 없는 경우 DB에서 직접 조회 후 캐싱.
 */
export async function getCmsRoleForAction(
  locals: RequestEvent['locals']
): Promise<string | null> {
  if (locals.cmsRole) return locals.cmsRole
  const { session } = await locals.safeGetSession()
  if (!session) return null
  const profile = await fetchCmsProfileByAuthId(locals.supabase, session.user.id)
  const role = profile?.cms_role ?? null
  if (role) locals.cmsRole = role
  return role
}
