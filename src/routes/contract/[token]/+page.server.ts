import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { error, redirect } from '@sveltejs/kit'
import { recordAuditLog } from '$lib/contract-signature/auditLog'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: signing, error: signingErr } = await admin
    .from('contract_signings')
    .select(`
      id,
      token,
      sent_at,
      viewed_at,
      signed_at,
      expires_at,
      contracts (
        id,
        title,
        content_blocks,
        specifications,
        document_url,
        reservation_id,
        authoring_mode,
        canvas_document,
        spreadsheet_document,
        rental_reservations (
          id,
          status,
          start_date,
          end_date,
          reservation_code,
          user_id,
          pickup_method,
          return_method,
          pickup_time,
          return_time,
          products ( name, category, product_code )
        )
      )
    `)
    .eq('token', params.token)
    .maybeSingle()

  if (signingErr || !signing) {
    throw error(404, '유효하지 않은 계약서 링크입니다.')
  }

  // 2026-08-21(TASK.md "예약 결제·계약서명 순서 재설계" Phase C, EC-1 방어): 서명은 이미
  // 끝났지만 결제(mock)를 아직 안 한 예약(status='hold' 유지 중)은 '/contract/signed'
  // 안내 페이지로 보내지 않는다 — 그 페이지엔 결제 UI가 없어 재접속 시 결제로 이어갈 방법이
  // 영구히 사라진다(고객이 서명 후 페이지를 닫거나 새로고침하면 예약이 hold에 갇히는
  // CRITICAL 회귀, sp3-qa-agent 발견). 서명+결제가 모두 끝나 confirmed로 전환된 경우에만
  // 기존처럼 안내 페이지로 보낸다. 이미 서명된 링크는 만료(expires_at) 여부와 무관하게
  // 결제 재개를 허용한다 — 서명이라는 목적은 이미 달성됐으므로 만료 체크의 원 취지(미서명
  // 상태로 방치된 링크 차단)가 적용되지 않는다.
  const signedReservationStatus = (signing.contracts as unknown as {
    rental_reservations: { status?: string | null } | null
  } | null)?.rental_reservations?.status ?? null

  if (signing.signed_at) {
    if (signedReservationStatus !== 'hold') {
      throw redirect(302, '/contract/signed')
    }
    // else: 서명완료 + 결제대기(hold) — 아래로 계속 진행해 결제 단계를 그대로 보여준다
  } else if (signing.expires_at && new Date(signing.expires_at) < new Date()) {
    throw redirect(302, '/contract/expired')
  }

  // viewed_at 최초 기록 + P8A-3: viewed 감사로그
  if (!signing.viewed_at) {
    await admin
      .from('contract_signings')
      .update({ viewed_at: new Date().toISOString() })
      .eq('id', signing.id)
  }

  const reservation = (signing.contracts as unknown as {
    rental_reservations: { id: number; user_id: string } | null
  } | null)?.rental_reservations

  // P8A-3: viewed 이벤트 기록 (최초/재방문 모두 기록 — append-only)
  const contractId = (signing.contracts as { id?: string } | null)?.id ?? null
  if (contractId) {
    await recordAuditLog(admin as Parameters<typeof recordAuditLog>[0], {
      contractId,
      eventType:  'viewed',
      actorType:  'customer',
      actorId:    reservation?.user_id ?? null,
      ipAddress:  null, // load()는 getClientAddress 없음 — SSR load에서 IP는 미지원
    })
  }

  let customer: { full_name: string | null; phone: string | null; email: string | null } | null = null
  if (reservation?.user_id) {
    const { data: profile } = await admin
      .from('user_profiles')
      .select('full_name, phone, email')
      .eq('id', reservation.user_id)
      .maybeSingle()
    customer = profile
  }

  // P8B-5: 발행자 서명·직인 조회 (고객 화면 렌더링용)
  interface IssuerSig { id: string; signature_type: string; signature_image_url: string | null; signed_at: string }
  let issuerSignatures: IssuerSig[] = []
  if (contractId) {
    const { data: isigs } = await (admin as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          eq: (k: string, v: string) => {
            order: (k: string, o: { ascending: boolean }) => Promise<{ data: IssuerSig[] | null }>
          }
        }
      }
    }).from('contract_issuer_signatures')
      .select('id, signature_type, signature_image_url, signed_at')
      .eq('contract_id', contractId)
      .order('signed_at', { ascending: true })
    issuerSignatures = isigs ?? []
  }

  // canvas 모드 substitutionMap 16개 전체 채움 — 주소·주문금액 추가 조회
  let shippingAddress: string | null = null
  type OrderData = {
    total_amount: number | null
    discount_amount: number | null
    tax_amount: number | null
    final_amount: number | null
    selected_coupon_id: string | null
    selected_points: number | null
  }
  let orderData: OrderData | null = null

  if (reservation?.user_id) {
    const { data: addrData } = await admin
      .from('user_shipping_addresses')
      .select('road_address, detail_address')
      .eq('user_id', reservation.user_id)
      .eq('is_default', true)
      .maybeSingle()

    if (addrData) {
      const parts = [
        (addrData as { road_address?: string | null }).road_address,
        (addrData as { detail_address?: string | null }).detail_address,
      ].filter(Boolean)
      shippingAddress = parts.join(' ') || null
    }
  }

  if (reservation?.id) {
    const { data: orderItemData } = await admin
      .from('order_items')
      .select('order_id')
      .eq('reservation_id', reservation.id)
      .maybeSingle()

    if (orderItemData && (orderItemData as { order_id?: string | null }).order_id) {
      const orderId = (orderItemData as { order_id: string }).order_id
      const { data: o } = await admin
        .from('orders')
        .select('total_amount, discount_amount, tax_amount, final_amount, selected_coupon_id, selected_points')
        .eq('id', orderId)
        .maybeSingle()
      orderData = o as OrderData | null
    }
  }

  // 2026-08-21(TASK.md "예약 결제·계약서명 순서 재설계" Phase C, GATE B Q1): 쿠폰/포인트
  // 선택 UI가 cart 체크아웃(1단계)에서 이 계약서명 페이지(3단계, 결제mock 트리거 직전)로
  // 이동했다 — cart/+page.server.ts의 조회·필터 로직과 동일 원칙(등급·기간·소진한도 검증)을
  // 그대로 적용한다. 이 페이지는 비로그인 토큰 기반 화면이라 세션이 아닌 reservation.user_id
  // 기준으로 조회한다.
  type RawUserCouponRow = {
    id: string
    coupon_id: string | null
    used_count: number
    coupons: {
      id: string
      code: string | null
      discount_type: string
      discount_value: number
      description: string | null
      is_active: boolean
      deleted_at: string | null
      valid_from: string | null
      valid_until: string | null
      user_grade_required: string | null
      usage_limit: number
      usage_count: number
      total_usage_limit: number | null
    } | null
  }
  let userCoupons: RawUserCouponRow[] = []
  let userPoints = 0

  if (reservation?.user_id) {
    const [profileResult, couponResult] = await Promise.all([
      admin
        .from('user_profiles')
        .select('membership_grade, points')
        .eq('id', reservation.user_id)
        .maybeSingle(),
      admin
        .from('user_coupons')
        .select(`id, coupon_id, used_count,
          coupons(
            id, code, discount_type, discount_value, description,
            is_active, deleted_at, valid_from, valid_until,
            user_grade_required, usage_limit, usage_count, total_usage_limit
          )`)
        .eq('user_id', reservation.user_id)
        .is('used_at', null),
    ])

    const memberGrade = (profileResult.data as { membership_grade?: string | null } | null)?.membership_grade ?? null
    userPoints = (profileResult.data as { points?: number } | null)?.points ?? 0

    const now = new Date().toISOString()
    userCoupons = ((couponResult.data ?? []) as unknown as RawUserCouponRow[]).filter((uc) => {
      const c = uc.coupons
      if (!c) return false
      if (!c.is_active) return false
      if (c.deleted_at) return false
      if (c.valid_from && c.valid_from > now) return false
      if (c.valid_until && c.valid_until < now) return false
      if (c.user_grade_required && c.user_grade_required !== memberGrade) return false
      if (c.total_usage_limit !== null && c.usage_count >= c.total_usage_limit) return false
      if (c.usage_limit > 0 && c.usage_count >= c.usage_limit) return false
      return true
    })
  }

  // 2026-08-24: 장바구니(1단계)에서 고른 쿠폰/포인트(orders.selected_coupon_id/selected_points,
  // Migration 340)를 이 페이지의 초기 선택값으로 반영 — 카트 제출 이후 쿠폰이 만료/소진되는
  // 등 더 이상 유효하지 않을 수 있어, 위에서 이미 검증·필터링된 userCoupons 목록에 실제로
  // 남아있는 경우에만 그대로 사용하고, 그렇지 않으면 미선택으로 되돌린다(무효 쿠폰 미리선택
  // 방지). 포인트도 그사이 잔액이 줄었을 수 있어 현재 userPoints로 재클램프.
  const preselectedCouponId = (orderData?.selected_coupon_id && userCoupons.some((uc) => uc.id === orderData?.selected_coupon_id))
    ? orderData.selected_coupon_id
    : null
  const preselectedPoints = Math.max(0, Math.min(orderData?.selected_points ?? 0, userPoints))

  return {
    signing,
    customer,
    issuerSignatures,
    shippingAddress,
    orderData,
    userCoupons,
    userPoints,
    preselectedCouponId,
    preselectedPoints,
    // EC-1 방어(위 참고) — 이미 서명된 상태(결제만 남음)로 재진입했음을 +page.svelte에 알려
    // 서명 UI 대신 결제 단계를 바로 렌더링하게 한다.
    alreadySigned: !!signing.signed_at,
  }
}
