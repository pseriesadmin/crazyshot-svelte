import { describe, it, expect, vi, beforeEach } from 'vitest'

/** 클라이언트 요청 헬퍼(2026-10-15): 서류 미등록(none)일 때만 서버에 한 번 요청, 실패해도 예외·토스트 없음 */
beforeEach(() => { vi.resetModules() })

describe('requestDocRegistrationIfNeeded', () => {
  it('none이면 /api/profile/doc-request를 POST로 호출한다', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const { requestDocRegistrationIfNeeded } = await import('$lib/utils/docRequestClient')
    requestDocRegistrationIfNeeded('none')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/profile/doc-request', { method: 'POST' })
  })

  it('pending·approved면 호출하지 않는다', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const { requestDocRegistrationIfNeeded } = await import('$lib/utils/docRequestClient')
    requestDocRegistrationIfNeeded('pending')
    requestDocRegistrationIfNeeded('approved')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('같은 페이지에서 연달아 불러도 한 번만 호출한다', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const { requestDocRegistrationIfNeeded } = await import('$lib/utils/docRequestClient')
    requestDocRegistrationIfNeeded('none')
    requestDocRegistrationIfNeeded('none')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('네트워크 오류가 나도 예외를 던지지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const { requestDocRegistrationIfNeeded } = await import('$lib/utils/docRequestClient')
    expect(() => requestDocRegistrationIfNeeded('none')).not.toThrow()
    await Promise.resolve()
  })
})
