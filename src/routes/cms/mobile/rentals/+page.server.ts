import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { clearIssuedContractContent } from '$lib/server/clearIssuedContractHelper'

import type { RentalListRow } from '../../reservation/+page.server'
export type { RentalListRow }

// 데스크톱 /cms/rentals/+page.server.ts와 동일 스코프(예약 단계 제외, 대여 라이프사이클 전용).
// 데스크톱 파일은 변경하지 않으므로 동일 상수를 이 파일에도 유지한다.
const RENTAL_STATUSES = ['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed']

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')

  const admin  = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const status = url.searchParams.get('status') ?? ''
  const search = url.searchParams.get('search') ?? ''
  const page   = parseInt(url.searchParams.get('page') ?? '1', 10)

  const { data: rows, error } = await admin.rpc('get_rental_list', {
    p_status:           status   || null,
    p_search:           search   || null,
    p_date_from:        null,
    p_date_to:          null,
    p_page:             page,
    p_per_page:         30,
    p_include_statuses: RENTAL_STATUSES,
  })

  if (error) console.error('[cms/mobile/rentals] get_rental_list error:', error.message)

  const rentals: RentalListRow[] = rows ?? []
  const totalCount = rentals[0]?.total_count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / 30))

  return { rentals, totalCount, totalPages, status, search, page, cmsRole }
}

export const actions: Actions = {
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
