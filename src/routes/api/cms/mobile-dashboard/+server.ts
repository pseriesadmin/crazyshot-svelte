/**
 * /api/cms/mobile-dashboard[?date=YYYY-MM-DD] — CMS 모바일 현장앱 대시보드 건수(날짜 없음 = 현재까지 통합) (2026-11-25)
 * 호출처는 /cms/mobile 첫 화면뿐 — 예약대여현황 메뉴 권한을 따른다.
 */
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json, error } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { ISO_DATE_RE, loadMobileDashboardCounts, loadMobileTotalCounts } from '$lib/server/cms/mobileDashboard'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals, url }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '인증 필요')
  if (!(await getCmsRoleForAction(locals))) throw error(403, '접근 권한이 없습니다.')

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const date = url.searchParams.get('date')
  // date 없음 = '현재까지' 통합 수량(첫 화면 기본값)
  if (!date) return json({ date: null, counts: await loadMobileTotalCounts(admin) })
  if (!ISO_DATE_RE.test(date)) return json({ error: '날짜 형식이 올바르지 않습니다.' }, { status: 400 })
  return json({ date, counts: await loadMobileDashboardCounts(admin, date) })
}
