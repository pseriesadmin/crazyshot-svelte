import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { attachCancelPending } from '$lib/server/attachCancelPending'

/** 고객 취소 요청 대기("취소대기") 표식 부착 (Migration 687) */

type Row = { reservation_id: number; cancel_pending?: boolean }

function makeAdmin(result: { data: Array<{ id: number }> | null; error: { message: string } | null }) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'in', 'not', 'neq']) {
    b[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return b }
  }
  b.then = (resolve: (v: typeof result) => void) => resolve(result)
  const admin = { from: vi.fn(() => b) } as unknown as SupabaseClient
  return { admin, calls }
}

describe('attachCancelPending', () => {
  it('취소 요청이 걸린 예약 행에만 cancel_pending=true를 붙인다', async () => {
    const { admin, calls } = makeAdmin({ data: [{ id: 2 }, { id: 5 }], error: null })
    const rows: Row[] = [{ reservation_id: 1 }, { reservation_id: 2 }, { reservation_id: 5 }]
    await attachCancelPending(admin, rows)
    expect(rows.map((r) => r.cancel_pending === true)).toEqual([false, true, true])
    // 조회는 대상 id 목록 + 표식 있음 + 이미 취소된 건 제외
    expect(calls.find((c) => c.method === 'in')?.args).toEqual(['id', [1, 2, 5]])
    expect(calls.find((c) => c.method === 'not')?.args).toEqual(['cancel_requested_at', 'is', null])
    expect(calls.find((c) => c.method === 'neq')?.args).toEqual(['status', 'cancelled'])
  })

  it('이미 cancel_pending인 행은 조회 대상에서 빼고, 대상이 없으면 조회하지 않는다', async () => {
    const { admin } = makeAdmin({ data: [], error: null })
    await attachCancelPending(admin, [{ reservation_id: 7, cancel_pending: true }])
    expect((admin as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled()
  })

  it('조회가 실패해도 예외 없이 표식 없이 끝난다(fail-soft) + 오류를 로그로 남긴다', async () => {
    const { admin } = makeAdmin({ data: null, error: { message: 'db down' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const rows: Row[] = [{ reservation_id: 1 }]
    await expect(attachCancelPending(admin, rows)).resolves.toBeUndefined()
    expect(rows[0].cancel_pending).toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
