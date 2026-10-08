// GET /api/cms/chat/agent-requests — 상담채팅 패널(AdminChatPanel) 세션 목록 위에 보여줄 "크레이지챗 접수 요청" 대기 목록.
//
// 크레이지챗(채팅 에이전트)이 고객의 예약 시간 변경·연장 요청을 접수하면 chat_agent_requests에 대기(pending)로 쌓인다.
// 이 엔드포인트는 그 대기 건을 CMS 전용 카드로 돌려준다 — chat_messages와 무관한 관리자 전용 데이터(service-operations.md §17).
// 권한: 상담 메뉴(consulting.chat) + 매니저 이상(빠른문의 리마인더 카드 pending-inquiries와 같은 기준).
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { buildRequestCards, type AgentRequestRow, type ReservationRowWithUser } from '$lib/server/crazychat/requests'
import type { RequestHandler } from './$types'

const MAX_PENDING = 30

export const GET: RequestHandler = async ({ locals }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.chat')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data, error } = await admin
    .from('chat_agent_requests')
    .select('id, created_at, user_id, session_id, message_id, kind, reservation_code')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(MAX_PENDING)
  if (error) return json({ error: error.message }, { status: 500 })

  const requests = (data ?? []) as AgentRequestRow[]
  if (requests.length === 0) return json({ requests: [] })

  const userIds = [...new Set(requests.map((r) => r.user_id))]
  const codes = [...new Set(requests.map((r) => r.reservation_code).filter((c): c is string => !!c))]

  const [profilesRes, reservationsRes] = await Promise.all([
    admin.from('user_profiles').select('id, full_name').in('id', userIds),
    codes.length > 0
      ? admin
          .from('rental_reservations')
          .select('id, user_id, reservation_code, status, start_date, end_date, return_time, payment_confirmed_at, created_at')
          .in('reservation_code', codes)
      : Promise.resolve({ data: [] as ReservationRowWithUser[] }),
  ])

  return json({
    requests: buildRequestCards(
      requests,
      (profilesRes.data ?? []) as Array<{ id: string; full_name: string | null }>,
      (reservationsRes.data ?? []) as ReservationRowWithUser[],
    ),
  })
}
