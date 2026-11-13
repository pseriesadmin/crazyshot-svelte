import { describe, it, expect, vi } from 'vitest'

/**
 * 반납 전·종료 건의 CS 이슈 기록(RPC 를 쓰지 않는 직접 기록 경로)에도 청구 사유별 금액이 저장된다 (sp3 M1, 2026-11-14)
 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k', FIREBASE_ADMIN_CLIENT_EMAIL: 'x', FIREBASE_ADMIN_PRIVATE_KEY: 'x' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co', PUBLIC_FIREBASE_PROJECT_ID: 'p' }))
vi.mock('$env/dynamic/private', () => ({ env: {} }))
vi.mock('$lib/server/recordReturnHistory', () => ({ recordReturnHistoryForCompleted: async () => undefined }))
vi.mock('$lib/server/awardRentalCompletePoints', () => ({ awardRentalCompletePoints: async () => undefined }))
vi.mock('$lib/server/awardReturnRegisterMissionPoints', () => ({ awardReturnMissionForApproved: async () => undefined }))
vi.mock('$lib/server/awardOnTimeReturnPoints', () => ({ awardOnTimeReturnPoints: async () => undefined }))
vi.mock('$lib/server/push', () => ({
  CUSTOMER_LIFECYCLE_PUSH_COPY: {},
  sendReservationLifecyclePush: async () => undefined,
  sendPushToAdmins: async () => undefined,
}))
vi.mock('$lib/server/products/resolveParentProductFields', () => ({ applyParentFieldsToRowProducts: async () => {} }))

import { registerInspectionIssue } from '$lib/server/inspection'

function makeAdmin(status: string) {
  const inserted: Record<string, unknown>[] = []
  const from = (table: string) => {
    if (table === 'reservation_inspection_issues') return { insert: async (row: Record<string, unknown>) => { inserted.push(row); return { error: null } } }
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.maybeSingle = async () => ({ data: { status } })
    return chain
  }
  return { admin: { from, rpc: async () => ({ data: { ok: true }, error: null }) }, inserted }
}

const media: { path: string; kind: 'photo' | 'video' }[] = []

describe('청구 — 반납 전·종료 건 직접 기록 경로', () => {
  it('청구 사유별 금액이 함께 저장된다(사유 목록·합계·항목별·청구 전 상태)', async () => {
    const { admin, inserted } = makeAdmin('completed')
    const r = await registerInspectionIssue(admin, 7, 'admin-1', {
      types: ['billing'],
      detail: '파손 청구',
      media,
      claim: { items: [{ kind: 'damage', amount: 150000 }, { kind: 'overdue', amount: 30000 }], total: 180000 },
    })
    expect(r.ok).toBe(true)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      reservation_id: 7,
      issue_types: ['billing'],
      claim_kinds: ['damage', 'overdue'],
      claim_amount: 180000,
      claim_status: 'pending',
      claim_items: [{ kind: 'damage', amount: 150000 }, { kind: 'overdue', amount: 30000 }],
    })
  })

  it('청구가 아닌 이슈는 청구 칼럼을 넣지 않는다(전부 비어 있어야 DB 일관성 CHECK 통과)', async () => {
    const { admin, inserted } = makeAdmin('completed')
    const r = await registerInspectionIssue(admin, 7, 'admin-1', { types: ['malfunction'], detail: '', media })
    expect(r.ok).toBe(true)
    expect(Object.keys(inserted[0])).not.toContain('claim_items')
    expect(Object.keys(inserted[0])).not.toContain('claim_amount')
  })
})
