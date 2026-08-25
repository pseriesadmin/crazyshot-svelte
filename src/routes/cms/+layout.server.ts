import { redirect } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { fetchCmsProfileByAuthId } from '$lib/server/cmsProfile'
import { hasRouteAccess } from '$lib/utils/cmsPermissions'
import {
  findCmsMenuKeyForPath,
  hasMenuAccess,
  type CmsMenuPermissionOverride,
} from '$lib/constants/cmsMenus'
import type { LayoutServerLoad } from './$types'

const PUBLIC_CMS_PATHS = ['/cms/login']

/**
 * Stage 3(Q6 좁히기 전용) — 특정 계정에 대한 메뉴권한 오버라이드 조회.
 *
 * cms_menu_permissions는 RLS 활성화 + 정책 없음(service_role 전용, "CMS 브라우저 auth
 * 패턴") 테이블이라 locals.supabase(사용자 세션 RLS 클라이언트)로는 조회할 수 없다 —
 * service_role 클라이언트로 직접 조회한다. 조회 실패 시 오버라이드 없음(빈 배열)으로
 * 방어적 폴백해, 이 조회 하나 때문에 CMS 전체 로그인이 막히지 않도록 한다.
 */
async function fetchMenuPermissionOverrides(userId: string): Promise<CmsMenuPermissionOverride[]> {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return []

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)
  const { data, error } = await admin
    .from('cms_menu_permissions')
    .select('menu_key, allowed')
    .eq('user_id', userId)

  if (error || !data) return []
  return data as CmsMenuPermissionOverride[]
}

export const load: LayoutServerLoad = async ({ locals, url, cookies }) => {
  if (PUBLIC_CMS_PATHS.some((p) => url.pathname.startsWith(p))) return {}

  const { session } = await locals.safeGetSession()
  if (!session) {
    // auth 쿠키가 남아 있으면 세션 만료, 없으면 최초 방문
    const hadSession = cookies.getAll().some(
      (c) => c.name.startsWith('sb-') && c.name.includes('auth-token')
    )
    // /cms/mobile 경로 진입 시 로그인 후 돌아올 수 있도록 returnTo 전달
    const returnTo = url.pathname.startsWith('/cms/mobile') ? url.pathname : null
    if (hadSession) {
      const t = encodeURIComponent(new Date().toISOString())
      const params = new URLSearchParams({ logout: 'expired', t })
      if (returnTo) params.set('returnTo', returnTo)
      throw redirect(303, `/cms/login?${params}`)
    }
    const loginUrl = returnTo
      ? `/cms/login?returnTo=${encodeURIComponent(returnTo)}`
      : '/cms/login'
    throw redirect(303, loginUrl)
  }

  // 로그인 상태 유지 미체크 시: 브라우저 종료 후 재진입하면 cms-remember 세션쿠키가 없음 → 로그아웃
  const rememberOk = cookies.get('cms-remember')
  if (!rememberOk) {
    await locals.supabase.auth.signOut()
    const t = encodeURIComponent(new Date().toISOString())
    throw redirect(303, `/cms/login?logout=expired&t=${t}`)
  }

  const profile = await fetchCmsProfileByAuthId(locals.supabase, session.user.id)
  if (!profile?.cms_role) throw redirect(303, '/cms/login')

  const role = profile.cms_role as string

  if (!hasRouteAccess(role, url.pathname)) {
    throw redirect(303, '/cms?notice=access_denied')
  }

  // Stage 3(Q6 확정 — 좁히기 전용) 메뉴권한 오버레이: role이 이미 허용한 경로라도, 관리자가
  // 이 계정에 대해 해당 메뉴를 명시적으로 차단(allowed=false)했다면 추가로 거부한다.
  // role이 애초에 막은 경로를 메뉴권한으로 열어주는 것은 불가능하다(hasMenuAccess() 자체가
  // roleAllowsMenuByDefault()를 최종 상한선으로 삼도록 설계됨, cmsMenus.ts 참고) — 즉 이
  // 오버레이는 항상 "좁히기"로만 작동하며 위 hasRouteAccess() 판정을 절대 무력화하지 않는다.
  // CMS_MENUS에 아직 등록되지 않은 경로(예: /cms/accounts, /cms/mobile)는 findCmsMenuKeyForPath가
  // null을 반환해 이 오버레이를 건너뛰고 기존 role 전용 가드만 적용된다(무회귀).
  const menuKey = findCmsMenuKeyForPath(url.pathname)
  if (menuKey) {
    const overrides = await fetchMenuPermissionOverrides(session.user.id)
    if (!hasMenuAccess(role, overrides, menuKey)) {
      throw redirect(303, '/cms?notice=access_denied')
    }
  }

  locals.cmsRole = role
  return { session, cmsRole: role }
}
