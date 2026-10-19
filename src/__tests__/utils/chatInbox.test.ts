// chatInbox.test.ts — CMS 상단바 채팅 벨 판정 규칙(A안: 마지막 메시지가 고객 발신이면 응대 필요, 서명 완료 카드는 24시간 이벤트)
import { describe, it, expect } from 'vitest'
import {
  buildChatInboxItems, findAutoRepliedCandidates, isWaitNoticeMessage, WAIT_NOTICE_PREFIX, inboxPreview, formatInboxTime, withTitleBadge, CHAT_INBOX_EVENT_TTL_MS,
  type ChatInboxMessageRow, type ChatInboxSessionRow,
} from '$lib/utils/chatInbox'

const NOW = Date.parse('2026-10-19T09:00:00Z')
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString()
const sessions: ChatInboxSessionRow[] = [
  { id: 's1', user_id: 'u1', status: 'open', updated_at: iso(1) },
  { id: 's2', user_id: 'u2', status: 'open', updated_at: iso(1) },
  { id: 's3', user_id: 'u3', status: 'pending', updated_at: iso(1) },
]
function msg(over: Partial<ChatInboxMessageRow> & { id: string; session_id: string; created_at: string }): ChatInboxMessageRow {
  return { sender_type: 'user', message_type: 'text', content: '문의', action_payload: null, admin_only: false, ...over }
}

describe('buildChatInboxItems', () => {
  it('마지막 메시지가 고객 발신이면 응대 필요, 관리자가 답한 세션은 제외', () => {
    const m = [
      msg({ id: 'a2', session_id: 's1', created_at: iso(1), content: '언제 받나요?' }),
      msg({ id: 'a1', session_id: 's1', created_at: iso(10), sender_type: 'admin' }),
      msg({ id: 'b2', session_id: 's2', created_at: iso(2), sender_type: 'admin', content: '답변드립니다' }),
      msg({ id: 'b1', session_id: 's2', created_at: iso(20) }),
    ]
    const r = buildChatInboxItems(sessions, m, NOW)
    expect(r.map((i) => i.session_id)).toEqual(['s1'])
    expect(r[0]).toMatchObject({ kind: 'reply', preview: '언제 받나요?', message_id: 'a2' })
  })

  it('관리자 전용 메시지는 마지막 메시지 판정에서 제외한다', () => {
    const m = [
      msg({ id: 'x2', session_id: 's1', created_at: iso(1), sender_type: 'admin', admin_only: true, message_type: 'action_card' }),
      msg({ id: 'x1', session_id: 's1', created_at: iso(5), content: '확인 부탁' }),
    ]
    expect(buildChatInboxItems(sessions, m, NOW)[0]).toMatchObject({ message_id: 'x1', kind: 'reply' })
  })

  it('전자계약 서명 완료 카드는 24시간 이내일 때만 이벤트로 노출', () => {
    const card = (id: string, minAgo: number) => msg({
      id, session_id: 's1', created_at: iso(minAgo), sender_type: 'admin', message_type: 'action_card',
      content: '홍길동 고객님의 전자계약 서명이 완료되었습니다.', action_payload: { type: 'contract_signed' },
    })
    expect(buildChatInboxItems(sessions, [card('c1', 30)], NOW)[0]).toMatchObject({ kind: 'event', label: '전자계약 서명 완료' })
    expect(buildChatInboxItems(sessions, [card('c2', CHAT_INBOX_EVENT_TTL_MS / 60_000 + 5)], NOW)).toEqual([])
  })

  it('이벤트가 아닌 관리자 카드는 노출하지 않는다', () => {
    const m = [msg({ id: 'k1', session_id: 's1', created_at: iso(1), sender_type: 'admin', message_type: 'action_card', action_payload: { type: 'reservation_approval' } })]
    expect(buildChatInboxItems(sessions, m, NOW)).toEqual([])
  })

  it('고객 발신 취소 요청 카드에는 라벨이 붙는다', () => {
    const m = [msg({ id: 'r1', session_id: 's3', created_at: iso(1), message_type: 'action_card', content: '', action_payload: { type: 'cancel_request' } })]
    expect(buildChatInboxItems(sessions, m, NOW)[0]).toMatchObject({ kind: 'reply', label: '예약 취소 요청' })
  })

  it('본문이 없는 고객 첨부는 종류 문구, 목록에 없는 세션 메시지는 무시, 최근 순 정렬', () => {
    const m = [
      msg({ id: 'p1', session_id: 's1', created_at: iso(30), message_type: 'image', content: '' }),
      msg({ id: 'p2', session_id: 's2', created_at: iso(3) }),
      msg({ id: 'p3', session_id: 'sX', created_at: iso(1) }),
    ]
    const r = buildChatInboxItems(sessions, m, NOW)
    expect(r.map((i) => i.session_id)).toEqual(['s2', 's1'])
    expect(r[1].preview).toBe('사진을 보냈어요')
  })
})

describe('표시 헬퍼', () => {
  it('미리보기: 줄바꿈 정리·길이 제한', () => {
    expect(inboxPreview('첫줄\n\n둘째줄')).toBe('첫줄 둘째줄')
    expect(inboxPreview('가'.repeat(80), 10)).toBe('가'.repeat(10) + '…')
  })
  it('시각 표시', () => {
    expect(formatInboxTime(iso(0), NOW)).toBe('방금')
    expect(formatInboxTime(iso(5), NOW)).toBe('5분 전')
    expect(formatInboxTime('잘못된값', NOW)).toBe('')
  })
  it('탭 제목 배지: 붙이기·갱신·제거·99+', () => {
    expect(withTitleBadge('CMS', 3)).toBe('(3) CMS')
    expect(withTitleBadge('(3) CMS', 5)).toBe('(5) CMS')
    expect(withTitleBadge('(5) CMS', 0)).toBe('CMS')
    expect(withTitleBadge('CMS', 120)).toBe('(99+) CMS')
    expect(withTitleBadge('(99+) CMS', 0)).toBe('CMS')
  })
})

describe('findAutoRepliedCandidates — 자동응답에 가려진 고객 문의', () => {
  const ss: ChatInboxSessionRow[] = [
    { id: 's1', user_id: 'u1', status: 'open', updated_at: iso(1), admin_id: null },
    { id: 's2', user_id: 'u2', status: 'open', updated_at: iso(1), admin_id: 'adm1' },
    { id: 's3', user_id: 'u3', status: 'open', updated_at: iso(1), admin_id: null },
  ]
  const ms = [
    msg({ id: 'a2', session_id: 's1', created_at: iso(1), sender_type: 'admin', content: '자동답변' }),
    msg({ id: 'a1', session_id: 's1', created_at: iso(2), content: '카메라가 파손됐어요' }),
    msg({ id: 'b2', session_id: 's2', created_at: iso(1), sender_type: 'admin' }),
    msg({ id: 'b1', session_id: 's2', created_at: iso(2) }),
    msg({ id: 'c1', session_id: 's3', created_at: iso(1) }),
  ]
  it('사람이 응대한 적 없는 세션의 마지막 고객 메시지만 후보', () => {
    const r = findAutoRepliedCandidates(ss, ms, new Set(['s3']))
    expect(r.map((i) => i.message_id)).toEqual(['a1'])
    expect(r[0].preview).toBe('카메라가 파손됐어요')
  })
  it('이미 목록에 있는 세션은 제외', () => {
    expect(findAutoRepliedCandidates(ss, ms, new Set(['s1', 's3']))).toEqual([])
  })
})

describe('담당자 연결 대기 안내(WAIT_REPLY)', () => {
  const wait = '정확한 답변을 위해 담당자가 확인 후 안내드릴게요. 잠시만 기다려 주세요. 영업 시간 외인 경우 지연될 수 있습니다.'
  it('서버의 WAIT_REPLY가 공통 앞부분으로 시작한다(문구가 바뀌면 알림 판정이 깨지지 않게 감시)', async () => {
    const { WAIT_REPLY } = await import('$lib/server/cannedAutoReply')
    expect(WAIT_REPLY.startsWith(WAIT_NOTICE_PREFIX)).toBe(true)
    expect(isWaitNoticeMessage({ sender_type: 'ai', content: WAIT_REPLY })).toBe(true)
    expect(isWaitNoticeMessage({ sender_type: 'admin', content: WAIT_REPLY })).toBe(false)
  })
  it('대기 안내가 마지막이어도 직전 고객 문의가 응대 필요로 남고 라벨이 붙는다', () => {
    const m = [
      msg({ id: 'w2', session_id: 's1', created_at: iso(1), sender_type: 'ai', content: wait }),
      msg({ id: 'w1', session_id: 's1', created_at: iso(2), content: '견적 알려주세요' }),
    ]
    const r = buildChatInboxItems(sessions, m, NOW)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ message_id: 'w1', kind: 'reply', label: '담당자 연결 대기', preview: '견적 알려주세요' })
  })
  it('대기 안내 뒤에 관리자가 답하면 사라진다', () => {
    const m = [
      msg({ id: 'w3', session_id: 's1', created_at: iso(1), sender_type: 'admin', content: '확인했습니다' }),
      msg({ id: 'w2', session_id: 's1', created_at: iso(2), sender_type: 'ai', content: wait }),
      msg({ id: 'w1', session_id: 's1', created_at: iso(3), content: '견적 알려주세요' }),
    ]
    expect(buildChatInboxItems(sessions, m, NOW)).toEqual([])
  })
  it('일반 AI 답변(대기 안내 아님)은 기존처럼 응대 완료로 본다', () => {
    const m = [
      msg({ id: 'a2', session_id: 's1', created_at: iso(1), sender_type: 'ai', content: '운영시간은 9시부터입니다' }),
      msg({ id: 'a1', session_id: 's1', created_at: iso(2), content: '운영시간?' }),
    ]
    expect(buildChatInboxItems(sessions, m, NOW)).toEqual([])
  })
})
