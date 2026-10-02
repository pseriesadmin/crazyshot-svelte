import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * 관리자 푸시 이벤트 'identity_review'(본인증명정보 승인 요청) — Migration #631 (Stage 라이브 테스트)
 *
 * 완료기준:
 *   정상동작: get_admin_push_recipients('identity_review')가 cms_role 보유 + admin_notify_identity_review=true
 *             관리자만 반환하고, update_admin_notify_setting으로 그 설정을 끄면 수신자에서 빠진다.
 *   막아야할것: 알 수 없는 이벤트 키는 여전히 수신자 0명(ELSE false), 설정 저장 함수가 잘못된 키는 거절한다.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

let toggledUserId: string | null = null
let originalValue = true

afterAll(async () => {
  if (toggledUserId) {
    await admin.rpc('update_admin_notify_setting', {
      p_target_user_id: toggledUserId, p_event_key: 'identity_review', p_enabled: originalValue,
    })
  }
})

describe('get_admin_push_recipients — identity_review', () => {
  it('수신자는 전원 cms_role 보유 + 설정 ON 관리자이고 1명 이상이다', async () => {
    const { data, error } = await admin.rpc('get_admin_push_recipients', { p_event_key: 'identity_review' })
    expect(error).toBeNull()
    const ids = (data ?? []) as string[]
    expect(ids.length).toBeGreaterThan(0)

    const { data: profiles } = await admin
      .from('user_profiles').select('id, cms_role, admin_notify_identity_review').in('id', ids)
    expect((profiles ?? []).length).toBe(ids.length)
    for (const p of (profiles ?? []) as Array<{ cms_role: string | null; admin_notify_identity_review: boolean }>) {
      expect(p.cms_role).not.toBeNull()
      expect(p.admin_notify_identity_review).toBe(true)
    }
  })

  it('알 수 없는 이벤트 키는 수신자 0명', async () => {
    const { data } = await admin.rpc('get_admin_push_recipients', { p_event_key: 'no_such_event' })
    expect((data ?? []) as string[]).toHaveLength(0)
  })

  it('update_admin_notify_setting으로 끄면 수신자에서 빠지고, 다시 켜면 돌아온다', async () => {
    const { data } = await admin.rpc('get_admin_push_recipients', { p_event_key: 'identity_review' })
    const ids = (data ?? []) as string[]
    toggledUserId = ids[0]
    originalValue = true

    const off = await admin.rpc('update_admin_notify_setting', {
      p_target_user_id: toggledUserId, p_event_key: 'identity_review', p_enabled: false,
    })
    expect((off.data as { ok: boolean }).ok).toBe(true)
    const after = await admin.rpc('get_admin_push_recipients', { p_event_key: 'identity_review' })
    expect((after.data as string[])).not.toContain(toggledUserId)

    const on = await admin.rpc('update_admin_notify_setting', {
      p_target_user_id: toggledUserId, p_event_key: 'identity_review', p_enabled: true,
    })
    expect((on.data as { ok: boolean }).ok).toBe(true)
    const back = await admin.rpc('get_admin_push_recipients', { p_event_key: 'identity_review' })
    expect((back.data as string[])).toContain(toggledUserId)
  })

  it('설정 저장 함수는 잘못된 이벤트 키를 거절한다', async () => {
    const { data } = await admin.rpc('update_admin_notify_setting', {
      p_target_user_id: '00000000-0000-0000-0000-000000000000', p_event_key: 'bogus', p_enabled: true,
    })
    expect(data).toMatchObject({ ok: false, error: 'invalid_event_key' })
  })
})
