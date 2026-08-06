import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'

export interface PushConfigRow {
  id: number
  category: 'customer_lifecycle' | 'customer_marketing'
  notify_type: string
  label: string
  push_enabled: boolean
}

export interface AdminNotifyRow {
  id: string
  full_name: string | null
  email: string
  cms_role: string
  admin_notify_new_reservation: boolean
  admin_notify_contract_signed: boolean
  admin_notify_payment_completed: boolean
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
const ADMIN_EVENT_KEYS = ['new_reservation', 'contract_signed', 'payment_completed'] as const

function admin() {
  return createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')
  if (!hasSettingsAccess(cmsRole)) throw redirect(303, '/cms?notice=access_denied')

  const sb = admin()

  const logStatus = url.searchParams.get('log_status') ?? 'all'
  const logType = url.searchParams.get('log_type') ?? 'all'
  const logPage = Math.max(1, parseInt(url.searchParams.get('log_page') ?? '1', 10))

  let logsQuery = sb
    .from('notification_logs')
    .select('id, user_id, type, title, body, metadata, sent_at', { count: 'exact' })
    .order('sent_at', { ascending: false })

  if (logStatus !== 'all') logsQuery = logsQuery.eq('metadata->>status', logStatus)
  if (logType !== 'all') logsQuery = logsQuery.eq('type', logType)

  const from = (logPage - 1) * LOGS_PER_PAGE
  logsQuery = logsQuery.range(from, from + LOGS_PER_PAGE - 1)

  const [configRes, adminRes, logsRes] = await Promise.all([
    sb.from('push_notification_config').select('id, category, notify_type, label, push_enabled').order('id'),
    sb
      .from('user_profiles')
      .select('id, full_name, email, cms_role, admin_notify_new_reservation, admin_notify_contract_signed, admin_notify_payment_completed')
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
    pushConfig: (configRes.data ?? []) as PushConfigRow[],
    adminList: (adminRes.data ?? []) as AdminNotifyRow[],
    logs,
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
