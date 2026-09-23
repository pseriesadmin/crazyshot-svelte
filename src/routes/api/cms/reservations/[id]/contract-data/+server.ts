import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import type { ContractSubstitutionData } from '$lib/types/contract-module'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { buildLineItems, formatComponentsText } from '$lib/utils/contractLineItems'
import type { ReservationForLineItems } from '$lib/utils/contractLineItems'
import { calcRentalMinutes, calcRentalPeriodParts } from '$lib/utils/cartRentalFee'

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

// 2026-09-08 신규 — 할인금액·차감포인트·할인차감(정산내역의 "차감" 성격 3개 필드) 전용.
// defaultRentalContractHtml.ts가 예전엔 이 3칸 앞에 "△ " 접두사를 정적 텍스트로 박아뒀는데,
// 실제 차감액이 0이거나 없는(null) 예약에서도 "△ 0원"/"△ -"처럼 차감이 없는데 차감 기호가
// 붙어 보이는 문제가 있었다(Stephen 실사용 중 발견). 값이 실제로 0보다 클 때만 "△ "를
// 값 자체에 붙이도록 이관 — 0이거나 null이면 기존 formatAmount와 동일하게 표시.
function formatDeltaAmount(n: number | null | undefined): string {
  if (n == null || n <= 0) return formatAmount(n)
  return '△ ' + formatAmount(n)
}

// 2026-09-09 신규 — 부가세(VAT) 전용. cart/+page.svelte otVat과 동일한 "포함가 역산" 표시
// 관례(`(${금액}원)`, PriceRow label "부가세 (10%, 포함)")를 그대로 재사용한다. orders.
// tax_amount는 항상 0으로 저장돼(주문 생성 RPC가 별도 부가세 계산을 하지 않음 — 대여요금
// 자체가 이미 부가세 포함가라는 전제) 실질적으로 쓸 수 없는 값이라, 이 컬럼을 읽는 대신
// "기본대여요금 - 등급할인"(=부가세 포함 순대여가, cart의 otNetBeforeVat과 동일 산식)에서
// 10/110을 역산해 "이 안에 부가세가 얼마 포함돼 있었는지"만 안내용으로 표시한다(합계 계산에
// 더하지 않음 — 이미 포함돼 있으므로 이중과세 방지).
function formatVatAmount(netBeforeVat: number): string {
  const vat = Math.round(netBeforeVat - netBeforeVat / 1.1)
  return `(${vat.toLocaleString('ko-KR')}원)`
}

// rental_reservations.start_date/end_date("YYYY-MM-DD") → 원본 엑셀 표기("YYYY.MM.DD")
function formatDateDot(d: string | null | undefined): string {
  if (!d) return '-'
  return d.slice(0, 10).replace(/-/g, '.')
}

// CS2654 C2 — 총사용시간: 수령일시~반납일시 실제 시간차(총 시간 단위).
// pickup_time/return_time은 "HH:MM"(시각만) — start_date/end_date와 결합해 전체 순간을
// 구성한 뒤 차이를 구한다. 둘 중 하나라도 배송형(is_delivery_type)이면 그 시각 자체가
// 실제 고객 선택값이 아니므로(위 isPickupDelivery/isReturnDelivery 판정과 동일 근거) '-'.
function formatTotalUsageHours(
  startDate: string | null | undefined,
  pickupTime: string | null | undefined,
  endDate: string | null | undefined,
  returnTime: string | null | undefined,
): string {
  if (!startDate || !pickupTime || !endDate || !returnTime) return '-'
  const start = new Date(`${startDate.slice(0, 10)}T${pickupTime}`)
  const end = new Date(`${endDate.slice(0, 10)}T${returnTime}`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '-'
  const diffHours = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60))
  if (diffHours <= 0) return '-'
  return `${diffHours}시간`
}

// ⛔ 2026-09-09 정정(Stephen 지시) — 이전까지는 이 엔드포인트가 쿠폰 할인액을 매번
// 즉석에서 재계산했다(discount_type/discount_value 기반, 아래 옛 구현 참고). 그런데
// orders.final_amount는 정작 이 재계산 결과를 전혀 반영하지 않고 등급할인만 반영된 채
// 저장돼 있어(create_reservation_order RPC의 원 설계 결함), "정산내역 각 줄을 더해도
// 최종 결제 금액이 안 맞는" 자기모순이 발생했다 — 계약서 표시 레이어가 자체 계산식을
// 갖는 것 자체가 잘못된 설계(Stephen: "합산 요금 출처는 시스템에서 가져와야지 전자계약
// 자체에서 계산식을 돌리면 안 된다")였다.
// ✅ 수정: create_reservation_order RPC가 쿠폰 할인을 실제로 계산해
// orders.coupon_discount_amount에 저장하고 final_amount 산식에도 반영하도록 변경 —
// 이 엔드포인트는 더 이상 재계산하지 않고 그 저장값을 그대로 읽기만 한다(아래 orderData
// 조회의 coupon_discount_amount 컬럼).

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

  // 2026-09-10 신규 — components(구성품)는 products.md §4-1에 명시된 "부모 전용" 편집 항목이라
  // 자식(재고단위)은 자체 값을 절대 갖지 않는다(가격정책처럼 부모→자식 자동 동기화 트리거도
  // 없음). 그런데 이 파일의 components 조회 4곳이 전부 예약의 product_id(항상 자식 id)로
  // 직접 조회하고 있어, 부모에 구성품을 등록해도 계약서엔 영원히 "-"만 표시되는 구조적 결함이
  // 있었다(Stephen 실사용 중 발견 — Creator SET01, 부모 등록 후 재발행해도 미반영). 조회
  // 대상 id에 parent_product_id가 있으면 그 부모의 components를, 없으면(그 자체가 이미
  // 부모이거나 부모 개념이 없는 경우) 자기 자신의 값을 사용하도록 통일한다. admin을 클로저로
  // 캡처(모듈 최상위 함수로 분리 시 SupabaseClient 제네릭 타입 불일치 에러 발생 — 로컬 함수로
  // 유지해 admin의 실제 추론 타입을 그대로 사용).
  async function resolveComponentsMap(
    rows: { id: string; parent_product_id: string | null; components?: unknown }[],
  ): Promise<Record<string, unknown>> {
    const parentIds = [...new Set(
      rows.map(r => r.parent_product_id).filter((v): v is string => !!v)
    )]
    const parentComponents: Record<string, unknown> = {}
    if (parentIds.length > 0) {
      const { data } = await admin.from('products').select('id, components').in('id', parentIds)
      for (const p of data ?? []) parentComponents[p.id as string] = p.components
    }
    return Object.fromEntries(
      rows.map(r => [
        r.id,
        r.parent_product_id ? (parentComponents[r.parent_product_id] ?? null) : (r.components ?? null),
      ])
    )
  }

  // ── 1. 기본 예약 정보 조회 (16개 스칼라 필드의 기준 reservation) ────────────
  const { data: res, error: resErr } = await admin
    .from('rental_reservations')
    .select('reservation_code, pickup_method, return_method, pickup_time, return_time, start_date, end_date, user_id, product_id, duration_type, pickup_address_road, pickup_address_detail, pickup_point_id, return_point_id')
    .eq('id', reservationId)
    .maybeSingle()

  if (resErr) return json({ error: resErr.message }, { status: 500 })
  if (!res) return json({ error: '예약 정보를 찾을 수 없습니다.' }, { status: 404 })

  // rental-fee-policy.md §2 — is_delivery_type(배송 반납 허용 지정) 판정. 수령/반납
  // 방식이 "배송"으로 지정된 방식이면 pickup_time/return_time은 실제 고객이 고른
  // 시각이 아니라(1day 강제청구라 시간선택 UI 자체가 무의미) 화면 임시값일 뿐이므로
  // 계약서에는 노출하지 않는다(아래 수령일시/반납일시 계산부 참고). pickup_method/
  // return_method는 둘 다 nullable(드래프트 예약 등)이라 빈 배열이면 .in() 호출 자체를
  // 스킵한다 — PostgREST가 빈 IN 목록을 받았을 때의 동작에 기대지 않기 위한 방어.
  const methodKeys = [res.pickup_method, res.return_method].filter((v): v is string => !!v)

  // CS2654 C2 — 지점옵션(수령/반납 지점 이름) 대상 pickup_point_id 목록
  const pointIds = [res.pickup_point_id, res.return_point_id].filter((v): v is string => !!v)

  // ── 2. 병렬 조회: 기본 예약의 스칼라 필드용 데이터 ────────────────────────
  const [productRes, userRes, orderItemRes, methodOptsRes, addrRes, pointRes, ownPriceRes] = await Promise.all([
    admin.from('products').select('name, product_code, components, parent_product_id').eq('id', res.product_id).maybeSingle(),
    admin.from('user_profiles').select('full_name, phone, email').eq('id', res.user_id).maybeSingle(),
    admin.from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle(),
    // 2026-09-08 — is_delivery_type 배송여부 판정과 함께 name(한글 라벨)도 같은 쿼리로
    // 조회한다. 기존엔 이 파일 전용 하드코딩 PICKUP_LABELS 맵을 별도로 썼는데, 그 맵의 키가
    // 실제 DB method_key(delivery/locker/quick/visit)와 어긋나(맵은 crazydelivery/epost
    // 등 다른 값) 배송 방식이 한글로 치환되지 않고 원본 코드값("delivery")이 그대로
    // 고객에게 노출되는 결함이 있었다(Stephen 실사용 중 발견) — DB의 name 컬럼을 유일한
    // 소스로 삼아 이원화 자체를 제거.
    methodKeys.length > 0
      ? admin.from('rental_method_options').select('method_key, is_delivery_type, name').in('method_key', methodKeys)
      : Promise.resolve({ data: [] as { method_key: string; is_delivery_type: boolean | null; name: string | null }[], error: null }),
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
    // CS2654 C2 — 지점옵션
    pointIds.length > 0
      ? admin.from('pickup_points').select('id, name').in('id', pointIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    // 대여 장비내역 Amount(금액) — 기준 예약(단독 예약 경로 전용) 실제 대여요금(price_rules).
    // 주문 묶음 경로(siblingRows)는 아래 §3에서 reservation별 duration_type이 서로 다를 수
    // 있어 별도 배치 조회로 처리 — 이 쿼리는 orderId가 없는 단독 예약일 때만 사용된다.
    res.duration_type
      ? admin.from('price_rules')
          .select('price')
          .eq('product_id', res.product_id)
          .eq('duration_type', res.duration_type)
          .eq('is_active', true)
          .is('deleted_at', null)
          .maybeSingle()
      : Promise.resolve({ data: null as { price: number } | null, error: null }),
  ])

  // 기준 예약(단독/주문묶음 공용) 메인상품 구성품 — 부모 해석 적용(위 resolveComponentsMap 참고)
  const mainComponentsMap = await resolveComponentsMap([{
    id: res.product_id as string,
    parent_product_id: (productRes.data?.parent_product_id as string | null) ?? null,
    components: productRes.data?.components,
  }])
  const mainComponentsResolved = mainComponentsMap[res.product_id as string] ?? null

  let orderData: {
    total_amount: number | null; discount_amount: number | null; tax_amount: number | null
    delivery_fee: number | null; final_amount: number | null
    selected_coupon_id: string | null; selected_points: number | null
    coupon_discount_amount: number | null
  } | null = null
  const orderId = orderItemRes.data?.order_id as string | number | null ?? null

  if (orderId) {
    const { data: o } = await admin
      .from('orders')
      .select('total_amount, discount_amount, tax_amount, delivery_fee, final_amount, selected_coupon_id, selected_points, coupon_discount_amount')
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
      // 모든 reservation 기본정보 + 메인상품 (duration_type — 대여요금 조회용)
      const { data: siblingRows } = await admin
        .from('rental_reservations')
        .select('id, product_id, duration_type')
        .in('id', siblingIds)
        .order('id', { ascending: true })

      const productIdSet = [
        ...new Set((siblingRows ?? []).map(r => r.product_id as string).filter(Boolean)),
      ]

      // 메인상품 일괄 조회 (N+1 방지) — components(구성품, 2026-09-08 추가): "대여 장비내역"
      // {{비고}} 채움용(contractLineItems.ts formatComponentsText 재사용)
      const { data: productRows } = productIdSet.length > 0
        ? await admin.from('products').select('id, name, product_code, components, parent_product_id').in('id', productIdSet)
        : { data: [] }

      // 구성품은 부모 전용 항목이라 부모 해석 필요(resolveComponentsMap 참고)
      const resolvedMainComponentsMap = await resolveComponentsMap(
        (productRows ?? []).map(p => ({
          id: p.id as string,
          parent_product_id: p.parent_product_id as string | null,
          components: p.components,
        })),
      )

      const productMap: Record<string, { name: string; product_code: string | null; components: unknown }> =
        Object.fromEntries(
          (productRows ?? []).map(p => [
            p.id as string,
            {
              name: p.name as string,
              product_code: p.product_code as string | null,
              components: resolvedMainComponentsMap[p.id as string] ?? null,
            },
          ])
        )

      // 대여 장비내역 Amount(금액) — 메인상품 실제 대여요금(price_rules, product_id+duration_type
      // 조합별 단가). 같은 상품이라도 reservation마다 duration_type이 다를 수 있어
      // product_id 하나로만 캐시하지 않고 "product_id|duration_type" 복합키로 조회한다.
      const { data: priceRows } = productIdSet.length > 0
        ? await admin.from('price_rules')
            .select('product_id, duration_type, price')
            .in('product_id', productIdSet)
            .eq('is_active', true)
            .is('deleted_at', null)
        : { data: [] }

      const priceMap = new Map<string, number>(
        (priceRows ?? []).map(p => [`${p.product_id}|${p.duration_type}`, p.price as number])
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
        ? await admin.from('products').select('id, product_code, components, parent_product_id').in('id', optionProductIds)
        : { data: [] }

      const optionCodeMap: Record<string, string | null> = Object.fromEntries(
        (optionProductRows ?? []).map(p => [p.id as string, p.product_code as string | null])
      )
      const optionComponentsMap = await resolveComponentsMap(
        (optionProductRows ?? []).map(p => ({
          id: p.id as string,
          parent_product_id: p.parent_product_id as string | null,
          components: p.components,
        })),
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
        const prod = productMap[pid] ?? { name: '-', product_code: null, components: null }
        const unitPrice = priceMap.get(`${pid}|${row.duration_type}`) ?? null
        const opts = (optionsByResId[row.id as number] ?? []).map(o => ({
          option_name:  o.option_name as string,
          qty:          o.qty as number,
          unit_price:   o.unit_price as number,
          product_code: o.option_product_id
            ? (optionCodeMap[o.option_product_id as string] ?? null)
            : null,
          components: o.option_product_id
            ? (optionComponentsMap[o.option_product_id as string] ?? null)
            : null,
        }))
        return { mainProduct: { ...prod, unit_price: unitPrice }, options: opts }
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
      ? await admin.from('products').select('id, product_code, components, parent_product_id').in('id', soloOptProductIds)
      : { data: [] }

    const soloCodeMap: Record<string, string | null> = Object.fromEntries(
      (soloOptProductRows ?? []).map(p => [p.id as string, p.product_code as string | null])
    )
    const soloComponentsMap = await resolveComponentsMap(
      (soloOptProductRows ?? []).map(p => ({
        id: p.id as string,
        parent_product_id: p.parent_product_id as string | null,
        components: p.components,
      })),
    )

    lineItemReservations = [
      {
        mainProduct: {
          name:         productRes.data?.name ?? '-',
          product_code: productRes.data?.product_code ?? null,
          unit_price:   ownPriceRes.data?.price ?? null,
          components:   mainComponentsResolved,
        },
        options: (soloOptions ?? []).map(o => ({
          option_name:  o.option_name as string,
          qty:          o.qty as number,
          unit_price:   o.unit_price as number,
          product_code: o.option_product_id
            ? (soloCodeMap[o.option_product_id as string] ?? null)
            : null,
          components: o.option_product_id
            ? (soloComponentsMap[o.option_product_id as string] ?? null)
            : null,
        })),
      },
    ]
  }

  // ── 3-1. 쿠폰 할인 내역 — create_reservation_order RPC가 이미 계산·저장해둔 값을
  // 그대로 읽는다(위 2026-09-09 정정 주석 참고, 이 엔드포인트는 재계산하지 않음).
  const couponDiscountAmount = orderData?.selected_coupon_id ? (orderData?.coupon_discount_amount ?? null) : null

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

  // ⛔ 2026-09-09 정책 반전(Stephen 확정) — 과거(~2026-09-08)엔 is_delivery_type=true인
  // 방식의 pickup_time/return_time이 대체로 NULL이거나 의미 없는 더미값이라 계약서에
  // "-"로 숨겼었다. 그런데 cart/+page.svelte bulkHandleMethod()가 "수령=배송이면 반납방식
  // 무관하게 00:00/24:00을 실제로 기록한다"로 바뀌면서(§163행 TASK.md 기록), 이 값은 이제
  // "이 예약이 대여일 00:00~반납일 24:00(=종일) 단위로 청구된다"는 의미를 실제로 담은
  // 정상값이 됐다 — 더 이상 숨길 이유가 없고, 오히려 노출하는 쪽이 정합이다(Stephen 확정,
  // "시간값이 노출되는게 정합임"). isPickupDelivery/isReturnDelivery는 아래
  // calcRentalMinutes() 대여일수 산식에는 계속 필요해 변수 자체는 유지하되, 수령일시/
  // 반납일시 표시값에서는 더 이상 이 두 플래그로 강제 은닉하지 않는다.
  const deliveryTypeByMethod = new Map(
    (methodOptsRes.data ?? []).map((m) => [m.method_key, m.is_delivery_type === true]),
  )
  const isPickupDelivery = res.pickup_method ? (deliveryTypeByMethod.get(res.pickup_method) ?? false) : false
  const isReturnDelivery = res.return_method ? (deliveryTypeByMethod.get(res.return_method) ?? false) : false

  // 2026-09-08 — 수령형태/반납형태 한글 라벨 소스(위 methodOptsRes 쿼리 참고 주석)
  const methodNameMap = new Map(
    (methodOptsRes.data ?? []).map((m) => [m.method_key, m.name]),
  )
  const pickupMethodLabel = res.pickup_method ? (methodNameMap.get(res.pickup_method) ?? res.pickup_method) : '-'
  const returnMethodLabel = res.return_method ? (methodNameMap.get(res.return_method) ?? res.return_method) : '-'

  // CS2654 C2 — 지점옵션: 수령 지점 우선, 없으면 반납 지점 (하위호환 유지 — 제거하지 않음)
  const pointNameMap = new Map((pointRes.data ?? []).map((p) => [p.id, p.name]))
  const branchName =
    (res.pickup_point_id ? pointNameMap.get(res.pickup_point_id) : undefined) ??
    (res.return_point_id ? pointNameMap.get(res.return_point_id) : undefined) ??
    null

  // 2026-09-08 — "구분" 섹션 수령방법지점/반납방법지점: 위 지점옵션과 달리 수령/반납 각
  // leg의 지점을 독립적으로 구분(pickup_point_id만 / return_point_id만). 지점이 없는
  // 방식(배송 등)은 방식명만 노출.
  const pickupBranchName = res.pickup_point_id ? (pointNameMap.get(res.pickup_point_id) ?? null) : null
  const returnBranchName = res.return_point_id ? (pointNameMap.get(res.return_point_id) ?? null) : null
  const pickupMethodBranch = pickupMethodLabel === '-'
    ? '-'
    : (pickupBranchName ? `${pickupMethodLabel} (${pickupBranchName})` : pickupMethodLabel)
  const returnMethodBranch = returnMethodLabel === '-'
    ? '-'
    : (returnBranchName ? `${returnMethodLabel} (${returnBranchName})` : returnMethodLabel)

  // 2026-09-08 — 대여일수: RentalDetailPanel.svelte·rentalDaysLabel.ts attachRentalDaysLabel()과
  // 완전히 동일한 산식 재사용(cartRentalFee.ts). deliveryLocked는 원본 함수와 동일하게
  // pickup_method 기준만 사용(반납 방식은 반영하지 않음 — 산식 일치를 위해 그대로 따름).
  const rentalMinutes = calcRentalMinutes(res.start_date, res.end_date, res.pickup_time, res.return_time, isPickupDelivery)
  const rentalPeriodParts = calcRentalPeriodParts(rentalMinutes)
  const rentalDaysLabel = rentalPeriodParts.length > 0
    ? rentalPeriodParts.map(p => `${p.num}${p.unit}`).join(' ')
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
    수량:         String(actualQty),
    수령형태:     pickupMethodLabel,
    수령일시:     res.pickup_time ?? '-',
    수령일자:     formatDateDot(res.start_date),
    반납형태:     returnMethodLabel,
    반납일시:     res.return_time ?? '-',
    반납일자:     formatDateDot(res.end_date),
    기본대여요금: formatAmount(orderData?.total_amount),
    할인금액:     formatDeltaAmount(orderData?.discount_amount),
    배송비:       formatAmount(orderData?.delivery_fee),
    // 2026-09-09 — "포함가 역산" 표시로 전환(위 formatVatAmount 주석 참고). 등급할인까지만
    // 반영한 순대여가(할인쿠폰·포인트는 부가세 계산 기준에서 제외 — cart otNetBeforeVat과 동일)
    부가세:       formatVatAmount((orderData?.total_amount ?? 0) - (orderData?.discount_amount ?? 0)),
    최종합계:     formatAmount(orderData?.final_amount),
    요금유형:     res.duration_type ? (DURATION_TYPE_LABELS[res.duration_type] ?? res.duration_type) : '-',
    할인차감:     formatDeltaAmount(couponDiscountAmount),
    차감포인트:   formatDeltaAmount(orderData?.selected_points),
    구성품:       formatComponentsText(mainComponentsResolved),
    // 신규: 주문 전체 상품 목록 (반복 영역 전용)
    상품목록: buildLineItems(lineItemReservations),
    // CS2654 C2 — 대응데이터 없던 6개 중 5개 신규 반영(이용기간금액은 의도적 보류)
    // 2026-09-08 수정: 기존엔 "이 예약에 이미 존재하는 계약서의 created_at"을 DB에서
    // 조회했는데, 최초 발행(신규 계약 생성) 시점엔 이 API가 호출되는 순간(발행 모달을 여는
    // 시점) 아직 contracts 행 자체가 생성되기 전이라 조회 결과가 항상 없어 "-"로만 채워지는
    // 구조적 버그였다(재발송 등 이미 계약이 존재하는 극히 일부 경로에서만 정상 날짜가
    // 보였음). "발행일"의 의미상 원하는 값은 어차피 "지금(발행 시점)"이므로, DB 조회 없이
    // 현재 시각을 바로 사용하도록 변경 — 최초 발행 시에도 항상 정상적으로 오늘 날짜가 채워짐.
    계약서발행일: formatDateDot(new Date().toISOString()),
    지점옵션:     branchName ?? '-',
    '총 정상 대여가': formatAmount(orderData?.total_amount),
    // 2026-09-08 신규 — "구분" 섹션 수령방법/반납방법 값(방식+지점 통합 표기)
    수령방법지점: pickupMethodBranch,
    반납방법지점: returnMethodBranch,
    // 2026-09-08 신규 — "대여 및 반납시간" 표 TOTAL 칸(실제 대여일수, RentalDetailPanel과 동일 산식)
    대여일수:     rentalDaysLabel,
    총사용시간:   formatTotalUsageHours(
      res.start_date,
      isPickupDelivery ? null : res.pickup_time,
      res.end_date,
      isReturnDelivery ? null : res.return_time,
    ),
    할인반영금액: formatAmount(couponDiscountAmount),
  }

  return json(data)
}
