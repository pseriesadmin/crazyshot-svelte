import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { sendReservationLifecyclePush } from '$lib/server/push'
import { sendApprovalNotifications } from '$lib/server/sendApprovalNotifications'
import { clearIssuedContractContent, discardSentContract } from '$lib/server/clearIssuedContractHelper'
import { resolveApprovalNotifyPlan } from '$lib/server/reservationApprovalNotify'
import { createDelivery, cancelDelivery, registerReturn, DheroApiError, DHERO_STATUS_LABEL } from '$lib/server/dhero'
import { escapeLikePattern } from '$lib/server/escapeLikePattern'
import { isBulkDeliveryMethod } from '$lib/server/isBulkDeliveryMethod'
import { getReservationForDhero } from '$lib/server/getReservationForDhero'
import { awardRentalCompletePoints } from '$lib/server/awardRentalCompletePoints'

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
  // Migration 344: 두발히어로 배송 상태 (nullable — 이전 예약은 NULL)
  dhero_status:         string | null
  dhero_status_code:    number | null
  dhero_return_book_id: string | null
  dhero_synced_at:      string | null
  tracking_number:      string | null
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
    p_search:                          escapeLikePattern(search) || null,
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

    // 예약 승인 채팅 알림 + 고객 푸시 — 공용 헬퍼로 통합 (NTF-C2 수정, 2026-08-31)
    // mode='hold'(같은 주문의 다른 상품 미승인)이면 채팅·푸시 둘 다 보류 — service-operations.md §4/§15
    const notifyPlan = await resolveApprovalNotifyPlan(admin, reservationId)
    await sendApprovalNotifications(admin, reservationId, notifyPlan)
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

    // 대여 액션 로그 기록 — 실패해도 메인 처리에 영향 없음 (fail-soft)
    // note='manual'로 수동 CMS 조작임을 표시 (QR 경로 note='qr_scan'과 구분 — EC-4)
    try {
      await admin.rpc('log_rental_action', {
        p_reservation_id: reservationId,
        p_action_type:    newStatus,
        p_admin_id:       session.user.id,
        p_note:           'manual',
      })
    } catch { /* 로그 실패는 무시 */ }

    // 대여완료 포인트 자동적립 — returned 전이 시에만, fail-soft(공용 헬퍼가 내부 처리)
    // QR 반납 경로(rentalQrTransition.ts)도 동일하게 배선됨(log_rental_action과 동일 이중 배선)
    if (newStatus === 'returned') {
      try {
        await awardRentalCompletePoints(admin, reservationId)
      } catch { /* 포인트 적립 실패는 무시 */ }
    }

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

    // ── 두발히어로 fail-soft 트리거 ─────────────────────────────────────────
    // shipped·return_requested·cancelled 전이 시 두발히어로 API 자동 호출.
    // API 실패는 예약 상태전이(이미 위에서 성공)에 영향을 주지 않는다 — 완전 격리.
    //
    // CRITICAL-1 수정 (2026-08-25): 기존 rental_reservations 단일 select에서
    // 존재하지 않는 컬럼(customer_name/addr 등) 조회로 42703 오류 → resRow=null →
    // 트리거 전체 스킵되던 버그를 getReservationForDhero() 공유 함수로 교체하여 수정.
    let dheroCancelFailed = false
    if (newStatus === 'shipped' || newStatus === 'return_requested' || newStatus === 'cancelled') {
      try {
        // 예약 정보 JOIN 조회 — user_profiles/user_shipping_addresses/products 포함
        // (rental_reservations에 고객명·주소·상품명이 직접 없음, 공유 모듈 사용)
        const res = await getReservationForDhero(admin, reservationId)

        if (res) {
          if (newStatus === 'shipped') {
            const isBulk = await isBulkDeliveryMethod(admin, res.pickupMethod)
            if (isBulk) {
              try {
                const deliveryRes = await createDelivery({
                  receiverName:              res.customerName,
                  receiverMobile:            res.customerPhone,
                  receiverAddress:           res.address,
                  receiverAddressDetail:     res.addressDetail,
                  receiverAddressPostalCode: res.postalCode,
                  productName:               res.productName,
                  orderIdFromCorp:           res.reservationCode ?? String(reservationId),
                  memoFromCustomer:          res.notes ?? undefined,
                })
                await admin.rpc('update_reservation_dhero_shipment', {
                  p_reservation_id:  reservationId,
                  p_tracking_number: deliveryRes.bookId,
                  p_courier_code:    '두발히어로',
                  p_status:          DHERO_STATUS_LABEL[0] ?? '배송접수',
                  p_status_code:     0,
                  p_dong_group:      deliveryRes.dongGroup ?? null,
                  p_meta:            deliveryRes as Record<string, unknown>,
                  p_return_book_id:  null,
                })
                // placePageUrl이 있으면 고객 채팅으로 수령위치 등록 안내 전달 (fail-soft)
                // service-operations.md §11: find_or_create_general_chat_session 경유는 RPC 내부에서 처리
                // service-operations.md §15: push.ts CUSTOMER_LIFECYCLE_PUSH_COPY에 dhero_place_guide 등록 완료
                if (deliveryRes.placePageUrl) {
                  try {
                    await admin.rpc('send_rental_chat_notification', {
                      p_reservation_id: reservationId,
                      p_notify_type:    'dhero_place_guide',
                      p_action_url:     deliveryRes.placePageUrl,
                    })
                    await sendReservationLifecyclePush(admin, reservationId, 'dhero_place_guide')
                  } catch (notifyErr) {
                    console.error('[dhero/place_guide notify] fail-soft:', notifyErr instanceof Error ? notifyErr.message : notifyErr)
                  }
                }
              } catch (e) {
                console.error('[dhero/shipped] fail-soft:', e instanceof Error ? e.message : e)
              }
            }
          } else if (newStatus === 'return_requested') {
            const isBulk = await isBulkDeliveryMethod(admin, res.returnMethod)
            const trackingNumber = res.trackingNumber
            if (isBulk && trackingNumber) {
              try {
                const returnRes = await registerReturn(trackingNumber)
                await admin.rpc('update_reservation_dhero_shipment', {
                  p_reservation_id:  reservationId,
                  p_tracking_number: trackingNumber,
                  p_courier_code:    '두발히어로',
                  p_status:          DHERO_STATUS_LABEL[0] ?? '반품접수',
                  p_status_code:     0,
                  p_dong_group:      returnRes.dongGroup ?? null,
                  p_meta:            returnRes as Record<string, unknown>,
                  p_return_book_id:  returnRes.bookId,
                })
              } catch (e) {
                console.error('[dhero/return_requested] fail-soft:', e instanceof Error ? e.message : e)
              }
            }
          } else if (newStatus === 'cancelled') {
            const trackingNumber = res.trackingNumber
            if (trackingNumber) {
              try {
                await cancelDelivery(trackingNumber)
              } catch (e) {
                if (e instanceof DheroApiError && e.statusCode === 412) {
                  dheroCancelFailed = true
                } else {
                  console.error('[dhero/cancelled] fail-soft:', e instanceof Error ? e.message : e)
                }
              }
            }
          }
        }
      } catch (e) {
        // 예약 조회 자체 실패도 fail-soft — 상태전이는 이미 성공
        console.error('[dhero] reservation lookup fail-soft:', e instanceof Error ? e.message : e)
      }
    }
    // ── dhero 트리거 끝 ────────────────────────────────────────────────────

    return { ok: true, ...(dheroCancelFailed ? { dhero_cancel_failed: true } : {}) }
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

  // Stage 5 (EC-6): 발송된 미서명 계약서 폐기 — 서명 링크 즉시 만료 + 콘텐츠 초기화 (GATE B Q7)
  // manager 이상 전용 (send-chat 엔드포인트와 동일 권한 기준 — security-auth.md 접근 매트릭스 참조)
  discardSentContract: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음' })

    const admin      = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const data       = await request.formData()
    const contractId = data.get('id') as string
    if (!contractId) return fail(400, { error: '계약서 ID가 없습니다.' })

    const result = await discardSentContract(contractId, admin)
    if (!result.ok) return fail(result.httpStatus, { error: result.error })
    return { ok: true }
  },
}
