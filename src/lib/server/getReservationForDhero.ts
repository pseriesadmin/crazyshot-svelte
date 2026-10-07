// src/lib/server/getReservationForDhero.ts
// 두발히어로 API 호출에 필요한 예약 정보 JOIN 조회 — 공유 서버 유틸
//
// rental_reservations에는 고객명·전화·주소·상품명이 직접 없음:
//   고객정보: user_profiles        (full_name, phone)
//   배송주소: user_shipping_addresses (road_address, detail_address, postal_code)
//   상품명:   products             (name)
//
// 이 함수를 공유하는 이유 (CRITICAL-1 수정 — 2026-08-25):
//   기존 cms/reservation/+page.server.ts의 updateStatus 액션이 rental_reservations에서
//   존재하지 않는 컬럼(customer_name/customer_phone/addr/addr_detail/postal_code/product_name)을
//   select 해 PostgREST 42703 오류로 항상 null을 반환, 자동 두발히어로 호출이 한 번도
//   실행되지 않던 버그를 수정. 올바른 JOIN 패턴을 이 공유 모듈에 단일화.
//
// 사용처:
//   1. src/routes/api/cms/reservations/[id]/dhero/+server.ts (수동 배송접수·상태조회)
//   2. src/routes/cms/reservation/+page.server.ts updateStatus (shipped/return_requested/cancelled 자동 트리거)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = { from: (table: string) => any }

export interface DheroReservationInfo {
  reservationId:     number
  status:            string
  pickupMethod:      string | null
  returnMethod:      string | null
  trackingNumber:    string | null
  reservationCode:   string | null
  dheroStatus:       string | null
  dheroStatusCode:   number | null
  dheroSyncedAt:     string | null
  dheroDongGroup:    string | null
  dheroReturnBookId: string | null
  dheroMeta:         Record<string, unknown> | null
  customerName:      string
  customerPhone:     string
  address:           string
  addressDetail:     string
  postalCode:        string
  productName:       string
  notes:             string | null  // 고객 요청사항 (memoFromCustomer 매핑용)
}

/**
 * 두발히어로 API 호출에 필요한 예약 정보를 JOIN 조회로 반환.
 * rental_reservations의 실존 컬럼만 select + user_profiles/user_shipping_addresses/products JOIN.
 * 실패 시 null 반환(조회 오류는 console.error로 로깅).
 */
export async function getReservationForDhero(
  admin: AnySupabaseClient,
  reservationId: number,
): Promise<DheroReservationInfo | null> {
  // rental_reservations 기본 정보 — 실제 존재하는 컬럼만 (customer_name 등은 여기 없음)
  const { data: resRow, error: resError } = await admin
    .from('rental_reservations')
    .select('id, status, pickup_method, return_method, tracking_number, reservation_code, user_id, product_id, dhero_status, dhero_status_code, dhero_synced_at, dhero_meta, dhero_dong_group, dhero_return_book_id, notes')
    .eq('id', reservationId)
    .maybeSingle()

  if (resError) {
    console.error(
      '[getReservationForDhero] rental_reservations 조회 실패:',
      resError.message,
      '| reservation_id:', reservationId,
    )
  }
  if (!resRow) return null

  const r = resRow as Record<string, unknown>

  // 고객 정보 (user_profiles JOIN)
  const { data: profile } = await admin
    .from('user_profiles')
    .select('full_name, phone')
    .eq('user_id', r.user_id as string)
    .maybeSingle()

  // 고객 기본 배송지 (user_shipping_addresses — is_default=true 우선)
  const { data: addrRow } = await admin
    .from('user_shipping_addresses')
    .select('road_address, detail_address, postal_code, recipient')
    .eq('user_id', r.user_id as string)
    .eq('is_default', true)
    .maybeSingle()

  // 기본 배송지가 없으면 첫 번째 배송지 시도
  const { data: fallbackAddr } = !addrRow ? await admin
    .from('user_shipping_addresses')
    .select('road_address, detail_address, postal_code, recipient')
    .eq('user_id', r.user_id as string)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle() : { data: null }

  const addr = addrRow ?? fallbackAddr

  // 상품명
  const { data: product } = await admin
    .from('products')
    .select('name')
    .eq('id', r.product_id as string)
    .maybeSingle()

  return {
    reservationId,
    status:            r.status as string,
    pickupMethod:      r.pickup_method as string | null,
    returnMethod:      r.return_method as string | null,
    trackingNumber:    r.tracking_number as string | null,
    reservationCode:   r.reservation_code as string | null,
    dheroStatus:       r.dhero_status as string | null,
    dheroStatusCode:   r.dhero_status_code as number | null,
    dheroSyncedAt:     r.dhero_synced_at as string | null,
    dheroDongGroup:    r.dhero_dong_group as string | null,
    dheroReturnBookId: r.dhero_return_book_id as string | null,
    dheroMeta:         r.dhero_meta as Record<string, unknown> | null,
    customerName:      ((profile as Record<string, unknown> | null)?.full_name as string) ?? '',
    customerPhone:     ((profile as Record<string, unknown> | null)?.phone as string) ?? '',
    address:           ((addr as Record<string, unknown> | null)?.road_address as string) ?? '',
    addressDetail:     ((addr as Record<string, unknown> | null)?.detail_address as string | null) ?? '',
    postalCode:        ((addr as Record<string, unknown> | null)?.postal_code as string) ?? '',
    productName:       ((product as Record<string, unknown> | null)?.name as string) ?? '',
    notes:             (r.notes as string | null) ?? null,
  }
}
