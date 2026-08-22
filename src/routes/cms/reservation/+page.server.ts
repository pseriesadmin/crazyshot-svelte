import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { sendReservationLifecyclePush } from '$lib/server/push'
import { clearIssuedContractContent } from '$lib/server/clearIssuedContractHelper'
import { resolveApprovalNotifyPlan } from '$lib/server/reservationApprovalNotify'

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
  payment_confirmed_at: string | null
  total_count:       number
}

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 화면 최초진입(URL에 ?status= 자체가 없음) 기본값 = '신청대기'(hold) — 요구사항 1(2026-08-20).
  // '전체' 칩 클릭 시에는 +page.svelte가 status=''를 명시적으로 params에 채워 보내므로
  // url.searchParams.has('status')가 true가 되어 이 기본값으로 되돌아가지 않는다.
  const status   = url.searchParams.has('status') ? (url.searchParams.get('status') ?? '') : 'hold'
  const search   = url.searchParams.get('search')    ?? ''
  const dateFrom = url.searchParams.get('date_from') ?? ''
  const dateTo   = url.searchParams.get('date_to')   ?? ''
  const page     = parseInt(url.searchParams.get('page') ?? '1', 10)
  const selectedParam = url.searchParams.get('selected')
  const selectedId    = selectedParam ? parseInt(selectedParam, 10) : null
  // '계약대기' 필터칩(2026-08-20) — status='hold' 중 전자계약이 발송됐지만 아직 서명되지
  // 않은 건만 골라내는 별도 차원의 조건. status와 독립적인 파라미터라 URL도 별도로 관리.
  const contractPending = url.searchParams.get('contract_pending') === '1'

  // confirmed 이후 상태는 /cms/rentals에서 관리 → 예약 목록에서 제외
  // draft(날짜 미정 임시예약)도 제외 — 고객이 체크아웃에서 날짜를 입력해 hold로 승격해야 관리자에게 노출됨(Default-Exclude)
  // p_exclude_statuses를 SQL WHERE에 반영해 LIMIT/OFFSET·total_count가 이 스코프 기준으로
  // 계산되도록 함(2026-08-07 페이지네이션 정합성 수정 — RPC에서 필터링 전 count를 쓰면
  // "총 N건"·페이지 수가 실제 표시 목록과 어긋남, migration 201 참고)
  const RENTAL_VIEW_STATUSES = ['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed', 'draft']

  const { data: rows, error } = await admin.rpc('get_rental_list', {
    p_status:                          status   || null,
    p_search:                          search   || null,
    p_date_from:                       dateFrom || null,
    p_date_to:                         dateTo   || null,
    p_page:                            page,
    p_per_page:                        30,
    p_exclude_statuses:                RENTAL_VIEW_STATUSES,
    p_require_contract_sent_unsigned:  contractPending || null,
  })

  if (error) console.error('[cms/reservation] get_rental_list error:', error.message)

  const rentals: RentalListRow[] = rows ?? []
  const totalCount = rentals[0]?.total_count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / 30))

  return { rentals, totalCount, totalPages, status, search, dateFrom, dateTo, page, selectedId, cmsRole, contractPending }
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

    // 예약 승인 채팅 알림 — 같은 주문(order_items)으로 묶인 다중상품 예약이면 상품별 개별
    // 발송 대신, 주문 전체가 승인 완료된 시점(이번 건이 마지막 승인)에만 통합 카드 1건으로
    // 발송한다(service-operations.md §4). 단일 상품 예약은 기존과 동일하게 즉시 단건 발송.
    const notifyPlan = await resolveApprovalNotifyPlan(admin, reservationId)
    if (notifyPlan.mode === 'batch') {
      const { data: batchResult, error: batchError } = await admin.rpc('send_rental_chat_notification_batch', {
        p_reservation_ids: notifyPlan.reservationIds,
        p_notify_type: 'reservation_approval',
      })
      if (batchError) {
        console.error('[cms/reservation] send_rental_chat_notification_batch error:', batchError.message)
      } else {
        const batchRes = batchResult as { ok: boolean; error?: string } | null
        if (!batchRes?.ok) console.error('[cms/reservation] send_rental_chat_notification_batch rejected:', batchRes?.error)
      }
    } else if (notifyPlan.mode === 'single') {
      await admin.rpc('send_rental_chat_notification', {
        p_reservation_id: reservationId,
        p_notify_type: 'reservation_approval',
      })
    }
    // notifyPlan.mode === 'hold' → 같은 주문의 다른 상품이 아직 미승인 — 알림 보류(마지막
    // 승인 시 위 batch 분기가 통합 카드로 한 번에 발송함)

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
    // cancelled·damage_claimed 추가(2026-08-18 검수 발견 — 상태만 바뀌고 고객 알림이 전혀
    // 없던 공백. HOLD 30분 자동만료는 release_reservation_hold RPC 내부에서 별도 발송)
    const AUTO_NOTIFY: Partial<Record<string, string>> = {
      shipped:          'shipment_notify',
      in_use:           'rental_confirm',
      return_requested: 'return_registration',
      returned:         'rental_complete',
      cancelled:        'reservation_cancelled',
      damage_claimed:   'damage_claimed',
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

  clearIssuedContract: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음' })

    const admin      = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const data       = await request.formData()
    const contractId = data.get('id') as string
    if (!contractId) return fail(400, { error: '계약서 ID가 없습니다.' })

    const result = await clearIssuedContractContent(contractId, admin)
    if (!result.ok) return fail(result.httpStatus, { error: result.error })
    return { ok: true }
  },
}
