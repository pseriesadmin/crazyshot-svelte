import { createServerClient } from '@supabase/ssr'
import type { Handle } from '@sveltejs/kit'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

export const handle: Handle = async ({ event, resolve }) => {
  try {
    event.locals.supabase = createServerClient(
      PUBLIC_SUPABASE_URL,
      PUBLIC_SUPABASE_ANON_KEY,
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

    event.locals.safeGetSession = async () => {
      const { data: { session }, error } = await event.locals.supabase.auth.getSession()
      if (error || !session) return { session: null, user: null }
      // JWT 재검증으로 조작된 토큰 차단
      const { data: { user }, error: userError } = await event.locals.supabase.auth.getUser()
      if (userError || !user) return { session: null, user: null }
      return { session, user }
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
