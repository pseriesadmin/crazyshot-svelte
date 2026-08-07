import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { sendReservationLifecyclePush } from '$lib/server/push'

import type { RentalListRow } from '../reservation/+page.server'
export type { RentalListRow }

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')

  const admin  = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const status = url.searchParams.get('status') ?? ''
  const search = url.searchParams.get('search') ?? ''
  const page   = parseInt(url.searchParams.get('page') ?? '1', 10)
  const selectedParam = url.searchParams.get('selected')
  const selectedId    = selectedParam ? parseInt(selectedParam, 10) : null

  // 대여 라이프사이클 전용: 예약 단계(pending/hold/cancelled)는 /cms/reservation에서 관리
  // p_include_statuses를 SQL WHERE에 반영해 LIMIT/OFFSET·total_count가 이 스코프 기준으로
  // 계산되도록 함(2026-08-07 페이지네이션 정합성 수정 — RPC에서 필터링 전 count를 쓰면
  // "총 N건"·페이지 수가 실제 표시 목록과 어긋남, migration 201 참고)
  const RENTAL_STATUSES = ['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed']

  const { data: rows, error } = await admin.rpc('get_rental_list', {
    p_status:           status   || null,
    p_search:           search   || null,
    p_date_from:        null,
    p_date_to:          null,
    p_page:             page,
    p_per_page:         30,
    p_include_statuses: RENTAL_STATUSES,
  })

  if (error) console.error('[cms/rentals] get_rental_list error:', error.message)

  const rentals: RentalListRow[] = rows ?? []
  const totalCount = rentals[0]?.total_count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / 30))

  return { rentals, totalCount, totalPages, status, search, page, selectedId, cmsRole }
}

export const actions: Actions = {
  sendChatNotify: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { message: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(403, { message: '권한 없음' })

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const data  = await request.formData()
    const reservationId = Number(data.get('reservation_id'))
    const notifyType    = data.get('notify_type') as string

    const { data: result, error } = await admin.rpc('send_rental_chat_notification', {
      p_reservation_id: reservationId,
      p_notify_type:    notifyType,
    })

    if (error) return fail(500, { message: error.message })
    const res = result as { ok: boolean; error?: string } | null
    if (!res?.ok) return fail(400, { message: res?.error ?? '알림 발송 실패' })
    // 수동 발송 푸시 알림 병행 (채팅과 독립 — 실패해도 위 처리에 영향 없음)
    await sendReservationLifecyclePush(admin, reservationId, notifyType)
    return { ok: true }
  },
}
