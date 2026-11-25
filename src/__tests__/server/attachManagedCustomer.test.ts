import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { attachManagedCustomer } from '$lib/server/attachManagedCustomer'

/** 예약대여현황 행 [관리고객] 표식 부착 (2026-11-25) */

type Row = { reservation_id: number; managed_customer?: boolean }

function makeAdmin(
  resv: { data: Array<{ id: number; user_id: string | null }> | null; error: { message: string } | null },
  prof: { data: Array<{ id: string }> | null; error: { message: string } | null },
) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = []
  const admin = {
    from: vi.fn((table: string) => {
      const result = table === 'rental_reservations' ? resv : prof
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'in', 'eq']) b[m] = (...args: unknown[]) => { calls.push({ table, method: m, args }); return b }
      b.then = (res: (v: typeof result) => void) => res(result)
      return b
    }),
  } as unknown as SupabaseClient
  return { admin, calls }
}

describe('attachManagedCustomer', () => {
  it('관리대상 고객의 예약 행에만 managed_customer=true를 붙인다', async () => {
    const { admin, calls } = makeAdmin(
      { data: [{ id: 1, user_id: 'a' }, { id: 2, user_id: 'b' }, { id: 3, user_id: 'a' }], error: null },
      { data: [{ id: 'a' }], error: null },
    )
    const rows: Row[] = [{ reservation_id: 1 }, { reservation_id: 2 }, { reservation_id: 3 }]
    await attachManagedCustomer(admin, rows)
    expect(rows.map((r) => r.managed_customer === true)).toEqual([true, false, true])
    expect(calls.find((c) => c.table === 'user_profiles' && c.method === 'eq')?.args).toEqual(['blacklisted', true])
  })
  it('행이 없으면 조회하지 않는다', async () => {
    const { admin } = makeAdmin({ data: [], error: null }, { data: [], error: null })
    await attachManagedCustomer(admin, [])
    expect((admin as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled()
  })
  it('조회가 실패해도 예외 없이 표식 없이 끝난다(fail-soft)', async () => {
    const { admin } = makeAdmin({ data: null, error: { message: 'db down' } }, { data: null, error: null })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const rows: Row[] = [{ reservation_id: 1 }]
    await expect(attachManagedCustomer(admin, rows)).resolves.toBeUndefined()
    expect(rows[0].managed_customer).toBeUndefined()
    spy.mockRestore()
  })
})
