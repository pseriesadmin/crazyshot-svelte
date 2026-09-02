import { createServerClient } from '@supabase/ssr'
import type { Handle } from '@sveltejs/kit'
import { requireSupabasePublicEnv } from '$lib/env/supabasePublic'

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
      const { data: { session }, error } = await event.locals.supabase.auth.getSession()
      if (error || !session) return { session: null, user: null }
      // JWT 재검증으로 조작된 토큰 차단
      const { data: { user }, error: userError } = await event.locals.supabase.auth.getUser()
      if (userError || !user) return { session: null, user: null }
      return { session, user }
    }
    let sessionPromise: ReturnType<typeof getSessionAndUser> | null = null
    event.locals.safeGetSession = () => {
      if (!sessionPromise) sessionPromise = getSessionAndUser()
      return sessionPromise
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
