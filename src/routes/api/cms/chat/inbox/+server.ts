// GET /api/cms/chat/inbox — CMS 상단바 채팅 벨(어느 메뉴 화면에서나 보는 "응대가 필요한 대화" 목록·개수).
// 정책(2026-10-19, Stephen 확정 A안 — DB 변경 없음):
//   · 응대 필요 = 종료되지 않은 세션의 "마지막 메시지(관리자 전용 메시지 제외)"가 고객 발신(sender_type='user')인 대화
//   · 자동응답(AI·빠른답변)이 마지막 메시지여도, 사람 관리자가 한 번도 응대하지 않은(admin_id 없음) 세션의 마지막 고객 메시지가 긴급(CS_ESCALATE)이면 유지
//   · 확인 필요 이벤트 카드 = 고객 행동으로 시스템이 관리자 쪽에 남긴 카드(전자계약 서명 완료 등) — 마지막 메시지이고 최근 24시간 이내일 때만
//     (관리자 발신 카드라 "응답 대기"가 아니므로 브라우저(localStorage)에서 확인 처리해 숨길 수 있다)
//   · 읽음 기록 컬럼이 없으므로 "관리자가 답하면 사라지는" 방식 — 개수는 전체, 목록은 최근 순 최대 10건
// 세션 목록 API(/api/chat/sessions)는 자동 대기전환 등 부수 효과가 있고 무거워 재사용하지 않고, 읽기 전용으로 별도 구성했다.
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { CHAT_INBOX_EVENT_CARD_TYPES, buildChatInboxItems, findAutoRepliedCandidates, type ChatInboxMessageRow, type ChatInboxSessionRow } from '$lib/utils/chatInbox'
import type { RequestHandler } from './$types'

const LOOKBACK_DAYS = 14
const SESSION_LIMIT = 150
const MESSAGE_LIMIT = 1500
const LIST_MAX = 10

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EXCLUDE_MAX = 100

export const GET: RequestHandler = async ({ locals, url }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.chat')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })

  // 이 브라우저에서 "확인" 처리한 이벤트 카드 메시지 id(쉼표 구분) — 이벤트 카드에만 적용(응답 대기 건은 관리자가 답해야 사라진다)
  const exclude = new Set(
    (url.searchParams.get('exclude') ?? '').split(',').map((v) => v.trim()).filter((v) => UUID_RE.test(v)).slice(0, EXCLUDE_MAX),
  )

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()

  const { data: sessionRows, error: sErr } = await admin
    .from('chat_sessions')
    .select('id, user_id, status, updated_at, admin_id')
    .neq('status', 'closed')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(SESSION_LIMIT)
  if (sErr) return json({ error: sErr.message }, { status: 500 })

  const sessions = (sessionRows ?? []) as ChatInboxSessionRow[]
  if (sessions.length === 0) return json({ count: 0, items: [] })

  const { data: msgRows, error: mErr } = await admin
    .from('chat_messages')
    .select('id, session_id, sender_type, message_type, content, action_payload, admin_only, created_at')
    .in('session_id', sessions.map((s) => s.id))
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MESSAGE_LIMIT)
  if (mErr) return json({ error: mErr.message }, { status: 500 })

  // 세션별 "마지막 메시지"만 추린다(관리자 전용 메시지는 고객 대화 흐름이 아니므로 제외 — 단 확인 필요 이벤트 카드 판정은 별도)
  const messagesDesc = (msgRows ?? []) as ChatInboxMessageRow[]
  const base = buildChatInboxItems(sessions, messagesDesc, Date.now())
    .filter((i) => !(i.kind === 'event' && exclude.has(i.message_id)))

  // 자동응답에 가려진 긴급 문의 — 사람 관리자가 한 번도 응대하지 않은 세션의 마지막 고객 메시지가 CS_ESCALATE이면 유지
  const candidates = findAutoRepliedCandidates(sessions, messagesDesc, new Set(base.map((i) => i.session_id)))
  const candidateIds = candidates.map((c) => c.message_id)
  const escalatedCandidateIds = new Set<string>()
  if (candidateIds.length > 0) {
    const { data: candLogs } = await admin
      .from('chat_intent_logs')
      .select('message_id')
      .in('message_id', candidateIds)
      .eq('intent', 'CS_ESCALATE')
    for (const l of (candLogs ?? []) as Array<{ message_id: string }>) escalatedCandidateIds.add(l.message_id)
  }
  const built = [...base, ...candidates.filter((c) => escalatedCandidateIds.has(c.message_id))]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  const top = built.slice(0, LIST_MAX)

  // 고객 이름·아이디(표시용) — 목록에 오른 세션만 조회
  const userIds = [...new Set(top.map((i) => i.user_id))]
  const nameMap: Record<string, { name: string; handle: string }> = {}
  if (userIds.length > 0) {
    const { data: profiles } = await admin.from('user_profiles').select('id, full_name, email').in('id', userIds)
    for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
      nameMap[p.id] = { name: p.full_name ?? '', handle: p.email ? `@${p.email.split('@')[0]}` : '' }
    }
  }

  // 긴급 배지 — 목록의 고객 발신 건 중 마지막 고객 메시지가 CS_ESCALATE로 분류된 것(기존 긴급 배지 규칙과 동일)
  const customerMsgIds = top.filter((i) => i.kind === 'reply' && i.message_id).map((i) => i.message_id)
  const urgentMsgIds = new Set<string>()
  if (customerMsgIds.length > 0) {
    const { data: logs } = await admin
      .from('chat_intent_logs')
      .select('message_id')
      .in('message_id', customerMsgIds)
      .eq('intent', 'CS_ESCALATE')
    for (const l of (logs ?? []) as Array<{ message_id: string }>) urgentMsgIds.add(l.message_id)
  }

  return json({
    count: built.length,
    event_card_types: CHAT_INBOX_EVENT_CARD_TYPES,
    items: top.map((i) => ({
      ...i,
      name: nameMap[i.user_id]?.name || nameMap[i.user_id]?.handle || '고객',
      handle: nameMap[i.user_id]?.handle ?? '',
      urgent: i.kind === 'reply' && urgentMsgIds.has(i.message_id),
    })),
  })
}
