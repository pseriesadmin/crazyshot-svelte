import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { RETURN_REGISTER_TIMER_SETTING_KEY, parseReturnBarTimer, pickReturnRegisterBarItems, toReturnBarReservations } from '$lib/utils/returnRegisterBar'
import type { RequestHandler } from './$types'

// 채팅창 '반납정보 등록하기' 안내바 대상 조회 — 로그인한 본인의 대여 건만 읽는다(서버가 JWT 로 검증한 user.id 만 사용, 본문·쿼리 값 사용 없음).
// 판정 규칙은 $lib/utils/returnRegisterBar(기존 CMS 반납 정책)가 정본이고, 여기서는 DB 에서 필요한 값을 읽어 넘기기만 한다. 읽기 전용(조회만).
// 실패하면 안내바만 못 띄우는 것이므로 오류는 빈 목록으로 돌려준다(채팅 사용을 막지 않는다).
export const GET: RequestHandler = async ({ locals }) => {
  const { session, user } = await locals.safeGetSession()
  if (!session || !user) return json({ items: [] }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ items: [] })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  try {
    const { data: rows, error } = await admin
      .from('rental_reservations')
      .select('id, end_date, return_method, status, return_record_exempt')
      .eq('user_id', user.id)
      .in('status', ['in_use', 'return_requested'])
      .not('end_date', 'is', null)
    if (error || !rows || rows.length === 0) return json({ items: [] })
    const reservations = toReturnBarReservations(rows)
    if (reservations.length === 0) return json({ items: [] })
    const ids = reservations.map((r) => r.id)

    const [submissions, adminEntries, setting] = await Promise.all([
      admin.from('reservation_return_submissions').select('reservation_id').in('reservation_id', ids),
      admin.from('reservation_return_admin_entries').select('reservation_id').in('reservation_id', ids),
      admin.from('cms_settings').select('value').eq('key', RETURN_REGISTER_TIMER_SETTING_KEY).maybeSingle(),
    ])
    // 반납 기록 조회가 실패하면 이미 등록한 건을 잘못 띄울 수 있어 안내바를 띄우지 않는다
    if (submissions.error || adminEntries.error) return json({ items: [] })
    const registered = new Set<number>([
      ...((submissions.data ?? []) as Array<{ reservation_id: number }>).map((s) => Number(s.reservation_id)),
      ...((adminEntries.data ?? []) as Array<{ reservation_id: number }>).map((e) => Number(e.reservation_id)),
    ])
    const timer = parseReturnBarTimer((setting.data as { value?: unknown } | null)?.value)
    const items = pickReturnRegisterBarItems(reservations, registered, timer, Date.now())
    return json({ items: items.map((i) => ({ reservationId: i.reservationId, href: i.href })) })
  } catch {
    return json({ items: [] })
  }
}
