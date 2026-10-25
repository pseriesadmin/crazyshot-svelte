import { describe, it, expect, vi } from 'vitest'
import { signupRestrictedMessage, SIGNUP_RESTRICTED_MESSAGE } from '$lib/server/signupRestriction'

// 계정 생성·이메일 변경이 재가입 제한 때문에 실패했을 때 사용자 문구로 바꿔 주는 헬퍼 (sp5 MEDIUM-3)
const clientWith = (res: { data: unknown; error: { message: string } | null }) => ({ rpc: vi.fn(async (..._a: unknown[]) => res) })

describe('signupRestrictedMessage', () => {
  it('오류 문구에 SIGNUP_RESTRICTED가 있으면 조회 없이 바로 안내', async () => {
    const c = clientWith({ data: null, error: null })
    expect(await signupRestrictedMessage(c, 'a@b.com', { message: 'x SIGNUP_RESTRICTED y' })).toBe(SIGNUP_RESTRICTED_MESSAGE)
    expect(c.rpc).not.toHaveBeenCalled()
  })
  it('사유 없는 인증 서버 오류는 제한 여부를 조회해 제한 중이면 안내', async () => {
    const c = clientWith({ data: { restricted: true }, error: null })
    expect(await signupRestrictedMessage(c, 'a@b.com', { message: 'Database error creating new user' })).toBe(SIGNUP_RESTRICTED_MESSAGE)
    expect(c.rpc).toHaveBeenCalledWith('check_signup_restricted', { p_email: 'a@b.com' })
  })
  it('제한 중이 아니거나 조회 실패·이메일 없음이면 null(기존 오류 처리 유지)', async () => {
    expect(await signupRestrictedMessage(clientWith({ data: { restricted: false }, error: null }), 'a@b.com', { message: 'x' })).toBeNull()
    expect(await signupRestrictedMessage(clientWith({ data: null, error: { message: 'down' } }), 'a@b.com', { message: 'x' })).toBeNull()
    expect(await signupRestrictedMessage(clientWith({ data: { restricted: true }, error: null }), '  ', { message: 'x' })).toBeNull()
  })
})
