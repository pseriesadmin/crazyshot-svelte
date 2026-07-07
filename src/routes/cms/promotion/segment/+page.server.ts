import { redirect } from '@sveltejs/kit'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { PageServerLoad } from './$types'

export type SegmentStats = {
  total_tracked_users: number
  total_events_7d: number
  last_refresh: string | null
  segments: Array<{
    segment: string
    count: number
    avg_score: number
  }>
}

export type SegmentUser = {
  user_id: string
  full_name: string | null
  phone: string | null
  email: string | null
  score: number | null
  computed_at: string
}

const SEGMENT_LABELS: Record<string, string> = {
  new_member:           '신규회원',
  vip:                  'VIP',
  dormant:              '휴면회원',
  cart_abandon:         '장바구니이탈',
  first_purchase_ready: '첫구매예정',
  repurchase_ready:     '재구매예정',
  high_value:           '고가치고객',
}

export const load: PageServerLoad = async ({ parent, locals, url }) => {
  const { cmsRole } = await parent()
  if (!hasSettingsAccess(cmsRole ?? '')) {
    throw redirect(303, '/cms?notice=access_denied')
  }

  const activeSegment = url.searchParams.get('segment') ?? ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = locals.supabase as unknown as any

  // 세그먼트 통계
  const { data: statsRaw } = await admin.rpc('get_segment_stats')
  const stats: SegmentStats = statsRaw ?? {
    total_tracked_users: 0,
    total_events_7d: 0,
    last_refresh: null,
    segments: [],
  }

  // 선택된 세그먼트 사용자 목록
  let segmentUsers: SegmentUser[] = []
  if (activeSegment) {
    const { data: users } = await admin.rpc('get_segment_users', {
      p_segment: activeSegment,
      p_limit:   50,
      p_offset:  0,
    })
    segmentUsers = (users ?? []) as SegmentUser[]
  }

  return {
    stats,
    segmentUsers,
    activeSegment,
    segmentLabels: SEGMENT_LABELS,
  }
}
