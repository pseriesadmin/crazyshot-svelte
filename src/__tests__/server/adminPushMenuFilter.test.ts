/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ADMIN_PUSH_EVENT_MENU_KEYS, filterAdminPushRecipientsByMenu } from '$lib/server/adminPushMenuFilter'

/**
 * 1단계 1h — 상담 알림(관리자 푸시·전역 새 채팅 토스트)에 consulting.chat 메뉴 권한 반영 (2026-10-05)
 *  · 푸시: 수신자 목록(RPC)을 받은 뒤 앱 코드에서 consulting.chat OFF 계정을 제외한다(RPC·DB 무변경).
 *  · 조회 실패는 fail-open(발송 누락이 과다 발송보다 위험 — 푸시에 한해, 화면·API 게이트는 fail-closed 유지).
 *  · 토스트: cms/+layout.svelte 새 채팅 토스트는 consulting.chat OFF 계정이면 구독하지 않는다.
 */
const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

type Result = { data: { user_id: string }[] | null; error: { message: string } | null }
function fakeSupabase(result: Result) {
  const calls: Record<string, unknown> = {}
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn((col: string, val: unknown) => { calls[col] = val; return q }),
    in: vi.fn((col: string, val: unknown) => { calls[col] = val; return Promise.resolve(result) }),
  }
  return { client: { from: vi.fn(() => q) } as never, q, calls }
}

describe('이벤트 → 메뉴 키 매핑', () => {
  it('상담 이벤트는 consulting.chat, 예약·결제·서명은 rental.reservation, 서류는 customers.list (2-B, Stephen 권장안)', () => {
    expect(ADMIN_PUSH_EVENT_MENU_KEYS.new_session).toBe('consulting.chat')
    expect(ADMIN_PUSH_EVENT_MENU_KEYS.urgent_chat_message).toBe('consulting.chat')
    for (const k of ['payment_completed', 'new_reservation', 'contract_signed']) {
      expect(ADMIN_PUSH_EVENT_MENU_KEYS[k], k).toBe('rental.reservation')
    }
    expect(ADMIN_PUSH_EVENT_MENU_KEYS.identity_review).toBe('customers.list')
    expect(ADMIN_PUSH_EVENT_MENU_KEYS.some_unknown_event).toBeUndefined()
  })
})

describe('filterAdminPushRecipientsByMenu', () => {
  it('매핑 없는 이벤트는 조회 없이 그대로 반환', async () => {
    const { client } = fakeSupabase({ data: [], error: null })
    expect(await filterAdminPushRecipientsByMenu(client, 'some_unknown_event', ['a', 'b'])).toEqual(['a', 'b'])
    expect((client as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled()
  })
  it('consulting.chat OFF 계정만 제외', async () => {
    const { client, calls } = fakeSupabase({ data: [{ user_id: 'b' }], error: null })
    expect(await filterAdminPushRecipientsByMenu(client, 'new_session', ['a', 'b', 'c'])).toEqual(['a', 'c'])
    expect(calls.menu_key).toBe('consulting.chat')
    expect(calls.allowed).toBe(false)
    expect(calls.user_id).toEqual(['a', 'b', 'c'])
  })
  it('OFF 계정이 없으면 전원 유지(무회귀)', async () => {
    const { client } = fakeSupabase({ data: [], error: null })
    expect(await filterAdminPushRecipientsByMenu(client, 'urgent_chat_message', ['a', 'b'])).toEqual(['a', 'b'])
  })
  it('조회 실패는 fail-open(전원 유지)', async () => {
    const { client } = fakeSupabase({ data: null, error: { message: 'boom' } })
    expect(await filterAdminPushRecipientsByMenu(client, 'new_session', ['a', 'b'])).toEqual(['a', 'b'])
  })
  it('조회 예외도 fail-open', async () => {
    const client = { from: () => { throw new Error('x') } } as never
    expect(await filterAdminPushRecipientsByMenu(client, 'new_session', ['a'])).toEqual(['a'])
  })
  it('빈 수신자는 조회 없이 빈 배열', async () => {
    const { client } = fakeSupabase({ data: [], error: null })
    expect(await filterAdminPushRecipientsByMenu(client, 'new_session', [])).toEqual([])
    expect((client as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled()
  })
})

describe('소스 스캔', () => {
  it('sendPushToAdmins가 수신자 목록 받은 뒤 필터를 적용', () => {
    const src = read('src/lib/server/push.ts')
    expect(src).toContain("import { filterAdminPushRecipientsByMenu } from '$lib/server/adminPushMenuFilter'")
    expect(src).toMatch(/filterAdminPushRecipientsByMenu\(supabase, eventKey, recipientIds\)/)
  })
  it('전역 새 채팅 토스트는 consulting.chat 권한 확인 후에만 구독', () => {
    const src = read('src/routes/cms/+layout.svelte')
    expect(src).toMatch(/hasMenuAccess\(data\.cmsRole \?\? '', data\.menuPermissionOverrides, 'consulting\.chat'\)/)
    expect(src).toMatch(/if \(!data\.cmsRole \|\| !canReceiveChatToast\) return/)
  })
})
