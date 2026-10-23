// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, unmount, flushSync, tick } from 'svelte'

/**
 * /auth/reset-password 랜딩 화면 실제 렌더 확인 (2026-10-23) — 운영자 발행 링크 / 옛 메일 링크 공용 화면
 * 한글·공백 차단, 글자수 제한, 6자 기준(메인 비밀번호 찾기와 동일) 검증.
 * 실행: npm run test:component
 */
const warn = vi.fn()
vi.mock('$lib/utils/toast', () => ({ csToast: { warning: (m: string) => warn(m), success: vi.fn(), error: vi.fn() } }))
vi.mock('$app/navigation', () => ({ goto: vi.fn(), replaceState: vi.fn() }))
const updateUser = vi.fn(async () => ({ error: null }))
vi.mock('$lib/services/supabase', () => ({
  supabase: {
    auth: {
      verifyOtp: vi.fn(async () => ({ error: null })),
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1' } } } })),
      updateUser: (...a: unknown[]) => (updateUser as unknown as (...x: unknown[]) => unknown)(...a),
    },
  },
}))

let cmp: Record<string, unknown> | null = null
afterEach(() => {
  if (cmp) unmount(cmp)
  cmp = null
  document.body.innerHTML = ''
  warn.mockClear()
  updateUser.mockClear()
})

async function open() {
  const Page = (await import('../../routes/auth/reset-password/+page.svelte')).default
  cmp = mount(Page, { target: document.body })
  flushSync()
  await tick()
  return {
    pw: document.querySelector('#rp-new') as HTMLInputElement,
    pw2: document.querySelector('#rp-confirm') as HTMLInputElement,
    form: document.querySelector('form') as HTMLFormElement,
  }
}
function type(el: HTMLInputElement, v: string) {
  el.value = v
  el.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

describe('/auth/reset-password 랜딩 화면', () => {
  it('두 입력란 모두 72자 제한이 걸려 있고 안내는 6자 기준이다', async () => {
    const { pw, pw2 } = await open()
    expect(pw.maxLength).toBe(72)
    expect(pw2.maxLength).toBe(72)
    expect(pw.placeholder).toContain('6자')
  })

  it('한글·공백은 입력 즉시 지워지고 경고는 3초 안에 한 번만 나온다', async () => {
    const { pw } = await open()
    type(pw, '한글ab12')
    expect(pw.value).toBe('ab12')
    type(pw, 'ab12 한')
    expect(pw.value).toBe('ab12')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('6자 미만이면 거절, 확인 불일치면 거절, 6자 영문이면 변경 요청이 나간다', async () => {
    const { pw, pw2, form } = await open()
    type(pw, 'abc12'); type(pw2, 'abc12')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await tick()
    expect(document.querySelector('.rp-error')?.textContent).toContain('6자')
    expect(updateUser).not.toHaveBeenCalled()

    type(pw, 'abc123'); type(pw2, 'abc124')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await tick()
    expect(document.querySelector('.rp-error')?.textContent).toContain('일치')
    expect(updateUser).not.toHaveBeenCalled()

    type(pw2, 'abc123')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'abc123' }))
  })
})
