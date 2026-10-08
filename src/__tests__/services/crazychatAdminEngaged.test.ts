/**
 * TDD: crazychatAdminEngaged.test.ts — "관리자 응대 중" 판정을 "배정 이력"에서 "최근 30분 이내 관리자 답변"으로 (2026-10-08)
 * 배경: 기존에는 chat_sessions.admin_id가 한 번이라도 채워지면 영구히 "응대 중"으로 보아, 사람이 한 번 답한 세션(일반 상담 세션의 약 절반)에는
 *       크레이지챗(조회·접수·추천·AI)이 끝내 끼어들지 못했다.
 * 규칙: admin_id가 없으면 응대 중 아님 / admin_id가 있어도 마지막 관리자 답변이 30분(미만) 이내일 때만 응대 중 / 판정 실패 시에는 안전하게 응대 중(= 크레이지챗이 끼어들지 않음).
 */
import { describe, it, expect, vi } from 'vitest'
import { ADMIN_ENGAGED_WINDOW_MINUTES, evaluateAdminEngaged, isAdminEngaged } from '$lib/server/crazychat/engagement'

const NOW = new Date('2026-10-08T05:00:00.000Z')
const minutesAgo = (m: number): string => new Date(NOW.getTime() - m * 60_000).toISOString()

describe('evaluateAdminEngaged (순수 판정)', () => {
  it('창 크기는 30분', () => {
    expect(ADMIN_ENGAGED_WINDOW_MINUTES).toBe(30)
  })
  it('admin_id가 없으면 응대 중이 아니다(관리자 답변 시각이 있어도 — 배정 전 자동응답 등)', () => {
    expect(evaluateAdminEngaged(null, minutesAgo(1), NOW)).toBe(false)
    expect(evaluateAdminEngaged(undefined, minutesAgo(1), NOW)).toBe(false)
  })
  it('admin_id가 있고 마지막 관리자 답변이 30분 이내면 응대 중', () => {
    expect(evaluateAdminEngaged('admin-1', minutesAgo(0), NOW)).toBe(true)
    expect(evaluateAdminEngaged('admin-1', minutesAgo(10), NOW)).toBe(true)
    expect(evaluateAdminEngaged('admin-1', minutesAgo(29.9), NOW)).toBe(true)
  })
  it('정확히 30분 이상 지났으면 응대 중이 아니다(경계값 포함)', () => {
    expect(evaluateAdminEngaged('admin-1', minutesAgo(30), NOW)).toBe(false)
    expect(evaluateAdminEngaged('admin-1', minutesAgo(31), NOW)).toBe(false)
    expect(evaluateAdminEngaged('admin-1', minutesAgo(60 * 24 * 4), NOW)).toBe(false)
  })
  it('admin_id는 있는데 관리자 답변이 하나도 없으면 응대 중이 아니다', () => {
    expect(evaluateAdminEngaged('admin-1', null, NOW)).toBe(false)
  })
  it('시각을 해석할 수 없으면 안전하게 응대 중으로 본다', () => {
    expect(evaluateAdminEngaged('admin-1', 'not-a-date', NOW)).toBe(true)
  })
  it('미래 시각(시계 오차)은 응대 중으로 본다', () => {
    expect(evaluateAdminEngaged('admin-1', minutesAgo(-5), NOW)).toBe(true)
  })
})

interface Captured { table?: string; eqs: Array<[string, unknown]>; orders: Array<[string, unknown]>; limit?: number }
function makeAdmin(result: { data: unknown; error: { message: string } | null } | Error): { admin: { from: ReturnType<typeof vi.fn> }; cap: Captured } {
  const cap: Captured = { eqs: [], orders: [] }
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn((c: string, v: unknown) => { cap.eqs.push([c, v]); return chain })
  chain.order = vi.fn((c: string, o: unknown) => { cap.orders.push([c, o]); return chain })
  chain.limit = vi.fn((n: number) => { cap.limit = n; return chain })
  chain.maybeSingle = vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)))
  const admin = { from: vi.fn((t: string) => { cap.table = t; return chain }) }
  return { admin, cap }
}

describe('isAdminEngaged (조회 포함)', () => {
  it('admin_id가 없으면 DB를 조회하지 않고 false', async () => {
    const { admin } = makeAdmin({ data: null, error: null })
    expect(await isAdminEngaged(admin, 'sess-1', null, NOW)).toBe(false)
    expect(admin.from).not.toHaveBeenCalled()
  })
  it('해당 세션의 sender_type=admin 최신 1건만 조회한다', async () => {
    const { admin, cap } = makeAdmin({ data: { created_at: minutesAgo(5) }, error: null })
    expect(await isAdminEngaged(admin, 'sess-1', 'admin-1', NOW)).toBe(true)
    expect(cap.table).toBe('chat_messages')
    expect(cap.eqs).toContainEqual(['session_id', 'sess-1'])
    expect(cap.eqs).toContainEqual(['sender_type', 'admin'])
    expect(cap.orders[0][0]).toBe('created_at')
    expect(cap.limit).toBe(1)
  })
  it('마지막 관리자 답변이 오래됐으면 false(크레이지챗이 응대 가능)', async () => {
    const { admin } = makeAdmin({ data: { created_at: minutesAgo(60 * 24 * 4) }, error: null })
    expect(await isAdminEngaged(admin, 'sess-1', 'admin-1', NOW)).toBe(false)
  })
  it('관리자 답변이 없으면 false', async () => {
    const { admin } = makeAdmin({ data: null, error: null })
    expect(await isAdminEngaged(admin, 'sess-1', 'admin-1', NOW)).toBe(false)
  })
  it('조회 오류면 안전하게 true(끼어들지 않음) — 던지지 않는다', async () => {
    const { admin } = makeAdmin({ data: null, error: { message: 'boom' } })
    expect(await isAdminEngaged(admin, 'sess-1', 'admin-1', NOW)).toBe(true)
  })
  it('조회 예외면 안전하게 true — 던지지 않는다', async () => {
    const { admin } = makeAdmin(new Error('network'))
    expect(await isAdminEngaged(admin, 'sess-1', 'admin-1', NOW)).toBe(true)
  })
})
