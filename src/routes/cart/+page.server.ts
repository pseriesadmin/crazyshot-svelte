import { redirect } from '@sveltejs/kit'
import { isRealMemberSession } from '$lib/utils/authGuard'
import { loadCourierClosedDates } from '$lib/server/courierClosedDates'
import { isCouponEligible } from '$lib/server/coupons/couponEligibility'
import { groupCartLineItems } from '$lib/utils/cartLineGrouping'
import { resolveParentProductId } from '$lib/services/reservationHelper'
import type { PageServerLoad } from './$types'
import type { SupabaseClient } from '@supabase/supabase-js'

// database.ts에 rental_guide_settings 미등록 상태 — cms/set/rental/+page.server.ts와 동일 패턴
// (generate_typescript_types 이후 제거)
function untypedFrom(sb: SupabaseClient, table: string) {
  return (sb as unknown as { from: (t: string) => ReturnType<SupabaseClient['from']> }).from(table)
}

export const load: PageServerLoad = async ({ locals }) => {
  const supabase = locals.supabase

  // 배송 방식 옵션 — 세션 불필요, 모든 사용자에게 제공
  const { data: deliveryOptionsData } = await supabase
    .from('rental_method_options')
    .select('id, method_key, name, deadline_time, display_order, is_bulk_delivery, is_courier_dependent')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('display_order', { ascending: true })
  const deliveryOptions = (deliveryOptionsData ?? []) as DeliveryOptionRow[]

  // 방문대여 지점 — 세션 불필요, 모든 사용자에게 제공(deliveryOptions와 동일 패턴).
  // 상품별 허용 지점(allowed_pickup_ids) 교집합 필터링은 클라이언트에서 수행(deliveryTabs와 동일 원칙)
  const { data: pickupPointsData } = await supabase
    .from('pickup_points')
    .select('id, name, address, phone')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  const pickupPoints = (pickupPointsData ?? []) as PickupPointRow[]

  // 택배 휴무일 캘린더 제어(2026-08-24) — 마스터 토글 OFF면 완전히 스킵(빈 배열),
  // ON이면 활성 토글에 해당하는 휴무일자만 모아 courierClosedDates로 전달.
  // isDeliveryLocked(delivery/crazydelivery) 방식일 때만 클라이언트에서 실제로 적용됨.
  const courierClosedDates = await loadCourierClosedDates(supabase)

  // 공통 대여 안내문(/cms/set/rental "공통 대여 안내문") — 이용안내 모달 내용, 세션 불필요
  const { data: guideData } = await untypedFrom(supabase, 'rental_guide_settings')
    .select('guide_text')
    .limit(1)
    .single()
  const rentalGuideText = (guideData as { guide_text?: string } | null)?.guide_text ?? ''

  // 필수 동의문 항목(/cms/set/rental "필수 동의문 항목") — 체크아웃 진행 전 고객이 개별로
  // 확인·체크해야 하는 항목 목록. 세션 불필요, 공개 조회(rentalGuideText와 동일 패턴).
  // 2026-08-30: 등록 UI만 있고 카트/체크아웃 어디서도 조회되지 않던 공백을 감사로 발견해 연결.
  const { data: consentItemsData } = await untypedFrom(supabase, 'rental_consent_items')
    .select('id, content, display_order')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('display_order', { ascending: true })
  const consentItems = (consentItemsData ?? []) as Array<{ id: string; content: string; display_order: number }>

  // 배송비(왕복/배송/반납요금) — CMS "/cms/set/rental > 배송적용옵션"에서 설정한 전역 요금.
  // 상품상세(products/[id])의 "예상 배송비" 안내와 동일 테이블·동일 select — 실제 가격 계산은
  // 상품별 shipping_round_trip/delivery/return 플래그(products 테이블) × 수령·반납 방식이
  // 실제 배송(is_bulk_delivery)인지를 클라이언트에서 조합해 판정한다(2026-08-25 — 그동안
  // rental_method_options.fee_amount(전부 0)만 보고 있어 "무료"로 잘못 표시되던 결함 수정).
  // 2026-08-30: CMS에 fee_amount 입력 UI 자체가 없어 항상 0으로 방치되던 죽은 코드 경로를
  // 감사(RSC-C3)로 발견 — rental_method_options의 fee_amount/is_free_for_top_grade select·
  // 사용을 완전히 제거하고 이 테이블(rental_shipping_settings)만으로 배송비를 계산.
  const { data: shippingSettingsData } = await untypedFrom(supabase, 'rental_shipping_settings')
    .select('enable_round_trip, round_trip_fee, enable_delivery, delivery_fee, enable_return, return_fee, shipping_guide, restrict_return_delivery')
    .limit(1)
    .single()
  const shippingSettings = shippingSettingsData as {
    enable_round_trip: boolean
    round_trip_fee: number | null
    enable_delivery: boolean
    delivery_fee: number | null
    enable_return: boolean
    return_fee: number | null
    shipping_guide: string | null
    restrict_return_delivery: boolean
  } | null

  // 배송료 우대설정(/cms/set/rental "배송료 우대설정") — 조건 만족 시 배송비 할인 조합(최대
  // 5개). 세션 무관, 공개 조회(deliveryOptions/shippingSettings와 동일 패턴).
  const { data: discountTiersData } = await untypedFrom(supabase, 'delivery_fee_discount_tiers')
    .select('min_rental_amount, condition_types, discount_rate')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('min_rental_amount', { ascending: true })
  const discountTiers = (discountTiersData ?? []) as Array<{
    min_rental_amount: number
    condition_types: Array<'long_term_rental' | 'sale_only_purchase' | 'rental_item'>
    discount_rate: number
  }>

  const { session } = await locals.safeGetSession()

  // 장바구니는 가입 완료 계정만 접근 가능 (2026-08-18) — 비회원·익명세션은 /account와
  // 동일하게 로그인 화면으로 리다이렉트한다. 예약(hold/draft)이 실제로 존재하려면 이미
  // 상품상세 예약 게이트를 통과한 실회원이어야 하므로, 여기 도달하는 비회원은 애초에
  // 담긴 항목이 없는 빈 장바구니를 볼 이유도 없다.
  if (!session || !isRealMemberSession(session)) {
    throw redirect(303, '/auth/login?redirect=/cart')
  }

  const FIRST_RENTAL_EXCLUDE = ['hold', 'draft', 'cancelled', 'expired'] as const

  const [cartResult, profileResult, couponResult, addressResult, firstRentalResult, studentResult, subscriptionResult] = await Promise.all([
    supabase
      .from('rental_reservations')
      .select('id, product_id, start_date, end_date, status, pickup_method, return_method, pickup_time, return_time, duration_type')
      .eq('user_id', session.user.id)
      .in('status', ['hold', 'draft'])
      .order('created_at', { ascending: false }),

    supabase
      .from('user_profiles')
      .select('membership_grade, credit_score, points, full_name, phone, email')
      .eq('id', session.user.id)
      .maybeSingle(),

    supabase
      .from('user_coupons')
      .select(`id, coupon_id, used_count,
        coupons(
          id, code, type, discount_type, discount_value, description,
          is_active, deleted_at, valid_from, valid_until,
          user_grade_required, usage_limit, usage_count, total_usage_limit,
          is_first_rental_only, is_student_only, is_subscription_only, is_walk_in_only,
          min_purchase_amount, min_rental_amount, min_rental_days
        )`)
      .eq('user_id', session.user.id)
      .is('used_at', null),

    // "회원정보 반영" 체크박스 활성화 판단 + 실제 자동채움용 — 기본 배송지(is_default) 우선,
    // 없으면 등록순 첫 배송지
    supabase
      .from('user_shipping_addresses')
      .select('road_address, detail_address')
      .eq('user_id', session.user.id)
      .order('is_default', { ascending: false })
      .order('sort_order', { ascending: true })
      .limit(1),

    // 쿠폰 7개 자격조건 中 사용자의존 조건 — Q2/학생/구독 (order-context 불필요)
    // Q2: rental_reservations 직접 조회, rental_count 컬럼 사용 금지 (products.md §2 동일 원칙)
    // ⚠️ rental_reservations에는 deleted_at 컬럼이 없음(Migration 348 적용 전 재검증으로 발견,
    // use_coupon RPC와 동일한 실수 — 여기서도 함께 수정) — 조건에서 제외
    supabase
      .from('rental_reservations')
      .select('id')
      .eq('user_id', session.user.id)
      .not('status', 'in', `(${FIRST_RENTAL_EXCLUDE.map(s => `"${s}"`).join(',')})`)
      .limit(1),

    supabase
      .from('user_profiles')
      .select('is_student')
      .eq('id', session.user.id)
      .maybeSingle(),

    // 실제 구독 테이블명은 subscriptions가 아니라 user_subscriptions이고, 이 테이블에도
    // deleted_at 컬럼이 없음(status CHECK 제약이 'active'/'cancelled'/'expired'만 허용) —
    // use_coupon RPC(Migration 348)와 동일하게 교정
    supabase
      .from('user_subscriptions')
      .select('id')
      .eq('user_id', session.user.id)
      .eq('status', 'active')
      .limit(1),
  ])

  const addressRows = (addressResult.data ?? []) as Array<{ road_address: string | null; detail_address: string | null }>
  const hasUserAddress = addressRows.some(row => !!row.road_address)
  const primaryAddress = addressRows.find(row => !!row.road_address) ?? null

  // ── 쿠폰 1차 필터 (기본 조건 — 날짜·등급·소진한도) ──────────────────────────
  // 7개 자격조건(order-dependent/user-dependent) 2차 필터는 calcTotal 확정 후 적용
  const now = new Date().toISOString()
  const memberGrade = (profileResult.data as ProfileRow | null)?.membership_grade ?? null

  const basicFilteredCoupons = ((couponResult.data ?? []) as RawUserCouponRow[]).filter(uc => {
    const c = uc.coupons
    if (!c) return false
    if (!c.is_active) return false
    if (c.deleted_at) return false
    if (c.valid_from && c.valid_from > now) return false
    if (c.valid_until && c.valid_until < now) return false
    // 등급 조건: user_grade_required가 설정된 쿠폰은 회원 등급 일치 필수
    if (c.user_grade_required && c.user_grade_required !== memberGrade) return false
    // 전체 발급 한도 소진
    if (c.total_usage_limit !== null && c.usage_count >= c.total_usage_limit) return false
    // 개별 사용 한도 소진
    if (c.usage_limit > 0 && c.usage_count >= c.usage_limit) return false
    return true
  })

  const rawReservations = (cartResult.data ?? []) as ReservationRow[]
  // id는 Stage DB bigint이지만 CalculateCartTotalArgs는 string[] — String() 변환으로 호환
  const reservationIds  = rawReservations.map(r => String(r.id))

  let serverProducts: ProductRow[] = []
  let cartProducts:   ProductRow[] = []   // 예약 순서대로 정렬된 카드용 상품 (하위호환)
  let cartLineItems:  CartLineItem[] = []
  let cartLineGroups: ReturnType<typeof groupCartLineItems> = []
  const availableStock: Record<string, number> = {}
  let productPriceRules: Record<string, { price12h: number | null; price24h: number | null; deposit: number | null }> = {}
  let calcTotal = 0, calcDiscount = 0, calcFinal = 0, depositTotal = 0

  if (rawReservations.length > 0) {
    // rental_reservations.product_id는 예약 시 배정된 자식 상품(재고 유닛)의 UUID를 직접 보관
    // (create_hold_reservation RPC 참조) — products RLS는 status='active' 기준이라 일반 세션으로도 조회 가능
    const productIds = [...new Set(rawReservations.map(r => r.product_id).filter((id): id is string => id != null))]
    const reservationIdsRaw = rawReservations.map(r => r.id)
    const [productsResult, priceRulesResult, optionsResult] = await Promise.all([
      productIds.length > 0
        ? supabase
            .from('products')
            .select('id, name, category, brand, slug, image_urls, is_active, created_at, updated_at, deleted_at, allowed_method_ids, allowed_pickup_ids, parent_product_id, shipping_round_trip, shipping_delivery, shipping_return, sale_only, sale_price')
            .in('id', productIds)
        : Promise.resolve({ data: [] as ProductRow[] }),
      productIds.length > 0
        ? supabase
            .from('price_rules')
            .select('product_id, duration_type, price, deposit_amount')
            .in('product_id', productIds)
            .in('duration_type', ['12h', '24h'])
        : Promise.resolve({ data: [] as Array<{ product_id: string; duration_type: string; price: number; deposit_amount: number | null }> }),
      // 옵션상품 + 수량 (Migration 176 reservation_options) — 상품 상세에서 선택한 옵션이 카드에 노출되도록
      supabase
        .from('reservation_options')
        .select('reservation_id, option_product_id, option_name, qty, unit_price')
        .in('reservation_id', reservationIdsRaw),
    ])
    serverProducts = (productsResult.data ?? []) as ProductRow[]

    // 대여방식(allowed_method_ids)·방문지점(allowed_pickup_ids)·배송옵션(shipping_round_trip/
    // delivery/return)은 CMS 대여정책 탭이 부모 상품에만 설정되는 필드(products.md §4-1 —
    // "rental" 탭은 부모 전용) — 예약에 배정된 자식 재고 유닛은 이 값들이 항상 비어있거나(배열)
    // null(배송옵션)이므로, parent_product_id가 있는 자식은 항상 부모 상품의 설정을 대신
    // 조회해 채운다.
    const parentIdsNeeded = [...new Set(
      serverProducts
        .filter(p => p.parent_product_id)
        .map(p => p.parent_product_id as string)
    )]
    if (parentIdsNeeded.length > 0) {
      const { data: parentRows } = await supabase
        .from('products')
        .select('id, allowed_method_ids, allowed_pickup_ids, shipping_round_trip, shipping_delivery, shipping_return, sale_only, sale_price')
        .in('id', parentIdsNeeded)
      const parentRowsTyped = (parentRows ?? []) as Array<{
        id: string
        allowed_method_ids: string[] | null
        allowed_pickup_ids: string[] | null
        shipping_round_trip: boolean | null
        shipping_delivery: boolean | null
        shipping_return: boolean | null
        sale_only: boolean | null
        sale_price: number | null
      }>
      const parentMethodMap = new Map(parentRowsTyped.map(p => [p.id, p.allowed_method_ids ?? []]))
      const parentPickupMap = new Map(parentRowsTyped.map(p => [p.id, p.allowed_pickup_ids ?? []]))
      const parentShippingMap = new Map(parentRowsTyped.map(p => [p.id, p]))
      serverProducts = serverProducts.map(p => {
        if (!p.parent_product_id) return p
        const next = { ...p }
        if (!p.allowed_method_ids || p.allowed_method_ids.length === 0) {
          next.allowed_method_ids = parentMethodMap.get(p.parent_product_id) ?? p.allowed_method_ids
        }
        if (!p.allowed_pickup_ids || p.allowed_pickup_ids.length === 0) {
          next.allowed_pickup_ids = parentPickupMap.get(p.parent_product_id) ?? p.allowed_pickup_ids
        }
        const parentShipping = parentShippingMap.get(p.parent_product_id)
        if (parentShipping) {
          next.shipping_round_trip = parentShipping.shipping_round_trip
          next.shipping_delivery   = parentShipping.shipping_delivery
          next.shipping_return     = parentShipping.shipping_return
          next.sale_only           = parentShipping.sale_only
          next.sale_price          = parentShipping.sale_price
        }
        return next
      })
    }

    for (const row of (priceRulesResult.data ?? []) as Array<{ product_id: string; duration_type: string; price: number; deposit_amount: number | null }>) {
      const entry = productPriceRules[row.product_id] ?? { price12h: null, price24h: null, deposit: null }
      if (row.duration_type === '12h') entry.price12h = row.price
      if (row.duration_type === '24h') { entry.price24h = row.price; entry.deposit = row.deposit_amount }
      productPriceRules[row.product_id] = entry
    }

    const optionRows = (optionsResult.data ?? []) as Array<{ reservation_id: number | string; option_product_id: string | null; option_name: string; qty: number; unit_price: number }>

    // 옵션상품 썸네일 — 카드 UI에서 본상품과 동일한 카드 형태로 노출하기 위해 이미지 추가 조회
    const optionProductIds = [...new Set(optionRows.map(r => r.option_product_id).filter((id): id is string => id != null))]
    const optionImageMap = new Map<string, string | null>()
    if (optionProductIds.length > 0) {
      const { data: optionProducts } = await supabase
        .from('products')
        .select('id, image_urls')
        .in('id', optionProductIds)
      for (const p of (optionProducts ?? []) as Array<{ id: string; image_urls: string[] | null }>) {
        optionImageMap.set(p.id, p.image_urls?.[0] ?? null)
      }
    }

    const optionsByReservation: Record<string, CartLineItemOption[]> = {}
    for (const row of optionRows) {
      const key = String(row.reservation_id)
      const list = optionsByReservation[key] ?? []
      list.push({
        optionProductId: row.option_product_id,
        name:            row.option_name,
        qty:             row.qty,
        unitPrice:       row.unit_price,
        imageUrl:        row.option_product_id ? optionImageMap.get(row.option_product_id) ?? null : null,
      })
      optionsByReservation[key] = list
    }

    // 예약 순서 그대로 상품 매핑 (하위호환 — 카드 UI는 cartLineItems 사용)
    cartProducts = rawReservations.map(r => {
      if (r.product_id == null) return null
      return serverProducts.find(p => p.id === r.product_id) ?? null
    }).filter((p): p is ProductRow => p !== null)

    // 예약-상품-요금 1:1 매핑 (상품 미해결 예약도 누락 없이 포함 — 카트 화면 무제한 목록용)
    cartLineItems = rawReservations.map(r => {
      const product = r.product_id != null ? serverProducts.find(p => p.id === r.product_id) ?? null : null
      const rules = r.product_id != null ? productPriceRules[r.product_id] : undefined
      return {
        reservationId: String(r.id),
        productId:     r.product_id,
        product,
        price12h:      rules?.price12h ?? null,
        price24h:      rules?.price24h ?? null,
        deposit:       rules?.deposit ?? null,
        startDate:     r.start_date,
        endDate:       r.end_date,
        pickupMethod:  r.pickup_method,
        returnMethod:  r.return_method,
        pickupTime:    r.pickup_time,
        returnTime:    r.return_time,
        durationType:  r.duration_type,
        options:       optionsByReservation[String(r.id)] ?? [],
        status:        r.status,
      }
    })

    // 장바구니 표시 레이어 그룹핑(2026-08-28, Stephen GATE B 승인) — 예약행(재고단위)은 그대로
    // 1건=1대 유지하되, 같은 부모상품+같은 날짜(hold)/같은 부모상품(draft)인 예약행들을 카드
    // 1개로 묶어 표시한다. calculate_cart_total 등 금액 계산은 예약행 단위 그대로 유지(아래).
    cartLineGroups = groupCartLineItems(cartLineItems)

    // 가용 재고 수 — 각 그룹의 메인상품(부모 해석) + 옵션상품 전부 배치 조회(Migration 421).
    // products/[id]/+page.server.ts와 동일 규칙("등록된 총 수량 - 점유되지 않은 실제 가용
    // 재고", 날짜 무관 현재시점 스냅샷) — 카트 수량(+) 버튼·옵션 수량(+) 버튼의 사전차단에 사용.
    const stockProductIds = [...new Set(
      cartLineGroups.flatMap(g => {
        const ids: string[] = []
        const parentId = resolveParentProductId(g.product)
        if (parentId) ids.push(parentId)
        for (const o of g.options) {
          if (o.optionProductId) ids.push(o.optionProductId)
        }
        return ids
      })
    )]
    if (stockProductIds.length > 0) {
      type StockRpcFn = (name: string, args: Record<string, unknown>) => Promise<{
        data: Array<{ product_id: string; available_count: number }> | null
        error: unknown
      }>
      const { data: stockRows, error: stockError } = await (supabase.rpc as unknown as StockRpcFn)(
        'get_available_stock_counts',
        { p_product_ids: stockProductIds },
      )
      if (stockError) {
        console.error('[cart] get_available_stock_counts 실패:', (stockError as { message?: string }).message)
      } else {
        for (const r of stockRows ?? []) availableStock[r.product_id] = r.available_count
      }
    }

    // calculate_cart_total RPC — subtotal, discount_amount, final_total, deposit_required 반환
    // (Database.Functions 타입 불일치로 as unknown as 캐스트 사용 — 기존 products/[id] 패턴 동일)
    // draft 행(날짜 NULL)이 섞이면 subtotal이 NULL로 오염되므로 hold 상태 행만 필터링해 전달 (DB-5는 2차 방어)
    const holdReservationIds = rawReservations.filter(r => r.status === 'hold').map(r => String(r.id))
    type CalcRow = { subtotal: number; discount_amount: number; final_total: number; deposit_required: number }
    type CalcRpcFn = (name: string, args: Record<string, unknown>) => Promise<{ data: CalcRow[] | null; error: unknown }>
    const calcResp = await (supabase.rpc as unknown as CalcRpcFn)('calculate_cart_total', {
      p_reservation_ids: holdReservationIds,
    })
    const row = calcResp.data?.[0] ?? null
    if (row) {
      calcTotal    = row.subtotal         ?? 0
      calcDiscount = row.discount_amount  ?? 0
      calcFinal    = row.final_total      ?? 0
      depositTotal = row.deposit_required ?? 0
    }
  }

  // ── 쿠폰 2차 필터: 7개 자격조건 (Migration 348 서버사이드 방어, isCouponEligible 순수함수) ──
  // 사용자 컨텍스트 — 위 Promise.all에서 확보한 쿼리 결과 사용(추가 DB 쿼리 없음)
  const isFirstRental         = (firstRentalResult.data?.length   ?? 0) === 0
  const isStudent             = (studentResult.data as { is_student?: boolean | null } | null)?.is_student === true
  const hasActiveSubscription = (subscriptionResult.data?.length  ?? 0) > 0

  // 주문 컨텍스트 — cart는 orders가 아직 없어 calcTotal을 대리값으로 사용
  // Q1 전체AND: rawReservations의 최소 대여일수, 모든 예약 방문 여부
  const cartRsvs = rawReservations.filter(r => r.status === 'hold' || r.status === 'draft')
  const minRentalDaysInCart = cartRsvs.length > 0
    ? Math.min(...cartRsvs.map(r => {
        const s = new Date(r.start_date), e = new Date(r.end_date)
        return Math.round((e.getTime() - s.getTime()) / 86400000) + 1
      }))
    : null
  const allWalkIn = cartRsvs.length > 0 ? cartRsvs.every(r => r.pickup_method === 'visit') : null

  const filteredCoupons = basicFilteredCoupons.filter(uc => {
    const c = uc.coupons
    if (!c) return false
    const result = isCouponEligible(
      {
        min_purchase_amount:  c.min_purchase_amount,
        min_rental_amount:    c.min_rental_amount,
        min_rental_days:      c.min_rental_days,
        is_first_rental_only: c.is_first_rental_only,
        is_student_only:      c.is_student_only,
        is_subscription_only: c.is_subscription_only,
        is_walk_in_only:      c.is_walk_in_only,
      },
      {
        orderAmount:           calcTotal > 0 ? calcTotal : null,
        minRentalDaysInOrder:  minRentalDaysInCart,
        allWalkIn,
        isFirstRental,
        isStudent,
        hasActiveSubscription,
      },
    )
    return result.ok
  })

  return {
    deliveryOptions,
    pickupPoints,
    courierClosedDates,
    rentalGuideText,
    consentItems,
    shippingSettings,
    discountTiers,
    userId:          session.user.id,
    reservationIds,
    cartProducts,
    cartLineItems,
    cartLineGroups,
    availableStock,
    productPriceRules,
    depositTotal,
    calcTotal,
    calcDiscount,
    calcFinal,
    serverCartItems: rawReservations,
    serverProducts,
    membershipGrade: (profileResult.data as ProfileRow | null)?.membership_grade ?? null,
    crazyScore:      (profileResult.data as ProfileRow | null)?.credit_score     ?? null,
    userPoints:      (profileResult.data as ProfileRow | null)?.points           ?? 0,
    userCoupons:     filteredCoupons as UserCouponRow[],
    isServerLoaded:  rawReservations.length > 0,
    hasUserAddress,
    // "회원정보 반영" 체크박스 자동채움용 — 체크 시 이 값으로 폼 필드를 덮어씀(BND: front-uiux 검수
    // 2026-08-17 발견 — 기존엔 체크박스가 토글만 될 뿐 실제 반영 로직이 전혀 없었음)
    userProfileInfo: {
      name:  (profileResult.data as ProfileRow | null)?.full_name ?? null,
      phone: (profileResult.data as ProfileRow | null)?.phone ?? null,
      email: (profileResult.data as ProfileRow | null)?.email ?? null,
    },
    userAddressInfo: primaryAddress
      ? { road_address: primaryAddress.road_address, detail_address: primaryAddress.detail_address }
      : null,
  }
}

// ─── 로컬 타입 ─────────────────────────────────────────────────────────────────

interface ReservationRow {
  id:            number | string
  product_id:    string | null
  start_date:    string
  end_date:      string
  status:        string
  pickup_method: string | null
  return_method: string | null
  pickup_time:   string | null
  return_time:   string | null
  duration_type: string | null
}

interface ProductRow {
  id:                  string
  name:                string
  category:            string
  brand:               string | null
  slug:                string
  image_urls:          string[]
  is_active:           boolean
  created_at:          string
  updated_at:          string
  deleted_at:          string | null
  allowed_method_ids?: string[] | null
  allowed_pickup_ids?: string[] | null
  parent_product_id?:  string | null
  shipping_round_trip?: boolean | null
  shipping_delivery?:   boolean | null
  shipping_return?:     boolean | null
  sale_only?:           boolean | null
  sale_price?:          number | null
}

interface PickupPointRow {
  id:      string
  name:    string
  address: string
  phone:   string | null
}

interface CartLineItemOption {
  optionProductId: string | null
  name:            string
  qty:             number
  unitPrice:       number
  imageUrl:        string | null
}

interface CartLineItem {
  reservationId: string
  productId:     string | null
  product:       ProductRow | null
  price12h:      number | null
  price24h:      number | null
  deposit:       number | null
  startDate:     string
  endDate:       string
  pickupMethod:  string | null
  returnMethod:  string | null
  pickupTime:    string | null
  returnTime:    string | null
  durationType:  string | null
  options:       CartLineItemOption[]
  status:        string
}

interface ProfileRow {
  membership_grade: string | null
  credit_score:     number | null
  points:           number
  full_name:        string | null
  phone:            string | null
  email:            string | null
}

// 노출 필터링 후 클라이언트로 전달되는 타입
interface UserCouponRow {
  id:         string
  coupon_id:  string
  used_count: number
  coupons: {
    id:                  string
    code:                string | null   // sequenced 모드 쿠폰은 NULL — B-0 타입 정합성 보완
    type:                string
    discount_type:       string
    discount_value:      number
    description:         string | null
    valid_until:         string | null
    min_purchase_amount: number
    min_rental_amount:   number
    min_rental_days:     number
  } | null
}

// 쿠폰 조회 raw 타입 (필터링 전)
interface RawCouponFields {
  id:                   string
  code:                 string | null   // sequenced 모드 쿠폰은 NULL — B-0 타입 정합성 보완
  type:                 string
  discount_type:        string
  discount_value:       number
  description:          string | null
  is_active:            boolean
  deleted_at:           string | null
  valid_from:           string | null
  valid_until:          string | null
  user_grade_required:  string | null
  usage_limit:          number
  usage_count:          number
  total_usage_limit:    number | null
  is_first_rental_only: boolean
  is_student_only:      boolean
  is_subscription_only: boolean
  is_walk_in_only:      boolean
  min_purchase_amount:  number
  min_rental_amount:    number
  min_rental_days:      number
}
interface RawUserCouponRow {
  id:         string
  coupon_id:  string
  used_count: number
  coupons:    RawCouponFields | null
}

interface DeliveryOptionRow {
  id:               string
  method_key:       string
  name:             string
  deadline_time:    string | null
  display_order:    number
  // 배송대여 수령/반납 일괄 지정(2026-08-24) — true인 방식은 /cart에서 반납방식 강제고정+
  // 시간선택 비활성화 대상(cms/set/rental "배송대여 수령/반납 일괄 지정" 콤보로 관리자 토글)
  is_bulk_delivery: boolean
  // 휴무일 캘린더 제한 대상(택배사 의존 여부) — is_bulk_delivery("요청 A" 전용)와는 별개
  // 목적(감사 RSC-B3, Migration #386). courierClosedMap 적용 방식 판정에만 쓰인다.
  is_courier_dependent: boolean
}
