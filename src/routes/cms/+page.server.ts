import { redirect } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import type { PageServerLoad } from './$types'
import type { ChatSession } from '$lib/types/chat'

/**
 * 오늘(로컬 기준) +n일 오프셋을 'YYYY-MM-DD' 문자열로 반환.
 * ⛔ toISOString()(UTC)로 포맷하면 UTC+9(KST) 등에서 로컬 날짜와 하루 어긋남 —
 * 로컬 date getter로 직접 포맷(CmsDashboardGantt.svelte의 addDays 버그와 동일 계열,
 * 2026-08-12 발견·수정).
 */
function todayOffset(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// CmsDashboardSubscriptions.svelte 의 SubRow와 구조 동일 (서버 → 컴포넌트 경계)
// 2026-08-15: 레거시 subscriptions 테이블 → subscription_plans+user_subscriptions로 데이터 소스 교체
interface SubRow {
  id: string
  user_id: string
  tier: string           // lowercase: 'easy' | 'pop' | 'crazy'
  monthly_price: number  // subscription_plans.monthly_price
  started_at: string     // user_subscriptions.started_at
  expires_at: string     // user_subscriptions.expires_at
  created_at: string
  customer_name: string
}

export const load: PageServerLoad = async ({ parent, fetch, locals }) => {
  const { cmsRole } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Phase 1 — subscription_plans(active) + user_subscriptions(active) 병렬 조회
  // 2026-08-15: 레거시 subscriptions 테이블(PGRST205 오류) → 살아있는 테이블로 교체
  // membership_grade(EASY/POP/CRAZY) 기준 buckets 재구성, user_profiles 내장 select로 단일 쿼리 처리
  const { data: subsData } = await admin
    .from('user_subscriptions')
    .select(`
      id, user_id, started_at, expires_at, created_at,
      subscription_plans!plan_id(monthly_price, membership_grade),
      user_profiles!user_id(full_name)
    `)
    .eq('status', 'active')

  const subscriptionData: { easy: SubRow[]; pop: SubRow[]; crazy: SubRow[] } = {
    easy: [], pop: [], crazy: [],
  }
  for (const s of (subsData ?? []) as Record<string, unknown>[]) {
    const plan    = s.subscription_plans as Record<string, unknown> | null
    const profile = s.user_profiles      as Record<string, unknown> | null
    const grade   = String(plan?.membership_grade ?? '').toUpperCase()
    const tierKey = grade === 'EASY' ? 'easy' : grade === 'POP' ? 'pop' : grade === 'CRAZY' ? 'crazy' : null
    if (!tierKey) continue // NONE 등급이나 알 수 없는 grade는 집계 제외
    subscriptionData[tierKey].push({
      id:            String(s.id),
      user_id:       s.user_id as string,
      tier:          tierKey,
      monthly_price: Number(plan?.monthly_price ?? 0),
      started_at:    String(s.started_at ?? ''),
      expires_at:    String(s.expires_at ?? ''),
      created_at:    s.created_at as string,
      customer_name: String(profile?.full_name ?? ''),
    })
  }

  // Phase 4 — 간트 초기 14일 창 (오늘 -3 ~ 오늘 +10)
  // 초기 로드는 SSR에서 직접 RPC 호출 (API 엔드포인트 경유 없음)
  const ganttFrom = todayOffset(-3)
  const ganttTo   = todayOffset(10)

  const { data: ganttRows, error: ganttError } = await admin.rpc('get_rental_list', {
    p_status:           null,
    p_search:           null,
    p_date_from:        ganttFrom,
    p_date_to:          ganttTo,
    p_page:             1,
    p_per_page:         200,
    p_exclude_statuses: ['cancelled', 'draft'],
  })
  if (ganttError) {
    console.error('[dashboard] gantt get_rental_list 오류:', ganttError.message)
  }

  // Phase 2 — 오늘 통계 RPC + 쿠폰 일간 리포트 (마이그레이션 미적용 시 null 폴백)
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  // ⛔ get_dashboard_today_stats/get_coupon_usage_report는 SQL 내부에서 is_cms_user()
  // (auth.uid() 기반) 게이트를 쓴다 — 세션 없는 service-role `admin` 클라이언트로 호출하면
  // auth.uid()가 항상 NULL이라 무조건 ACCESS_DENIED가 난다(2026-08-13 실사용 중 발견: "마이그레이션
  // 적용 여부를 확인하세요" 오류 메시지의 진짜 원인 — 마이그레이션은 정상 적용돼 있었음).
  // 로그인 세션이 실린 `locals.supabase`로 호출해야 auth.uid()가 실제 관리자로 채워짐 —
  // get_promotion_analytics 등 기존에 정상 동작하는 is_cms_user() 게이트 RPC들과 동일 패턴
  // (`cms/promotion/analytics/+page.server.ts`의 `locals.supabase.rpc(...)` 참고).
  // 생성된 Database 타입에 이 RPC들의 최신 시그니처가 반영돼 있지 않아, 기존 관례
  // (cms/promotion/coupon/+page.server.ts의 `locals.supabase as unknown as any`)를 그대로 따름
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionDb = locals.supabase as unknown as any
  const [{ data: statsData, error: statsError }, { data: couponRows, error: couponError }] =
    await Promise.all([
      sessionDb.rpc('get_dashboard_today_stats'),
      sessionDb.rpc('get_coupon_usage_report', {
        p_period: 'day',
        p_from: todayStart.toISOString(),
        p_to: todayEnd.toISOString(),
      }),
    ])

  if (statsError) {
    console.error('[dashboard] get_dashboard_today_stats 오류:', statsError.message)
  }
  if (couponError) {
    console.error('[dashboard] get_coupon_usage_report 오류:', couponError.message)
  }

  // Phase 3 — /api/chat/sessions fetch (기존 부수효과 — auto_pending 전환, 미응답 푸시 — 그대로 유지)
  const chatSessionsRes = await fetch('/api/chat/sessions')
  const chatSessions: ChatSession[] = chatSessionsRes.ok
    ? ((await chatSessionsRes.json() as { sessions?: ChatSession[] }).sessions ?? [])
    : []

  // 주간 자동응답(빠른답변) 최다사용 TOP10 (Migration #237) — is_cms_user() 게이트라
  // locals.supabase(세션 클라이언트)로 호출(위 오늘통계 RPC와 동일 이유)
  const { data: topCannedRows, error: topCannedError } = await sessionDb.rpc(
    'get_top_canned_responses_weekly',
  )
  if (topCannedError) {
    console.error('[dashboard] get_top_canned_responses_weekly 오류:', topCannedError.message)
  }
  const topCannedResponses: { canned_response_id: string; title: string; category: string | null; reply_count: number }[] =
    topCannedRows ?? []

  const todayStats = statsData as Record<string, number> | null
  const couponToday = {
    issued: (couponRows ?? []).reduce(
      (sum: number, r: { issued_count: number }) => sum + (r.issued_count ?? 0),
      0,
    ),
    used: (couponRows ?? []).reduce(
      (sum: number, r: { used_count: number }) => sum + (r.used_count ?? 0),
      0,
    ),
  }

  return {
    cmsRole,
    ganttWindow: { from: ganttFrom, to: ganttTo, rows: ganttRows ?? [] },
    subscriptionData,
    todayStats,
    couponToday,
    chatSessions,
    topCannedResponses,
  }
}
