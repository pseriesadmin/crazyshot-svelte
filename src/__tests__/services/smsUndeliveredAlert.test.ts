import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { ADMIN_PUSH_EVENT_MENU_KEYS } from '$lib/server/adminPushMenuFilter'

/**
 * 문자 미도착 관리자 알림(Migration #710) — 순수 판정 + Stage 라이브(수신자 조회·설정 저장·권한).
 * 정상: 수신 완료는 확인 처리, 미도착 의심(3000 30분 초과)·실패는 알림, 그 외는 대기 / 막아야할것: 알 수 없는 키 거절·클라이언트 롤의 함수 실행.
 */
const isStage = PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
let toggledUserId: string | null = null

afterAll(async () => {
  if (isStage && toggledUserId) {
    await admin.rpc('update_admin_notify_setting', { p_target_user_id: toggledUserId, p_event_key: 'sms_undelivered', p_enabled: true })
  }
})

describe('judgeLog', async () => {
  const { judgeLog, ALERT_NOTIFY_TYPES } = await import('$lib/server/smsDeliveryAlert')
  const t0 = new Date('2026-10-14T08:33:15Z')
  const at = (m: number) => new Date(t0.getTime() + m * 60000)
  it('수신 완료는 확인, 접수 30분 초과·실패 코드는 알림, 그 외는 대기', () => {
    expect(judgeLog('4000', t0, at(1))).toBe('confirm')
    expect(judgeLog('3000', t0, at(29))).toBe('wait')
    expect(judgeLog('3000', t0, at(31))).toBe('alert')
    expect(judgeLog('3013', t0, at(1))).toBe('alert')
    expect(judgeLog('2000', t0, at(120))).toBe('wait')
    expect(judgeLog(null, t0, at(120))).toBe('wait')
  })
  it('점검 대상은 계약서 안내·예약 승인으로 한정', () => {
    expect([...ALERT_NOTIFY_TYPES]).toEqual(['contract_link', 'reservation_approval'])
  })
})

describe('메뉴 권한 필터 매핑', () => {
  it('문자 미도착 알림은 예약대여현황(rental.reservation) 권한을 따른다', () => {
    expect(ADMIN_PUSH_EVENT_MENU_KEYS.sms_undelivered).toBe('rental.reservation')
  })
})

describe.skipIf(!isStage)('get_admin_push_recipients — sms_undelivered (Stage)', () => {
  it('수신자는 전원 cms_role 보유 + 설정 ON 관리자(기본 ON)', async () => {
    const { data, error } = await admin.rpc('get_admin_push_recipients', { p_event_key: 'sms_undelivered' })
    expect(error).toBeNull()
    const ids = (data ?? []) as string[]
    expect(ids.length).toBeGreaterThan(0)
    const { data: profiles } = await admin.from('user_profiles').select('id, cms_role, admin_notify_sms_undelivered').in('id', ids)
    for (const p of (profiles ?? []) as Array<{ cms_role: string | null; admin_notify_sms_undelivered: boolean }>) {
      expect(p.cms_role).not.toBeNull()
      expect(p.admin_notify_sms_undelivered).toBe(true)
    }
  })
  it('기존 이벤트 동작은 그대로(알 수 없는 키 0명), 끄면 빠지고 켜면 돌아온다', async () => {
    const bogus = await admin.rpc('get_admin_push_recipients', { p_event_key: 'no_such_event' })
    expect((bogus.data ?? []) as string[]).toHaveLength(0)
    const { data } = await admin.rpc('get_admin_push_recipients', { p_event_key: 'sms_undelivered' })
    toggledUserId = ((data ?? []) as string[])[0]
    const off = await admin.rpc('update_admin_notify_setting', { p_target_user_id: toggledUserId, p_event_key: 'sms_undelivered', p_enabled: false })
    expect((off.data as { ok?: boolean })?.ok).toBe(true)
    const after = await admin.rpc('get_admin_push_recipients', { p_event_key: 'sms_undelivered' })
    expect(((after.data ?? []) as string[]).includes(toggledUserId)).toBe(false)
    await admin.rpc('update_admin_notify_setting', { p_target_user_id: toggledUserId, p_event_key: 'sms_undelivered', p_enabled: true })
    const back = await admin.rpc('get_admin_push_recipients', { p_event_key: 'sms_undelivered' })
    expect(((back.data ?? []) as string[]).includes(toggledUserId)).toBe(true)
  })
  it('잘못된 이벤트 키는 저장 함수가 거절한다', async () => {
    const bad = await admin.rpc('update_admin_notify_setting', { p_target_user_id: '00000000-0000-0000-0000-000000000000', p_event_key: 'nope', p_enabled: true })
    expect((bad.data as { ok?: boolean; error?: string })?.error).toBe('invalid_event_key')
  })
  it('발송 로그 점검 표시 컬럼이 있고 service_role이 쓸 수 있다', async () => {
    const { error } = await admin.from('sms_notification_logs').select('id, delivery_confirmed_at, delivery_alerted_at').limit(1)
    expect(error).toBeNull()
  })
})
