/**
 * chatPreviewConsistency.test.ts — 2026-11-27 (Stephen 지시 "일반 채팅도 목록 카드 마지막 대화와 채팅창 마지막 내용이 다른 오류 정밀 분석·해결")
 * 원인별 시험:
 *   ① 서버 목록이 메시지를 한 번에 가져와 1,000건 상한에서 잘려 오래된 세션 카드 미리보기가 비는 문제 → 세션별 마지막 메시지 전용 조회(RPC)
 *   ② 실시간 메시지가 순서 뒤바뀌어 도착하면 카드가 옛 메시지로 되돌아가는 문제
 *   ③ 채팅창을 여는 중에 도착한 메시지가 불러오기 결과에 덮여 사라지는 문제 / 다른 세션 메시지가 섞이는 문제
 *   ④ 삭제·탭 복귀·세션 갱신 때 카드 미리보기를 서버 기준으로 다시 맞추지 않는 문제
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { mergeMessagesById, shouldApplyIncomingPreview } from '$lib/utils/chatSessionSync'
import type { ChatMessage } from '$lib/types/chat'

const msg = (id: string, at: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, session_id: 's1', sender_type: 'user', content: id, message_type: 'text', action_payload: null, is_read: false, created_at: at, ...extra,
})

describe('mergeMessagesById — 불러온 메시지 + 불러오는 중 도착한 메시지', () => {
  it('MM-1: 같은 id 는 한 번만, 시간순(오래된→최신)으로 합친다', () => {
    const base = [msg('a', '2026-11-27T02:41:00Z'), msg('b', '2026-11-27T02:43:00Z')]
    const extra = [msg('c', '2026-11-27T02:53:00Z'), msg('b', '2026-11-27T02:43:00Z')]
    expect(mergeMessagesById(base, extra).map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('MM-2: 불러온 결과에 같은 id 가 있으면 불러온 쪽(서버 값)을 우선한다', () => {
    const base = [msg('a', '2026-11-27T02:41:00Z', { is_read: true })]
    const extra = [msg('a', '2026-11-27T02:41:00Z', { is_read: false })]
    expect(mergeMessagesById(base, extra)[0].is_read).toBe(true)
  })

  it('MM-3: 불러온 결과가 비어 있어도 도착한 메시지는 남는다', () => {
    expect(mergeMessagesById([], [msg('x', '2026-11-27T02:41:00Z')]).map((m) => m.id)).toEqual(['x'])
  })
})

describe('shouldApplyIncomingPreview — 순서 뒤바뀐 실시간 메시지', () => {
  it('SP-1: 카드의 마지막 시각보다 오래된 메시지는 미리보기를 덮어쓰지 않는다', () => {
    expect(shouldApplyIncomingPreview('2026-11-27T02:56:55Z', '2026-11-27T02:53:31Z')).toBe(false)
  })
  it('SP-2: 같은 시각(세션 갱신이 먼저 도착한 경우)·더 최신 메시지는 반영한다', () => {
    expect(shouldApplyIncomingPreview('2026-11-27T02:56:55Z', '2026-11-27T02:56:55Z')).toBe(true)
    expect(shouldApplyIncomingPreview('2026-11-27T02:53:31Z', '2026-11-27T02:56:55Z')).toBe(true)
  })
  it('SP-3: 카드에 시각 정보가 없으면 반영한다', () => {
    expect(shouldApplyIncomingPreview(null, '2026-11-27T02:56:55Z')).toBe(true)
    expect(shouldApplyIncomingPreview('2026-11-27T02:56:55Z', undefined)).toBe(true)
  })
})

describe('연결 확인(소스)', () => {
  const read = (p: string): string => readFileSync(p, 'utf8')

  it('CP-1: 서버 목록은 세션별 마지막 메시지 전용 조회(RPC)를 쓰고, 실패 시 기존 조회로 대체한다', () => {
    const src = read('src/routes/api/chat/sessions/+server.ts')
    expect(src).toContain("rpc('get_chat_session_last_messages'")
    expect(src).toContain(".from('chat_messages')") // 대체(폴백) 조회가 남아 있다 — DB 적용 전 배포에도 목록이 비지 않게
  })

  it('CP-2: 스토어가 순서 뒤바뀐 메시지를 건너뛴다', () => {
    expect(read('src/lib/stores/chat.svelte.ts')).toContain('shouldApplyIncomingPreview')
  })

  it('CP-3: 채팅창 불러오기가 도착한 메시지를 합치고, 불러오기 전 도착분은 따로 모은다', () => {
    const src = read('src/lib/components/chat/AdminChatPanel.svelte')
    expect(src).toContain('mergeMessagesById(')
    expect(src).toMatch(/pendingRealtime|pending:/)
  })

  it('CP-4: 삭제 이벤트·탭 복귀·세션 마지막 시각 갱신 때 목록을 서버 기준으로 다시 맞춘다', () => {
    const src = read('src/lib/components/chat/AdminChatPanel.svelte')
    expect(src).toContain('visibilitychange')
    expect(src).toContain('refetchScheduler.schedule(300)') // 삭제 이벤트·삭제 성공 시
    expect(src).toContain('session.last_message_at > prevLast') // 세션 마지막 시각이 앞선 경우
    expect(read('src/lib/services/chatService.ts')).toContain('onDeleted')
  })
})
