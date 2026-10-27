// src/routes/api/cart/validate-delivery-address/+server.ts
// 배송 가능 주소 사전 검증 — 두발히어로 연동(is_dhero_integration) 방식 선택 시 비차단 경고용
//
// 설계 원칙:
//  - 로그인 세션 필요 (비회원 체크아웃 없음)
//  - 연동 대상 방식이 아닐 때는 무조건 valid:true 반환 (두발히어로 호출 불필요 — 판정은 isDheroIntegrationMethod, 장바구니 요청 A 스위치와 무관)
//  - validateAddress() 실패 → fail-soft (valid:true 반환, 서버 에러가 UX를 막지 않음)
//  - 이 응답이 valid:false여도 제출 자체를 막지 않음 (경고 toast만 표시)
//  - 배송 허용지역(delivery_service_areas)이 등록돼 있고 배송형(is_delivery_type) 방식이면 지역 밖은 valid:false + reason:'out_of_area'
//    (실제 차단은 장바구니 제출 게이트 + set_reservation_shipment_method가 한다 — 이 응답은 사전 안내용)
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { validateAddress } from '$lib/server/dhero'
import { isDheroIntegrationMethod } from '$lib/server/isDheroIntegrationMethod'
import { isAddressInDeliveryArea, attachZipRanges, type DeliveryAreaLike } from '$lib/utils/deliveryArea'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request, locals }) => {
  // 로그인 세션 필수
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  let body: { address?: unknown; postalCode?: unknown; methodKey?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }

  const address   = typeof body.address   === 'string' ? body.address.trim()   : ''
  const postalCode = typeof body.postalCode === 'string' ? body.postalCode.trim() : ''
  const methodKey  = typeof body.methodKey  === 'string' ? body.methodKey.trim()  : ''

  if (!address || !postalCode) {
    return json({ valid: true }) // 주소 미입력 = 검증 불필요 (제출 시 별도 validation)
  }

  // 연동 대상 방식인지 isDheroIntegrationMethod() 공유 함수로 판단 (2026-10-27 스위치 분리 — 전엔 is_bulk_delivery 재사용)
  // 기존 인라인 rental_method_options 조회를 제거하고 공유 유틸 재사용 (DRY 원칙)
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 배송 허용지역 검사 (fail-soft — 조회 실패 시 통과)
  try {
    const { data: typeRow } = await admin
      .from('rental_method_options')
      .select('is_delivery_type')
      .eq('method_key', methodKey)
      .is('deleted_at', null)
      .maybeSingle()
    if ((typeRow as { is_delivery_type?: boolean } | null)?.is_delivery_type) {
      const { data: areaRows } = await (admin as unknown as { from: (t: string) => { select: (c: string) => { is: (c: string, v: null) => Promise<{ data: DeliveryAreaLike[] | null }> } } })
        .from('delivery_service_areas')
        .select('sido, sigungu')
        .is('deleted_at', null)
      const { data: zipRows } = await (admin as unknown as { rpc: (fn: string) => Promise<{ data: Array<{ sido: string; sigungu: string; range_start: number; range_end: number }> | null }> }).rpc('get_delivery_zip_ranges')
      const areasWithZips = attachZipRanges(areaRows ?? [], zipRows ?? [])
      if (!isAddressInDeliveryArea(address, areasWithZips, postalCode)) {
        return json({ valid: false, reason: 'out_of_area' })
      }
    }
  } catch {
    // 지역 조회 실패 → 낙관적 처리
  }

  const isDheroOn = await isDheroIntegrationMethod(admin, methodKey)
  if (!isDheroOn) {
    return json({ valid: true }) // 배송 방식이 두발히어로 아님 → 검증 불필요
  }

  // 두발히어로 주소 검증 (fail-soft)
  try {
    const res = await validateAddress({ address, postalCode })
    return json({ valid: res.valid, dongGroup: res.dongGroup ?? null })
  } catch {
    // API 실패 → 경고 toast 안 띄움 (배송 가능 여부 불명 시 낙관적 처리)
    return json({ valid: true })
  }
}
