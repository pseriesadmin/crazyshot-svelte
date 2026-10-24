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
import { CMS_REMEMBER_COOKIE, cmsRememberCookieOptions } from '$lib/server/cmsRememberCookie'
import { recordCmsLogin } from '$lib/server/cmsLoginLog'
import { REMEMBER_COOKIE } from '$lib/utils/authCookies'
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

export const load: LayoutServerLoad = async ({ locals, url, cookies, request, getClientAddress }) => {
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

  // 로그인 상태 유지 표식(cms-remember)이 없으면 CMS 로그인 화면을 거치지 않은 세션이다.
  //  · 관리자 권한이 확인되면 표식을 새로 발급해 계속 진행한다 — 사용자 사이트에서 관리자 계정으로 로그인한 뒤 /cms로 오거나
  //    표식만 먼저 만료된 경우에 로그인이 풀리지 않게 한다(수명은 로그인 선택 cs-remember를 따름: '0'이면 세션 쿠키, 그 외 400일).
  //  · 관리자 권한이 없는 세션만 기존처럼 로그아웃시킨다.
  //  · 이 경로의 진입도 CMS 접속 로그(cms_login_logs)에 남긴다(표식을 발급하는 최초 1회만 — 이후 이동은 기록하지 않음, 기록 실패는 접속을 막지 않음).
  const profile = await fetchCmsProfileByAuthId(locals.supabase, session.user.id)
  if (!cookies.get(CMS_REMEMBER_COOKIE)) {
    if (!profile?.cms_role) {
      await locals.supabase.auth.signOut()
      const t = encodeURIComponent(new Date().toISOString())
      throw redirect(303, `/cms/login?logout=expired&t=${t}`)
    }
    cookies.set(CMS_REMEMBER_COOKIE, '1', cmsRememberCookieOptions(cookies.get(REMEMBER_COOKIE) !== '0'))
    let ip = 'unknown'
    try { ip = getClientAddress() } catch { /* dev 환경 */ }
    await recordCmsLogin({
      userId: session.user.id,
      email: session.user.email ?? '',
      cmsRole: profile.cms_role,
      ipAddress: request?.headers.get('x-forwarded-for') ?? ip,
      userAgent: request?.headers.get('user-agent') ?? 'unknown',
    })
  }

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
  //
  // overrides는 경로 매칭 여부와 무관하게 항상 조회한다 — GNB(+layout.svelte)가 동일 값을
  // 그대로 재사용해 "role은 허용하지만 이 계정만 차단된" 메뉴를 내비게이션에서도 감춰야
  // 하기 때문(그렇지 않으면 눌러도 튕겨나가는 죽은 링크가 그대로 노출되는 우회로가 남는다).
  const overrides = await fetchMenuPermissionOverrides(session.user.id)

  const menuKey = findCmsMenuKeyForPath(url.pathname)
  if (menuKey && !hasMenuAccess(role, overrides, menuKey)) {
    throw redirect(303, '/cms?notice=access_denied')
  }

  locals.cmsRole = role
  return { session, cmsRole: role, cmsName: profile.name, menuPermissionOverrides: overrides }
}
