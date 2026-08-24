import type { PageServerLoad, Actions } from './$types'
import { fail, redirect } from '@sveltejs/kit'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

export type MarketingRule = {
  id: string
  name: string
  trigger_type: string
  trigger_meta: Record<string, unknown> | null
  action_type: string
  action_meta: Record<string, unknown> | null
  is_active: boolean
  created_at: string
}

export type MarketingRuleLog = {
  id: string
  rule_id: string | null
  user_id: string | null
  triggered_at: string
  result: Record<string, unknown> | null
}

// marketing_rules / marketing_rule_logs はdatabase.ts型定義外のテーブル
// supabase client を any キャストして直接アクセス
function db(supabase: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as unknown as any
}

export const load: PageServerLoad = async ({ parent, locals }) => {
  const { cmsRole } = await parent()
  if (!hasSettingsAccess(cmsRole ?? '')) {
    throw redirect(303, '/cms?notice=access_denied')
  }

  const client = db(locals.supabase)
  const [rulesRes, logsRes] = await Promise.all([
    client.from('marketing_rules').select('*').order('created_at', { ascending: false }),
    client.from('marketing_rule_logs').select('*').order('triggered_at', { ascending: false }).limit(50)
  ])
  return {
    rules: (rulesRes.data ?? []) as MarketingRule[],
    logs:  (logsRes.data  ?? []) as MarketingRuleLog[]
  }
}

export const actions: Actions = {
  createRule: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(403, { error: '권한 없음' })
    if (!hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음' })

    const data = await request.formData()

    let triggerMeta = null
    let actionMeta = null
    try {
      const tmRaw = data.get('trigger_meta') as string | null
      if (tmRaw) triggerMeta = JSON.parse(tmRaw)
    } catch {
      return fail(400, { error: 'trigger_meta JSON 형식이 올바르지 않습니다.' })
    }
    try {
      const amRaw = data.get('action_meta') as string | null
      if (amRaw) actionMeta = JSON.parse(amRaw)
    } catch {
      return fail(400, { error: 'action_meta JSON 형식이 올바르지 않습니다.' })
    }

    // H-01: RPC 경유(migration 331 cms_create_marketing_rule) — db()는 파일 상단 헬퍼(load()와
    // 동일하게 database.ts에 없는 테이블/RPC 타입을 우회하는 기존 관행)
    const { data: result, error } = await db(locals.supabase).rpc('cms_create_marketing_rule', {
      p_name:         data.get('name'),
      p_trigger_type: data.get('trigger_type'),
      p_trigger_meta: triggerMeta,
      p_action_type:  data.get('action_type'),
      p_action_meta:  actionMeta,
    })
    if (error) return fail(400, { error: error.message })
    const res = result as { ok: boolean; error?: string } | null
    if (!res?.ok) return fail(400, { error: res?.error ?? '생성 실패' })
    return { success: true }
  },

  // 서버측 NOT 반전(migration 331 cms_toggle_marketing_rule) — 클라이언트가 보낸 is_active를
  // 신뢰하지 않음(migration 262 cms_toggle_banner와 동일 원칙)
  toggleRule: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(403, { error: '권한 없음' })
    if (!hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음' })

    const data = await request.formData()
    const id   = data.get('id') as string
    const { data: result, error } = await db(locals.supabase).rpc('cms_toggle_marketing_rule', { p_id: id })
    if (error) return fail(400, { error: error.message })
    const res = result as { ok: boolean; error?: string } | null
    if (!res?.ok) return fail(400, { error: res?.error ?? '토글 실패' })
    return { success: true }
  },

  deleteRule: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(403, { error: '권한 없음' })
    if (!hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음' })

    const data = await request.formData()
    const { data: result, error } = await db(locals.supabase).rpc('cms_delete_marketing_rule', {
      p_id: data.get('id') as string,
    })
    if (error) return fail(400, { error: error.message })
    const res = result as { ok: boolean; error?: string } | null
    if (!res?.ok) return fail(400, { error: res?.error ?? '삭제 실패' })
    return { success: true }
  }
}
