import type { PageServerLoad, Actions } from './$types'
import { fail } from '@sveltejs/kit'
import type { SupabaseClient } from '@supabase/supabase-js'

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

export const load: PageServerLoad = async ({ locals }) => {
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
    const data = await request.formData()
    const client = db(locals.supabase)

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

    const { error } = await client.from('marketing_rules').insert({
      name:         data.get('name'),
      trigger_type: data.get('trigger_type'),
      trigger_meta: triggerMeta,
      action_type:  data.get('action_type'),
      action_meta:  actionMeta,
      is_active:    true
    })
    if (error) return fail(400, { error: error.message })
    return { success: true }
  },

  toggleRule: async ({ request, locals }) => {
    const data      = await request.formData()
    const id        = data.get('id') as string
    const is_active = data.get('is_active') === 'true'
    const client    = db(locals.supabase)
    const { error } = await client.from('marketing_rules').update({ is_active: !is_active }).eq('id', id)
    if (error) return fail(400, { error: error.message })
    return { success: true }
  },

  deleteRule: async ({ request, locals }) => {
    const data   = await request.formData()
    const client = db(locals.supabase)
    const { error } = await client.from('marketing_rules').delete().eq('id', data.get('id') as string)
    if (error) return fail(400, { error: error.message })
    return { success: true }
  }
}
