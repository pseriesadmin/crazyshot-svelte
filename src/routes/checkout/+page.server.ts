import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
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
      reservationIds:  [] as string[],
      cartProducts:    [] as ProductRow[],
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
      .select('id, asset_id, start_date, end_date, status')
      .eq('user_id', session.user.id)
      .eq('status', 'hold')
      .order('created_at', { ascending: true }),

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
  let cartProducts:   ProductRow[] = []   // 예약 순서대로 정렬된 카드용 상품
  let calcTotal = 0, calcDiscount = 0, calcFinal = 0, depositTotal = 0

  if (rawReservations.length > 0) {
    // asset_id → product_id 경유로 상품 조회 (카드 표시용)
    // RLS "assets: 본인 렌탈 자산 조회"는 confirmed/in_use만 허용 — hold 단계에서도 읽을 수 있도록 service_role 클라이언트 사용
    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    // null asset_id (구 예약 등)를 제거해야 .in() 쿼리가 에러 없이 동작함
    const validAssetIds = rawReservations.map(r => r.asset_id).filter((id): id is string | number => id != null)
    const assetRows: Array<{ id: string | number; product_id: string }> = []
    if (validAssetIds.length > 0) {
      const assetsRes = await admin.from('assets').select('id, product_id').in('id', validAssetIds)
      assetRows.push(...((assetsRes.data as Array<{ id: string | number; product_id: string }> | null) ?? []))
    }

    const productIds = [...new Set(assetRows.map(a => a.product_id))]
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('id, name, category, brand, slug, image_urls, is_active, created_at, updated_at, deleted_at, allowed_method_ids')
        .in('id', productIds)
        .eq('is_active', true)
      serverProducts = (products ?? []) as ProductRow[]
    }

    // 예약 순서 그대로 상품 매핑 (Card 1 = 첫 예약, Card 2 = 두 번째 예약)
    cartProducts = rawReservations.map(r => {
      if (r.asset_id == null) return null
      const asset = assetRows.find(a => String(a.id) === String(r.asset_id))
      return asset ? (serverProducts.find(p => p.id === asset.product_id) ?? null) : null
    }).filter((p): p is ProductRow => p !== null)

    // calculate_cart_total RPC — subtotal, discount_amount, final_total, deposit_required 반환
    // (Database.Functions 타입 불일치로 as unknown as 캐스트 사용 — 기존 products/[id] 패턴 동일)
    type CalcRow = { subtotal: number; discount_amount: number; final_total: number; deposit_required: number }
    type CalcRpcFn = (name: string, args: Record<string, unknown>) => Promise<{ data: CalcRow[] | null; error: unknown }>
    const calcResp = await (supabase.rpc as unknown as CalcRpcFn)('calculate_cart_total', {
      p_reservation_ids: reservationIds,
      p_user_id:         session.user.id,
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
    reservationIds,
    cartProducts,
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
  asset_id:   number | string | null
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
