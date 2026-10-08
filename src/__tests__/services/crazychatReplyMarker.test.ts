import { describe, it, expect, vi } from 'vitest'
import { crazychatReplyMarker, insertAgentMessage } from '$lib/server/crazychat/shared'

vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn() }))

/** 크레이지챗 S6 — 크레이지챗 텍스트 답변에는 관리자 화면 배지용 표시값이 붙고, 카드 답변은 기존 payload 그대로 */
function fakeAdmin() {
  const inserted: Array<Record<string, unknown>> = []
  return {
    inserted,
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row)
        return { select: () => ({ single: async () => ({ data: { id: 'm1', ...row }, error: null }) }) }
      },
    }),
  }
}

describe('crazychatReplyMarker / insertAgentMessage', () => {
  it('표시값은 type=crazychat_reply와 발신 기능(source)을 담는다', () => {
    expect(crazychatReplyMarker('ai')).toEqual({ type: 'crazychat_reply', source: 'ai' })
  })
  it('텍스트 답변: message_type은 text 그대로이고 표시값이 붙는다(고객 화면은 카드로 그리지 않는다)', async () => {
    const a = fakeAdmin()
    await insertAgentMessage(a, 's1', '안내', undefined, 'query')
    expect(a.inserted[0]).toMatchObject({ sender_type: 'ai', message_type: 'text', content: '안내', action_payload: { type: 'crazychat_reply', source: 'query' } })
  })
  it('기본 source는 action', async () => {
    const a = fakeAdmin()
    await insertAgentMessage(a, 's1', '접수')
    expect(a.inserted[0].action_payload).toEqual({ type: 'crazychat_reply', source: 'action' })
  })
  it('카드 답변은 기존 카드 payload 그대로(배지 표시값으로 덮지 않는다)', async () => {
    const a = fakeAdmin()
    await insertAgentMessage(a, 's1', '서류', { type: 'identity_request', doc_type: 'identity' })
    expect(a.inserted[0]).toMatchObject({ message_type: 'action_card', action_payload: { type: 'identity_request' } })
  })
})
