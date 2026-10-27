// chatInbox.ts — CMS 상단바 채팅 벨 "응대가 필요한 대화" 판정·표시 규칙 (서버·브라우저 공용 순수 함수)
// 정책(2026-10-19, Stephen 확정 A안): 응대 필요 = 마지막 메시지(관리자 전용 제외)가 고객 발신.
// 확인 필요 이벤트 카드 = 고객 행동으로 시스템이 남긴 관리자 발신 카드(서명 완료 등) 중 마지막 메시지이고 최근 24시간 이내인 것.
import { htmlToPlainText } from '$lib/utils/cannedBlocks'

/** 고객 행동으로 생성되지만 관리자 발신(sender_type='admin')으로 저장되는 카드 — 벨에서 "확인 필요"로 취급 */
export const CHAT_INBOX_EVENT_CARD_TYPES = ['contract_signed'] as const

const EVENT_CARD_LABEL: Record<string, string> = {
  contract_signed: '전자계약 서명 완료',
  cancel_request: '예약 취소 요청',
  cancel_inquiry: '예약 취소 문의',
}

/**
 * "정확한 답변을 위해 담당자가 확인 후 안내드릴게요…" 담당자 대기 안내(cannedAutoReply.ts WAIT_REPLY, sender_type='ai')의 공통 앞부분.
 * 이 안내가 마지막 메시지여도 고객은 사람의 답변을 기다리는 중이므로 응대 필요로 본다(정책 2026-10-19, Stephen).
 * 문구가 바뀌어도 WAIT_REPLY가 이 앞부분으로 시작해야 한다 — chatInbox.test.ts가 검증.
 */
export const WAIT_NOTICE_PREFIX = '정확한 답변을 위해 담당자가 확인 후 안내드릴게요'

export function isWaitNoticeMessage(m: { sender_type: string; content: string | null }): boolean {
  return m.sender_type === 'ai' && typeof m.content === 'string' && m.content.startsWith(WAIT_NOTICE_PREFIX)
}

/** 담당자 대기 안내가 이어진 고객 문의에 붙는 라벨 */
const WAIT_LABEL = '담당자 연결 대기'

/** 이벤트 카드가 벨에 머무는 최대 시간(ms) — 관리자 발신이라 "답변하면 사라짐"이 성립하지 않으므로 시간으로 제한 */
export const CHAT_INBOX_EVENT_TTL_MS = 24 * 60 * 60 * 1000

export interface ChatInboxSessionRow { id: string; user_id: string; status: string; updated_at: string; admin_id?: string | null }
export interface ChatInboxMessageRow {
  id: string
  session_id: string
  sender_type: string
  message_type: string | null
  content: string | null
  action_payload: { type?: string } | null
  admin_only: boolean | null
  created_at: string
}

export interface ChatInboxBuiltItem {
  session_id: string
  user_id: string
  message_id: string
  /** 'reply' = 고객 메시지에 응답 필요 / 'event' = 확인 필요 이벤트 카드 */
  kind: 'reply' | 'event'
  label: string | null
  preview: string
  created_at: string
}

/** 목록 한 줄에 보여줄 미리보기(줄바꿈 제거·길이 제한). 서식 HTML이 섞여 있어도 글자만 남긴다. */
export function inboxPreview(content: string | null | undefined, max = 60): string {
  const t = htmlToPlainText(content ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** 고객 첨부/카드류 메시지는 본문이 비어 있을 수 있어 종류 라벨로 대신한다 */
function fallbackPreview(m: ChatInboxMessageRow): string {
  if (m.message_type === 'image') return '사진을 보냈어요'
  if (m.message_type === 'video') return '동영상을 보냈어요'
  if (m.message_type === 'file') return '파일을 보냈어요'
  return '새 메시지'
}

/**
 * 세션·메시지 목록으로 벨에 보일 항목을 만든다(최근 활동 순).
 * messages는 created_at 내림차순이어야 한다(세션별 첫 건이 마지막 메시지).
 */
export function buildChatInboxItems(
  sessions: readonly ChatInboxSessionRow[],
  messages: readonly ChatInboxMessageRow[],
  nowMs: number,
): ChatInboxBuiltItem[] {
  const sessionById = new Map(sessions.map((s) => [s.id, s]))
  const lastBySession = new Map<string, ChatInboxMessageRow>()
  const waitAfterLast = new Set<string>() // 마지막(대기 안내 제외) 메시지 뒤에 담당자 대기 안내가 이어진 세션
  for (const m of messages) {
    if (!sessionById.has(m.session_id)) continue
    if (m.admin_only === true) continue
    if (lastBySession.has(m.session_id)) continue
    // 담당자 대기 안내는 "답변"이 아니므로 건너뛰고 그 앞 메시지를 마지막으로 본다
    if (isWaitNoticeMessage(m)) { waitAfterLast.add(m.session_id); continue }
    lastBySession.set(m.session_id, m)
  }

  const items: ChatInboxBuiltItem[] = []
  for (const [sessionId, m] of lastBySession) {
    const s = sessionById.get(sessionId)
    if (!s) continue
    const cardType = m.action_payload?.type
    if (m.sender_type === 'user') {
      const eventLabel = cardType === 'cancel_request' ? EVENT_CARD_LABEL.cancel_request
        : cardType === 'cancel_inquiry' ? EVENT_CARD_LABEL.cancel_inquiry : null
      items.push({
        session_id: sessionId,
        user_id: s.user_id,
        message_id: m.id,
        kind: 'reply',
        label: eventLabel ?? (waitAfterLast.has(sessionId) ? WAIT_LABEL : null),
        preview: inboxPreview(m.content) || fallbackPreview(m),
        created_at: m.created_at,
      })
    } else if (
      m.sender_type === 'admin' &&
      m.message_type === 'action_card' &&
      cardType &&
      (CHAT_INBOX_EVENT_CARD_TYPES as readonly string[]).includes(cardType) &&
      nowMs - new Date(m.created_at).getTime() <= CHAT_INBOX_EVENT_TTL_MS
    ) {
      items.push({
        session_id: sessionId,
        user_id: s.user_id,
        message_id: m.id,
        kind: 'event',
        label: EVENT_CARD_LABEL[cardType] ?? '확인 필요',
        preview: inboxPreview(m.content),
        created_at: m.created_at,
      })
    }
  }
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  return items
}

/** 벨 목록 시각 표시: 방금 / N분 전 / 오늘 HH:mm / M/D (KST 기준 브라우저 로컬 시각) */
export function formatInboxTime(iso: string, nowMs: number = Date.now()): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = nowMs - t
  if (diff < 60_000) return '방금'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`
  const d = new Date(t)
  const now = new Date(nowMs)
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 탭 제목 앞 "(N) " 배지 — 0이면 제거, 99 초과는 99+ */
export function withTitleBadge(title: string, count: number): string {
  const base = title.replace(/^\((?:\d+\+?)\)\s/, '')
  if (count <= 0) return base
  return `(${count > 99 ? '99+' : count}) ${base}`
}

/**
 * 자동응답(AI·빠른답변 자동매칭)이 마지막 메시지가 된 세션 중 "사람 관리자가 한 번도 응대하지 않은(admin_id 없음)" 세션의
 * 가장 최근 고객 메시지를 후보로 돌려준다. 호출 쪽에서 그 메시지가 긴급(CS_ESCALATE)으로 분류된 것만 벨에 올린다 —
 * 단순 FAQ 자동응답까지 모두 올리면 소음이 되고, 파손·분실 같은 긴급 문의가 자동응답에 가려지는 것만 막는 것이 목적(service-operations.md §13 ③④ 동일 규칙).
 */
export function findAutoRepliedCandidates(
  sessions: readonly ChatInboxSessionRow[],
  messages: readonly ChatInboxMessageRow[],
  alreadyListedSessionIds: ReadonlySet<string>,
): ChatInboxBuiltItem[] {
  const out: ChatInboxBuiltItem[] = []
  for (const s of sessions) {
    if (alreadyListedSessionIds.has(s.id) || s.admin_id) continue
    const own = messages.filter((m) => m.session_id === s.id && m.admin_only !== true && !isWaitNoticeMessage(m))
    const last = own[0] // created_at 내림차순(담당자 대기 안내는 일반 항목 경로에서 처리되므로 제외)
    if (!last || last.sender_type === 'user') continue // 마지막이 고객이면 이미 일반 항목으로 처리됨
    const lastUser = own.find((m) => m.sender_type === 'user')
    if (!lastUser) continue
    out.push({
      session_id: s.id,
      user_id: s.user_id,
      message_id: lastUser.id,
      kind: 'reply',
      label: null,
      preview: inboxPreview(lastUser.content) || '새 메시지',
      created_at: lastUser.created_at,
    })
  }
  return out
}
