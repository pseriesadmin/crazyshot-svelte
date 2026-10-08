import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { ADMIN_PUSH_EVENT_MENU_KEYS } from '$lib/server/adminPushMenuFilter'

/**
 * 관리자 푸시 이벤트 'crazychat_request'(크레이지챗 접수 알림) — Migration #666 (Stage 라이브 테스트)
 * 정상: cms_role 보유 + 설정 ON 관리자만 수신, 끄면 빠지고 켜면 돌아온다 / 막아야할것: 알 수 없는 키 수신자 0명·저장 함수가 잘못된 키 거절,
 *       상담 메뉴 권한 OFF 계정은 앱 코드 필터가 제외(매핑 존재).
 */
const isStage = PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
let toggledUserId: string | null = null

afterAll(async () => {
  if (isStage && toggledUserId) {
    await admin.rpc('update_admin_notify_setting', { p_target_user_id: toggledUserId, p_event_key: 'crazychat_request', p_enabled: true })
  }
})

describe('메뉴 권한 필터 매핑', () => {
  it('크레이지챗 접수 알림은 상담(consulting.chat) 메뉴 권한을 따른다', () => {
    expect(ADMIN_PUSH_EVENT_MENU_KEYS.crazychat_request).toBe('consulting.chat')
  })
})

describe.skipIf(!isStage)('get_admin_push_recipients — crazychat_request', () => {
  it('수신자는 전원 cms_role 보유 + 설정 ON 관리자이고 1명 이상이다(기본 ON)', async () => {
    const { data, error } = await admin.rpc('get_admin_push_recipients', { p_event_key: 'crazychat_request' })
    expect(error).toBeNull()
    const ids = (data ?? []) as string[]
    expect(ids.length).toBeGreaterThan(0)
    const { data: profiles } = await admin.from('user_profiles').select('id, cms_role, admin_notify_crazychat_request').in('id', ids)
    expect((profiles ?? []).length).toBe(ids.length)
    for (const p of (profiles ?? []) as Array<{ cms_role: string | null; admin_notify_crazychat_request: boolean }>) {
      expect(p.cms_role).not.toBeNull()
      expect(p.admin_notify_crazychat_request).toBe(true)
    }
  })

  it('기존 이벤트 키 동작은 그대로(identity_review 수신자 존재, 알 수 없는 키는 0명)', async () => {
    const ir = await admin.rpc('get_admin_push_recipients', { p_event_key: 'identity_review' })
    expect(((ir.data ?? []) as string[]).length).toBeGreaterThan(0)
    const bogus = await admin.rpc('get_admin_push_recipients', { p_event_key: 'no_such_event' })
    expect((bogus.data ?? []) as string[]).toHaveLength(0)
  })

  it('끄면 수신자에서 빠지고 켜면 돌아온다', async () => {
    const { data } = await admin.rpc('get_admin_push_recipients', { p_event_key: 'crazychat_request' })
    toggledUserId = ((data ?? []) as string[])[0]
    const off = await admin.rpc('update_admin_notify_setting', { p_target_user_id: toggledUserId, p_event_key: 'crazychat_request', p_enabled: false })
    expect((off.data as { ok: boolean }).ok).toBe(true)
    expect(((await admin.rpc('get_admin_push_recipients', { p_event_key: 'crazychat_request' })).data as string[])).not.toContain(toggledUserId)
    const on = await admin.rpc('update_admin_notify_setting', { p_target_user_id: toggledUserId, p_event_key: 'crazychat_request', p_enabled: true })
    expect((on.data as { ok: boolean }).ok).toBe(true)
    expect(((await admin.rpc('get_admin_push_recipients', { p_event_key: 'crazychat_request' })).data as string[])).toContain(toggledUserId)
  })

  it('저장 함수는 잘못된 키를 거절한다', async () => {
    const { data } = await admin.rpc('update_admin_notify_setting', { p_target_user_id: '00000000-0000-0000-0000-000000000000', p_event_key: 'bogus', p_enabled: true })
    expect(data).toMatchObject({ ok: false, error: 'invalid_event_key' })
  })
})
