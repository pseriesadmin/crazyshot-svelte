import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * behaviorTracker.trackEvent — 네트워크 왕복(getUser) 제거 + 실패 격리 (2026-10-03)
 * 완료기준: ① 로컬 세션(getSession)만 사용하고 getUser는 호출하지 않는다 ② RPC 에러·예외가 호출부로 전파되지 않는다
 *          ③ 로그인 세션이 없으면 p_user_id=null로 기록한다
 */
const getUser = vi.fn()
const getSession = vi.fn()
const rpc = vi.fn()

vi.mock('$app/environment', () => ({ browser: true }))
vi.mock('$lib/services/supabase', () => ({
  supabase: { auth: { getUser, getSession }, rpc, },
}))

vi.stubGlobal('sessionStorage', { getItem: () => 'sess-1', setItem: () => {} })
vi.stubGlobal('window', { innerWidth: 1280, location: { pathname: '/products' } })
vi.stubGlobal('document', { referrer: '' })

const { trackEvent } = await import('../../lib/analytics/behaviorTracker')

describe('trackEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockImplementation(() => rpc)
    ;(rpc as unknown as { bind: () => typeof rpc }).bind = () => rpc
  })

  it('getSession의 user.id로 RPC를 호출하고 getUser는 호출하지 않는다', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u-1' } } } })
    rpc.mockResolvedValue({ error: null })
    await trackEvent('pageview')
    expect(getUser).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('track_behavior_event', expect.objectContaining({ p_user_id: 'u-1', p_event_type: 'pageview' }))
  })

  it('세션이 없으면 p_user_id=null', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    rpc.mockResolvedValue({ error: null })
    await trackEvent('click')
    expect(rpc).toHaveBeenCalledWith('track_behavior_event', expect.objectContaining({ p_user_id: null }))
  })

  it('RPC가 error를 반환해도 throw하지 않고 경고만 남긴다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getSession.mockResolvedValue({ data: { session: null } })
    rpc.mockResolvedValue({ error: { message: 'boom' } })
    await expect(trackEvent('click')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('getSession·RPC가 예외를 던져도 호출부로 전파하지 않는다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getSession.mockRejectedValue(new Error('network'))
    await expect(trackEvent('search')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
