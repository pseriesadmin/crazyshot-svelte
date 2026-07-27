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
    }
  }

  const [cartResult, profileResult, couponResult] = await Promise.all([
    supabase
      .from('rental_reservations')
      .select('id, product_id, start_date, end_date, status')
      .eq('user_id', session.user.id)
      .eq('status', 'hold')
      .order('created_at', { ascending: false }),

    supabase
      .from('user_profiles')
      .select('membership_grade, credit_score, points')
      .eq('id', session.user.id)
      .maybeSingle(),

    supabase
      .from('user_coupons')
      .select('id, coupon_id, coupons(id, code, discount_type, discount_value, description, valid_until)')
      .eq('user_id', session.user.id)
      .is('used_at', null),
  ])

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
    if (productIds.length > 0) {
      const [{ data: products }, { data: priceRows }] = await Promise.all([
        supabase
          .from('products')
          .select('id, name, category, brand, slug, image_urls, is_active, created_at, updated_at, deleted_at, allowed_method_ids')
          .in('id', productIds),
        supabase
          .from('price_rules')
          .select('product_id, duration_type, price, deposit_amount')
          .in('product_id', productIds)
          .in('duration_type', ['12h', '24h']),
      ])
      serverProducts = (products ?? []) as ProductRow[]

      for (const row of (priceRows ?? []) as Array<{ product_id: string; duration_type: string; price: number; deposit_amount: number | null }>) {
        const entry = productPriceRules[row.product_id] ?? { price12h: null, price24h: null, deposit: null }
        if (row.duration_type === '12h') entry.price12h = row.price
        if (row.duration_type === '24h') { entry.price24h = row.price; entry.deposit = row.deposit_amount }
        productPriceRules[row.product_id] = entry
      }
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
      }
    })

    // calculate_cart_total RPC — subtotal, discount_amount, final_total, deposit_required 반환
    // (Database.Functions 타입 불일치로 as unknown as 캐스트 사용 — 기존 products/[id] 패턴 동일)
    type CalcRow = { subtotal: number; discount_amount: number; final_total: number; deposit_required: number }
    type CalcRpcFn = (name: string, args: Record<string, unknown>) => Promise<{ data: CalcRow[] | null; error: unknown }>
    const calcResp = await (supabase.rpc as unknown as CalcRpcFn)('calculate_cart_total', {
      p_reservation_ids: reservationIds,
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
    userCoupons:     (couponResult.data ?? []) as UserCouponRow[],
    isServerLoaded:  rawReservations.length > 0,
  }
}

// ─── 로컬 타입 ─────────────────────────────────────────────────────────────────

interface ReservationRow {
  id:         number | string
  product_id: string | null
  start_date: string
  end_date:   string
  status:     string
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
}

interface ProfileRow {
  membership_grade: string | null
  credit_score:     number | null
  points:           number
}

interface UserCouponRow {
  id:        string
  coupon_id: string
  coupons: {
    id:             string
    code:           string
    discount_type:  string
    discount_value: number
    description:    string | null
    valid_until:    string
  } | null
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
