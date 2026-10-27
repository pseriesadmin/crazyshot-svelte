import { describe, it, expect, vi, beforeEach } from 'vitest'
/**
 * TDD RED — P3 항목 4: request-notes 엔드포인트 주문 단위 병합
 *
 * 완료조건:
 *   - 같은 주문의 다른 예약들도 요청사항을 가져온다
 *   - 모든 예약의 값이 동일 → 단일 값으로 반환(중복 제거)
 *   - 값이 다르면 "상품명A: 값A / 상품명B: 값B" 형식으로 병합 반환
 *   - pickup_frontdoor_password는 요청한 예약의 값만 (권한 변경 없음)
 */

vi.mock('$lib/server/requireMenuAccess', () => ({
  requireMenuAccessApi: vi.fn(async () => null),
}))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    async json() { return data },
  }),
}))
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: vi.fn().mockResolvedValue('manager'),
}))

// listOrderReservationIds mock
const mockListOrderReservationIds = vi.fn()
vi.mock('$lib/server/dheroOrderUnits', () => ({
  listOrderReservationIds: (...args: unknown[]) => mockListOrderReservationIds(...args),
}))

// resolveParentProductFields mock — products.md §2-16: 부모 우선 이름 병합
const mockResolveParentProductFields = vi.fn()
vi.mock('$lib/server/products/resolveParentProductFields', () => ({
  resolveParentProductFields: (...args: unknown[]) => mockResolveParentProductFields(...args),
}))

// supabase admin mock — from().select().eq().maybeSingle() and from().select().in()
const mockAdminFrom = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: mockAdminFrom }),
}))

function makeLocals() {
  return { safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: 'admin' } } }) }
}

// ── 헬퍼: Supabase 체인 mock ─────────────────────────────────────────────────

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.in = vi.fn().mockReturnValue(chain)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  // await chain → result
  chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => unknown) => resolve(result))
  return chain
}

describe('GET /api/cms/reservations/[id]/request-notes — 주문 단위 병합', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 기본값: resolveParentProductFields는 입력 rows를 그대로 통과 (부모 참조 없는 시나리오)
    mockResolveParentProductFields.mockImplementation(
      async (_client: unknown, rows: { id: string; name: string | null; parent_product_id: string | null }[]) => rows
    )
  })

  it('단일 예약(주문에 묶이지 않음) — 기존처럼 단건 값만 반환', async () => {
    // listOrderReservationIds가 자기 자신만 반환
    mockListOrderReservationIds.mockResolvedValue([10])

    let callCount = 0
    mockAdminFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // in('id', [10]) — 주문 내 예약들 notes 조회
        return makeChain({ data: [{ id: 10, notes: '배송주의', pickup_request_note: '경비실에 맡겨주세요', return_request_note: null, product_id: 'PROD-A' }], error: null })
      }
      if (callCount === 2) {
        // products 상품명 조회
        return makeChain({ data: [{ id: 'PROD-A', name: '카메라A' }], error: null })
      }
      // pickup_frontdoor_password (manager)
      return makeChain({ data: { pickup_frontdoor_password: '1234' }, error: null })
    })

    const { GET } = await import('../../routes/api/cms/reservations/[id]/request-notes/+server')
    const res = await GET({ params: { id: '10' }, locals: makeLocals(), request: {} as Request, url: new URL('http://localhost') } as never) as { status: number; json: () => Promise<unknown> }
    expect(res.status).toBe(200)
    const body = await res.json() as { notes: string | null; pickup_request_note: string | null; return_request_note: string | null; pickup_frontdoor_password: string | null }
    expect(body.notes).toBe('배송주의')
    expect(body.pickup_request_note).toBe('경비실에 맡겨주세요')
    expect(body.return_request_note).toBeNull()
    expect(body.pickup_frontdoor_password).toBe('1234')
  })

  it('주문 내 2개 예약 — 동일한 pickup_request_note → 중복 제거(단일 값 반환)', async () => {
    mockListOrderReservationIds.mockResolvedValue([10, 11])

    let callCount = 0
    mockAdminFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return makeChain({ data: [
          { id: 10, notes: null, pickup_request_note: '경비실에 맡겨주세요', return_request_note: null, product_id: 'PROD-A' },
          { id: 11, notes: null, pickup_request_note: '경비실에 맡겨주세요', return_request_note: null, product_id: 'PROD-B' },
        ], error: null })
      }
      if (callCount === 2) {
        return makeChain({ data: [{ id: 'PROD-A', name: '카메라A' }, { id: 'PROD-B', name: '렌즈B' }], error: null })
      }
      return makeChain({ data: { pickup_frontdoor_password: '5678' }, error: null })
    })

    const { GET } = await import('../../routes/api/cms/reservations/[id]/request-notes/+server')
    const res = await GET({ params: { id: '10' }, locals: makeLocals(), request: {} as Request, url: new URL('http://localhost') } as never) as { status: number; json: () => Promise<unknown> }
    const body = await res.json() as { pickup_request_note: string | null }
    // 두 예약의 값이 같으면 한 번만
    expect(body.pickup_request_note).toBe('경비실에 맡겨주세요')
  })

  it('주문 내 2개 예약 — 다른 pickup_request_note → 상품명 포함 병합 반환', async () => {
    mockListOrderReservationIds.mockResolvedValue([10, 11])

    let callCount = 0
    mockAdminFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return makeChain({ data: [
          { id: 10, notes: null, pickup_request_note: '문 앞에 두세요', return_request_note: null, product_id: 'PROD-A' },
          { id: 11, notes: null, pickup_request_note: '경비실에 맡겨주세요', return_request_note: null, product_id: 'PROD-B' },
        ], error: null })
      }
      if (callCount === 2) {
        return makeChain({ data: [{ id: 'PROD-A', name: '카메라A' }, { id: 'PROD-B', name: '렌즈B' }], error: null })
      }
      return makeChain({ data: { pickup_frontdoor_password: null }, error: null })
    })

    const { GET } = await import('../../routes/api/cms/reservations/[id]/request-notes/+server')
    const res = await GET({ params: { id: '10' }, locals: makeLocals(), request: {} as Request, url: new URL('http://localhost') } as never) as { status: number; json: () => Promise<unknown> }
    const body = await res.json() as { pickup_request_note: string | null }
    // 값이 다르므로 상품명과 함께 병합
    expect(body.pickup_request_note).toContain('카메라A')
    expect(body.pickup_request_note).toContain('렌즈B')
    expect(body.pickup_request_note).toContain('문 앞에 두세요')
    expect(body.pickup_request_note).toContain('경비실에 맡겨주세요')
  })

  it('pickup_frontdoor_password — 요청한 예약(id=10)의 값만 반환 (권한 변경 없음)', async () => {
    mockListOrderReservationIds.mockResolvedValue([10, 11])

    let callCount = 0
    const frontdoorChain = makeChain({ data: { pickup_frontdoor_password: '9999' }, error: null })
    mockAdminFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return makeChain({ data: [
          { id: 10, notes: null, pickup_request_note: null, return_request_note: null, product_id: 'PROD-A' },
          { id: 11, notes: null, pickup_request_note: null, return_request_note: null, product_id: 'PROD-B' },
        ], error: null })
      }
      if (callCount === 2) {
        return makeChain({ data: [{ id: 'PROD-A', name: '카메라A' }, { id: 'PROD-B', name: '렌즈B' }], error: null })
      }
      // pickup_frontdoor_password — 예약 10번의 값만 (.eq('id', reservationId) 확인 대상)
      return frontdoorChain
    })

    const { GET } = await import('../../routes/api/cms/reservations/[id]/request-notes/+server')
    const res = await GET({ params: { id: '10' }, locals: makeLocals(), request: {} as Request, url: new URL('http://localhost') } as never) as { status: number; json: () => Promise<unknown> }
    const body = await res.json() as { pickup_frontdoor_password: string | null }
    expect(body.pickup_frontdoor_password).toBe('9999')
    // Issue #6: frontdoor 조회가 reservationId=10 단건만 대상인지 확인
    expect(frontdoorChain.eq).toHaveBeenCalledWith('id', 10)
  })

  it('resolveParentProductFields — 부모 이름이 있을 때 자식 이름 대신 부모 이름을 병합 문구에 사용한다', async () => {
    // products.md §2-16: 자식 재고의 name은 부모 값으로 대체되어야 한다
    mockListOrderReservationIds.mockResolvedValue([10, 11])

    let callCount = 0
    mockAdminFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return makeChain({ data: [
          { id: 10, notes: null, pickup_request_note: '문 앞에 두세요', return_request_note: null, product_id: 'PROD-A' },
          { id: 11, notes: null, pickup_request_note: '경비실에 맡겨주세요', return_request_note: null, product_id: 'PROD-B' },
        ], error: null })
      }
      if (callCount === 2) {
        // 자식 상품: 각각 자기 이름(부모 이름이 아님)
        return makeChain({ data: [
          { id: 'PROD-A', name: '자식카메라A', parent_product_id: 'PARENT-A' },
          { id: 'PROD-B', name: '자식렌즈B', parent_product_id: null },
        ], error: null })
      }
      return makeChain({ data: { pickup_frontdoor_password: null }, error: null })
    })

    // resolveParentProductFields가 PROD-A의 name을 부모 이름으로 교체
    mockResolveParentProductFields.mockImplementation(
      async (_client: unknown, rows: { id: string; name: string | null; parent_product_id: string | null }[]) =>
        rows.map(r => r.id === 'PROD-A' ? { ...r, name: '부모카메라A(부모이름)' } : r)
    )

    const { GET } = await import('../../routes/api/cms/reservations/[id]/request-notes/+server')
    const res = await GET({ params: { id: '10' }, locals: makeLocals(), request: {} as Request, url: new URL('http://localhost') } as never) as { status: number; json: () => Promise<unknown> }
    const body = await res.json() as { pickup_request_note: string | null }

    // 병합 문구에 부모 이름이 사용됨 (자식 이름 '자식카메라A'가 아니라 '부모카메라A(부모이름)')
    expect(body.pickup_request_note).toContain('부모카메라A(부모이름)')
    expect(body.pickup_request_note).not.toContain('자식카메라A')
    expect(body.pickup_request_note).toContain('자식렌즈B')
    expect(mockResolveParentProductFields).toHaveBeenCalled()
  })
})
