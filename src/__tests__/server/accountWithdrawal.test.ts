import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * account/profile — requestWithdrawal 서버 액션 TDD 테스트
 * (2026-08-28, TASK.md "마이페이지 회원 탈퇴('탈회') 기능 신설" T3)
 *
 * 테스트 케이스:
 * ① 정상 처리 → {success:true, purge_at} 반환, RPC 올바른 인자 호출 확인
 * ② RPC가 {ok:false, error_code:'active_rental_exists'} 반환 → fail(400) 전파
 * ③ 세션 없음 → fail(401), RPC 미호출
 */

vi.mock('@sveltejs/kit', () => ({
  fail: (status: number, data?: Record<string, unknown>) => ({ status, data }),
  redirect: (status: number, location: string) => {
    throw Object.assign(new Error(`Redirect ${status}`), { status, location })
  },
}))

vi.mock('$lib/utils/rpc', () => ({
  callTypedRpc: vi.fn().mockImplementation(
    (
      supabase: { rpc: (name: string, args?: unknown) => Promise<unknown> },
      name: string,
      args?: unknown,
    ) => supabase.rpc(name, args),
  ),
}))

vi.mock('$lib/server/account/loadUserCoupons', () => ({
  loadUserCoupons: vi.fn().mockResolvedValue([]),
}))

// 동적 import (vi.mock 호이스팅 이후 실행)
const { actions } = await import('../../routes/account/profile/+page.server')

type ActionMap = Record<string, (e: unknown) => Promise<unknown>>

// FormData 헬퍼 — 다중값(getAll) 지원
function makeRequest(fields: Record<string, string | string[]> = {}): Request {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) {
      for (const item of v) fd.append(k, item)
    } else {
      fd.append(k, v)
    }
  }
  return { formData: async () => fd } as unknown as Request
}

// locals 스텁 — safeGetSession + supabase.rpc mock
function makeLocals(
  sessionUser: { id: string } | null,
  rpcResult: { data: unknown; error: unknown } | null,
) {
  return {
    safeGetSession: vi.fn().mockResolvedValue({
      session: sessionUser ? { user: sessionUser } : null,
    }),
    supabase: {
      rpc: vi.fn().mockResolvedValue(rpcResult ?? { data: null, error: null }),
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    },
  }
}

describe('requestWithdrawal — account/profile 서버 액션', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('① 정상 처리: RPC {ok:true, purge_at} → {success:true, purge_at} 반환 + 올바른 RPC 인자 확인', async () => {
    const purge_at = '2026-09-28T00:00:00.000Z'
    const locals = makeLocals(
      { id: 'user-123' },
      { data: { ok: true, purge_at }, error: null },
    )

    const result = await (actions as ActionMap).requestWithdrawal({
      request: makeRequest({
        reasons: ['서비스 불만', '사용 빈도 낮음'],
        reasonEtc: '기타 이유',
      }),
      locals,
    })

    expect(result).toEqual({ success: true, purge_at })
    expect(locals.supabase.rpc).toHaveBeenCalledWith('request_account_withdrawal', {
      p_reasons: ['서비스 불만', '사용 빈도 낮음'],
      p_reason_etc: '기타 이유',
    })
  })

  it('② RPC {ok:false, error_code:active_rental_exists} 반환 → fail(400) 에러 전파', async () => {
    const locals = makeLocals(
      { id: 'user-123' },
      {
        data: {
          ok: false,
          error: '진행 중인 대여가 있어 탈회할 수 없습니다.',
          error_code: 'active_rental_exists',
        },
        error: null,
      },
    )

    const result = await (actions as ActionMap).requestWithdrawal({
      request: makeRequest({ reasons: ['기타'] }),
      locals,
    })

    expect(result).toMatchObject({
      status: 400,
      data: {
        error: '진행 중인 대여가 있어 탈회할 수 없습니다.',
        error_code: 'active_rental_exists',
      },
    })
    expect(locals.supabase.rpc).toHaveBeenCalledOnce()
  })

  it('③ 세션 없음 → fail(401) 반환, RPC 호출 없음', async () => {
    const locals = makeLocals(null, null)

    const result = await (actions as ActionMap).requestWithdrawal({
      request: makeRequest({ reasons: ['이탈'] }),
      locals,
    })

    expect(result).toMatchObject({ status: 401 })
    expect(locals.supabase.rpc).not.toHaveBeenCalled()
  })
})
