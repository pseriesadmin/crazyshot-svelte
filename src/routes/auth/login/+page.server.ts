import type { PageServerLoad } from './$types'

// ──────────────────────────────────────────────────────────────
// 광고 배너 타입 (CMS → 프로모션 → 광고 / promotion_banners 테이블)
//
// placement: 'login_mobile' — 로그인 모바일 gnb-mobile-nav 하단 배너
// html_content: 관리자가 CMS에서 작성한 HTML (서버사이드 렌더링 전용)
//               {@html} 사용 — CMS 관리자 전용 입력이므로 XSS 위험 없음
// link_url: 배너 클릭 시 이동 URL (null 이면 링크 없음)
// priority: 높을수록 우선 표시
// is_active: false 이면 표시 안 함
// ──────────────────────────────────────────────────────────────

export type PromoBanner = {
  bg_image_url: string
  overlay_image_url: string | null
  html_content: string
  link_url: string | null
}

// CMS 데이터 미생성 시 정적 fallback
const DEFAULT_BANNER: PromoBanner = {
  bg_image_url: '/auth/welcome-mobile-bg.png',
  overlay_image_url: '/auth/welcome-mobile-overlay.png',
  html_content: `
    <p class="m-welcome-kr">
      <span class="m-w-purple">고민</span><span class="m-w-red">광</span><span class="m-w-purple">이탈</span><br/>
      <span class="m-w-purple">렌탈</span><span class="m-w-red">빨</span><span class="m-w-purple">장비</span>
    </p>
    <p class="m-welcome-sub">부심만족&nbsp;<span class="m-w-red-sub">크레이지샷</span></p>
  `,
  link_url: null,
}

export const load: PageServerLoad = async ({ locals }) => {
  // CMS → 프로모션 → 광고 (promotion_banners) 에서 로그인 모바일 배너 조회
  // promotion_banners 테이블 미생성 시 catch → DEFAULT_BANNER fallback
  try {
    const { data, error } = await locals.supabase
      .from('promotion_banners')
      .select('bg_image_url, overlay_image_url, html_content, link_url')
      .eq('placement', 'login_mobile')
      .eq('is_active', true)
      .order('priority', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) return { banner: DEFAULT_BANNER }
    return { banner: data as PromoBanner }
  } catch {
    // promotion_banners 테이블 미생성 단계 — 정적 기본 배너 표시
    return { banner: DEFAULT_BANNER }
  }
}
