// GET /account/rental/[id]/contract — 고객용 서명완료 전자계약서 열람 (읽기 전용, 새 창)
// /contract/[token] 서명화면과 달리 1회성 토큰이 아니라 로그인 세션 기반 — 예약 소유자만 접근
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { error, redirect } from '@sveltejs/kit'
import { recordAuditLog } from '$lib/contract-signature/auditLog'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/auth/login')

  // 소유권 확인은 반드시 고객 세션 클라이언트(RLS)로 — 타 고객의 예약 ID를 넣어도
  // user_id 불일치 시 조회 자체가 안 됨(존재 여부조차 노출하지 않음)
  const { data: reservation, error: reservationErr } = await locals.supabase
    .from('rental_reservations')
    .select('id, reservation_code, start_date, end_date, pickup_method, return_method, pickup_time, return_time, product_id, products(name, category, product_code)')
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (reservationErr || !reservation) {
    throw error(404, '예약을 찾을 수 없습니다.')
  }

  // products(...) 조인 select는 생성된 Database 타입에서 추론이 안 돼 never로 잡힘
  // (chatSession 등 이 코드베이스 전반에서 쓰는 캐스팅 관례와 동일)
  const res = reservation as unknown as {
    id: number | string
    reservation_code: string | null
    start_date: string
    end_date: string
    pickup_method: string | null
    return_method: string | null
    pickup_time: string | null
    return_time: string | null
    products: { name: string; category: string; product_code: string | null } | null
  }

  // 이후 조회는 admin(service_role) — contracts/contract_signings는 소유권 확인이 끝난
  // 뒤부터는 /contract/[token] 서명화면과 동일하게 admin 클라이언트로 조회(RLS 우회)
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 2026-08-31(CRITICAL 수정): init-contract API가 "같은 주문에 이미 계약이 있으면 재사용"
  // 으로 바뀌어(예약=주문 단위 통일), 계약은 이제 주문당 1건만 존재하고 대표 예약에만
  // anchor된다. 이 예약(res.id) 자신이 계약을 직접 소유하지 않는 형제 예약(같은 주문의
  // 다른 상품)일 수 있으므로, 같은 주문의 예약 전체를 대상으로 조회해야 한다 — 그렇지
  // 않으면 실제로 서명 완료된 계약이 있어도 "계약 없음" 안내만 뜨는 결함이 발생한다.
  const { data: orderItemRow } = await admin
    .from('order_items')
    .select('order_id')
    .eq('reservation_id', res.id)
    .maybeSingle()

  let candidateReservationIds: (string | number)[] = [res.id]
  const orderId = (orderItemRow as { order_id?: string | number | null } | null)?.order_id
  if (orderId != null) {
    const { data: siblingItems } = await admin
      .from('order_items')
      .select('reservation_id')
      .eq('order_id', orderId)
    const siblingIds = ((siblingItems ?? []) as { reservation_id: string | number | null }[])
      .map((r) => r.reservation_id)
      .filter((v): v is string | number => v != null)
    if (siblingIds.length > 0) candidateReservationIds = siblingIds
  }

  const { data: signingRow } = await admin
    .from('contract_signings')
    .select(`
      id, signed_at, ip_address, signature_data, stroke_count, signed_content_snapshot,
      contracts!inner (
        id, title, content_blocks, specifications, authoring_mode,
        canvas_document, spreadsheet_document, reservation_id
      )
    `)
    .in('contracts.reservation_id', candidateReservationIds)
    .not('signed_at', 'is', null)
    .order('signed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!signingRow) {
    // 목록 페이지는 서명 완료 건에만 버튼을 노출하지만, 그 사이 상태가 바뀌었을 수 있는
    // 엣지케이스 — 하드 에러 대신 화면에서 안내 문구로 처리
    return { reservation: res, contract: null, mySignature: null, customer: null, issuerSignatures: [], shippingAddress: null, orderData: null }
  }

  const liveContract = signingRow.contracts as unknown as {
    id: string
    title: string | null
    content_blocks: unknown[]
    specifications: { key: string; value: string }[]
    authoring_mode: string | null
    canvas_document: unknown
    spreadsheet_document: unknown
  }

  // 2026-08-21: 서명 시점 스냅샷이 있으면 그걸 우선 사용 — 서명 이후 관리자가 계약 원본을
  // 고쳐도 고객은 "그때 서명한 그 모습"을 그대로 본다(형태 보존). 스냅샷이 없으면(이 컬럼
  // 도입 이전 서명 건) 기존처럼 라이브 contracts 컬럼으로 폴백 — id/reservation_id처럼
  // 콘텐츠가 아닌 필드는 항상 라이브 값을 그대로 쓴다.
  const snapshot = signingRow.signed_content_snapshot as {
    title: string | null
    content_blocks: unknown[]
    specifications: { key: string; value: string }[]
    authoring_mode: string | null
    canvas_document: unknown
    spreadsheet_document: unknown
  } | null

  const contract = {
    id: liveContract.id,
    title: (snapshot ?? liveContract).title,
    content_blocks: (snapshot ?? liveContract).content_blocks,
    specifications: (snapshot ?? liveContract).specifications,
    authoring_mode: (snapshot ?? liveContract).authoring_mode,
    canvas_document: (snapshot ?? liveContract).canvas_document,
    spreadsheet_document: (snapshot ?? liveContract).spreadsheet_document,
  }

  // P8A-3와 동일한 감사로그 관례 — 고객 본인의 열람도 append-only로 기록
  await recordAuditLog(admin as Parameters<typeof recordAuditLog>[0], {
    contractId: contract.id,
    eventType:  'viewed',
    actorType:  'customer',
    actorId:    session.user.id,
    ipAddress:  null,
  })

  const { data: profile } = await admin
    .from('user_profiles')
    .select('full_name, phone, email')
    .eq('id', session.user.id)
    .maybeSingle()

  interface IssuerSig { id: string; signature_type: string; signature_image_url: string | null; signed_at: string }
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
    .eq('contract_id', contract.id)
    .order('signed_at', { ascending: true })

  let shippingAddress: string | null = null
  const { data: addrData } = await admin
    .from('user_shipping_addresses')
    .select('road_address, detail_address')
    .eq('user_id', session.user.id)
    .eq('is_default', true)
    .maybeSingle()
  if (addrData) {
    const parts = [
      (addrData as { road_address?: string | null }).road_address,
      (addrData as { detail_address?: string | null }).detail_address,
    ].filter(Boolean)
    shippingAddress = parts.join(' ') || null
  }

  let orderData: {
    total_amount: number | null
    discount_amount: number | null
    tax_amount: number | null
    delivery_fee: number | null
    final_amount: number | null
  } | null = null
  // orderId는 위 계약 조회 시점에 이미 조회해둔 값을 재사용(중복 쿼리 방지)
  if (orderId != null) {
    const { data: o } = await admin
      .from('orders')
      .select('total_amount, discount_amount, tax_amount, delivery_fee, final_amount')
      .eq('id', orderId)
      .maybeSingle()
    orderData = o as typeof orderData
  }

  return {
    reservation: res,
    contract,
    mySignature: {
      signature_data: signingRow.signature_data as string | null,
      signed_at:      signingRow.signed_at as string,
      ip_address:     signingRow.ip_address as string | null,
    },
    customer: profile,
    issuerSignatures: isigs ?? [],
    shippingAddress,
    orderData,
  }
}
