import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

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
