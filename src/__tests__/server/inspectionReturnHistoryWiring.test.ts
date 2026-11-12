import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 검수 승인·이슈 해소 → 상품 이력 자동 반영 호출 연결 점검 (sp3 재검수 MINOR-B, 2026-11-12)
 *  · 승인 성공 시 완료된 모든 예약 id 로 recordReturnHistoryForCompleted 가 호출되고, 포인트·알림보다 뒤(맨 마지막)에 호출된다
 *  · 이슈 해소 성공 시에도 호출된다
 *  · 승인·해소가 실패하면(RPC 거절) 호출되지 않는다 — 완료되지 않은 예약의 사진은 이력에 넣지 않는다
 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k', FIREBASE_ADMIN_CLIENT_EMAIL: 'x', FIREBASE_ADMIN_PRIVATE_KEY: 'x' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co', PUBLIC_FIREBASE_PROJECT_ID: 'p' }))
vi.mock('$env/dynamic/private', () => ({ env: {} }))

const order: string[] = []
const mockHistory = vi.fn()
vi.mock('$lib/server/recordReturnHistory', () => ({
  recordReturnHistoryForCompleted: async (...a: unknown[]) => { order.push('history'); mockHistory(...a) },
}))
vi.mock('$lib/server/awardRentalCompletePoints', () => ({ awardRentalCompletePoints: async () => { order.push('award') } }))
vi.mock('$lib/server/awardReturnRegisterMissionPoints', () => ({ awardReturnMissionForApproved: async () => { order.push('mission') } }))
vi.mock('$lib/server/awardOnTimeReturnPoints', () => ({ awardOnTimeReturnPoints: async () => undefined }))
vi.mock('$lib/server/push', () => ({
  CUSTOMER_LIFECYCLE_PUSH_COPY: {
    inspection_pass: { title: '대여 완료 안내', body: (p: string) => `${p} 이상 없음` },
    inspection_issue: { title: '검수 결과 안내', body: (p: string) => `${p} 이상 확인` },
  },
  sendReservationLifecyclePush: async () => { order.push('push') },
  sendPushToAdmins: async () => undefined,
}))
vi.mock('$lib/server/products/resolveParentProductFields', () => ({ applyParentFieldsToRowProducts: async () => {} }))

import { approveInspection, resolveInspectionIssue } from '$lib/server/inspection'

function makeAdmin(rpcImpl: (fn: string) => unknown) {
  const rpc = async (fn: string) => {
    if (fn === 'return_records_missing') return { data: [], error: null } // 모든 상품 반납 기록 등록됨
    return rpcImpl(fn)
  }
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq']) chain[m] = () => chain
  chain.maybeSingle = async () => ({ data: { status: 'returned', products: { name: 'SONY FX3' } } })
  return { rpc, from: () => chain }
}

beforeEach(() => {
  order.length = 0
  mockHistory.mockReset()
})

describe('검수 승인·이슈 해소 → 이력 자동 반영 호출 연결', () => {
  it('승인 성공: 완료된 모든 예약 id 로 호출하고, 포인트·알림 뒤 맨 마지막에 호출한다', async () => {
    const admin = makeAdmin((fn) => (fn === 'approve_return_inspection' ? { data: { ok: true, completed_ids: [10, 11] }, error: null } : { data: { ok: true }, error: null }))
    const r = await approveInspection(admin, 10, 'admin-1')
    expect(r.ok).toBe(true)
    expect(mockHistory).toHaveBeenCalledTimes(1)
    expect(mockHistory).toHaveBeenCalledWith(admin, [10, 11], 'admin-1')
    expect(order[order.length - 1]).toBe('history')
    expect(order.indexOf('award')).toBeLessThan(order.indexOf('history'))
  })
  it('승인 거절(RPC 실패): 이력 반영을 호출하지 않는다', async () => {
    const admin = makeAdmin((fn) => (fn === 'approve_return_inspection' ? { data: { ok: false, error: '거절' }, error: null } : { data: { ok: true }, error: null }))
    const r = await approveInspection(admin, 10, 'admin-1')
    expect(r.ok).toBe(false)
    expect(mockHistory).not.toHaveBeenCalled()
  })
  it('이슈 해소 성공: 완료된 예약 id 로 호출한다', async () => {
    const admin = makeAdmin(() => ({ data: { ok: true, completed_ids: [20] }, error: null }))
    const r = await resolveInspectionIssue(admin, 20, 'admin-2', '협의 완료')
    expect(r.ok).toBe(true)
    expect(mockHistory).toHaveBeenCalledTimes(1)
    expect(mockHistory).toHaveBeenCalledWith(admin, [20], 'admin-2')
  })
  it('이슈 해소 거절(RPC 실패): 이력 반영을 호출하지 않는다', async () => {
    const admin = makeAdmin(() => ({ data: { ok: false, error: '거절' }, error: null }))
    const r = await resolveInspectionIssue(admin, 20, 'admin-2', '')
    expect(r.ok).toBe(false)
    expect(mockHistory).not.toHaveBeenCalled()
  })
})
