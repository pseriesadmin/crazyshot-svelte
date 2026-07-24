import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

import type { RentalListRow } from '../reservation/+page.server'
export type { RentalListRow }

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')

  const admin  = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const status = url.searchParams.get('status') ?? ''
  const search = url.searchParams.get('search') ?? ''
  const page   = parseInt(url.searchParams.get('page') ?? '1', 10)

  const { data: rows, error } = await admin.rpc('get_rental_list', {
    p_status:    status   || null,
    p_search:    search   || null,
    p_date_from: null,
    p_date_to:   null,
    p_page:      page,
    p_per_page:  30,
  })

  if (error) console.error('[cms/rentals] get_rental_list error:', error.message)

  // 대여 라이프사이클 전용: 예약 단계(pending/hold/cancelled)는 /cms/reservation에서 관리
  const allRows = rows ?? []
  const RENTAL_STATUSES = new Set(['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed'])
  const rentals: RentalListRow[] = allRows.filter((r: RentalListRow) => RENTAL_STATUSES.has(r.status))
  const totalCount = allRows[0]?.total_count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / 30))

  return { rentals, totalCount, totalPages, status, search, page, cmsRole }
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
    return { ok: true }
  },
}
