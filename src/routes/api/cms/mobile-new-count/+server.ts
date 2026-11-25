/**
 * /api/cms/mobile-new-count — CMS 모바일 현장앱 '대여 목록' 플로팅 아이콘의 당일 신규 건수 배지용 (2026-11-25)
 * 당일(KST 00:00~) 새로 '계약완료(confirmed)' 상태가 된 주문의 수. 주문 1건 = 1개(같은 예약코드는 합산).
 * 호출처는 /cms/mobile 화면뿐 — 예약대여현황 메뉴 권한을 따른다. 조회 실패는 0으로 응답(배지만 안 보임).
 */
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json, error } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '인증 필요')
  if (!(await getCmsRoleForAction(locals))) throw error(403, '접근 권한이 없습니다.')

  // 오늘 0시(KST) — 한국 시각 기준 날짜를 구해 +09:00 오프셋으로 시작 시각을 만든다
  const kstDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const startOfTodayKst = `${kstDate}T00:00:00+09:00`

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error: qErr } = await admin
    .from('rental_reservations')
    .select('id, reservation_code')
    .eq('status', 'confirmed')
    .gte('status_changed_at', startOfTodayKst)
    .limit(1000)
  if (qErr) {
    console.error('[mobile-new-count] 조회 실패:', qErr.message)
    return json({ count: 0 })
  }
  const keys = new Set(
    ((data ?? []) as Array<{ id: number; reservation_code: string | null }>).map((r) => r.reservation_code ?? `id:${r.id}`),
  )
  return json({ count: keys.size })
}
