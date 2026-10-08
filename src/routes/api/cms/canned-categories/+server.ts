// /api/cms/canned-categories — 빠른답변 분류 설정(Migration #681)
//   GET    : 분류 목록(활성·비활성 모두, 채팅 '/' 드롭다운과 빠른답변 화면 공용)
//   POST   : 분류 추가           (매니저 이상, consulting.qna)
//   PATCH  : 이름·순서·노출·민감 변경 (매니저 이상, consulting.qna)
//   DELETE : 추가 분류 삭제(쓰는 빠른답변이 없을 때만) (매니저 이상, consulting.qna)
// 허용 규칙은 planCategoryChange(순수 함수)가 정하고, 이 파일은 집행만 한다.
import { requireAnyMenuAccessApi, requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { getRoleLevel, hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { insertCmsAdminAuditLog } from '$lib/server/cmsAdminAuditLog'
import { loadCannedCategories, resetSensitiveCategoryCache } from '$lib/server/cannedCategories'
import { planCategoryChange, type CategoryChange } from '$lib/constants/cannedResponseCategories'
import type { RequestHandler } from './$types'

const admin = () => createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function requireManager(locals: App.Locals): Promise<Response | null> {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한 없음 (manager 이상 필요)' }, { status: 403 })
  return null
}

export const GET: RequestHandler = async ({ locals }) => {
  const denied = await requireAnyMenuAccessApi(locals, ['consulting.chat', 'consulting.qna'])
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })
  return json({ categories: await loadCannedCategories(admin()) })
}

async function apply(change: CategoryChange, actorId: string | null = null): Promise<Response> {
  const db = admin()
  const list = await loadCannedCategories(db)
  let usage = 0
  if (change.type === 'delete') {
    const { count, error } = await db.from('canned_responses').select('id', { count: 'exact', head: true }).eq('category', change.value)
    if (error) return json({ error: '사용 현황을 확인하지 못했습니다.' }, { status: 500 })
    usage = count ?? 0
  }
  const plan = planCategoryChange(list, change, { usage })
  if (!plan.ok) return json({ error: plan.error }, { status: 400 })
  if (plan.action === 'insert') {
    const { error } = await db.from('canned_response_categories').insert(plan.row)
    if (error) return json({ error: error.code === '23505' ? '이미 있는 분류 이름입니다.' : '추가하지 못했습니다.' }, { status: error.code === '23505' ? 409 : 500 })
  } else if (plan.action === 'update') {
    const { error } = await db.from('canned_response_categories').update({ ...plan.patch, updated_at: new Date().toISOString() }).eq('value', plan.value)
    if (error) return json({ error: error.code === '23505' ? '이미 있는 분류 이름입니다.' : '수정하지 못했습니다.' }, { status: error.code === '23505' ? 409 : 500 })
  } else if (plan.action === 'reorder') {
    const now = new Date().toISOString()
    for (const r of plan.sorted) {
      const { error } = await db.from('canned_response_categories').update({ sort_order: r.sort_order, updated_at: now }).eq('value', r.value)
      if (error) return json({ error: '순서를 저장하지 못했습니다.' }, { status: 500 })
    }
  } else {
    const { error } = await db.from('canned_response_categories').delete().eq('value', plan.value)
    if (error) return json({ error: '삭제하지 못했습니다.' }, { status: 500 })
  }
  resetSensitiveCategoryCache()
  if (plan.action === 'update' && 'ai_allowed' in plan.patch) {
    const before = list.find((c) => c.value === plan.value)
    await insertCmsAdminAuditLog(db, {
      actorId, actionType: 'crazychat_setting_change', targetUserId: null,
      beforeValue: { category: plan.value, ai_allowed: before?.ai_allowed ?? false },
      afterValue: { category: plan.value, ai_allowed: plan.patch.ai_allowed ?? false },
    })
  }
  return json({ categories: await loadCannedCategories(db) })
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.qna')
  if (denied) return denied
  const forbidden = await requireManager(locals)
  if (forbidden) return forbidden
  const body = (await request.json().catch(() => null)) as { label?: unknown; human_only?: unknown } | null
  if (typeof body?.label !== 'string') return json({ error: 'label 필요' }, { status: 400 })
  return apply({ type: 'add', label: body.label, human_only: body.human_only === true })
}

export const PATCH: RequestHandler = async ({ locals, request }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.qna')
  if (denied) return denied
  const forbidden = await requireManager(locals)
  if (forbidden) return forbidden
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (b && Array.isArray(b.order) && b.order.every((v) => typeof v === 'string')) return apply({ type: 'reorder', order: b.order as string[] })
  if (!b || typeof b.value !== 'string') return json({ error: 'value 필요' }, { status: 400 })
  // AI 허용을 켜는 것은 슈퍼마스터 전용(크레이지챗 AI '켜짐'과 같은 기준). 끄는 것은 매니저도 가능(비상 정지)
  let actorId: string | null = null
  if (typeof b.ai_allowed === 'boolean') {
    const cmsRole = await getCmsRoleForAction(locals)
    if (b.ai_allowed && getRoleLevel(cmsRole ?? '') < getRoleLevel('superadmin')) return json({ error: 'AI 허용을 켜는 것은 슈퍼마스터만 할 수 있습니다.' }, { status: 403 })
    actorId = (await locals.safeGetSession()).session?.user?.id ?? null
  }
  return apply({
    type: 'update', value: b.value,
    ...(typeof b.label === 'string' ? { label: b.label } : {}),
    ...(typeof b.is_active === 'boolean' ? { is_active: b.is_active } : {}),
    ...(typeof b.human_only === 'boolean' ? { human_only: b.human_only } : {}),
    ...(typeof b.ai_allowed === 'boolean' ? { ai_allowed: b.ai_allowed } : {}),
    ...(typeof b.sort_order === 'number' ? { sort_order: b.sort_order } : {}),
  }, actorId)
}

export const DELETE: RequestHandler = async ({ locals, request }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.qna')
  if (denied) return denied
  const forbidden = await requireManager(locals)
  if (forbidden) return forbidden
  const b = (await request.json().catch(() => null)) as { value?: unknown } | null
  if (typeof b?.value !== 'string') return json({ error: 'value 필요' }, { status: 400 })
  return apply({ type: 'delete', value: b.value })
}
