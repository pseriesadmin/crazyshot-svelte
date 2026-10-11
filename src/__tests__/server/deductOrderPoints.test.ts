import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * deductOrderPoints (2026-10-04, sp3 M-2 (a)) — 결제 후 포인트 차감 실패를 반드시 감지하고 관리자에게 알린다.
 */
const sendPushToAdmins = vi.fn()
vi.mock('$lib/server/push', () => ({ sendPushToAdmins: (...a: unknown[]) => sendPushToAdmins(...a) }))

const { deductOrderPoints } = await import('$lib/server/checkout/deductOrderPoints')

function adminWith(rpc: () => Promise<{ data: unknown; error: { message: string } | null }>): SupabaseClient {
  return { rpc } as unknown as SupabaseClient
}
const base = { userId: 'u1', orderId: 46, reservationId: 239, source: 'test' }

beforeEach(() => { sendPushToAdmins.mockReset() })

describe('deductOrderPoints', () => {
  it('성공: 차감량을 돌려주고 알림 없음', async () => {
    const r = await deductOrderPoints(adminWith(async () => ({ data: { ok: true, deducted: 500 }, error: null })), { ...base, points: 500, alertAdminOnFailure: true })
    expect(r).toEqual({ ok: true, deducted: 500 })
    expect(sendPushToAdmins).not.toHaveBeenCalled()
  })

  it('포인트 0이면 RPC 호출 없이 성공', async () => {
    const rpc = vi.fn()
    const r = await deductOrderPoints({ rpc } as unknown as SupabaseClient, { ...base, points: 0, alertAdminOnFailure: true })
    expect(r.ok).toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('거부(INSUFFICIENT_POINTS): ok=false + 결제 완료 경로면 관리자 알림 1회', async () => {
    const r = await deductOrderPoints(adminWith(async () => ({ data: { ok: false, error: 'INSUFFICIENT_POINTS' }, error: null })), { ...base, points: 500, alertAdminOnFailure: true })
    expect(r).toEqual({ ok: false, deducted: 0, error: 'INSUFFICIENT_POINTS' })
    expect(sendPushToAdmins).toHaveBeenCalledTimes(1)
    const payload = sendPushToAdmins.mock.calls[0][1] as { body: string; link: string }
    expect(payload.body).toContain('주문 #46')
    expect(payload.link).toContain('selected=239')
  })

  it('RPC 오류: ok=false(RPC_ERROR) + 알림', async () => {
    const r = await deductOrderPoints(adminWith(async () => ({ data: null, error: { message: 'boom' } })), { ...base, points: 500, alertAdminOnFailure: true })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('RPC_ERROR')
    expect(sendPushToAdmins).toHaveBeenCalledTimes(1)
  })

  it('확정 전 사전 차감 경로(alertAdminOnFailure=false)는 실패해도 알림을 보내지 않는다', async () => {
    const r = await deductOrderPoints(adminWith(async () => ({ data: { ok: false, error: 'INSUFFICIENT_POINTS' }, error: null })), { ...base, points: 500, alertAdminOnFailure: false })
    expect(r.ok).toBe(false)
    expect(sendPushToAdmins).not.toHaveBeenCalled()
  })

  it('RPC 예외: 던지지 않고 ok=false(RPC_EXCEPTION)', async () => {
    const r = await deductOrderPoints(adminWith(async () => { throw new Error('network') }), { ...base, points: 500, alertAdminOnFailure: false })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('RPC_EXCEPTION')
  })
})
