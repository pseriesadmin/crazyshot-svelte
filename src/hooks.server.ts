import { createServerClient } from '@supabase/ssr'
import type { Handle } from '@sveltejs/kit'
import { stringify } from 'devalue'
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

// ⛔ CMS-GATE-ENVELOPE-1(2026-09-28 발견·수정): 이 게이트는 SvelteKit의 form action
// 파이프라인을 거치지 않고 handle()에서 곧바로 Response를 반환하므로, 이전에는 단순
// `{ error }` + 실제 401/403 HTTP 상태로 응답했다. 그런데 클라이언트(ProductDetailPanel.svelte
// 등)는 모든 CMS 저장 요청을 SvelteKit의 ActionResult 규약(`{type,status,data}`, HTTP 상태는
// 항상 200이고 진짜 상태값은 body의 status 필드에 담김 — `fail()`이 실제로 이렇게 동작함)으로
// 가정하고 처리한다. 형식이 다르면:
//   - use:enhance 기반 탭(기본정보·가격정책·대여정책 등)은 `deserialize()`가 `type` 없는
//     객체를 반환해 `applyAction()`의 사양 밖 분기(else)를 타면서 페이지 상태가 깨짐
//   - 커스텀 fetch 기반 탭(옵션상품)은 res.ok만 보고 사유 없이 "저장에 실패했습니다"만 표시
// 세션 만료 등으로 이 게이트가 실제 CMS 요청을 차단할 때마다 두 결함이 함께 발생했다.
// 해결: SvelteKit의 `fail(status, data)`가 실제로 만드는 것과 동일한 봉투
// (`$app/forms`의 deserialize()가 기대하는 devalue 인코딩 + 항상 HTTP 200)로 응답한다 —
// 이러면 기존 `handleSectionSave`/`saveBundles`의 "type==='failure'" 처리 로직이 그대로
// 정상 동작해 실제 차단 사유(인증 필요/권한 없음)가 화면에 정확히 표시된다.
function jsonReject(status: number, message: string): Response {
  const envelope = {
    type: 'failure' as const,
    status,
    data: stringify({ error: message }),
  }
  return new Response(JSON.stringify(envelope), {
    status: 200,
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
