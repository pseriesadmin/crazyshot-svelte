/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 고정된 프로젝트 소스 경로를 읽는 용도 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 2026-10-27 (Stephen 지시): CMS 대여정보에 고객 요청사항(공동현관 출입번호 등)을 읽기 전용으로 표시한다.
 * 고객이 장바구니에서 남긴 요청사항은 예약에 저장되지만(수령용·반납용·단일 notes) 관리자 화면 어디에도 읽는 코드가 없었다.
 *  RN-1  메뉴 권한 게이트가 먼저 실행되고 거절이면 DB를 읽지 않는다
 *  RN-2  수령·반납·단일 요청사항을 공백 정리해 돌려준다(빈 문자열·공백뿐이면 null)
 *  RN-3  잘못된 예약 ID 400 · 없는 예약 404 · 조회 오류 500(내부 메시지 미노출)
 *  RN-5  공동현관 출입번호(pickup_frontdoor_password, Migration #774)는 manager 이상에게만 내려주고 partner 에는 null
 *  RN-4  패널이 이 API 를 읽고 세 항목을 화면에 표시하며, 쓰기(PATCH/POST) 기능은 없다
 */

const mockGuard = vi.fn()
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: (...a: unknown[]) => mockGuard(...a) }))
const mockRole = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: (...a: unknown[]) => mockRole(...a) }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co' }))
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, async json() { return data } }),
}))

// P3-4: listOrderReservationIds를 모킹 — 단건 반환(단일 예약 시나리오)
vi.mock('$lib/server/dheroOrderUnits', () => ({
  listOrderReservationIds: vi.fn().mockImplementation(async (_: unknown, id: number) => [id]),
}))

const mockSingle = vi.fn()
const mockFrom = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: mockFrom }) }))

const handler = await import('../../routes/api/cms/reservations/[id]/request-notes/+server')
const GET = handler.GET as unknown as (e: unknown) => Promise<{ status: number; json(): Promise<Record<string, unknown>> }>

// P3-4: 주 조회(rental_reservations .in())와 frontdoor 조회(rental_reservations .maybeSingle())를 분리
// select 컬럼명으로 조회 경로를 구분: 'id, notes...' → .in() 반환 / 'pickup_frontdoor_password' → .eq().maybeSingle()
let mockInRows: { data: Record<string, unknown>[] | null; error: unknown } = { data: [], error: null }
const mockFrontdoorSingle = vi.fn()

beforeEach(() => {
  mockGuard.mockReset().mockResolvedValue(null)
  mockRole.mockReset().mockResolvedValue('manager')
  mockSingle.mockReset()
  mockFrontdoorSingle.mockReset().mockResolvedValue({ data: null, error: null })
  mockInRows = { data: [], error: null }

  mockFrom.mockReset().mockImplementation((table: string) => {
    if (table === 'products') {
      return { select: vi.fn().mockReturnValue({ in: vi.fn().mockReturnValue(Promise.resolve({ data: [], error: null })) }) }
    }
    // rental_reservations: select 컬럼으로 경로 구분
    return {
      select: vi.fn().mockImplementation((cols: string) => {
        if (cols.includes('pickup_frontdoor_password')) {
          // frontdoor 전용 조회 경로 — .eq().maybeSingle()
          return { eq: vi.fn().mockReturnValue({ maybeSingle: mockFrontdoorSingle }) }
        }
        // 주 조회 경로 — .in() 으로 배열 반환
        return { in: vi.fn().mockReturnValue(Promise.resolve(mockInRows)) }
      })
    }
  })
})

describe('GET /api/cms/reservations/[id]/request-notes', () => {
  it('RN-1: 메뉴 권한이 거절이면 그 응답을 그대로 돌려주고 DB 를 읽지 않는다', async () => {
    mockGuard.mockResolvedValue({ status: 403, async json() { return { error: 'denied' } } })
    const res = await GET({ params: { id: '5' }, locals: {} })
    expect(res.status).toBe(403)
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockGuard).toHaveBeenCalledWith(expect.anything(), 'rental.reservation')
  })

  it('RN-2: 수령·반납·단일 요청사항을 공백 정리해 돌려주고 빈 값은 null 이다', async () => {
    mockInRows = { data: [{ id: 5, notes: '  공동현관 0418* ', pickup_request_note: '경비실 호출', return_request_note: '   ', product_id: null }], error: null }
    mockFrontdoorSingle.mockResolvedValue({ data: null, error: null })
    const res = await GET({ params: { id: '5' }, locals: {} })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ notes: '공동현관 0418*', pickup_request_note: '경비실 호출', return_request_note: null, pickup_frontdoor_password: null })
  })

  it('RN-5: 공동현관 출입번호는 manager 이상에게만 내려주고 partner 에는 null 이다', async () => {
    mockInRows = { data: [{ id: 5, notes: null, pickup_request_note: null, return_request_note: null, product_id: null }], error: null }
    mockFrontdoorSingle.mockResolvedValue({ data: { pickup_frontdoor_password: ' #0418* ' }, error: null })
    expect((await (await GET({ params: { id: '5' }, locals: {} })).json()).pickup_frontdoor_password).toBe('#0418*')
    mockRole.mockResolvedValue('partner')
    const res = await GET({ params: { id: '5' }, locals: {} })
    expect(res.status).toBe(200)
    expect((await res.json()).pickup_frontdoor_password).toBeNull()
  })

  it('RN-3: 잘못된 ID 는 400, 없는 예약은 404, 조회 오류는 500(내부 메시지 미노출)', async () => {
    expect((await GET({ params: { id: 'abc' }, locals: {} })).status).toBe(400)
    expect((await GET({ params: { id: '0' }, locals: {} })).status).toBe(400)
    // 404: .in() 결과가 빈 배열
    mockInRows = { data: [], error: null }
    expect((await GET({ params: { id: '5' }, locals: {} })).status).toBe(404)
    // 500: .in() 결과에 error
    mockInRows = { data: null, error: { message: 'secret db detail' } }
    const res = await GET({ params: { id: '5' }, locals: {} })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret db detail')
  })
})

describe('RentalDetailPanel — 고객 요청사항 표시 배선', () => {
  const panel = readFileSync(join(process.cwd(), 'src/lib/components/cms/RentalDetailPanel.svelte'), 'utf-8')
  const api = readFileSync(join(process.cwd(), 'src/routes/api/cms/reservations/[id]/request-notes/+server.ts'), 'utf-8')

  it('RN-4: 패널이 API 를 읽어 요청 사항·수령 요청·반납 요청을 표시하고, API 는 읽기 전용이다', () => {
    expect(panel).toContain('/request-notes')
    expect(panel).toContain('요청 사항')
    expect(panel).toContain('수령 요청')
    expect(panel).toContain('반납 요청')
    expect(panel).toContain('공동현관 출입번호')
    expect(panel).toContain("requestNotes?.pickup_frontdoor_password ?? '-'")
    // 행은 배송형 수령 + manager 이상일 때만, 값이 없어도 '-'로 항상 보인다(2026-10-27)
    expect(panel).toContain('{#if trackingApplicable === true && canManagePaymentAndLocker}')
    expect(panel).toContain('requestNotes?.pickup_request_note')
    expect(api).not.toMatch(/export const (POST|PATCH|PUT|DELETE)/)
  })
})
