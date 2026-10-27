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

import { resolveParentProductFields } from '$lib/server/products/resolveParentProductFields'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = { from: (table: string) => any }

export interface DheroReservationInfo {
  reservationId:     number
  status:            string
  pickupMethod:      string | null
  returnMethod:      string | null
  trackingNumber:    string | null
  courierCode:       string | null  // 운송장 택배사('두발히어로'면 두발히어로 접수번호) — 출고 처리의 재접수 방지 판정용
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
  notes:             string | null  // 옛 요청사항 컬럼(운영 5건뿐) — 새 요청은 pickupRequestNote·returnRequestNote
  pickupRequestNote: string | null  // 장바구니 '요청 사항'(수령용, Migration #476) — 두발히어로 배송 접수 memoFromCustomer 의 원천
  returnRequestNote: string | null  // 장바구니 '요청 사항'(반납용)
  frontdoorPassword: string | null  // 수령 주소 공동현관 출입번호(장바구니 전용 칸, Migration #774) — 두발히어로 frontdoorPassword(운송장 미인쇄)로 전달
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
    .select('id, status, pickup_method, return_method, tracking_number, courier_code, reservation_code, user_id, product_id, dhero_status, dhero_status_code, dhero_synced_at, dhero_meta, dhero_dong_group, dhero_return_book_id, notes, pickup_request_note, return_request_note, pickup_address_road, pickup_address_detail, pickup_postal_code')
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

  // 공동현관 출입번호(Migration #774) — 핵심 조회에서 분리한 fail-soft 단건 조회.
  // 컬럼이 아직 없는 환경(DB 적용 전 코드 배포)에서도 조회 오류가 예약 조회 전체를 null 로 만들어 접수·상태 조회·반품 접수가 멈추지 않게 한다.
  let frontdoorPassword: string | null = null
  try {
    const { data: fd } = await admin
      .from('rental_reservations')
      .select('pickup_frontdoor_password')
      .eq('id', reservationId)
      .maybeSingle()
    const v = (fd as { pickup_frontdoor_password?: unknown } | null)?.pickup_frontdoor_password
    frontdoorPassword = typeof v === 'string' && v.trim() !== '' ? v : null
  } catch { /* fail-soft — 출입번호만 비어 접수된다 */ }

  // 고객 정보 (user_profiles JOIN)
  const { data: profile } = await admin
    .from('user_profiles')
    .select('full_name, phone')
    .eq('user_id', r.user_id as string)
    .maybeSingle()

  // 배송지 — 예약신청 시점 스냅샷(pickup_address_road/detail)이 정본이다.
  // 고객 계정에 저장된 배송지(user_shipping_addresses)는 장바구니에서 주소를 직접 입력한 고객에게는
  // 없을 수 있어(0건이면 주소가 빈 값으로 두발히어로에 나가 접수가 조용히 실패하던 결함, 2026-10-12)
  // 스냅샷이 없을 때와 우편번호 보충용으로만 쓴다. 우편번호는 예약에 저장되지 않으므로 같은 도로명 주소의
  // 저장 배송지에서 찾는다.
  const snapRoad   = ((r.pickup_address_road as string | null) ?? '').trim()
  const snapDetail = ((r.pickup_address_detail as string | null) ?? '').trim()
  // 2026-10-13(Migration #704): 예약신청 시점에 저장된 우편번호가 정본 — 없을 때만(옛 예약) 같은 도로명 주소의 저장 배송지에서 찾는다
  const snapPostal = ((r.pickup_postal_code as string | null) ?? '').trim()

  const { data: savedAddrs } = await admin
    .from('user_shipping_addresses')
    .select('road_address, detail_address, postal_code, is_default, sort_order')
    .eq('user_id', r.user_id as string)
    .order('is_default', { ascending: false })
    .order('sort_order', { ascending: true })
  const saved = (savedAddrs ?? []) as Array<{ road_address: string | null; detail_address: string | null; postal_code: string | null }>
  const norm = (v: string | null | undefined): string => (v ?? '').replace(/\s+/g, '')

  const matched = snapRoad ? saved.find((a) => norm(a.road_address) === norm(snapRoad)) : undefined
  const fallback = saved[0]
  const addr = snapRoad
    ? { road_address: snapRoad, detail_address: snapDetail || (matched?.detail_address ?? ''), postal_code: snapPostal || (matched?.postal_code ?? '') }
    : (fallback ?? null)

  // 상품명
  // 자식 재고의 이름은 부모 값을 따른다(자식 재고 부모 참조 전환 Phase 3-C) — 배송 주문서에 전달되는 상품명
  const { data: productRow } = await admin
    .from('products')
    .select('name, parent_product_id')
    .eq('id', r.product_id as string)
    .maybeSingle()
  const [resolvedProduct] = productRow
    ? await resolveParentProductFields(admin, [productRow as { name: string | null; parent_product_id: string | null }], ['name'])
    : []
  const product = { name: resolvedProduct?.name ?? null }

  return {
    reservationId,
    status:            r.status as string,
    pickupMethod:      r.pickup_method as string | null,
    returnMethod:      r.return_method as string | null,
    trackingNumber:    r.tracking_number as string | null,
    courierCode:       (r.courier_code as string | null | undefined) ?? null,
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
    pickupRequestNote: (r.pickup_request_note as string | null | undefined) ?? null,
    returnRequestNote: (r.return_request_note as string | null | undefined) ?? null,
    frontdoorPassword,
  }
}
