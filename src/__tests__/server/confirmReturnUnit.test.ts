import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 상품별 [검수확인] (2026-11-13, Stephen 확정)
 *  · 반납요청 + 반납정보 등록된 상품만 → 그 상품 1건만 반납완료로 전환(다른 상품은 건드리지 않음)
 *  · 반납완료 이상이면 멱등 성공, 대여중 등 다른 단계·반납정보 없음·확인 실패는 거절(상태 변경 없음)
 *  · 반납 검수 승인: 고객 제출 카드가 있는 상품이 아직 반납요청(검수확인 전)이면 거절 — 화면의 [반납 검수 승인] 활성 조건과 같은 규칙
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

import {
  CONFIRM_UNIT_RECORD_ERROR,
  CONFIRM_UNIT_STATUS_ERROR,
  RETURN_RECORD_CHECK_FAILED_ERROR,
  UNCONFIRMED_CARD_ERROR,
  approveInspection,
  confirmReturnUnit,
} from '$lib/server/inspection'

interface Fake {
  statusById: Record<number, string>
  submissions: number[] // 고객 제출이 있는 예약 id
  orderOf: Record<number, number> // 예약 id → 주문 id
  missing: number[] | null // return_records_missing 결과(null = 조회 실패)
  updateFails?: boolean // update_reservation_status 가 실패(ok:false)하는 경우
}

const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []

function makeAdmin(f: Fake) {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args })
    if (fn === 'return_records_missing') return f.missing === null ? { data: null, error: { message: 'x' } } : { data: f.missing, error: null }
    if (fn === 'update_reservation_status') return f.updateFails ? { data: { ok: false, error: '전환 불가' }, error: null } : { data: { ok: true }, error: null }
    return { data: { ok: true, completed_ids: [1] }, error: null }
  }
  function from(table: string) {
    const state: { eq: Record<string, unknown>; inn: Record<string, unknown[]> } = { eq: {}, inn: {} }
    const result = (): { data: unknown } => {
      if (table === 'rental_reservations') {
        const ids = (state.inn.id as number[] | undefined) ?? (state.eq.id !== undefined ? [Number(state.eq.id)] : Object.keys(f.statusById).map(Number))
        const rows = ids.filter((id) => f.statusById[id] !== undefined && (state.eq.status === undefined || f.statusById[id] === state.eq.status)).map((id) => ({ id, status: f.statusById[id] }))
        return { data: rows }
      }
      if (table === 'order_items') {
        if (state.eq.reservation_id !== undefined) return { data: [{ order_id: f.orderOf[Number(state.eq.reservation_id)] ?? null, reservation_id: Number(state.eq.reservation_id) }] }
        return { data: Object.entries(f.orderOf).filter(([, o]) => o === state.eq.order_id).map(([rid]) => ({ reservation_id: Number(rid) })) }
      }
      if (table === 'reservation_return_submissions') {
        const ids = (state.inn.reservation_id as number[] | undefined) ?? []
        return { data: f.submissions.filter((id) => ids.includes(id)).map((reservation_id) => ({ reservation_id })) }
      }
      return { data: [] }
    }
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (k: string, v: unknown) => { state.eq[k] = v; return chain },
      in: (k: string, v: unknown[]) => { state.inn[k] = v; return chain },
      maybeSingle: async () => {
        const d = result().data as unknown[]
        return { data: d[0] ?? null, error: null }
      },
      then: (resolve: (v: unknown) => unknown) => resolve({ ...result(), error: null }),
    }
    return chain
  }
  return { rpc, from }
}

const updates = (): number[] => rpcCalls.filter((c) => c.fn === 'update_reservation_status').map((c) => Number(c.args.p_reservation_id))

beforeEach(() => {
  rpcCalls.length = 0
})

describe('상품별 검수확인 — confirmReturnUnit', () => {
  it('반납요청 + 반납정보 등록: 그 상품 1건만 반납완료로 전환한다(같은 주문의 다른 상품은 그대로)', async () => {
    const admin = makeAdmin({ statusById: { 1: 'return_requested', 2: 'return_requested' }, submissions: [1, 2], orderOf: { 1: 9, 2: 9 }, missing: [] })
    const r = await confirmReturnUnit(admin, 2)
    expect(r.ok).toBe(true)
    expect(updates()).toEqual([2])
    expect(rpcCalls.find((c) => c.fn === 'update_reservation_status')?.args.p_new_status).toBe('returned')
  })

  it('이미 반납완료·완료면 아무것도 바꾸지 않고 성공(멱등)', async () => {
    for (const st of ['returned', 'completed']) {
      rpcCalls.length = 0
      const r = await confirmReturnUnit(makeAdmin({ statusById: { 1: st }, submissions: [1], orderOf: {}, missing: [] }), 1)
      expect(r.ok).toBe(true)
      expect(updates()).toEqual([])
    }
  })

  it('대여중 등 반납요청이 아니면 거절하고 상태를 바꾸지 않는다', async () => {
    const r = await confirmReturnUnit(makeAdmin({ statusById: { 1: 'in_use' }, submissions: [], orderOf: {}, missing: [] }), 1)
    expect(r).toEqual({ ok: false, error: CONFIRM_UNIT_STATUS_ERROR })
    expect(updates()).toEqual([])
  })

  it('반납정보가 없는 상품은 거절한다', async () => {
    const r = await confirmReturnUnit(makeAdmin({ statusById: { 1: 'return_requested' }, submissions: [], orderOf: { 1: 9 }, missing: [1] }), 1)
    expect(r).toEqual({ ok: false, error: CONFIRM_UNIT_RECORD_ERROR })
    expect(updates()).toEqual([])
  })

  it('반납정보 등록 여부를 확인하지 못하면 거절한다(fail-closed)', async () => {
    const r = await confirmReturnUnit(makeAdmin({ statusById: { 1: 'return_requested' }, submissions: [1], orderOf: {}, missing: null }), 1)
    expect(r).toEqual({ ok: false, error: RETURN_RECORD_CHECK_FAILED_ERROR })
    expect(updates()).toEqual([])
  })

  it('같은 주문의 다른 상품이 반납정보 미등록이어도, 이 상품에 반납정보가 있으면 이 상품은 검수확인된다', async () => {
    const admin = makeAdmin({ statusById: { 1: 'return_requested', 2: 'in_use' }, submissions: [1], orderOf: { 1: 9, 2: 9 }, missing: [2] })
    const r = await confirmReturnUnit(admin, 1)
    expect(r.ok).toBe(true)
    expect(updates()).toEqual([1])
  })

  it('반납완료 전환이 실패하면 그 오류를 돌려준다', async () => {
    const admin = makeAdmin({ statusById: { 1: 'return_requested' }, submissions: [1], orderOf: {}, missing: [], updateFails: true })
    const r = await confirmReturnUnit(admin, 1)
    expect(r).toEqual({ ok: false, error: '전환 불가' })
  })

  it('없는 예약은 거절한다', async () => {
    const r = await confirmReturnUnit(makeAdmin({ statusById: {}, submissions: [], orderOf: {}, missing: [] }), 7)
    expect(r.ok).toBe(false)
  })
})

describe('반납 검수 승인 — 검수확인 전 상품이 있으면 거절', () => {
  it('고객 제출 카드가 있는 상품이 아직 반납요청이면 승인하지 않는다(승인 RPC·상태 전환 호출 없음)', async () => {
    const admin = makeAdmin({ statusById: { 1: 'returned', 2: 'return_requested' }, submissions: [1, 2], orderOf: { 1: 9, 2: 9 }, missing: [] })
    const r = await approveInspection(admin, 1, 'admin-1')
    expect(r).toEqual({ ok: false, error: UNCONFIRMED_CARD_ERROR })
    expect(rpcCalls.some((c) => c.fn === 'approve_return_inspection')).toBe(false)
    expect(updates()).toEqual([])
  })

  it('관리자 대리 등록만 있는 상품(고객 제출 없음)은 대기 대상이 아니라 승인이 진행된다', async () => {
    const admin = makeAdmin({ statusById: { 1: 'returned', 2: 'return_requested' }, submissions: [1], orderOf: { 1: 9, 2: 9 }, missing: [] })
    const r = await approveInspection(admin, 1, 'admin-1')
    expect(r.ok).toBe(true)
    expect(rpcCalls.some((c) => c.fn === 'approve_return_inspection')).toBe(true)
  })

  it('모든 상품이 검수확인(반납완료)이면 승인된다', async () => {
    const admin = makeAdmin({ statusById: { 1: 'returned', 2: 'returned' }, submissions: [1, 2], orderOf: { 1: 9, 2: 9 }, missing: [] })
    const r = await approveInspection(admin, 1, 'admin-1')
    expect(r.ok).toBe(true)
  })
})

describe('연결 점검(소스 스캔)', () => {
  const read = (p: string): string => readFileSync(p, 'utf-8')
  it('API 는 confirm_unit 액션을 상품(예약) id 로 받고 manager 이상 게이트 뒤에 처리한다', () => {
    const route = read('src/routes/api/cms/reservations/[id]/inspection/+server.ts')
    expect(route).toContain("action === 'confirm_unit'")
    expect(route).toContain('confirmReturnUnit(admin, reservationId)')
    expect(route.indexOf('hasSettingsAccess(cmsRole)')).toBeLessThan(route.indexOf("action === 'confirm_unit'"))
  })
  it('패널: 카드에 [검수확인] 버튼, 모든 대기 상품이 확인돼야 [반납 검수 승인] 활성, CS 이슈 검수중이면 기존처럼 비활성', () => {
    const panel = read('src/lib/components/cms/RentalDetailPanel.svelte')
    expect(panel).toContain("action: 'confirm_unit'")
    expect(panel).toContain('unconfirmedCards.length === 0')
    expect(panel).toMatch(/approveHeaderReady = \$derived\(canInspect && canApproveStage && hasInspectionInfo && inspStatus !== 'issue' && unconfirmedCards\.length === 0\)/)
    expect(panel).toContain('class="btn-ev-confirm"')
  })
})
