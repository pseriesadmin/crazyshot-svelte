import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  const supabase = locals.supabase

  // 배송 방식 옵션 — 세션 불필요, 모든 사용자에게 제공
  const { data: deliveryOptionsData } = await supabase
    .from('rental_method_options')
    .select('id, method_key, name, fee_amount, fee_description, deadline_time, display_order')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('display_order', { ascending: true })
  const deliveryOptions = (deliveryOptionsData ?? []) as DeliveryOptionRow[]

  const { session } = await locals.safeGetSession()

  if (!session) {
    return {
      deliveryOptions,
      userId:          null as string | null,
      isGuest:         true,
      reservationIds:  [] as string[],
      cartProducts:    [] as ProductRow[],
      cartLineItems:   [] as CartLineItem[],
      productPriceRules: {} as Record<string, { price12h: number | null; price24h: number | null; deposit: number | null }>,
      depositTotal:    0,
      calcTotal:       0,
      calcDiscount:    0,
      calcFinal:       0,
      serverCartItems: [] as ReservationRow[],
      serverProducts:  [] as ProductRow[],
      membershipGrade: null as string | null,
      crazyScore:      null as number | null,
      userPoints:      0,
      userCoupons:     [] as UserCouponRow[],
      isServerLoaded:  false,
      hasUserAddress:  false,
    }
  }

  const [cartResult, profileResult, couponResult, addressResult] = await Promise.all([
    supabase
      .from('rental_reservations')
      .select('id, product_id, start_date, end_date, status, pickup_method, return_method, pickup_time, return_time, duration_type')
      .eq('user_id', session.user.id)
      .in('status', ['hold', 'draft'])
      .order('created_at', { ascending: false }),

    supabase
      .from('user_profiles')
      .select('membership_grade, credit_score, points')
      .eq('id', session.user.id)
      .maybeSingle(),

    supabase
      .from('user_coupons')
      .select(`id, coupon_id, used_count,
        coupons(
          id, code, discount_type, discount_value, description,
          is_active, deleted_at, valid_from, valid_until,
          user_grade_required, usage_limit, usage_count, total_usage_limit,
          is_first_rental_only, is_student_only, is_subscription_only, is_walk_in_only,
          min_purchase_amount, min_rental_amount, min_rental_days
        )`)
      .eq('user_id', session.user.id)
      .is('used_at', null),

    // "회원정보 반영" 체크박스 활성화 판단용 — 저장된 배송지가 하나라도 있는지만 확인
    supabase
      .from('user_shipping_addresses')
      .select('road_address')
      .eq('user_id', session.user.id)
      .limit(1),
  ])

  const hasUserAddress = ((addressResult.data ?? []) as Array<{ road_address: string | null }>)
    .some(row => !!row.road_address)

  // ── 쿠폰 노출 조건 필터 ─────────────────────────────────────────────────────
  const now = new Date().toISOString()
  const memberGrade = (profileResult.data as ProfileRow | null)?.membership_grade ?? null

  const filteredCoupons = ((couponResult.data ?? []) as RawUserCouponRow[]).filter(uc => {
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
            .select('id, name, category, brand, slug, image_urls, is_active, created_at, updated_at, deleted_at, allowed_method_ids, parent_product_id')
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

    // 대여방식(allowed_method_ids)은 CMS 대여정책 탭이 부모 상품에만 설정되는 필드 — 예약에
    // 배정된 자식 재고 유닛은 이 값이 항상 빈 배열([])이라, 자식 자신의 값이 비어있으면
    // 부모 상품의 설정을 대신 조회해 채운다 (products.md §5 대여정책 ↔ 예약 흐름 연결 참고)
    const parentIdsNeeded = [...new Set(
      serverProducts
        .filter(p => (!p.allowed_method_ids || p.allowed_method_ids.length === 0) && p.parent_product_id)
        .map(p => p.parent_product_id as string)
    )]
    if (parentIdsNeeded.length > 0) {
      const { data: parentRows } = await supabase
        .from('products')
        .select('id, allowed_method_ids')
        .in('id', parentIdsNeeded)
      const parentMethodMap = new Map(
        ((parentRows ?? []) as Array<{ id: string; allowed_method_ids: string[] | null }>)
          .map(p => [p.id, p.allowed_method_ids ?? []])
      )
      serverProducts = serverProducts.map(p => {
        if ((!p.allowed_method_ids || p.allowed_method_ids.length === 0) && p.parent_product_id) {
          return { ...p, allowed_method_ids: parentMethodMap.get(p.parent_product_id) ?? p.allowed_method_ids }
        }
        return p
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

  return {
    deliveryOptions,
    userId:          session.user.id,
    // 익명(게스트) 로그인 여부 — 체크아웃 완료 버튼 문구 분기(회원/비회원)에 사용
    isGuest:         session.user.is_anonymous ?? false,
    reservationIds,
    cartProducts,
    cartLineItems,
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
  parent_product_id?:  string | null
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
}

// 노출 필터링 후 클라이언트로 전달되는 타입
interface UserCouponRow {
  id:         string
  coupon_id:  string
  used_count: number
  coupons: {
    id:                  string
    code:                string
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
  code:                 string
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
  id:              string
  method_key:      string
  name:            string
  fee_amount:      number
  fee_description: string | null
  deadline_time:   string | null
  display_order:   number
}
