// GET/PUT /api/cms/chat/crazychat/settings — 크레이지챗 스위치 조회·변경 (S5)
// 권한: 크레이지챗 메뉴(consulting.crazychat) + 매니저 이상. 마스터 ON·AI '켜짐'은 슈퍼마스터 전용(마스터 OFF는 누구나 가능 — 비상 정지).
// 변경은 항상 이 API로만 한다: updated_by를 채우고 변경 전후를 cms_admin_audit_log에 남긴다(감사 기록 실패는 변경을 되돌리지 않는다).
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json } from '@sveltejs/kit'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { insertCmsAdminAuditLog } from '$lib/server/cmsAdminAuditLog'
import { getRoleLevel, hasSettingsAccess } from '$lib/utils/cmsPermissions'
import {
  applyChange, isNoop, levelsToColumns, parseSettingsChange, requiresSuperadmin, rowToLevels,
  type SettingsRow,
} from '$lib/server/crazychat/settings-update'
import type { RequestHandler } from './$types'

const COLUMNS =
  'agent_enabled, query_enabled, query_observe, action_enabled, action_observe, recommend_enabled, recommend_observe, ai_fallback_enabled, ai_fallback_observe, ai_allowed_categories, updated_at, updated_by'

type Row = SettingsRow & { updated_at: string | null; updated_by: string | null }

async function updatedByName(admin: SupabaseClient, id: string | null): Promise<string | null> {
  if (!id) return null
  const { data } = await admin.from('user_profiles').select('full_name, email').eq('id', id).maybeSingle()
  const p = data as { full_name?: string | null; email?: string | null } | null
  return p?.full_name || p?.email || null
}

export const GET: RequestHandler = async ({ locals }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.crazychat')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin.from('crazychat_settings').select(COLUMNS).limit(1).maybeSingle()
  if (error || !data) {
    console.error('[crazychat] 설정 읽기 실패:', error?.message ?? '행 없음')
    return json({ error: '설정을 읽지 못했습니다.' }, { status: 500 })
  }
  const row = data as unknown as Row
  return json({
    settings: rowToLevels(row),
    updated_at: row.updated_at,
    updated_by_name: await updatedByName(admin, row.updated_by),
    can_enable_live: getRoleLevel(cmsRole) >= getRoleLevel('superadmin'),
  })
}

export const PUT: RequestHandler = async ({ locals, request }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.crazychat')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 401 })

  const parsed = parseSettingsChange(await request.json().catch(() => null))
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin.from('crazychat_settings').select(COLUMNS).limit(1).maybeSingle()
  if (error || !data) return json({ error: '설정을 읽지 못했습니다.' }, { status: 500 })
  const before = rowToLevels(data as unknown as Row)
  const after = applyChange(before, parsed.change)
  if (isNoop(before, after)) return json({ ok: true, unchanged: true, settings: after })

  if (requiresSuperadmin(before, after) && getRoleLevel(cmsRole) < getRoleLevel('superadmin')) {
    return json({ error: '마스터 스위치를 켜거나 AI 답변을 켜짐으로 바꾸는 것은 슈퍼마스터만 할 수 있습니다.' }, { status: 403 })
  }

  // 낙관적 잠금: 읽은 뒤 다른 관리자가 먼저 바꿨다면(updated_at이 달라짐) 옛 값을 되돌려 쓰지 않고 거절한다
  // (마스터 OFF 같은 비상 정지·권한 판정이 stale 값으로 무력화되는 것을 막는다)
  const readUpdatedAt = (data as unknown as Row).updated_at
  const { data: written, error: updateError } = await admin
    .from('crazychat_settings')
    .update({ ...levelsToColumns(after), updated_by: session.user.id })
    .eq('id', true)
    .eq('updated_at', readUpdatedAt as string)
    .select('id')
  if (updateError) return json({ error: '저장하지 못했습니다.' }, { status: 500 })
  if (!written || written.length === 0) {
    return json({ error: '다른 관리자가 먼저 설정을 바꿨습니다. 새로고침 후 다시 시도해 주세요.' }, { status: 409 })
  }

  await insertCmsAdminAuditLog(admin, {
    actorId: session.user.id,
    actionType: 'crazychat_setting_change',
    targetUserId: null,
    beforeValue: before as unknown as Record<string, unknown>,
    afterValue: after as unknown as Record<string, unknown>,
  })
  return json({ ok: true, settings: after })
}
