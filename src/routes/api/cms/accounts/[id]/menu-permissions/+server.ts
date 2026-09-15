// /api/cms/accounts/[id]/menu-permissions — 계정별 메뉴 세부 접근권한 CRUD
// .claude/harness/TASK.md "CMS 관리자 계정 목록 → 계정 정보설정 상세패널" Stage 3
//
// GET: 특정 계정(target)의 메뉴권한 오버레이 목록 조회 (cms_get_menu_permissions RPC)
// PUT: 메뉴 1건의 허용/차단 저장 (cms_set_menu_permission RPC)
//
// - manager+ 게이트(hasSettingsAccess) — "CMS 브라우저 auth 패턴"(service_role 경유,
//   RLS 정책 없는 cms_menu_permissions 테이블을 브라우저 RLS RPC가 아니라 이 API로만 접근).
// - getCmsRoleForAction() 사용 — +server.ts는 +layout.server.ts load()를 거치지 않고
//   직접 fetch될 수 있어 locals.cmsRole이 비어있을 수 있다(security-auth.md "form action에서
//   locals.cmsRole 직접 사용 절대 금지" 규칙과 동일 이유).
// - EC-5: 자기 자신을 대상(target)으로 하는 변경은 self-service 경로로 간주해 차단한다.
// - 대상이 슈퍼마스터(superadmin)면 requireAccountMutationAccess()로 호출자도 실제
//   슈퍼마스터여야만 통과한다(2026-09-15 추가 — 누락돼 있던 CRITICAL 공백, 계정목록의 다른
//   관리 액션과 동일 게이트로 통일). PUT 전용 — GET(열람)은 계정 상세패널의 다른 탭 열람과
//   동일하게 manager+면 대상 무관하게 허용.
// - Q6 확정(좁히기 전용): "메뉴권한이 role 허용범위를 절대 넘어설 수 없다"는 불변조건을
//   여기(API 레이어)에서 강제한다 — allowed=true 요청은 대상 계정의 실제 cms_role 기준
//   roleAllowsMenuByDefault()가 통과할 때만 저장을 허용한다. RPC(cms_set_menu_permission)
//   자체는 이 판정을 하지 않는 단순 upsert다(Stage 2의 requireAccountMutationAccess와
//   동일하게, 인가·업무규칙은 호출자인 이 API 레이어가 담당하고 RPC는 데이터 계층만 담당하는
//   기존 설계 원칙을 그대로 따름) — allowed=false(좁히기)는 role과 무관하게 항상 허용되므로
//   이 경우엔 대상 role 조회 자체를 생략한다.

import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { fetchCmsProfileByAuthId } from '$lib/server/cmsProfile'
import { requireAccountMutationAccess } from '$lib/server/requireTrueSuperadmin'
import { findCmsMenuByKey, roleAllowsMenuByDefault } from '$lib/constants/cmsMenus'
import { insertCmsAdminAuditLog } from '$lib/server/cmsAdminAuditLog'
import type { RequestHandler } from './$types'

export interface CmsMenuPermissionRow {
  menu_key: string
  allowed: boolean
  updated_at: string
  updated_by: string | null
}

function makeAdmin() {
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return null
  return createClient(getSupabaseUrl(), key)
}

// GET /api/cms/accounts/[id]/menu-permissions
export const GET: RequestHandler = async ({ locals, params }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })

  const admin = makeAdmin()
  if (!admin) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const targetUserId = params.id
  if (!targetUserId) return json({ error: '잘못된 요청입니다.' }, { status: 400 })

  const { data, error } = await admin.rpc('cms_get_menu_permissions', {
    p_user_id: targetUserId,
  })
  if (error) return json({ error: error.message }, { status: 500 })

  return json((data ?? []) as CmsMenuPermissionRow[])
}

// PUT /api/cms/accounts/[id]/menu-permissions — body: { menu_key: string, allowed: boolean }
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })

  const admin = makeAdmin()
  if (!admin) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증이 필요합니다.' }, { status: 401 })

  const targetUserId = params.id
  if (!targetUserId) return json({ error: '잘못된 요청입니다.' }, { status: 400 })

  // EC-5: 자기 자신에게 메뉴권한을 부여/변경하는 self-service 경로 차단
  if (targetUserId === session.user.id) {
    return json({ error: '자기 자신의 메뉴 권한은 변경할 수 없습니다.' }, { status: 403 })
  }

  // 대상 계정이 슈퍼마스터(superadmin)이면 호출자도 실제 슈퍼마스터여야 통과 — 계정목록의
  // 다른 관리 액션(updateRole/toggleSuspend/delete 등)과 동일한 requireAccountMutationAccess
  // 게이트를 여기에도 적용한다. 이 게이트가 없으면 매니저가 슈퍼마스터 계정의 메뉴 접근을
  // 몰래 차단할 수 있었다(2026-09-15 발견 → 즉시 수정, Stephen 확인).
  const accessErr = await requireAccountMutationAccess(locals, admin, targetUserId)
  if (accessErr) return json({ error: accessErr }, { status: 403 })

  const body = (await request.json().catch(() => null)) as
    | { menu_key?: unknown; allowed?: unknown }
    | null
  const menuKey = typeof body?.menu_key === 'string' ? body.menu_key : ''
  const allowed = body?.allowed

  if (!menuKey || !findCmsMenuByKey(menuKey)) {
    return json({ error: '올바르지 않은 메뉴입니다.' }, { status: 400 })
  }
  if (typeof allowed !== 'boolean') {
    return json({ error: '올바르지 않은 요청입니다.' }, { status: 400 })
  }

  // Q6 확정: 메뉴권한은 role 허용범위를 절대 넘어설 수 없다(좁히기 전용) — 대상 계정의
  // 실제 cms_role 기준으로 이 메뉴에 애초에 접근 불가능하면 allowed=true 저장 요청 자체를
  // 거부한다. allowed=false(차단, 즉 좁히기)는 이 제약이 필요 없으므로 대상 role 조회를
  // 생략한다.
  if (allowed) {
    const targetProfile = await fetchCmsProfileByAuthId(admin, targetUserId)
    if (!roleAllowsMenuByDefault(targetProfile?.cms_role ?? '', menuKey)) {
      return json(
        { error: '이 계정의 등급으로는 접근할 수 없는 메뉴입니다.' },
        { status: 400 }
      )
    }

    // 슈퍼마스터 잠금(2026-09-15, Stephen 지시): 슈퍼마스터가 직접 이 메뉴를 OFF로
    // 전환해 둔 상태라면, 그 항목을 다시 ON으로 되돌리는 것은 슈퍼마스터 계정만 할 수
    // 있다 — 매니저가 시도하면 거부하고 클라이언트가 그대로 토스트로 보여줄 안내
    // 문구를 반환한다. "누가 껐는가"는 마지막으로 저장한 updated_by의 현재 등급으로
    // 판단한다(별도 컬럼 없이 기존 스키마만으로 판정 — 그 사람이 이후 강등/승격되면
    // 판정도 함께 달라지는 것은 의도된 동작).
    const { data: existingRows } = await admin.rpc('cms_get_menu_permissions', {
      p_user_id: targetUserId,
    })
    const existing = ((existingRows ?? []) as CmsMenuPermissionRow[]).find(
      (r) => r.menu_key === menuKey
    )
    if (existing && existing.allowed === false && existing.updated_by) {
      const lockerProfile = await fetchCmsProfileByAuthId(admin, existing.updated_by)
      if (lockerProfile?.cms_role === 'superadmin' && cmsRole !== 'superadmin') {
        return json({ error: '슈퍼마스터 권한 계정에 문의하세요.' }, { status: 403 })
      }
    }
  }

  const { error } = await admin.rpc('cms_set_menu_permission', {
    p_target_user_id: targetUserId,
    p_menu_key: menuKey,
    p_allowed: allowed,
    p_actor_id: session.user.id,
  })
  if (error) return json({ error: error.message }, { status: 500 })

  await insertCmsAdminAuditLog(admin, {
    actorId: session.user.id,
    actionType: 'menu_permission_change',
    targetUserId,
    afterValue: { menu_key: menuKey, allowed },
  })

  return json({ success: true })
}
