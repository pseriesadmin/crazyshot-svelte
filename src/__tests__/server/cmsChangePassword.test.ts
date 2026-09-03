import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * CMS 관리자 "본인 비밀번호 변경"(changePassword 액션) 회귀테스트
 * (2026-09-03, Stephen "관리자 계정들의 각자 비번 수정 기능 여부 확인: 없으면 아주 간단히
 * 기존 cms 로그인 모달 내에 UI 구현" 요청으로 신설. 액션은 src/routes/cms/login/
 * +page.server.ts에 남아있고, 실제 UI는 AccountDetailPanel.svelte의 "본인 계정" 전용
 * 모달에서 action="/cms/login?/changePassword"로 크로스라우트 호출한다 — Stephen이
 * 최초 배치(로그인 페이지 전용 화면)를 반려하고 계정상세패널 모달로 재배치 지시)
 *
 * 보안(auth) 도메인 신규 로직이라 AGENTS.md TDD 강제 키워드에 해당 — 최소 회귀테스트 작성.
 * 설계: 현재 비밀번호 재인증(signInWithPassword) 성공 시에만
 * locals.supabase.auth.updateUser({password})로 실제 변경. service_role 없이 요청자 본인
 * 세션(locals.supabase)만 사용 — 그 어떤 관리자도 타인의 비밀번호를 대신 바꿀 수 없는 구조.
 *
 * 검증 항목:
 * ① 세션 없음 → fail(401), signInWithPassword/updateUser 호출 없음
 * ② 필수값 누락 → fail(400)
 * ③ 새 비밀번호/확인 불일치 → fail(400), updateUser 미호출
 * ④ 새 비밀번호 8자 미만 → fail(400), updateUser 미호출
 * ⑤ 현재 비밀번호 오류(재인증 실패) → fail(400), updateUser 미호출
 * ⑥ 정상 흐름 → signInWithPassword(재인증) 성공 후 updateUser 호출 + { success: true } 반환
 */

vi.mock('@sveltejs/kit', () => ({
  fail: (status: number, data: Record<string, unknown>) => ({ status, data }),
  redirect: (status: number, location: string) => {
    throw Object.assign(new Error(`Redirect ${status}`), { status, location })
  },
}))

const { actions } = await import('../../routes/cms/login/+page.server')

type ActionsShape = {
  changePassword: (event: unknown) => Promise<unknown>
}

function makeFormData(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

function makeEvent(
  sessionUser: { id: string; email: string } | null,
  formFields: Record<string, string>,
  opts: { signInError?: boolean; updateError?: boolean } = {},
) {
  const signInWithPassword = vi.fn().mockResolvedValue(
    opts.signInError ? { data: {}, error: { message: 'invalid credentials' } } : { data: {}, error: null },
  )
  const updateUser = vi.fn().mockResolvedValue(
    opts.updateError ? { data: {}, error: { message: 'update failed' } } : { data: {}, error: null },
  )

  return {
    request: { formData: async () => makeFormData(formFields) },
    locals: {
      safeGetSession: vi.fn().mockResolvedValue({
        session: sessionUser ? { user: sessionUser } : null,
      }),
      supabase: { auth: { signInWithPassword, updateUser } },
    },
    _signInWithPassword: signInWithPassword,
    _updateUser: updateUser,
  }
}

describe('cms/login changePassword 액션', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('① 세션 없음 → fail(401), 재인증/변경 호출 없음', async () => {
    const event = makeEvent(null, {
      currentPassword: 'old12345',
      newPassword: 'new12345',
      confirmPassword: 'new12345',
    })

    const result = (await (actions as ActionsShape).changePassword(event)) as {
      status: number
    }

    expect(result.status).toBe(401)
    expect(event._signInWithPassword).not.toHaveBeenCalled()
    expect(event._updateUser).not.toHaveBeenCalled()
  })

  it('② 필수값 누락 → fail(400)', async () => {
    const event = makeEvent({ id: 'u1', email: 'admin@crazyshot.kr' }, {
      currentPassword: '',
      newPassword: 'new12345',
      confirmPassword: 'new12345',
    })

    const result = (await (actions as ActionsShape).changePassword(event)) as {
      status: number
    }

    expect(result.status).toBe(400)
    expect(event._signInWithPassword).not.toHaveBeenCalled()
  })

  it('③ 새 비밀번호/확인 불일치 → fail(400), updateUser 미호출', async () => {
    const event = makeEvent({ id: 'u1', email: 'admin@crazyshot.kr' }, {
      currentPassword: 'old12345',
      newPassword: 'new12345',
      confirmPassword: 'different1',
    })

    const result = (await (actions as ActionsShape).changePassword(event)) as {
      status: number
    }

    expect(result.status).toBe(400)
    expect(event._updateUser).not.toHaveBeenCalled()
  })

  it('④ 새 비밀번호 8자 미만 → fail(400), updateUser 미호출', async () => {
    const event = makeEvent({ id: 'u1', email: 'admin@crazyshot.kr' }, {
      currentPassword: 'old12345',
      newPassword: 'short1',
      confirmPassword: 'short1',
    })

    const result = (await (actions as ActionsShape).changePassword(event)) as {
      status: number
    }

    expect(result.status).toBe(400)
    expect(event._updateUser).not.toHaveBeenCalled()
  })

  it('⑤ 현재 비밀번호 오류(재인증 실패) → fail(400), updateUser 미호출', async () => {
    const event = makeEvent(
      { id: 'u1', email: 'admin@crazyshot.kr' },
      { currentPassword: 'wrongpass', newPassword: 'new12345', confirmPassword: 'new12345' },
      { signInError: true },
    )

    const result = (await (actions as ActionsShape).changePassword(event)) as {
      status: number
    }

    expect(result.status).toBe(400)
    expect(event._signInWithPassword).toHaveBeenCalledWith({
      email: 'admin@crazyshot.kr',
      password: 'wrongpass',
    })
    expect(event._updateUser).not.toHaveBeenCalled()
  })

  it('⑥ 정상 흐름 → 재인증 성공 후 updateUser 호출 + { success: true } 반환', async () => {
    const event = makeEvent(
      { id: 'u1', email: 'admin@crazyshot.kr' },
      { currentPassword: 'old12345', newPassword: 'new12345', confirmPassword: 'new12345' },
    )

    const result = await (actions as ActionsShape).changePassword(event)

    expect(result).toEqual({ success: true })
    expect(event._signInWithPassword).toHaveBeenCalledWith({
      email: 'admin@crazyshot.kr',
      password: 'old12345',
    })
    expect(event._updateUser).toHaveBeenCalledWith({ password: 'new12345' })
  })
})
