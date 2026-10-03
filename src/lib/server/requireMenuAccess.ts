// requireMenuAccess.ts — 계정별 메뉴 접근 권한(cms_menu_permissions 오버레이)의 서버 집행 공용 검사 (서버 전용)
//
// 배경(2026-10-03): 권한설정 탭의 OFF 설정은 화면 진입(+layout.server.ts redirect)만 막고, 폼 액션(레이아웃 load보다
// 먼저 실행됨)과 API는 cms_role만 확인해 OFF 계정도 직접 호출로 데이터 조회·동작이 가능했다. 이 함수가 그 서버 경로의
// 진입부에서 같은 판정(hasMenuAccess)을 집행한다. 엔드포인트에는 진입부 한 줄 호출만 추가한다(기존 로직 수정 금지).
//
//   +server.ts : const denied = await requireMenuAccessApi(locals, 'consulting.chat'); if (denied) return denied
//   폼 액션    : const denied = await requireMenuAccessAction(locals, 'rental.reservation'); if (denied) return denied
//
// 정책(Stephen 확정 2026-10-03):
//  · 판정은 cmsMenus.hasMenuAccess 그대로 — OFF 오버라이드가 role보다 먼저 평가(슈퍼관리자도 OFF면 거부), 좁히기 전용
//  · 오버라이드 조회 실패·서비스 키 없음 = 차단(fail-closed). ⚠️ 레이아웃의 fetchMenuPermissionOverrides는 조회 실패 시
//    전부 허용(fail-open)이라 서로 다르다 — 레이아웃은 이번 단계에서 변경하지 않는다(회귀 위험, 후속 과제)
//  · 오버라이드가 없거나 ON인 계정은 이전과 동일하게 통과(무회귀)
import { json, fail } from '@sveltejs/kit'
import type { ActionFailure, RequestEvent } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasMenuAccess, type CmsMenuPermissionOverride } from '$lib/constants/cmsMenus'

export type MenuAccessResult =
  | { ok: true; cmsRole: string }
  | { ok: false; status: 401 | 403; error: string }

type OverridesResult = { ok: true; overrides: CmsMenuPermissionOverride[] } | { ok: false }

const MSG_UNAUTHENTICATED = '로그인이 필요합니다.'
const MSG_DENIED = '이 기능에 대한 접근 권한이 없습니다.'
const MSG_LOOKUP_FAILED = '권한 정보를 확인하지 못해 요청을 차단했습니다. 잠시 후 다시 시도해 주세요.'

// 요청 단위 캐시 — 같은 요청(locals)에서 여러 번 검사해도 cms_menu_permissions 조회는 1회.
// 실패도 요청 안에서는 한 번만 시도한다(실패 상태에서 반복 호출이 DB를 계속 두드리지 않게). 다음 요청은 새로 조회한다.
const overridesCache = new WeakMap<object, Promise<OverridesResult>>()

async function loadOverrides(userId: string): Promise<OverridesResult> {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    console.error('[requireMenuAccess] SUPABASE_SERVICE_ROLE_KEY 없음 — 요청 차단')
    return { ok: false }
  }
  try {
    const admin = createClient(getSupabaseUrl(), serviceRoleKey)
    const { data, error } = await admin.from('cms_menu_permissions').select('menu_key, allowed').eq('user_id', userId)
    if (error || !data) {
      console.error('[requireMenuAccess] 메뉴권한 조회 실패 — 요청 차단:', error?.message ?? 'no data')
      return { ok: false }
    }
    return { ok: true, overrides: data as CmsMenuPermissionOverride[] }
  } catch (e) {
    console.error('[requireMenuAccess] 메뉴권한 조회 예외 — 요청 차단:', e instanceof Error ? e.message : e)
    return { ok: false }
  }
}

/** 현재 요청자가 menuKey 메뉴의 기능(데이터·동작)에 접근 가능한지 판정한다. */
export async function checkMenuAccess(locals: RequestEvent['locals'], menuKey: string): Promise<MenuAccessResult> {
  const { session } = await locals.safeGetSession()
  if (!session) return { ok: false, status: 401, error: MSG_UNAUTHENTICATED }

  // 고객(front) 세션 등 CMS 권한 없는 계정은 여기서 거부 — 오버라이드 조회까지 가지 않는다
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return { ok: false, status: 403, error: MSG_DENIED }

  let pending = overridesCache.get(locals)
  if (!pending) {
    pending = loadOverrides(session.user.id)
    overridesCache.set(locals, pending)
  }
  const loaded = await pending
  if (!loaded.ok) return { ok: false, status: 403, error: MSG_LOOKUP_FAILED }

  // 존재하지 않는 메뉴 키(오타)는 hasMenuAccess가 false를 반환 → 거부(무방비 방지)
  if (!hasMenuAccess(cmsRole, loaded.overrides, menuKey)) return { ok: false, status: 403, error: MSG_DENIED }
  return { ok: true, cmsRole }
}

/**
 * 여러 메뉴 중 하나라도 접근 가능하면 통과 — 두 화면이 함께 쓰는 공용 API용
 * (예: 채팅 입력창의 '/' 빠른답변 목록은 채팅 화면과 빠른답변 관리 화면이 같은 API를 쓴다).
 * 어느 한 메뉴만 OFF인 계정의 다른 화면 기능이 부수적으로 막히지 않게 한다. 전부 거부일 때만 거부,
 * 빈 목록은 거부(무방비 방지). 오버라이드 조회는 요청 단위 캐시를 공유하므로 DB 조회는 1회.
 */
export async function checkAnyMenuAccess(locals: RequestEvent['locals'], menuKeys: readonly string[]): Promise<MenuAccessResult> {
  if (menuKeys.length === 0) return { ok: false, status: 403, error: MSG_DENIED }
  let firstFailure: MenuAccessResult | null = null
  for (const key of menuKeys) {
    const r = await checkMenuAccess(locals, key)
    if (r.ok) return r
    firstFailure ??= r
  }
  return firstFailure as MenuAccessResult
}

/** +server.ts 진입부용 — 거부 시 JSON 오류 Response, 통과 시 null */
export async function requireMenuAccessApi(locals: RequestEvent['locals'], menuKey: string): Promise<Response | null> {
  const r = await checkMenuAccess(locals, menuKey)
  return r.ok ? null : json({ error: r.error }, { status: r.status })
}

/** 폼 액션 진입부용 — 거부 시 fail(status,{error}), 통과 시 null */
export async function requireMenuAccessAction(
  locals: RequestEvent['locals'],
  menuKey: string,
): Promise<ActionFailure<{ error: string }> | null> {
  const r = await checkMenuAccess(locals, menuKey)
  return r.ok ? null : fail(r.status, { error: r.error })
}

/** +server.ts 진입부용 — 여러 메뉴 중 하나라도 허용이면 통과, 전부 거부일 때만 JSON 오류 Response */
export async function requireAnyMenuAccessApi(locals: RequestEvent['locals'], menuKeys: readonly string[]): Promise<Response | null> {
  const r = await checkAnyMenuAccess(locals, menuKeys)
  return r.ok ? null : json({ error: r.error }, { status: r.status })
}
