// guestChatMerge.test.ts — 로그인 직전 비회원 토큰 판별 + 통합 요청(실패해도 던지지 않음)
import { describe, it, expect, vi } from 'vitest'
import { pickGuestToken, requestGuestChatMerge } from '$lib/utils/guestChatMerge'

describe('pickGuestToken', () => {
  it('익명 세션이면 토큰을 돌려준다', () => {
    expect(pickGuestToken({ access_token: 'tok', user: { is_anonymous: true } })).toBe('tok')
  })
  it('회원 세션·세션 없음·토큰 없음은 null', () => {
    expect(pickGuestToken({ access_token: 'tok', user: { is_anonymous: false } })).toBeNull()
    expect(pickGuestToken({ access_token: 'tok', user: {} })).toBeNull()
    expect(pickGuestToken(null)).toBeNull()
    expect(pickGuestToken({ access_token: '', user: { is_anonymous: true } })).toBeNull()
  })
})

describe('requestGuestChatMerge', () => {
  const resp = (ok: boolean, body: unknown) => ({ ok, json: async () => body }) as unknown as Response
  it('통합된 세션이 있으면 true, 토큰을 본문으로 보낸다', async () => {
    const f = vi.fn().mockResolvedValue(resp(true, { ok: true, sessions: 1, messages: 3 }))
    expect(await requestGuestChatMerge('tok', f as unknown as typeof fetch)).toBe(true)
    expect(f).toHaveBeenCalledWith('/api/auth/merge-guest-chat', expect.objectContaining({ method: 'POST', body: JSON.stringify({ guest_access_token: 'tok' }) }))
  })
  it('통합할 대화가 없으면 false', async () => {
    const f = vi.fn().mockResolvedValue(resp(true, { ok: true, sessions: 0, messages: 0 }))
    expect(await requestGuestChatMerge('tok', f as unknown as typeof fetch)).toBe(false)
  })
  it('서버 오류·네트워크 오류도 던지지 않고 false', async () => {
    expect(await requestGuestChatMerge('tok', vi.fn().mockResolvedValue(resp(false, {})) as unknown as typeof fetch)).toBe(false)
    expect(await requestGuestChatMerge('tok', vi.fn().mockRejectedValue(new Error('net')) as unknown as typeof fetch)).toBe(false)
  })
})
