import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { requireAccountMutationAccess } from '$lib/server/requireTrueSuperadmin'
import { insertCmsAdminAuditLog } from '$lib/server/cmsAdminAuditLog'
import { clearNotifyMessageCache, readMessageFromExtraConfig } from '$lib/server/notifyMessages'
import { validateNotifyMessage, NOTIFY_SPECS, NOTIFY_VARIABLES } from '$lib/utils/notifyTemplate'
import { LIFECYCLE_SMS_COPY } from '$lib/server/sms'
import { getLockerEntrancePassword, LOCKER_ENTRANCE_KEY } from '$lib/server/lockerEntrance'
import { isValidLockerPassword } from '$lib/utils/lockerFields'
import { CONSULT_HOURS_KEY, getConsultHours } from '$lib/server/consultHours'
import { validateConsultHours } from '$lib/utils/consultHours'
import { getLockerGuideTimer } from '$lib/server/lockerGuideTimer'
import { getReturnRegisterTimer } from '$lib/server/returnRegisterTimer'
import { RETURN_SUBMIT_LINK_TYPES, returnSubmitPath } from '$lib/utils/returnNotice'
import { RETURN_REGISTER_TIMER_KEY, isReturnRegisterLeg, parseReturnRegisterTime, type ReturnRegisterTimer } from '$lib/utils/returnRegisterTimer'
import { LOCKER_TIMER_KEY, parseTimerValue, type LockerGuideTimer, type LockerTimerLeg } from '$lib/utils/lockerGuideTimer'

// 상담 응대시간 행이 알림 목록 안에서 놓이는 자리(2026-11-10) — 어느 알림 바로 아래인지(notify_type), ''는 맨 위. 설정이 없으면 목록 맨 아래.
const CONSULT_ROW_AFTER_KEY = 'push_consult_row_after'

async function getConsultRowAfter(sb: ReturnType<typeof admin>): Promise<string | null> {
  try {
    const { data } = await sb.from('cms_settings').select('value').eq('key', CONSULT_ROW_AFTER_KEY).maybeSingle()
    const after = (data as { value?: { after?: unknown } | null } | null)?.value?.after
    return typeof after === 'string' ? after : null
  } catch {
    return null
  }
}

export interface PushConfigRow {
  id: number
  category: 'customer_lifecycle' | 'customer_marketing'
  notify_type: string
  label: string
  push_enabled: boolean
  /** CMS에서 편집한 안내문장(없으면 null = 기본 문구 사용) */
  message: string | null
}

export interface AdminNotifyRow {
  id: string
  full_name: string | null
  email: string
  cms_role: string
  admin_notify_new_reservation: boolean
  admin_notify_contract_signed: boolean
  admin_notify_payment_completed: boolean
  admin_notify_new_session: boolean
  admin_notify_urgent_chat_message: boolean
  admin_notify_identity_review: boolean
  admin_notify_crazychat_request: boolean
  admin_notify_sms_undelivered: boolean
}

export interface PushLogRow {
  id: string
  user_id: string
  type: string
  title: string
  body: string
  metadata: { status?: string; reason?: string } | null
  sent_at: string
  recipient_name: string
}

const LOGS_PER_PAGE = 20
const ADMIN_EVENT_KEYS = ['new_reservation', 'contract_signed', 'payment_completed', 'new_session', 'urgent_chat_message', 'identity_review', 'crazychat_request', 'sms_undelivered'] as const

// 설정 유형 → sms.ts 문자 유형(smsTypeToConfigType의 역방향). 문자 고정 문구가 없는 유형(예: 무인보관함은 별도 조립)은 undefined.
function configTypeToSmsType(configType: string): string | undefined {
  if (configType === 'contract_sent') return 'contract_link'
  if (configType === 'contract_signed_customer') return 'contract_signed'
  return configType in LIFECYCLE_SMS_COPY ? configType : undefined
}

/**
 * 저장된 안내문장이 없을 때 "지금 실제로 발송되는 문자 문구"를 샘플값으로 렌더링해 화면에 보여주기 위한 값.
 * 발송 경로(sendLifecycleSms)와 같은 규칙: 고정 문구 + 'http'가 없으면 줄바꿈 후 링크 첨부.
 */
function buildSmsDefaultSamples(): Record<string, string> {
  const product = NOTIFY_VARIABLES['상품명'].sample
  const defaultLink = 'https://crazyshot.kr/account/rental'
  const out: Record<string, string> = {}
  for (const spec of NOTIFY_SPECS) {
    if (!spec.sms) continue
    const smsType = configTypeToSmsType(spec.notifyType)
    const fn = smsType ? LIFECYCLE_SMS_COPY[smsType] : undefined
    if (!fn) continue
    // 반납 등록요청·방식별 반납 안내는 실제로 반납 등록 화면 풀링크가 붙는다(예시 예약번호 1234)
    const link = smsType && RETURN_SUBMIT_LINK_TYPES.has(smsType) ? `https://crazyshot.kr${returnSubmitPath(1234)}` : defaultLink
    let msg = fn(product, link)
    if (!msg.includes('http')) msg = `${msg}\n${link}`
    out[spec.notifyType] = msg
  }
  return out
}

function admin() {
  return createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')
  if (!hasSettingsAccess(cmsRole)) throw redirect(303, '/cms?notice=access_denied')

  const sb = admin()

  const rawStatus = url.searchParams.get('log_status') ?? 'all'
  const logStatus = ['all', 'sent', 'skipped', 'error'].includes(rawStatus) ? rawStatus : 'all'
  const logType = url.searchParams.get('log_type') ?? 'all'
  const parsedPage = parseInt(url.searchParams.get('log_page') ?? '1', 10)
  const logPage = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1

  let logsQuery = sb
    .from('notification_logs')
    .select('id, user_id, type, title, body, metadata, sent_at', { count: 'exact' })
    .order('sent_at', { ascending: false })

  if (logStatus !== 'all') logsQuery = logsQuery.eq('metadata->>status', logStatus)
  if (logType !== 'all') logsQuery = logsQuery.eq('type', logType)

  const from = (logPage - 1) * LOGS_PER_PAGE
  logsQuery = logsQuery.range(from, from + LOGS_PER_PAGE - 1)

  const lockerEntrancePassword = await getLockerEntrancePassword(sb)
  const consultHours = await getConsultHours(sb)
  const lockerTimer = await getLockerGuideTimer(sb)
  const returnRegisterTimer = await getReturnRegisterTimer(sb)
  const consultRowAfter = await getConsultRowAfter(sb)

  // 표시 순서(Migration #797 sort_order, 관리자가 드래그로 변경) — 비어 있는 신규 유형은 맨 아래(id 순).
  // 컬럼이 아직 없는 환경(마이그레이션 미적용)에서는 조회가 실패하므로 예전 id 순 조회로 되돌린다(fail-open — 배포 순서 사고로 화면이 비는 것 방지).
  const loadConfigRows = async () => {
    const ordered = await sb
      .from('push_notification_config')
      .select('id, category, notify_type, label, push_enabled, extra_config')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('id')
    if (!ordered.error) return ordered
    return sb.from('push_notification_config').select('id, category, notify_type, label, push_enabled, extra_config').order('id')
  }

  const [configRes, adminRes, logsRes] = await Promise.all([
    loadConfigRows(),
    sb
      .from('user_profiles')
      .select('id, full_name, email, cms_role, admin_notify_new_reservation, admin_notify_contract_signed, admin_notify_payment_completed, admin_notify_new_session, admin_notify_urgent_chat_message, admin_notify_identity_review, admin_notify_crazychat_request, admin_notify_sms_undelivered')
      .not('cms_role', 'is', null)
      .order('cms_role', { ascending: false })
      .order('full_name'),
    logsQuery,
  ])

  const rawLogs = (logsRes.data ?? []) as Omit<PushLogRow, 'recipient_name'>[]
  const recipientIds = [...new Set(rawLogs.map((r) => r.user_id))]

  const { data: recipientProfiles } =
    recipientIds.length > 0
      ? await sb.from('user_profiles').select('id, full_name, email').in('id', recipientIds)
      : { data: [] as { id: string; full_name: string | null; email: string }[] }

  const nameById = new Map(
    (recipientProfiles ?? []).map((p) => [p.id, p.full_name || p.email]),
  )

  const logs: PushLogRow[] = rawLogs.map((r) => ({
    ...r,
    recipient_name: nameById.get(r.user_id) ?? '알 수 없음',
  }))

  const totalLogCount = logsRes.count ?? 0
  const totalLogPages = Math.max(1, Math.ceil(totalLogCount / LOGS_PER_PAGE))

  return {
    pushConfig: ((configRes.data ?? []) as (Omit<PushConfigRow, 'message'> & { extra_config: unknown })[]).map(
      ({ extra_config, ...row }): PushConfigRow => ({ ...row, message: readMessageFromExtraConfig(extra_config) }),
    ),
    adminList: (adminRes.data ?? []) as AdminNotifyRow[],
    lockerEntrancePassword,
    consultHours,
    lockerTimer,
    returnRegisterTimer,
    consultRowAfter,
    logs,
    smsDefaults: buildSmsDefaultSamples(),
    logPage,
    totalLogPages,
    logStatus,
    logType,
    cmsRole,
  }
}

export const actions: Actions = {
  updatePushConfig: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { message: '권한 없음' })

    const data = await request.formData()
    const notifyType = data.get('notify_type') as string
    const pushEnabled = data.get('push_enabled') === 'true'
    if (!notifyType) return fail(400, { message: 'notify_type required' })

    const { data: result, error } = await admin().rpc('update_push_notification_config', {
      p_notify_type: notifyType,
      p_push_enabled: pushEnabled,
    })
    if (error) return fail(500, { message: error.message })
    const res = result as { ok: boolean; error?: string } | null
    if (!res?.ok) return fail(400, { message: res?.error ?? '저장 실패' })
    return { ok: true, action: 'updatePushConfig' as const }
  },

  // 고객 알림 목록 순서 저장(드래그로 바꾼 순서, Migration #797) — 한 분류의 전체 유형을 화면 순서대로 받아 번호를 다시 매긴다. 발송에는 영향 없음.
  reorderPushConfig: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { message: '권한 없음' })

    const data = await request.formData()
    const category = data.get('category')
    const rawOrder = data.get('order')
    if ((category !== 'customer_lifecycle' && category !== 'customer_marketing') || typeof rawOrder !== 'string') {
      return fail(400, { message: 'invalid request' })
    }
    let order: unknown
    try {
      order = JSON.parse(rawOrder)
    } catch {
      return fail(400, { message: 'invalid request' })
    }
    if (!Array.isArray(order) || order.length === 0 || order.length > 200 || !order.every((t) => typeof t === 'string' && t.length > 0 && t.length <= 80)) {
      return fail(400, { message: 'invalid request' })
    }

    const { data: result, error } = await admin().rpc('reorder_push_notification_config', {
      p_category: category,
      p_notify_types: order as string[],
    })
    if (error) return fail(500, { message: error.message })
    const res = result as { ok: boolean; error?: string } | null
    if (!res?.ok) return fail(400, { message: res?.error ?? '순서 저장 실패' })
    return { ok: true, action: 'reorderPushConfig' as const }
  },

  // 알림별 안내문장 저장 — 빈 문장은 기본 문구 복원. 푸시·문자 양쪽에 같은 문장이 쓰인다.
  updatePushMessage: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { message: '권한 없음' })

    const data = await request.formData()
    const notifyType = data.get('notify_type')
    const rawMessage = data.get('message')
    if (typeof notifyType !== 'string' || !notifyType || typeof rawMessage !== 'string') {
      return fail(400, { message: 'invalid request' })
    }

    // 서버 재검증 — 화면 검증과 같은 함수(허용 변수·길이·문자 규격)
    const validation = validateNotifyMessage(notifyType, rawMessage)
    if (!validation.ok) return fail(400, { message: validation.error ?? '문장이 올바르지 않습니다.' })

    const sb = admin()
    const { data: before } = await sb
      .from('push_notification_config')
      .select('extra_config')
      .eq('notify_type', notifyType)
      .maybeSingle()
    const beforeMessage = readMessageFromExtraConfig((before as { extra_config?: unknown } | null)?.extra_config)

    const nextMessage = rawMessage.trim() === '' ? '' : rawMessage.replace(/\r\n/g, '\n').trim()
    const { data: result, error } = await sb.rpc('update_push_notification_message', {
      p_notify_type: notifyType,
      p_message: nextMessage,
    })
    if (error) return fail(500, { message: error.message })
    const res = result as { ok: boolean; error?: string } | null
    if (!res?.ok) return fail(400, { message: res?.error ?? '저장 실패' })

    clearNotifyMessageCache()
    await insertCmsAdminAuditLog(sb, {
      actorId: session.user.id,
      actionType: 'push_message_change',
      targetUserId: null,
      beforeValue: { notify_type: notifyType, message: beforeMessage },
      afterValue: { notify_type: notifyType, message: nextMessage || null },
    })
    return { ok: true, action: 'updatePushMessage' as const, warnings: validation.warnings }
  },

  // 무인보관함 중앙현관 비밀번호 저장(2026-10-11) — 채팅카드·문자·푸시 변수가 이 값을 읽는다. 빈 값 = 삭제(안내에서 그 줄 생략).
  updateLockerEntrance: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { message: '권한 없음' })

    const data = await request.formData()
    const raw = data.get('password')
    if (typeof raw !== 'string') return fail(400, { message: 'invalid request' })
    const password = raw.trim()
    if (password !== '' && !isValidLockerPassword(password)) return fail(400, { message: '중앙현관 비밀번호는 4~10자의 숫자·특수문자만 입력할 수 있습니다.' })

    const sb = admin()
    const before = await getLockerEntrancePassword(sb)
    if (password === '') {
      const { error } = await sb.from('cms_settings').delete().eq('key', LOCKER_ENTRANCE_KEY)
      if (error) return fail(500, { message: error.message })
    } else {
      const { error } = await sb.from('cms_settings').upsert({ key: LOCKER_ENTRANCE_KEY, value: { password }, updated_at: new Date().toISOString() })
      if (error) return fail(500, { message: error.message })
    }
    // 비밀번호 값은 감사로그에 남기지 않는다(변경 여부만)
    await insertCmsAdminAuditLog(sb, {
      actorId: session.user.id,
      actionType: 'push_message_change',
      targetUserId: null,
      beforeValue: { setting: LOCKER_ENTRANCE_KEY, set: before !== null },
      afterValue: { setting: LOCKER_ENTRANCE_KEY, set: password !== '' },
    })
    return { ok: true, action: 'updateLockerEntrance' as const }
  },

  // 상담 응대시간 안내 저장(2026-11-10) — 채팅창 노출 문구 + 자동 노출 시간대(KST). 문구를 비워 저장하면 설정 삭제(노출 없음).
  updateConsultHours: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { message: '권한 없음' })

    const data = await request.formData()
    const message = data.get('message')
    const start = data.get('start')
    const end = data.get('end')
    if (typeof message !== 'string') return fail(400, { message: 'invalid request' })

    const sb = admin()
    const before = await getConsultHours(sb)

    if (message.trim() === '') {
      const { error } = await sb.from('cms_settings').delete().eq('key', CONSULT_HOURS_KEY)
      if (error) return fail(500, { message: error.message })
      await insertCmsAdminAuditLog(sb, {
        actorId: session.user.id,
        actionType: 'push_message_change',
        targetUserId: null,
        beforeValue: { setting: CONSULT_HOURS_KEY, value: before },
        afterValue: { setting: CONSULT_HOURS_KEY, value: null },
      })
      return { ok: true, action: 'updateConsultHours' as const, cleared: true }
    }

    // 서버 재검증 — 화면 검증과 같은 함수
    const v = validateConsultHours({ message, start, end })
    if (!v.ok) return fail(400, { message: v.error })

    const { error } = await sb.from('cms_settings').upsert({ key: CONSULT_HOURS_KEY, value: v.value, updated_at: new Date().toISOString() })
    if (error) return fail(500, { message: error.message })
    await insertCmsAdminAuditLog(sb, {
      actorId: session.user.id,
      actionType: 'push_message_change',
      targetUserId: null,
      beforeValue: { setting: CONSULT_HOURS_KEY, value: before },
      afterValue: { setting: CONSULT_HOURS_KEY, value: v.value },
    })
    return { ok: true, action: 'updateConsultHours' as const, cleared: false }
  },

  // 무인보관함 안내 추가 자동 발송 시간 저장(2026-11-13) — 수령 전날(pickupPrev)/수령일 당일(pickup)/반납일 당일(return) 구간별 1~24시(KST). 시각을 비워 저장하면 그 구간의 추가 발송을 끈다.
  updateLockerTimer: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { message: '권한 없음' })

    const data = await request.formData()
    const leg = data.get('leg')
    if (leg !== 'pickupPrev' && leg !== 'pickup' && leg !== 'return') return fail(400, { message: 'invalid request' })
    const time = parseTimerValue(data.get('time'))
    if (time === undefined) return fail(400, { message: '시각을 01:00 ~ 24:00 사이(10분 단위)에서 선택해 주세요.' })

    const sb = admin()
    const before = await getLockerGuideTimer(sb)
    const after: LockerGuideTimer = { ...before, [leg as LockerTimerLeg]: time }

    if (after.pickupPrev === null && after.pickup === null && after.return === null) {
      const { error } = await sb.from('cms_settings').delete().eq('key', LOCKER_TIMER_KEY)
      if (error) return fail(500, { message: error.message })
    } else {
      const { error } = await sb.from('cms_settings').upsert({ key: LOCKER_TIMER_KEY, value: after, updated_at: new Date().toISOString() })
      if (error) return fail(500, { message: error.message })
    }
    await insertCmsAdminAuditLog(sb, {
      actorId: session.user.id,
      actionType: 'push_message_change',
      targetUserId: null,
      beforeValue: { setting: LOCKER_TIMER_KEY, value: before },
      afterValue: { setting: LOCKER_TIMER_KEY, value: after },
    })
    return { ok: true, action: 'updateLockerTimer' as const, cleared: time === null }
  },

  // 반납정보 등록요청 발송 시간 저장(2026-11-13, Migration #825) — 방문(visit)·퀵(quick)·무인함(locker) 구간별 '반납일 당일 HH:MM'(01:00~24:00, 10분 단위). 비워 저장하면 그 구간은 보내지 않는다.
  updateReturnRegisterTimer: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { message: '권한 없음' })

    const data = await request.formData()
    const leg = data.get('leg')
    if (!isReturnRegisterLeg(leg)) return fail(400, { message: 'invalid request' })
    const time = parseReturnRegisterTime(data.get('time'))
    if (time === undefined) return fail(400, { message: '시각을 01:00 ~ 24:00 사이(10분 단위)에서 선택해 주세요.' })

    const sb = admin()
    const before = await getReturnRegisterTimer(sb)
    const after: ReturnRegisterTimer = { ...before, [leg]: time }

    if (after.visit === null && after.quick === null && after.locker === null) {
      const { error } = await sb.from('cms_settings').delete().eq('key', RETURN_REGISTER_TIMER_KEY)
      if (error) return fail(500, { message: error.message })
    } else {
      const { error } = await sb.from('cms_settings').upsert({ key: RETURN_REGISTER_TIMER_KEY, value: after, updated_at: new Date().toISOString() })
      if (error) return fail(500, { message: error.message })
    }
    await insertCmsAdminAuditLog(sb, {
      actorId: session.user.id,
      actionType: 'push_message_change',
      targetUserId: null,
      beforeValue: { setting: RETURN_REGISTER_TIMER_KEY, value: before },
      afterValue: { setting: RETURN_REGISTER_TIMER_KEY, value: after },
    })
    return { ok: true, action: 'updateReturnRegisterTimer' as const, cleared: time === null }
  },

  // 상담 응대시간 행의 목록 내 위치 저장(드래그 결과) — 표시 위치만 바꾼다
  updateConsultRowAfter: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { message: '권한 없음' })

    const after = (await request.formData()).get('after')
    if (typeof after !== 'string' || after.length > 80) return fail(400, { message: 'invalid request' })

    const { error } = await admin().from('cms_settings').upsert({ key: CONSULT_ROW_AFTER_KEY, value: { after }, updated_at: new Date().toISOString() })
    if (error) return fail(500, { message: error.message })
    return { ok: true, action: 'updateConsultRowAfter' as const }
  },

  updateAdminNotify: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { message: '권한 없음' })

    const data = await request.formData()
    const targetUserId = data.get('target_user_id') as string
    const eventKey = data.get('event_key') as string
    const enabled = data.get('enabled') === 'true'

    if (!targetUserId || !(ADMIN_EVENT_KEYS as readonly string[]).includes(eventKey)) {
      return fail(400, { message: 'invalid request' })
    }

    // 대상 계정이 superadmin이면 호출자도 실제 superadmin이어야 통과 — 계정관리의 다른 액션·
    // 메뉴권한 API와 동일한 게이트(manager가 마스터의 알림 수신 설정을 바꾸지 못하도록).
    const accessErr = await requireAccountMutationAccess(locals, admin(), targetUserId)
    if (accessErr) return fail(403, { message: accessErr })

    const { data: result, error } = await admin().rpc('update_admin_notify_setting', {
      p_target_user_id: targetUserId,
      p_event_key: eventKey,
      p_enabled: enabled,
    })
    if (error) return fail(500, { message: error.message })
    const res = result as { ok: boolean; error?: string } | null
    if (!res?.ok) return fail(400, { message: res?.error ?? '저장 실패' })
    return { ok: true, action: 'updateAdminNotify' as const }
  },
}
