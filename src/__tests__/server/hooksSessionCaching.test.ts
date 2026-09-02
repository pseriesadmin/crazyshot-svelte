import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * hooks.server.ts safeGetSession() 요청 스코프 캐싱 회귀테스트
 * (2026-09-02, "실서버 CMS·사용자화면 전역 심각한 로딩 지연" 원인 규명·수정 QA 권고사항)
 *
 * 배경: safeGetSession()이 요청당 캐싱 없이 getSession()+getUser()(Auth 서버 왕복,
 * 도쿄)를 매 호출마다 재실행 — 이 함수를 호출하는 지점이 전역 128개 파일에 퍼져 있어
 * 화면 1건당 최대 10회 안팎 중복 왕복이 발생하던 문제를 요청 스코프 Promise 캐싱으로 해소.
 * hooks.server.ts는 Frozen + 보안(auth) TDD 강제 도메인이라 캐싱 동작 자체를 검증한다.
 *
 * 검증 항목:
 * ① 동일 요청 내 safeGetSession() 여러 번 호출 → getSession/getUser 각 1회만 실행
 * ② getSession 실패/session=null → getUser는 호출되지 않고, 재호출도 일관되게 null
 * ③ getUser 실패 → getSession은 1회만, 재호출도 일관되게 null
 * ④ 서로 다른 요청(handle 별도 호출) 간 캐시가 공유되지 않음(요청별 격리)
 */

const getSessionMock = vi.fn()
const getUserMock = vi.fn()

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getSession: getSessionMock,
      getUser: getUserMock,
    },
  })),
}))

vi.mock('$lib/env/supabasePublic', () => ({
  requireSupabasePublicEnv: () => ({ url: 'https://example.supabase.co', anonKey: 'anon-key' }),
}))

const { handle } = await import('../../hooks.server')

type HandleFn = (input: {
  event: {
    cookies: { getAll: () => unknown[]; set: () => void }
    locals: { safeGetSession?: () => Promise<unknown> }
  }
  resolve: (event: unknown, opts?: unknown) => Promise<unknown>
}) => Promise<unknown>

const handleFn = handle as unknown as HandleFn

const SESSION = { user: { id: 'user-1' } }
const USER = { id: 'user-1' }

function makeEvent() {
  return {
    cookies: { getAll: () => [], set: () => {} },
    locals: {} as { safeGetSession?: () => Promise<unknown> },
  }
}

describe('hooks.server.ts — safeGetSession() 요청 스코프 캐싱', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('① 동일 요청 내 여러 번 호출해도 getSession/getUser는 각 1회만 실행됨', async () => {
    getSessionMock.mockResolvedValue({ data: { session: SESSION }, error: null })
    getUserMock.mockResolvedValue({ data: { user: USER }, error: null })

    const event = makeEvent()
    await (handleFn)({
      event,
      resolve: async () => {
        const r1 = await event.locals.safeGetSession!()
        const r2 = await event.locals.safeGetSession!()
        const r3 = await event.locals.safeGetSession!()
        expect(r1).toEqual({ session: SESSION, user: USER })
        expect(r2).toEqual({ session: SESSION, user: USER })
        expect(r3).toEqual({ session: SESSION, user: USER })
        return new Response('ok')
      },
    })

    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(getUserMock).toHaveBeenCalledTimes(1)
  })

  it('② getSession 실패(session=null) → getUser는 호출되지 않고 재호출도 일관되게 null', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null })

    const event = makeEvent()
    await (handleFn)({
      event,
      resolve: async () => {
        const r1 = await event.locals.safeGetSession!()
        const r2 = await event.locals.safeGetSession!()
        expect(r1).toEqual({ session: null, user: null })
        expect(r2).toEqual({ session: null, user: null })
        return new Response('ok')
      },
    })

    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(getUserMock).not.toHaveBeenCalled()
  })

  it('③ getUser 실패(JWT 재검증 실패) → getSession은 1회만, 재호출도 일관되게 null', async () => {
    getSessionMock.mockResolvedValue({ data: { session: SESSION }, error: null })
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'invalid token' } })

    const event = makeEvent()
    await (handleFn)({
      event,
      resolve: async () => {
        const r1 = await event.locals.safeGetSession!()
        const r2 = await event.locals.safeGetSession!()
        expect(r1).toEqual({ session: null, user: null })
        expect(r2).toEqual({ session: null, user: null })
        return new Response('ok')
      },
    })

    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(getUserMock).toHaveBeenCalledTimes(1)
  })

  it('④ 서로 다른 요청(handle 별도 호출) 간 캐시가 공유되지 않음 — 요청마다 다시 1회 호출', async () => {
    getSessionMock.mockResolvedValue({ data: { session: SESSION }, error: null })
    getUserMock.mockResolvedValue({ data: { user: USER }, error: null })

    const event1 = makeEvent()
    await (handleFn)({
      event: event1,
      resolve: async () => {
        await event1.locals.safeGetSession!()
        await event1.locals.safeGetSession!()
        return new Response('ok')
      },
    })
    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(getUserMock).toHaveBeenCalledTimes(1)

    const event2 = makeEvent()
    await (handleFn)({
      event: event2,
      resolve: async () => {
        await event2.locals.safeGetSession!()
        await event2.locals.safeGetSession!()
        return new Response('ok')
      },
    })
    // 두 번째 "요청"에서도 다시 1회씩만 — 누적(2회)이 아니라 매 요청마다 리셋됨을 확인
    expect(getSessionMock).toHaveBeenCalledTimes(2)
    expect(getUserMock).toHaveBeenCalledTimes(2)
  })

  it('⑤ 동시(parallel) 호출도 in-flight Promise를 공유해 getSession/getUser가 1회만 실행됨', async () => {
    getSessionMock.mockResolvedValue({ data: { session: SESSION }, error: null })
    getUserMock.mockResolvedValue({ data: { user: USER }, error: null })

    const event = makeEvent()
    await (handleFn)({
      event,
      resolve: async () => {
        const [r1, r2] = await Promise.all([
          event.locals.safeGetSession!(),
          event.locals.safeGetSession!(),
        ])
        expect(r1).toEqual({ session: SESSION, user: USER })
        expect(r2).toEqual({ session: SESSION, user: USER })
        return new Response('ok')
      },
    })

    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(getUserMock).toHaveBeenCalledTimes(1)
  })
})
