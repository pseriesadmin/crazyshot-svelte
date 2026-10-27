import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 공동현관 출입번호(Migration #774) — 배포 순서 방어와 매핑 (2026-10-27, sp3 지적)
 * DB 적용 전에 코드가 먼저 배포돼 컬럼이 없어도 두발히어로 예약 조회·요청사항 조회가 통째로 깨지면 안 된다.
 *
 * FO-1 getReservationForDhero: 핵심 조회 select 에 신규 컬럼이 없다(소스 가드)
 * FO-2 getReservationForDhero: 출입번호 조회가 오류·예외여도 예약 정보는 null 이 아니고 frontdoorPassword 만 null
 * FO-2b 실제 DB 클라이언트처럼 예외 대신 { data:null, error } 를 돌려줘도(컬럼 없음) 같은 결과
 * FO-3 getReservationForDhero: 저장된 값이 있으면 frontdoorPassword 로 매핑된다(컬럼→필드 변이 포착)
 * FO-4 request-notes: 출입번호 조회가 예외여도 200 이고 나머지 요청사항은 정상, 출입번호만 null
 */

import { getReservationForDhero } from '$lib/server/getReservationForDhero'

function makeAdmin(opts: { frontdoor?: unknown; frontdoorThrows?: boolean; frontdoorErrors?: boolean }) {
  const baseRes = {
    id: 1, status: 'shipped', pickup_method: 'delivery', return_method: 'delivery', tracking_number: null, courier_code: null,
    reservation_code: 'CS1', user_id: 'u1', product_id: 'p1', dhero_status: null, dhero_status_code: null, dhero_synced_at: null, dhero_meta: null,
    dhero_dong_group: null, dhero_return_book_id: null, notes: null, pickup_address_road: '서울 강남구 테헤란로 1', pickup_address_detail: '101호', pickup_postal_code: '06236',
  }
  return {
    from: (table: string) => {
      let cols = ''
      const chain: Record<string, unknown> = {}
      for (const m of ['eq', 'order', 'limit', 'is', 'in']) chain[m] = () => chain
      chain.select = (c: string) => { cols = c; return chain }
      const data = (): unknown => {
        if (table === 'rental_reservations') {
          if (cols.trim() === 'pickup_frontdoor_password') {
            if (opts.frontdoorThrows) throw new Error('column does not exist')
            return { pickup_frontdoor_password: opts.frontdoor ?? null }
          }
          return baseRes
        }
        if (table === 'user_profiles') return { full_name: '홍길동', phone: '01012345678' }
        if (table === 'products') return { name: '카메라', parent_product_id: null }
        return []
      }
      const isFrontdoorQuery = () => table === 'rental_reservations' && cols.trim() === 'pickup_frontdoor_password'
      chain.maybeSingle = async () => (opts.frontdoorErrors && isFrontdoorQuery()
        ? { data: null, error: { message: 'column rental_reservations.pickup_frontdoor_password does not exist', code: '42703' } }
        : { data: data(), error: null })
      chain.then = (resolve: (v: unknown) => void) => resolve({ data: data(), error: null })
      return chain
    },
  }
}

describe('getReservationForDhero — 공동현관 출입번호 분리·매핑', () => {
  it('FO-1: 핵심 조회 select 에 신규 컬럼을 섞지 않는다(소스 가드)', () => {
    const src = readFileSync('src/lib/server/getReservationForDhero.ts', 'utf8')
    const mainSelect = src.slice(src.indexOf(".select('id, status, pickup_method"), src.indexOf(".eq('id', reservationId)"))
    expect(mainSelect).not.toContain('pickup_frontdoor_password')
    expect(src).toContain(".select('pickup_frontdoor_password')")
  })

  it('FO-2: 출입번호 조회가 예외여도 예약 정보는 null 이 아니고 frontdoorPassword 만 null', async () => {
    const res = await getReservationForDhero(makeAdmin({ frontdoorThrows: true }), 1)
    expect(res).not.toBeNull()
    expect(res?.address).toBe('서울 강남구 테헤란로 1')
    expect(res?.frontdoorPassword).toBeNull()
  })

  it('FO-2b: 예외 대신 { data:null, error } 가 와도(컬럼 없음, 실제 DB 클라이언트 형태) 예약 정보는 그대로이고 값만 null', async () => {
    const res = await getReservationForDhero(makeAdmin({ frontdoorErrors: true }), 1)
    expect(res).not.toBeNull()
    expect(res?.address).toBe('서울 강남구 테헤란로 1')
    expect(res?.frontdoorPassword).toBeNull()
  })

  it('FO-3: 저장된 값은 frontdoorPassword 로 매핑되고, 빈 문자열은 null', async () => {
    expect((await getReservationForDhero(makeAdmin({ frontdoor: '#0418*' }), 1))?.frontdoorPassword).toBe('#0418*')
    expect((await getReservationForDhero(makeAdmin({ frontdoor: '  ' }), 1))?.frontdoorPassword).toBeNull()
    expect((await getReservationForDhero(makeAdmin({}), 1))?.frontdoorPassword).toBeNull()
  })
})

describe('request-notes — 출입번호 조회 분리', () => {
  const mockGuard = vi.fn()
  const mockRole = vi.fn()
  const state = { frontdoorThrows: false }

  beforeEach(() => {
    mockGuard.mockReset().mockResolvedValue(null)
    mockRole.mockReset().mockResolvedValue('manager')
    state.frontdoorThrows = false
    vi.resetModules()
    vi.doMock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: (...a: unknown[]) => mockGuard(...a) }))
    vi.doMock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: (...a: unknown[]) => mockRole(...a) }))
    vi.doMock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
    vi.doMock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co' }))
    vi.doMock('@sveltejs/kit', () => ({ json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, async json() { return data } }) }))
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from: () => {
          let cols = ''
          const chain: Record<string, unknown> = {}
          chain.select = (c: string) => { cols = c; return chain }
          chain.eq = () => chain
          chain.maybeSingle = async () => {
            if (cols.includes('pickup_frontdoor_password')) {
              if (state.frontdoorThrows) throw new Error('column does not exist')
              return { data: { pickup_frontdoor_password: ' #0418* ' }, error: null }
            }
            return { data: { notes: null, pickup_request_note: '경비실', return_request_note: null }, error: null }
          }
          return chain
        },
      }),
    }))
  })

  it('FO-4: 출입번호 조회가 예외여도 200 이고 나머지 요청사항은 정상, 출입번호만 null', async () => {
    state.frontdoorThrows = true
    const { GET } = await import('../../routes/api/cms/reservations/[id]/request-notes/+server')
    const res = (await (GET as unknown as (e: unknown) => Promise<{ status: number; json(): Promise<Record<string, unknown>> }>)({ params: { id: '5' }, locals: {} }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pickup_request_note).toBe('경비실')
    expect(body.pickup_frontdoor_password).toBeNull()
  })

  it('FO-4b: 정상이면 manager 에게 값이 내려가고, partner 는 출입번호를 조회하지도 않는다', async () => {
    const { GET } = await import('../../routes/api/cms/reservations/[id]/request-notes/+server')
    const call = GET as unknown as (e: unknown) => Promise<{ json(): Promise<Record<string, unknown>> }>
    expect((await (await call({ params: { id: '5' }, locals: {} })).json()).pickup_frontdoor_password).toBe('#0418*')
    mockRole.mockResolvedValue('partner')
    expect((await (await call({ params: { id: '5' }, locals: {} })).json()).pickup_frontdoor_password).toBeNull()
  })
})
