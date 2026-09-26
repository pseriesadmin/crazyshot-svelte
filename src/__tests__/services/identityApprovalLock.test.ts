import { describe, it, expect } from 'vitest'
import { isIdentityApproved } from '$lib/server/identityApproval'
import type { SupabaseClient } from '@supabase/supabase-js'

function mockAdmin(row: Record<string, string | null> | null, error: { message: string } | null = null) {
  const selected: string[] = []
  const chain = {
    select: (cols: string) => { selected.push(cols); return chain },
    eq: () => chain,
    maybeSingle: async () => ({ data: row, error }),
  }
  return { client: { from: () => chain } as unknown as SupabaseClient, selected }
}

const V = '2026-09-20T00:00:00Z'

describe('isIdentityApproved — 승인 후 고객 수정·삭제 차단 판정', () => {
  it.each(['identity', 'foreign'] as const)('%s: 승인 이력 없음 → 미승인', async (t) => {
    const { client } = mockAdmin({ [`${t}_verified_at`]: V, [`${t}_approved_at`]: null })
    expect(await isIdentityApproved(client, 'u', t)).toBe(false)
  })
  it.each(['identity', 'foreign'] as const)('%s: 승인시각 > 제출시각 → 승인', async (t) => {
    const { client } = mockAdmin({ [`${t}_verified_at`]: V, [`${t}_approved_at`]: '2026-09-21T00:00:00Z' })
    expect(await isIdentityApproved(client, 'u', t)).toBe(true)
  })
  it.each(['identity', 'foreign'] as const)('%s: 승인시각 = 제출시각(경계) → 승인', async (t) => {
    const { client } = mockAdmin({ [`${t}_verified_at`]: V, [`${t}_approved_at`]: V })
    expect(await isIdentityApproved(client, 'u', t)).toBe(true)
  })
  it.each(['identity', 'foreign'] as const)('%s: 승인 후 재제출 → 검토대기(수정 가능)', async (t) => {
    const { client } = mockAdmin({ [`${t}_verified_at`]: '2026-09-22T00:00:00Z', [`${t}_approved_at`]: '2026-09-21T00:00:00Z' })
    expect(await isIdentityApproved(client, 'u', t)).toBe(false)
  })
  it('제출시각 없이 승인만 있으면 승인', async () => {
    const { client } = mockAdmin({ identity_verified_at: null, identity_approved_at: V })
    expect(await isIdentityApproved(client, 'u')).toBe(true)
  })
  it('프로필 없음 → 미승인', async () => {
    const { client } = mockAdmin(null)
    expect(await isIdentityApproved(client, 'u')).toBe(false)
  })
  it('조회 오류 → 안전측 차단(fail-closed)', async () => {
    const { client } = mockAdmin(null, { message: 'db down' })
    expect(await isIdentityApproved(client, 'u', 'foreign')).toBe(true)
  })
  it('docType에 맞는 컬럼만 조회', async () => {
    const { client, selected } = mockAdmin(null)
    await isIdentityApproved(client, 'u', 'foreign')
    expect(selected[0]).toBe('foreign_verified_at, foreign_approved_at')
  })
})
