import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { sendReservationLifecyclePush } from '$lib/server/push'

export interface RentalListRow {
  reservation_id:    number
  reservation_code:  string | null
  status:            string
  rental_start:      string
  rental_end:        string
  rental_days:       number | null
  duration_type:     string | null
  pickup_method:     string | null
  return_method:     string | null
  pickup_time:       string | null
  return_time:       string | null
  user_id:           string
  customer_name:     string
  customer_email:    string
  customer_phone:    string
  membership_grade:  string
  credit_score:      number
  product_id:        string
  product_name:      string
  product_code:      string | null
  product_category:  string
  product_image_url: string | null
  order_id:          number | null
  order_key:         string | null
  order_amount:      number | null
  discount_amount:   number | null
  tax_amount:        number | null
  delivery_fee:      number | null
  payment_status:    string | null
  contract_id:       string | null
  contract_status:   string | null
  contract_pdf_url:  string | null
  auto_signed_at:    string | null
  customer_signed_at: string | null
  signing_sent_at:   string | null
  signing_token:     string | null
  created_at:        string
  total_count:       number
}

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const status   = url.searchParams.get('status')    ?? ''
  const search   = url.searchParams.get('search')    ?? ''
  const dateFrom = url.searchParams.get('date_from') ?? ''
  const dateTo   = url.searchParams.get('date_to')   ?? ''
  const page     = parseInt(url.searchParams.get('page') ?? '1', 10)
  const selectedParam = url.searchParams.get('selected')
  const selectedId    = selectedParam ? parseInt(selectedParam, 10) : null

  // confirmed 이후 상태는 /cms/rentals에서 관리 → 예약 목록에서 제외
  // draft(날짜 미정 임시예약)도 제외 — 고객이 체크아웃에서 날짜를 입력해 hold로 승격해야 관리자에게 노출됨(Default-Exclude)
  // p_exclude_statuses를 SQL WHERE에 반영해 LIMIT/OFFSET·total_count가 이 스코프 기준으로
  // 계산되도록 함(2026-08-07 페이지네이션 정합성 수정 — RPC에서 필터링 전 count를 쓰면
  // "총 N건"·페이지 수가 실제 표시 목록과 어긋남, migration 201 참고)
  const RENTAL_VIEW_STATUSES = ['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed', 'draft']

  const { data: rows, error } = await admin.rpc('get_rental_list', {
    p_status:           status   || null,
    p_search:           search   || null,
    p_date_from:        dateFrom || null,
    p_date_to:          dateTo   || null,
    p_page:             page,
    p_per_page:         30,
    p_exclude_statuses: RENTAL_VIEW_STATUSES,
  })

  if (error) console.error('[cms/reservation] get_rental_list error:', error.message)

  const rentals: RentalListRow[] = rows ?? []
  const totalCount = rentals[0]?.total_count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / 30))

  return { rentals, totalCount, totalPages, status, search, dateFrom, dateTo, page, selectedId, cmsRole }
}

export const actions: Actions = {
  approveReservation: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(403, { message: '권한 없음' })

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const data  = await request.formData()
    const reservationId = Number(data.get('reservation_id'))

    const { data: result, error } = await admin.rpc('update_reservation_status', {
      p_reservation_id: reservationId,
      p_new_status:     'confirmed',
    })

    if (error) return fail(500, { message: error.message })
    const res = result as { ok: boolean; error?: string } | null
    if (!res?.ok) return fail(400, { message: res?.error ?? '처리 실패' })
    // 예약 승인 채팅 알림 자동 발송
    await admin.rpc('send_rental_chat_notification', {
      p_reservation_id: reservationId,
      p_notify_type: 'reservation_approval',
    })
    // 예약 승인 푸시 알림 병행 발송 (채팅과 독립 — 실패해도 위 처리에 영향 없음)
    await sendReservationLifecyclePush(admin, reservationId, 'reservation_approval')
    return { ok: true }
  },

  updateStatus: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(403, { message: '권한 없음' })

    const admin     = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const data      = await request.formData()
    const reservationId = Number(data.get('reservation_id'))
    const newStatus     = data.get('status') as string

    const { data: result, error } = await admin.rpc('update_reservation_status', {
      p_reservation_id: reservationId,
      p_new_status:     newStatus,
    })

    if (error) return fail(500, { message: error.message })
    const res = result as { ok: boolean; error?: string } | null
    if (!res?.ok) return fail(400, { message: res?.error ?? '처리 실패' })
    // 상태 전환별 채팅 알림 자동 발송
    const AUTO_NOTIFY: Partial<Record<string, string>> = {
      shipped:          'shipment_notify',
      in_use:           'rental_confirm',
      return_requested: 'return_registration',
      returned:         'rental_complete',
    }
    const notifyType = AUTO_NOTIFY[newStatus]
    if (notifyType) {
      await admin.rpc('send_rental_chat_notification', {
        p_reservation_id: reservationId,
        p_notify_type: notifyType,
      })
      // 상태 전환 푸시 알림 병행 발송 (채팅과 독립 — 실패해도 위 처리에 영향 없음)
      await sendReservationLifecyclePush(admin, reservationId, notifyType)
    }
    return { ok: true }
  },
}
