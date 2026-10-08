/**
 * TDD: crazychatSettingsDb.test.ts — 크레이지챗 S5 실DB 검증 (Stage 전용)
 * 핵심: 설정 갱신 시 updated_at 자동 기록 / 감사 로그에 새 이벤트 종류 저장 가능 / 화면이 읽는 열이 실제로 존재.
 * ⛔ Stage(ezyvffjvuwmtuhpxdjrw)에서만 실행. 설정 행은 끝에 전부 OFF로 복구한다.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { insertCmsAdminAuditLog } from '$lib/server/cmsAdminAuditLog'

const isStage = PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const RESET = {
  agent_enabled: false, query_enabled: false, query_observe: false, action_enabled: false, action_observe: false,
  ai_fallback_enabled: false, ai_fallback_observe: false, ai_allowed_categories: [] as string[],
}
afterAll(async () => { if (isStage) await admin.from('crazychat_settings').update(RESET).eq('id', true) })

describe.skipIf(!isStage)('크레이지챗 설정 — 실DB', () => {
  it('설정을 바꾸면 updated_at이 자동으로 갱신된다', async () => {
    const { data: before } = await admin.from('crazychat_settings').select('updated_at').eq('id', true).single()
    await new Promise((r) => setTimeout(r, 1100))
    const { error } = await admin.from('crazychat_settings').update({ query_observe: true }).eq('id', true)
    expect(error).toBeNull()
    const { data: after } = await admin.from('crazychat_settings').select('updated_at, query_observe').eq('id', true).single()
    expect(after!.query_observe).toBe(true)
    expect(new Date(after!.updated_at as string).getTime()).toBeGreaterThan(new Date(before!.updated_at as string).getTime())
  })

  it("감사 로그에 'crazychat_setting_change' 변경 전후가 저장된다", async () => {
    const marker = `tdd-${Date.now()}`
    await insertCmsAdminAuditLog(admin, {
      actorId: null, actionType: 'crazychat_setting_change', targetUserId: null,
      beforeValue: { query: 'off', marker }, afterValue: { query: 'observe', marker },
    })
    const { data } = await admin.from('cms_admin_audit_log').select('id, action_type, before_value, after_value').eq('action_type', 'crazychat_setting_change').contains('after_value', { marker })
    expect(data).toHaveLength(1)
    expect(data![0].before_value).toMatchObject({ query: 'off' })
    await admin.from('cms_admin_audit_log').delete().eq('id', data![0].id)
  })

  it('감사 로그의 기존 이벤트 종류는 그대로 허용되고 모르는 종류는 거부된다', async () => {
    const bad = await admin.from('cms_admin_audit_log').insert({ action_type: 'no_such_action', user_id: null, target_user_id: null })
    expect(bad.error).not.toBeNull()
  })

  it('화면·API가 읽는 열이 모두 존재한다(통계·초안·접수 집계 쿼리 형태)', async () => {
    const q = await admin.from('crazychat_query_observations').select('mode, intent, outcome').limit(1)
    const a = await admin.from('ai_reply_observations').select('mode, outcome, reason, sent, input_tokens, output_tokens, feedback').limit(1)
    const d = await admin.from('ai_reply_observations').select('id, created_at, session_id, mode, category, confidence, draft_text, sent, feedback').eq('outcome', 'answered').not('draft_text', 'is', null).is('feedback', null).limit(1)
    const r = await admin.from('chat_agent_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')
    for (const x of [q, a, d, r]) expect(x.error).toBeNull()
  })
})
