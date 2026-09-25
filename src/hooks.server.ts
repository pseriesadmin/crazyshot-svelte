import { createServerClient } from '@supabase/ssr'
import type { Handle } from '@sveltejs/kit'
import { requireSupabasePublicEnv } from '$lib/env/supabasePublic'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** 라우팅과 동일하게 디코딩·슬래시 병합·소문자화 — 우회 경로 정규화 (디코딩 실패 시 null) */
function normalizePath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname).replace(/\/{2,}/g, '/').toLowerCase()
  } catch {
    return null
  }
}

/** /cms/** 변경 요청 중 로그인 전 접근이 필요한 /cms/login 을 제외한 대상인지 판정 */
function isCmsMutationGated(method: string, pathname: string): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false
  const path = normalizePath(pathname)
  if (path === null) return true // 판독 불가 경로는 안전측으로 게이트
  if (!(path === '/cms' || path.startsWith('/cms/'))) return false
  return !(path === '/cms/login' || path.startsWith('/cms/login/'))
}

function jsonReject(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export const handle: Handle = async ({ event, resolve }) => {
  try {
    const { url, anonKey } = requireSupabasePublicEnv()
    event.locals.supabase = createServerClient(
      url,
      anonKey,
      {
        cookies: {
          getAll: () => event.cookies.getAll(),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) => {
              try {
                event.cookies.set(name, value, { ...options, path: '/' })
              } catch {
                // 응답 생성 후 auth refresh 쿠키 — SSR 안전 무시
              }
            })
          },
        },
      },
    )

    // 요청당 1회만 실제 검증 — Supabase Auth 리전(도쿄)과의 네트워크 왕복이 걸리는
    // getUser() 호출이 한 요청 안에서 여러 +layout.server.ts/+page.server.ts/+server.ts를
    // 거치며 캐싱 없이 중복 호출되어(최대 10회 안팎) 메뉴 이동마다 심각한 지연을 유발하던
    // 문제를 해소 — Promise 자체를 캐싱해 동시 호출도 하나의 네트워크 왕복만 발생시킨다.
    // (실서버 CMS·사용자 화면 전역 심각한 로딩 지연 원인 규명 결과, 2026-09-02)
    const getSessionAndUser = async () => {
      try {
        const { data: { session }, error } = await event.locals.supabase.auth.getSession()
        if (error || !session) return { session: null, user: null }
        // JWT 재검증으로 조작된 토큰 차단
        const { data: { user }, error: userError } = await event.locals.supabase.auth.getUser()
        if (userError || !user) return { session: null, user: null }
        return { session, user }
      } catch (sessionErr) {
        // getSession()/getUser()가 {data,error} 형태가 아니라 예외를 던지는 경우
        // (리프레시 토큰 완전 무효화, Auth 서버 네트워크 타임아웃 등) — 예외가 그대로
        // 전파되면 앱 전역(/cart, CMS 전체 등)이 500 에러로 막힌다. 로그인이 풀린
        // 상태와 동일하게 안전 처리한다(CMS 전역 전수검증 2026-09-09).
        console.error('[CRAZYSHOT SESSION CHECK ERROR]', sessionErr)
        return { session: null, user: null }
      }
    }
    let sessionPromise: ReturnType<typeof getSessionAndUser> | null = null
    event.locals.safeGetSession = () => {
      if (!sessionPromise) sessionPromise = getSessionAndUser()
      return sessionPromise
    }

    // CMS 중앙 게이트 — 폼 액션은 +layout.server.ts 가드를 거치지 않으므로
    // /cms/** 변경 요청은 여기서 CMS 직원(어떤 cms_role이든)만 통과시킨다.
    // 세부 등급(manager 이상 등)은 각 액션의 기존 게이트가 담당.
    if (isCmsMutationGated(event.request.method, event.url.pathname)) {
      try {
        const { session } = await event.locals.safeGetSession()
        if (!session) return jsonReject(401, '인증 필요')
        const cmsRole = await getCmsRoleForAction(event.locals)
        if (!cmsRole) return jsonReject(403, '권한 없음')
      } catch (gateErr) {
        console.error('[CRAZYSHOT CMS GATE ERROR]', gateErr)
        return jsonReject(403, '권한 없음')
      }
    }

    return await resolve(event, {
      filterSerializedResponseHeaders(name) {
        return name === 'content-range' || name === 'x-supabase-api-version'
      },
    })
  } catch (err) {
    console.error('[CRAZYSHOT SSR ERROR]', err)
    throw err
  }
}
