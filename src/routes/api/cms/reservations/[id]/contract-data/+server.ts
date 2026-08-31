import { createClient } from '@supabase/supabase-js'
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
    .select('reservation_code, pickup_method, return_method, pickup_time, return_time, user_id, product_id, duration_type')
    .eq('id', reservationId)
    .maybeSingle()

  if (resErr) return json({ error: resErr.message }, { status: 500 })
  if (!res) return json({ error: '예약 정보를 찾을 수 없습니다.' }, { status: 404 })

  // ── 2. 병렬 조회: 기본 예약의 스칼라 필드용 데이터 ────────────────────────
  const [productRes, userRes, orderItemRes, addrRes] = await Promise.all([
    admin.from('products').select('name, product_code').eq('id', res.product_id).maybeSingle(),
    admin.from('user_profiles').select('full_name, phone, email').eq('id', res.user_id).maybeSingle(),
    admin.from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle(),
    admin.from('user_shipping_addresses')
      .select('road_address, detail_address')
      .eq('user_id', res.user_id)
      .eq('is_default', true)
      .maybeSingle(),
  ])

  let orderData: { total_amount: number | null; discount_amount: number | null; tax_amount: number | null; delivery_fee: number | null; final_amount: number | null } | null = null
  const orderId = orderItemRes.data?.order_id as string | number | null ?? null

  if (orderId) {
    const { data: o } = await admin
      .from('orders')
      .select('total_amount, discount_amount, tax_amount, delivery_fee, final_amount')
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

  // ── 4. 응답 조립 ─────────────────────────────────────────────────────────────
  const addr = addrRes.data
  const addrStr = addr
    ? [addr.road_address, addr.detail_address].filter(Boolean).join(' ')
    : '-'

  const data: ContractSubstitutionData = {
    // 기존 16개 스칼라 필드 (하위호환 — 기준 reservationId 기반)
    고객이름:     userRes.data?.full_name ?? '-',
    연락처:       userRes.data?.phone ?? '-',
    이메일:       userRes.data?.email ?? '-',
    주소:         addrStr,
    예약코드:     res.reservation_code ?? '-',
    상품코드:     productRes.data?.product_code ?? '-',
    상품명:       productRes.data?.name ?? '-',
    수량:         '1',
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
    // 신규: 주문 전체 상품 목록 (반복 영역 전용)
    상품목록: buildLineItems(lineItemReservations),
  }

  return json(data)
}
