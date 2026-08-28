import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * T4: src/routes/+layout.server.ts 자동복구 통합 지점 TDD mock 테스트
 * (2026-08-28, TASK.md "마이페이지 회원 탈퇴('탈회') 기능 신설" T4)
 *
 * plan_source: /Users/stevenmac/.claude/plans/dazzling-sauteeing-aurora.md §2-②
 *
 * 검증 항목:
 * ① 세션 없음 → from/rpc 호출 없음 (통과)
 * ② withdrawal_status='requested' → restore_withdrawn_account RPC 호출됨
 * ③ withdrawal_status='none' → RPC 호출 없음 (불필요한 DB 부하 방지)
 *
 * 설계 원칙:
 * - hooks.server.ts(핫패스)는 건드리지 않는다.
 * - 루트 레이아웃에서 하드 리다이렉트 하지 않는다(루프 위험).
 * - 최소 반환값만 사용한다(각 페이지의 +page.server.ts가 필요한 데이터를 따로 로드).
 */

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw Object.assign(new Error(`Redirect ${status}`), { status, location })
  },
}))

// 동적 import (vi.mock 호이스팅 이후 실행)
const { load } = await import('../../routes/+layout.server')

type LoadFn = (e: unknown) => Promise<Record<string, unknown>>

// locals 스텁 빌더 — withdrawal_status 세팅과 rpc mock 포함
function makeLocals(
  sessionUser: { id: string } | null,
  withdrawalStatus: string | null = null,
  rpcResult: { data: unknown; error: unknown } = { data: { ok: true, restored: true }, error: null },
) {
  const maybeSingleResult =
    withdrawalStatus !== null
      ? { data: { withdrawal_status: withdrawalStatus, withdrawal_purge_at: null }, error: null }
      : { data: null, error: null }

  const mockFrom = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(maybeSingleResult),
  })
  const mockRpc = vi.fn().mockResolvedValue(rpcResult)

  return {
    safeGetSession: vi.fn().mockResolvedValue({
      session: sessionUser ? { user: sessionUser } : null,
    }),
    supabase: {
      from: mockFrom,
      rpc: mockRpc,
    },
    _mockFrom: mockFrom,
    _mockRpc: mockRpc,
  }
}

describe('+layout.server load — 탈퇴 자동복구 통합 지점', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('① 세션 없음: user_profiles 조회도 RPC 호출도 없음', async () => {
    const locals = makeLocals(null)

    const result = await (load as LoadFn)({ locals })

    expect(result).toBeDefined()
    expect(locals._mockFrom).not.toHaveBeenCalled()
    expect(locals._mockRpc).not.toHaveBeenCalled()
  })

  it('② withdrawal_status=requested: restore_withdrawn_account RPC가 호출됨', async () => {
    const locals = makeLocals({ id: 'user-abc' }, 'requested')

    await (load as LoadFn)({ locals })

    expect(locals._mockRpc).toHaveBeenCalledWith('restore_withdrawn_account')
    expect(locals._mockRpc).toHaveBeenCalledTimes(1)
  })

  it('③ withdrawal_status=none: RPC 호출 없음 (불필요한 호출 방지)', async () => {
    const locals = makeLocals({ id: 'user-abc' }, 'none')

    await (load as LoadFn)({ locals })

    expect(locals._mockFrom).toHaveBeenCalled() // user_profiles 조회는 하지만
    expect(locals._mockRpc).not.toHaveBeenCalled() // RPC는 호출 안 함
  })
})
