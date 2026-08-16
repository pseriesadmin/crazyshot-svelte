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

  if (signing.signed_at) {
    throw redirect(302, '/contract/signed')
  }

  if (signing.expires_at && new Date(signing.expires_at) < new Date()) {
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
  let orderData: {
    total_amount: number | null
    discount_amount: number | null
    tax_amount: number | null
    final_amount: number | null
  } | null = null

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
        .select('total_amount, discount_amount, tax_amount, final_amount')
        .eq('id', orderId)
        .maybeSingle()
      orderData = o as typeof orderData
    }
  }

  return { signing, customer, issuerSignatures, shippingAddress, orderData }
}
