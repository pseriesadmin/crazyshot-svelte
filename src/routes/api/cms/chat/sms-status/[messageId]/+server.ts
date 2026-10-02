/**
 * GET /api/cms/chat/sms-status/[messageId]
 * 관리자 상담채팅의 대여·예약 대화카드가 SMS로도 동시 발송됐는지 조회한다(2026-10-02).
 *
 * ⛔ 고객과 세션을 공유하는 chat_messages에 SMS 결과를 넣으면 고객 화면에도 노출되므로
 *    (service-operations.md §17) 카드에는 저장하지 않고, 관리자 화면에서만 이 API로 라이브 조회한다.
 *
 * 판정: 그 카드의 고객(user_id) + 카드 타입에 대응하는 notify_type 후보(smsNotifyTypesForCard)로 sms_notification_logs의 'sent' 행이
 *       카드 발송 시각 전후 5분 안에 있으면 발송 성공. 묶음 승인 카드는 대표 예약 1건으로 SMS가
 *       나가므로 reservation_id가 아니라 고객 기준으로 조회한다.
 * 접근: CMS 관리자(cms_role 보유자)만. 조회는 service_role.
 */
import { json, error } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { smsNotifyTypesForCard } from '$lib/utils/smsCardTypes'
import type { RequestHandler } from './$types'

const WINDOW_MS = 5 * 60 * 1000

export const GET: RequestHandler = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '로그인이 필요합니다.')
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) throw error(403, '접근 권한이 없습니다.')

  const messageId = params.messageId
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId)) {
    throw error(400, '유효하지 않은 메시지 ID입니다.')
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: msg } = await admin
    .from('chat_messages')
    .select('created_at, action_payload, chat_sessions!inner(user_id)')
    .eq('id', messageId)
    .maybeSingle()
  if (!msg) return json({ sent: false })

  const row = msg as {
    created_at: string
    action_payload: { type?: string } | null
    chat_sessions: { user_id: string | null } | { user_id: string | null }[] | null
  }
  const notifyTypes = smsNotifyTypesForCard(row.action_payload?.type)
  const sessionField = row.chat_sessions
  const userId = Array.isArray(sessionField) ? sessionField[0]?.user_id : sessionField?.user_id
  if (notifyTypes.length === 0 || !userId) return json({ sent: false })

  const at = new Date(row.created_at).getTime()
  const { data: logs, error: logsErr } = await admin
    .from('sms_notification_logs')
    .select('id')
    .eq('user_id', userId)
    .in('notify_type', notifyTypes)
    .eq('status', 'sent')
    .gte('created_at', new Date(at - WINDOW_MS).toISOString())
    .lte('created_at', new Date(at + WINDOW_MS).toISOString())
    .limit(1)
  if (logsErr) console.error('[sms-status] 로그 조회 실패:', logsErr.message)

  return json({ sent: (logs?.length ?? 0) > 0 })
}
