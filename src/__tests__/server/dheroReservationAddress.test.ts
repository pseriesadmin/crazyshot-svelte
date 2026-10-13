import { describe, it, expect } from 'vitest'
import { getReservationForDhero } from '$lib/server/getReservationForDhero'

/**
 * 두발히어로 접수 주소 정본 — 예약 스냅샷(pickup_address_road/detail) 우선,
 * 우편번호는 같은 도로명 주소의 저장 배송지에서 보충, 스냅샷이 없으면 저장 배송지로 폴백.
 * (저장 배송지가 0건인 고객의 접수가 빈 주소로 조용히 실패하던 결함, 2026-10-12)
 */

type Row = Record<string, unknown> | Array<Record<string, unknown>> | null

function makeAdmin(tables: Record<string, Row>) {
  return {
    from: (table: string) => {
      const data = tables[table] ?? null
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'limit', 'is', 'in']) chain[m] = () => chain
      chain.maybeSingle = async () => ({ data: Array.isArray(data) ? (data[0] ?? null) : data, error: null })
      chain.then = (resolve: (v: unknown) => void) => resolve({ data, error: null })
      return chain
    },
  }
}

const baseRes = {
  id: 1, status: 'shipped', pickup_method: 'delivery', return_method: 'delivery',
  tracking_number: null, reservation_code: 'CS1', user_id: 'u1', product_id: 'p1',
  dhero_status: null, dhero_status_code: null, dhero_synced_at: null, dhero_meta: null,
  dhero_dong_group: null, dhero_return_book_id: null, notes: null,
}

describe('getReservationForDhero 주소 정본', () => {
  it('저장 배송지가 0건이어도 예약 스냅샷 주소를 쓴다(우편번호는 비어 있음)', async () => {
    const admin = makeAdmin({
      rental_reservations: { ...baseRes, pickup_address_road: '경기 의정부시 평화로568번길 45', pickup_address_detail: '101호' },
      user_profiles: { full_name: '홍길동', phone: '01012345678' },
      user_shipping_addresses: [],
      products: { name: '카메라', parent_product_id: null },
    })
    const res = await getReservationForDhero(admin, 1)
    expect(res?.address).toBe('경기 의정부시 평화로568번길 45')
    expect(res?.addressDetail).toBe('101호')
    expect(res?.postalCode).toBe('')
  })

  it('예약에 저장된 우편번호가 있으면 저장 배송지가 없어도 그 값을 쓴다(Migration #704)', async () => {
    const admin = makeAdmin({
      rental_reservations: { ...baseRes, pickup_address_road: '경기 성남시 분당구 서판교로 32', pickup_address_detail: '101호', pickup_postal_code: '13479' },
      user_profiles: { full_name: '홍길동', phone: '01012345678' },
      user_shipping_addresses: [],
      products: { name: '카메라', parent_product_id: null },
    })
    const res = await getReservationForDhero(admin, 1)
    expect(res?.postalCode).toBe('13479')
  })

  it('예약 우편번호가 저장 배송지 값보다 우선한다', async () => {
    const admin = makeAdmin({
      rental_reservations: { ...baseRes, pickup_address_road: '서울 강남구 테헤란로 1', pickup_address_detail: null, pickup_postal_code: '06236' },
      user_profiles: { full_name: '홍길동', phone: '01012345678' },
      user_shipping_addresses: [{ road_address: '서울 강남구 테헤란로 1', detail_address: '2층', postal_code: '99999', is_default: true }],
      products: { name: '카메라', parent_product_id: null },
    })
    const res = await getReservationForDhero(admin, 1)
    expect(res?.postalCode).toBe('06236')
  })

  it('같은 도로명 주소의 저장 배송지에서 우편번호를 보충한다', async () => {
    const admin = makeAdmin({
      rental_reservations: { ...baseRes, pickup_address_road: '서울 강남구 테헤란로 1', pickup_address_detail: null },
      user_profiles: { full_name: '홍길동', phone: '01012345678' },
      user_shipping_addresses: [
        { road_address: '다른 주소', detail_address: 'x', postal_code: '11111', is_default: true },
        { road_address: '서울 강남구  테헤란로 1', detail_address: '2층', postal_code: '06236', is_default: false },
      ],
      products: { name: '카메라', parent_product_id: null },
    })
    const res = await getReservationForDhero(admin, 1)
    expect(res?.address).toBe('서울 강남구 테헤란로 1')
    expect(res?.postalCode).toBe('06236')
    expect(res?.addressDetail).toBe('2층')
  })

  it('스냅샷이 없으면 저장 배송지(기본 우선)로 폴백한다', async () => {
    const admin = makeAdmin({
      rental_reservations: { ...baseRes, pickup_address_road: null, pickup_address_detail: null },
      user_profiles: { full_name: '홍길동', phone: '01012345678' },
      user_shipping_addresses: [{ road_address: '기본 주소', detail_address: '3호', postal_code: '22222', is_default: true }],
      products: { name: '카메라', parent_product_id: null },
    })
    const res = await getReservationForDhero(admin, 1)
    expect(res?.address).toBe('기본 주소')
    expect(res?.postalCode).toBe('22222')
  })
})
