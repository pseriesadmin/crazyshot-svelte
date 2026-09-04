import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import type { ContractSubstitutionData } from '$lib/types/contract-module'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { buildLineItems } from '$lib/utils/contractLineItems'
import type { ReservationForLineItems } from '$lib/utils/contractLineItems'

const PICKUP_LABELS: Record<string, string> = {
  crazydelivery: '크레이지샷 배송',
  quick:         '당일퀵 배송',
  locker:        '무인 보관함',
  visit:         '본점 방문수령',
  epost:         '택배',
}

// cart/+page.svelte DUR_TYPES · ProductDetailPanel.svelte "24시간(1일)" 표기 관례와 동일
const DURATION_TYPE_LABELS: Record<string, string> = {
  '12h':     '12시간',
  '24h':     '24시간(1일)',
  '1day':    '1일',
  'monthly': '월간',
}

function formatAmount(n: number | null | undefined): string {
  if (n == null) return '-'
  return n.toLocaleString('ko-KR') + '원'
}

const COMPONENTS_TEXT_MAX = 50

// products.components(key-value JSONB, ProductDetailPanel.svelte "구성품" 탭 — products.md
// §4-1) → "key: value, key: value" 텍스트로 합친 뒤 50자(전체 문자 기준) 초과 시 말줄임.
// products/[id]/+page.svelte의 productComponents 파생(Object.entries + 빈 키 제외)과
// 동일한 필터링 규칙 재사용.
function formatComponentsText(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '-'
  const entries = Object.entries(raw as Record<string, unknown>).filter(([k]) => k.trim())
  if (entries.length === 0) return '-'
  const joined = entries
    .map(([k, v]) => (typeof v === 'string' && v.trim() ? `${k}: ${v}` : k))
    .join(', ')
  return joined.length > COMPONENTS_TEXT_MAX
    ? joined.slice(0, COMPONENTS_TEXT_MAX) + '...'
    : joined
}

// ⛔ 2026-08-31(같은 날 정정) — 최초 구현은 payment_transactions(coupon_discount·point_amount,
// 결제 확정 시점 기록)를 소스로 썼으나 이는 완전히 잘못된 시점 설계였다(Stephen 지적으로
// 발견): 계약서는 "예약신청완료"(장바구니 체크아웃, create_reservation_order 실행) 이후
// 관리자가 "계약 발행"하는 시점에 이미 생성·발송되고, 실제 PG 결제(Toss)는 그보다 한참
// 뒤(rental-lifecycle.md 목표 흐름 3단계 — 계약 서명 이후 /contract/[token]/pay-mock·
// pay-result 경유)에나 일어난다. 즉 계약 발행 시점에는 payment_transactions 행 자체가
// 아직 존재하지 않는 게 정상 케이스이므로, 그 테이블을 소스로 쓰면 이 두 변수는 사실상
// 모든 계약서에서 영구히 '-'로만 표시된다 — 완전한 설계 오류였다.
//
// ✅ 올바른 소스: 쿠폰·포인트는 "예약신청완료"(장바구니 체크아웃) 시점에 이미
// orders.selected_coupon_id / orders.selected_points로 확정·저장된다(create_reservation_
// order RPC). 단, 그 시점에 실제 "몇 원 할인인지"(쿠폰 discount_type/discount_value 기반
// 계산값)는 서버에 저장되지 않고 cart/+page.svelte에서 미리보기 목적으로만 클라이언트
// 계산됐다가 버려진다(otCouponDiscount — 소스 계산식과 완전히 동일하게 이 파일에서 재현).
// 포인트는 orders.selected_points가 이미 원화 1:1 정수값이라 별도 계산 불필요.
async function resolveSelectedCouponDiscountAmount(
  admin: SupabaseClient,
  selectedCouponId: string | null,
  orderSubtotal: number,
): Promise<number | null> {
  if (!selectedCouponId) return null

  const { data } = await admin
    .from('user_coupons')
    .select('coupons(discount_type, discount_value)')
    .eq('id', selectedCouponId)
    .maybeSingle()

  const coupon = (data as { coupons: { discount_type: string; discount_value: number } | null } | null)?.coupons
  if (!coupon) return null

  // cart/+page.svelte otCouponDiscount와 동일 계산식(fixed=정액 / 그 외=정률, subtotal 기준)
  return coupon.discount_type === 'fixed'
    ? coupon.discount_value
    : Math.round(orderSubtotal * coupon.discount_value / 100)
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  // P7-3: manager 이상만 허용
  if (!cmsRole || !hasSettingsAccess(cmsRole)) {
    return json({ error: '권한 없음' }, { status: 403 })
  }

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // ── 1. 기본 예약 정보 조회 (16개 스칼라 필드의 기준 reservation) ────────────
  const { data: res, error: resErr } = await admin
    .from('rental_reservations')
    .select('reservation_code, pickup_method, return_method, pickup_time, return_time, user_id, product_id, duration_type, pickup_address_road, pickup_address_detail')
    .eq('id', reservationId)
    .maybeSingle()

  if (resErr) return json({ error: resErr.message }, { status: 500 })
  if (!res) return json({ error: '예약 정보를 찾을 수 없습니다.' }, { status: 404 })

  // ── 2. 병렬 조회: 기본 예약의 스칼라 필드용 데이터 ────────────────────────
  const [productRes, userRes, orderItemRes, addrRes] = await Promise.all([
    admin.from('products').select('name, product_code, components').eq('id', res.product_id).maybeSingle(),
    admin.from('user_profiles').select('full_name, phone, email').eq('id', res.user_id).maybeSingle(),
    admin.from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle(),
    // ⚠️ 2026-09-03(Migration 434): 이 조회는 이제 "정본"이 아니라 하위호환 폴백 전용이다 —
    // rental_reservations.pickup_address_road/detail(예약신청완료 시점 스냅샷)가 있으면
    // 그걸 우선 쓰고, 이 쿼리는 그 컬럼 신설 이전에 생성된 예약(res.pickup_address_road가
    // NULL인 경우)에서만 사용된다. "예약과 무관하게 항상 현재 시점 기본 배송지를 보여주는"
    // 문제(Stephen 지적, service-operations.md 계약서 변수 시점 원칙과 동일 클래스)를
    // 이걸로 해소 — 새 예약은 전부 스냅샷을 가지므로 이 라이브 조회 자체가 점점 안 쓰이게 됨.
    admin.from('user_shipping_addresses')
      .select('road_address, detail_address')
      .eq('user_id', res.user_id)
      .eq('is_default', true)
      .maybeSingle(),
  ])

  let orderData: {
    total_amount: number | null; discount_amount: number | null; tax_amount: number | null
    delivery_fee: number | null; final_amount: number | null
    selected_coupon_id: string | null; selected_points: number | null
  } | null = null
  const orderId = orderItemRes.data?.order_id as string | number | null ?? null

  if (orderId) {
    const { data: o } = await admin
      .from('orders')
      .select('total_amount, discount_amount, tax_amount, delivery_fee, final_amount, selected_coupon_id, selected_points')
      .eq('id', orderId)
      .maybeSingle()
    orderData = o
  }

  // ── 3. 상품목록 빌드: 주문에 묶인 모든 reservation + 옵션상품 조회 (Q1=C안) ──
  // 같은 order_id의 모든 reservation_id를 가져온 뒤 각각 메인상품+옵션 조회
  let lineItemReservations: ReservationForLineItems[] = []

  if (orderId) {
    // 같은 주문에 묶인 reservation_id 전체 (순서: created_at ASC, service-operations.md §4)
    const { data: orderItemRows } = await admin
      .from('order_items')
      .select('reservation_id')
      .eq('order_id', orderId)
      .order('reservation_id', { ascending: true })

    const siblingIds = (orderItemRows ?? [])
      .map(r => r.reservation_id as number | null)
      .filter((v): v is number => v != null)

    if (siblingIds.length > 0) {
      // 모든 reservation 기본정보 + 메인상품
      const { data: siblingRows } = await admin
        .from('rental_reservations')
        .select('id, product_id')
        .in('id', siblingIds)
        .order('id', { ascending: true })

      const productIdSet = [
        ...new Set((siblingRows ?? []).map(r => r.product_id as string).filter(Boolean)),
      ]

      // 메인상품 일괄 조회 (N+1 방지)
      const { data: productRows } = productIdSet.length > 0
        ? await admin.from('products').select('id, name, product_code').in('id', productIdSet)
        : { data: [] }

      const productMap: Record<string, { name: string; product_code: string | null }> =
        Object.fromEntries(
          (productRows ?? []).map(p => [
            p.id as string,
            { name: p.name as string, product_code: p.product_code as string | null },
          ])
        )

      // 모든 reservation의 옵션상품 일괄 조회 (N+1 방지)
      const { data: allOptions } = await admin
        .from('reservation_options')
        .select('reservation_id, option_name, qty, unit_price, option_product_id')
        .in('reservation_id', siblingIds)
        .order('id', { ascending: true })

      // 옵션상품의 product_code 조회
      const optionProductIds = [
        ...new Set(
          (allOptions ?? [])
            .map(o => o.option_product_id as string | null)
            .filter((v): v is string => !!v)
        ),
      ]

      const { data: optionProductRows } = optionProductIds.length > 0
        ? await admin.from('products').select('id, product_code').in('id', optionProductIds)
        : { data: [] }

      const optionCodeMap: Record<string, string | null> = Object.fromEntries(
        (optionProductRows ?? []).map(p => [p.id as string, p.product_code as string | null])
      )

      // reservation_id → options 맵
      const optionsByResId: Record<number, typeof allOptions> = {}
      for (const opt of allOptions ?? []) {
        const rid = opt.reservation_id as number
        if (!optionsByResId[rid]) optionsByResId[rid] = []
        optionsByResId[rid].push(opt)
      }

      // ReservationForLineItems 배열 구성
      lineItemReservations = (siblingRows ?? []).map(row => {
        const pid = row.product_id as string
        const prod = productMap[pid] ?? { name: '-', product_code: null }
        const opts = (optionsByResId[row.id as number] ?? []).map(o => ({
          option_name:  o.option_name as string,
          qty:          o.qty as number,
          unit_price:   o.unit_price as number,
          product_code: o.option_product_id
            ? (optionCodeMap[o.option_product_id as string] ?? null)
            : null,
        }))
        return { mainProduct: prod, options: opts }
      })
    }
  } else {
    // 주문이 없는 단독 예약 → 기본 예약 1건 + 그 옵션만
    const { data: soloOptions } = await admin
      .from('reservation_options')
      .select('option_name, qty, unit_price, option_product_id')
      .eq('reservation_id', reservationId)
      .order('id', { ascending: true })

    const soloOptProductIds = [
      ...new Set(
        (soloOptions ?? [])
          .map(o => o.option_product_id as string | null)
          .filter((v): v is string => !!v)
      ),
    ]

    const { data: soloOptProductRows } = soloOptProductIds.length > 0
      ? await admin.from('products').select('id, product_code').in('id', soloOptProductIds)
      : { data: [] }

    const soloCodeMap: Record<string, string | null> = Object.fromEntries(
      (soloOptProductRows ?? []).map(p => [p.id as string, p.product_code as string | null])
    )

    lineItemReservations = [
      {
        mainProduct: {
          name:         productRes.data?.name ?? '-',
          product_code: productRes.data?.product_code ?? null,
        },
        options: (soloOptions ?? []).map(o => ({
          option_name:  o.option_name as string,
          qty:          o.qty as number,
          unit_price:   o.unit_price as number,
          product_code: o.option_product_id
            ? (soloCodeMap[o.option_product_id as string] ?? null)
            : null,
        })),
      },
    ]
  }

  // ── 3-1. 쿠폰·포인트 차감 내역 ("예약신청완료" 시점 orders.selected_* 기준) ─────
  const couponDiscountAmount = await resolveSelectedCouponDiscountAmount(
    admin,
    orderData?.selected_coupon_id ?? null,
    orderData?.total_amount ?? 0,
  )

  // ⛔ 2026-09-03 정정 — 기존 스칼라 {{수량}}은 "항상 1" 하드코딩이었다(P3-3, "거짓
  // 다중수량 선택지 없이 일반 변수 칩으로만 제공"). Stephen 지적: 이건 오류이며, 반복영역
  // 전용 상품목록(buildLineItems)이 2026-08-28에 이미 정정한 것과 동일한 원칙 —
  // "같은 상품(이름+품번 동일)을 여러 건 예약했으면 수량=실제 예약 건수"를 이 스칼라
  // {{수량}}에도 동일하게 적용해야 한다(contractLineItems.ts 그룹화 키와 완전히 동일한
  // `${name} ${product_code ?? ''}` 식별키 재사용 — 로직 이원화 방지).
  const ownProductKey = `${productRes.data?.name ?? ''} ${productRes.data?.product_code ?? ''}`
  const actualQty = lineItemReservations.filter(
    (r) => `${r.mainProduct.name} ${r.mainProduct.product_code ?? ''}` === ownProductKey
  ).length || 1

  // ── 4. 응답 조립 ─────────────────────────────────────────────────────────────
  // 주소 — 정본: rental_reservations.pickup_address_road/detail(예약신청완료 시점 스냅샷,
  // Migration 434). 둘 다 없으면(스냅샷 컬럼 신설 이전 예약) 기존 방식(고객 현재 기본
  // 배송지)으로 폴백 — Stephen 확정.
  const snapshotAddr = [res.pickup_address_road, res.pickup_address_detail]
    .filter(Boolean)
    .join(' ')
  const fallbackAddr = addrRes.data
    ? [addrRes.data.road_address, addrRes.data.detail_address].filter(Boolean).join(' ')
    : ''
  const addrStr = snapshotAddr || fallbackAddr || '-'

  const data: ContractSubstitutionData = {
    // 기존 16개 스칼라 필드 (하위호환 — 기준 reservationId 기반)
    고객이름:     userRes.data?.full_name ?? '-',
    연락처:       userRes.data?.phone ?? '-',
    이메일:       userRes.data?.email ?? '-',
    주소:         addrStr,
    예약코드:     res.reservation_code ?? '-',
    상품코드:     productRes.data?.product_code ?? '-',
    상품명:       productRes.data?.name ?? '-',
    수량:         String(actualQty),
    수령형태:     res.pickup_method ? (PICKUP_LABELS[res.pickup_method] ?? res.pickup_method) : '-',
    수령일시:     res.pickup_time ?? '-',
    반납형태:     res.return_method ? (PICKUP_LABELS[res.return_method] ?? res.return_method) : '-',
    반납일시:     res.return_time ?? '-',
    기본대여요금: formatAmount(orderData?.total_amount),
    할인금액:     formatAmount(orderData?.discount_amount),
    배송비:       formatAmount(orderData?.delivery_fee),
    부가세:       formatAmount(orderData?.tax_amount),
    최종합계:     formatAmount(orderData?.final_amount),
    요금유형:     res.duration_type ? (DURATION_TYPE_LABELS[res.duration_type] ?? res.duration_type) : '-',
    할인차감:     formatAmount(couponDiscountAmount),
    차감포인트:   formatAmount(orderData?.selected_points),
    구성품:       formatComponentsText(productRes.data?.components),
    // 신규: 주문 전체 상품 목록 (반복 영역 전용)
    상품목록: buildLineItems(lineItemReservations),
  }

  return json(data)
}
