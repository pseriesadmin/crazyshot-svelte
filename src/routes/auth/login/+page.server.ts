import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { isRealMemberSession } from '$lib/utils/authGuard'
import { parseLoginBannerSettings, orderLoginBanners, type LoginBannerRow } from '$lib/utils/loginBanner'

// ──────────────────────────────────────────────────────────────
// 모바일 기본(고정) 배너 타입 — 등록된 배너가 없을 때 쓰는 대체 배너.
// 실제 운영 배너는 로그인 화면의 "배너 관리"(LoginBannerModal)로 등록하며 banners 테이블
// (slot_key 'login_pc'/'login_mobile')과 cms_settings.login_banner_mode 에 저장된다(fetchBanner 참고).
// html_content: 코드에 고정된 HTML(서버 코드 상수, 사용자 입력 아님) — {@html} 로 렌더링
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

export const load: PageServerLoad = async ({ locals, url }) => {
  const { session } = await locals.safeGetSession()

  // [BUGFIX 2026-09-28] 익명 세션(signInAnonymously, 채팅 1회 사용만으로 생성됨)을
  // "로그인됨"으로 오판해 redirect 파라미터로 되돌려보내면, 장바구니처럼
  // isRealMemberSession(가입 완료 세션만 인정)을 요구하는 화면과 기준이 어긋나
  // /cart ↔ /auth/login 무한 리다이렉트 루프가 발생한다 — 실제 가입 세션만 인정하도록 통일.
  if (session && isRealMemberSession(session)) {
    // CMS 어드민이면 로그인 페이지 접근 허용 (배너 관리 버튼 노출용)
    const { data: profile } = await locals.supabase
      .from('user_profiles')
      .select('cms_role')
      .eq('id', session.user.id)
      .single()
    const isCmsAdmin = !!(profile as { cms_role?: string | null } | null)?.cms_role

    if (isCmsAdmin) {
      // CMS 어드민: 페이지 유지, isCmsAdmin 전달
      return fetchBanner(locals)
        .then((rest) => ({ ...rest, isCmsAdmin: true }))
    }

    // 일반 로그인 사용자: 목적지로 이동
    const redirectTo = url.searchParams.get('redirect')
    throw redirect(303, redirectTo ?? '/')
  }

  return fetchBanner(locals).then((rest) => ({ ...rest, isCmsAdmin: false }))
}

// 로그인 화면 배너 — 관리 모달(LoginBannerModal)이 저장하는 곳과 같은 곳을 읽는다(2026-10-02):
//   배너: banners 테이블 slot_key 'login_pc' / 'login_mobile' (공개 조회 정책이 is_active·노출 기간을 걸러줌, deleted_at 제외, sort_order 순)
//   설정: cms_settings.login_banner_mode { pc_mode, mobile_mode, mobile_visible }
// 배너는 목록(순서대로=등록순, 랜덤=서버에서 섞은 순서)으로 내려가고 화면이 4초마다 돌려 보여준다. 목록이 비면 화면은 기존 고정 배너(DEFAULT_BANNER·PC 고정 문구)를 그대로 쓴다. mobile_visible=false 면 모바일 배너 영역 숨김.
// 이전에는 존재하지 않는 promotion_banners 테이블을 읽어 항상 고정 배너만 보였다.
async function fetchBanner(locals: App.Locals) {
  const empty = { banner: DEFAULT_BANNER, pcBanners: [] as LoginBannerRow[], mobileBanners: [] as LoginBannerRow[], mobileVisible: true }
  try {
    const columns = 'id, title, sub_copy, image_url, link_url'
    const [pcRes, mobileRes, settingsRes] = await Promise.all([
      locals.supabase.from('banners').select(columns).eq('slot_key', 'login_pc').is('deleted_at', null).order('sort_order', { ascending: true }),
      locals.supabase.from('banners').select(columns).eq('slot_key', 'login_mobile').is('deleted_at', null).order('sort_order', { ascending: true }),
      locals.supabase.from('cms_settings').select('value').eq('key', 'login_banner_mode').maybeSingle(),
    ])
    const settings = parseLoginBannerSettings((settingsRes.data as { value: unknown } | null)?.value)
    return {
      banner: DEFAULT_BANNER,
      pcBanners: orderLoginBanners((pcRes.data ?? []) as LoginBannerRow[], settings.pcMode),
      mobileBanners: orderLoginBanners((mobileRes.data ?? []) as LoginBannerRow[], settings.mobileMode),
      mobileVisible: settings.mobileVisible,
    }
  } catch {
    // 조회 실패 시 기존 고정 배너로 안전하게 대체
    return empty
  }
}
