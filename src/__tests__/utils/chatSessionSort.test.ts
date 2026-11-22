import { describe, it, expect } from 'vitest'
import { sortChatSessions, chatDefaultSort, CHAT_SORT_OPTIONS, type ChatSortRow } from '$lib/utils/chatSessionSort'

type Row = ChatSortRow & { id: string }
function s(id: string, p: Partial<Row> = {}): Row {
  return { id, last_message_at: '2026-11-20T01:00:00Z', updated_at: '2026-11-20T01:00:00Z', closed_at: null, last_message_sender: 'admin', ...p }
}
const ids = (rows: Row[]) => rows.map((r) => r.id)

describe('채팅 탭별 정렬 (CSV 상담 > 채팅)', () => {
  it('기본 정렬: 진행중=오래 기다린 순, 대기·종료=최신순', () => {
    expect(chatDefaultSort('open')).toBe('waiting')
    expect(chatDefaultSort('pending')).toBe('newest')
    expect(chatDefaultSort('closed')).toBe('newest')
  })
  it('종료 탭은 추가 옵션이 없다', () => {
    expect(CHAT_SORT_OPTIONS.closed).toHaveLength(1)
  })

  it('진행중: 긴급 건 상단 고정 → 고객이 마지막으로 말한 채 가장 오래 기다린 순', () => {
    const urgent = s('urgent', { is_urgent: true, last_message_sender: 'user', last_message_at: '2026-11-20T05:00:00Z' })
    const waitOld = s('waitOld', { last_message_sender: 'user', last_message_at: '2026-11-20T02:00:00Z' })
    const waitNew = s('waitNew', { last_message_sender: 'user', last_message_at: '2026-11-20T04:00:00Z' })
    const answered = s('answered', { last_message_sender: 'admin', last_message_at: '2026-11-20T03:00:00Z' })
    expect(ids(sortChatSessions([answered, waitNew, urgent, waitOld], 'open', 'waiting'))).toEqual(['urgent', 'waitOld', 'waitNew', 'answered'])
  })

  it('진행중 최신순: 긴급은 여전히 상단, 나머지는 마지막 대화 최신순', () => {
    const urgent = s('urgent', { is_urgent: true, last_message_at: '2026-11-20T01:00:00Z' })
    const a = s('a', { last_message_at: '2026-11-20T02:00:00Z' })
    const b = s('b', { last_message_at: '2026-11-20T03:00:00Z' })
    expect(ids(sortChatSessions([a, urgent, b], 'open', 'newest'))).toEqual(['urgent', 'b', 'a'])
  })

  it('대기: 대기 전환(updated_at) 최신순 / 오래된 순', () => {
    const o = s('o', { updated_at: '2026-11-19T00:00:00Z' })
    const n = s('n', { updated_at: '2026-11-20T00:00:00Z' })
    expect(ids(sortChatSessions([o, n], 'pending', 'newest'))).toEqual(['n', 'o'])
    expect(ids(sortChatSessions([n, o], 'pending', 'oldest'))).toEqual(['o', 'n'])
  })

  it('종료: closed_at 최신순(없으면 updated_at)', () => {
    const a = s('a', { closed_at: '2026-11-18T00:00:00Z' })
    const b = s('b', { closed_at: null, updated_at: '2026-11-19T00:00:00Z' })
    expect(ids(sortChatSessions([a, b], 'closed', 'newest'))).toEqual(['b', 'a'])
  })

  it('입력 배열을 바꾸지 않는다', () => {
    const rows = [s('x', { updated_at: '2026-11-01T00:00:00Z' }), s('y', { updated_at: '2026-11-02T00:00:00Z' })]
    sortChatSessions(rows, 'pending', 'newest')
    expect(ids(rows)).toEqual(['x', 'y'])
  })
})
