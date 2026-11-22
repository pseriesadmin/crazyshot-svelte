// 상담 > 채팅 목록 탭별 정렬 — '예약대여현황 탭별 정렬·필터 정리 v1'(2026-11-20) 채팅 항목. 기본/추가 구분은 문서 기재 순서.
//   진행중: 긴급 건 상단 고정 → 오래 기다린 순(기본) / 최신순
//   대기  : 대기 전환 시점 최신순(기본) / 오래된 순
//   종료  : 종료 전환 시점 최신순(추가 옵션 없음)
// 시각 기준: 진행중 = last_message_at(마지막 대화 시각), 대기 = updated_at(대기 전환 때 갱신, 새 메시지가 오면 진행중으로 바뀐다), 종료 = closed_at

export type ChatSortTab = 'open' | 'pending' | 'closed'
export type ChatSortMode = 'waiting' | 'newest' | 'oldest'

export interface ChatSortRow {
  is_urgent?: boolean
  last_message_sender?: string
  last_message_at: string | null
  updated_at: string
  closed_at: string | null
}

export const CHAT_SORT_OPTIONS: Record<ChatSortTab, { value: ChatSortMode; label: string }[]> = {
  open: [{ value: 'waiting', label: '오래 기다린 순' }, { value: 'newest', label: '최신순' }],
  pending: [{ value: 'newest', label: '최신순' }, { value: 'oldest', label: '오래된 순' }],
  closed: [{ value: 'newest', label: '최신순' }],
}

export function chatDefaultSort(tab: ChatSortTab): ChatSortMode {
  return CHAT_SORT_OPTIONS[tab][0].value
}

function lastAt(s: ChatSortRow): string {
  return s.last_message_at ?? s.updated_at
}

export function sortChatSessions<T extends ChatSortRow>(sessions: T[], tab: ChatSortTab, mode: ChatSortMode): T[] {
  const list = [...sessions]
  if (tab === 'open') {
    const urgent = (s: T) => (s.is_urgent ? 0 : 1)
    // 고객이 마지막으로 말한 채 답을 못 받은 세션만 '기다리는 중' — 그 안에서 가장 오래된 순
    const waiting = (s: T) => (s.last_message_sender === 'user' ? 0 : 1)
    return list.sort((a, b) => {
      const u = urgent(a) - urgent(b)
      if (u) return u
      if (mode === 'waiting') {
        const w = waiting(a) - waiting(b)
        if (w) return w
        return waiting(a) === 0 ? lastAt(a).localeCompare(lastAt(b)) : lastAt(b).localeCompare(lastAt(a))
      }
      return lastAt(b).localeCompare(lastAt(a))
    })
  }
  const at = (s: T) => (tab === 'closed' ? (s.closed_at ?? s.updated_at) : s.updated_at)
  return list.sort((a, b) => (mode === 'oldest' ? at(a).localeCompare(at(b)) : at(b).localeCompare(at(a))))
}
