<script lang="ts">
  import { supabase } from '$lib/services/supabase'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { mobileChatNav } from '$lib/stores/mobileChatNav.svelte'
  import { mobileSubGnb } from '$lib/stores/mobileSubGnb.svelte'
  import { refreshMobileNewRentals } from '$lib/stores/mobileNewRentals.svelte'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import { Toaster } from 'svelte-sonner'
  import { unregisterCurrentPushToken } from '$lib/utils/push'
  import type { LayoutData } from './$types'

  interface Props {
    data: LayoutData
    children: import('svelte').Snippet
  }

  let { data, children }: Props = $props()

  let showProfileModal = $state(false)

  // 상담 화면에서는 GNB를 CMS 서브 탭바 스타일로(좌측 '목록' 탭 · 우측 내 정보)
  // 공통 서브 GNB 구조 — 홈(/cms/mobile)을 뺀 하위 화면은 메인 GNB 대신 서브 GNB(좌측 홈 아이콘 · 중앙 메뉴명 · 우측 내 정보)를 쓴다.
  // 화면을 추가할 때는 아래 SUB_GNB_TITLES 에 경로와 메뉴명만 넣으면 같은 구조가 적용된다.
  const SUB_GNB_TITLES: ReadonlyArray<readonly [string, string]> = [
    ['/cms/mobile/chat', '상담 세션'],
    ['/cms/mobile/rentals', '대여 목록'],
    ['/cms/mobile/products', '상품 목록'],
  ]
  // 상품 상세(/cms/mobile/[id])는 상품명을 화면이 채워 준다. 고정 화면 경로(chat·rentals·products·qr)는 제외.
  const isDetailRoute = $derived(/^\/cms\/mobile\/(?!chat$|rentals$|products$|qr$)[^/]+\/?$/.test(page.url.pathname))
  const subGnbTitle = $derived(
    SUB_GNB_TITLES.find(([prefix]) => page.url.pathname.startsWith(prefix))?.[1]
      ?? (isDetailRoute ? (mobileSubGnb.title ?? '상품 상세') : null),
  )
  const isChatRoute = $derived(page.url.pathname.startsWith('/cms/mobile/chat'))

  // 대여 목록 아이콘 배지(당일 신규 건수) — 화면 이동 때와 60초마다 갱신
  $effect(() => {
    void page.url.pathname
    void refreshMobileNewRentals()
  })
  $effect(() => {
    const t = setInterval(() => { void refreshMobileNewRentals() }, 60_000)
    return () => clearInterval(t)
  })

  // 홈 화면 바로가기(PWA) — 이 현장앱(/cms/mobile)을 '홈 화면에 추가'하면 일반 사이트가 아니라 현장앱이 바로 열리도록,
  // 현장앱 화면에 있는 동안 매니페스트(시작 주소 /cms/mobile)와 iOS 앱 이름을 현장앱용으로 바꿔 둔다. 화면을 떠나면 원래대로 복원한다.
  $effect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    const title = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const prev = { link: link?.getAttribute('href') ?? null, title: title?.getAttribute('content') ?? null, theme: theme?.getAttribute('content') ?? null }
    link?.setAttribute('href', '/manifest-cms-mobile.json')
    title?.setAttribute('content', '현장앱')
    theme?.setAttribute('content', '#1D183E')
    return () => {
      if (prev.link !== null) link?.setAttribute('href', prev.link)
      if (prev.title !== null) title?.setAttribute('content', prev.title)
      if (prev.theme !== null) theme?.setAttribute('content', prev.theme)
    }
  })

  const userInitial = $derived((data.session?.user?.email?.[0] ?? '?').toUpperCase())

  function roleLabel(role: string | null | undefined): string {
    if (role === 'superadmin') return '슈퍼관리자'
    if (role === 'manager') return '매니저'
    if (role === 'partner') return '파트너'
    return role ?? '-'
  }

  function formatDateTime(iso: string | null | undefined): string {
    if (!iso) return '-'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '-'
    return d.toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  }

  async function logout(): Promise<void> {
    await unregisterCurrentPushToken()
    await supabase.auth.signOut()
    goto('/cms/login')
  }
</script>

<Toaster position="bottom-center" />

<div class="mobile-shell">
  <!-- GNB — CMS pill 스타일 (모바일 축소 적용) -->
  <div class="mob-topbar-wrap" class:has-subgnb={subGnbTitle !== null}>
    {#if subGnbTitle !== null}
      <header class="mob-subgnb">
        <!-- 좌측: 세션 목록 화면에서는 홈 아이콘(현장앱 홈으로), 대화창이 열려 있으면 홈 아이콘 대신 '목록' 탭 -->
        <div class="sub-left">
          {#if isChatRoute && mobileChatNav.inSession}
            <button type="button" class="sub-tab" onclick={() => mobileChatNav.back?.()}><ChevronIcon direction="left" size={5} />목록</button>
          {:else if isDetailRoute}
            <a class="sub-tab" href="/cms/mobile/products"><ChevronIcon direction="left" size={5} />목록</a>
          {:else}
            <a href="/cms/mobile" class="sub-home" aria-label="현장앱 홈" title="현장앱 홈">
              <svg xmlns="http://www.w3.org/2000/svg" width="21" height="20" viewBox="0 0 21 20" fill="none" aria-hidden="true">
                <path d="M10.5009 5.89594e-07C11.5905 0.000624114 12.7132 0.41156 13.7051 0.927735C14.7246 1.45838 15.7471 2.1745 16.6718 2.94629C17.5985 3.71968 18.4602 4.57667 19.1513 5.40918C19.8181 6.21242 20.4175 7.10114 20.6972 7.9375C20.9959 8.83055 21.0275 10.0069 20.9843 11.085C20.939 12.2175 20.7986 13.4581 20.6357 14.5908C20.4722 15.7284 20.2828 16.7835 20.1347 17.5527C20.0606 17.9378 19.996 18.2528 19.9502 18.4727C19.9273 18.5826 19.9092 18.6691 19.8965 18.7285C19.8901 18.758 19.8853 18.781 19.8818 18.7969C19.8801 18.8046 19.8789 18.8111 19.8779 18.8154C19.8774 18.8176 19.8759 18.8213 19.8759 18.8213V18.8232C19.6974 19.6322 18.8968 20.1434 18.0879 19.9648C17.2789 19.7863 16.7678 18.9857 16.9463 18.1768L16.9472 18.1729C16.9479 18.1699 16.9488 18.1653 16.9502 18.1592C16.953 18.146 16.9571 18.1254 16.9629 18.0986C16.9744 18.045 16.9921 17.9648 17.0136 17.8613C17.0567 17.6543 17.1176 17.3538 17.1884 16.9854C17.3305 16.247 17.5111 15.241 17.666 14.1641C17.8216 13.082 17.9477 11.9536 17.9873 10.9648C18.029 9.9219 17.9632 9.22379 17.8515 8.88965C17.7482 8.58082 17.43 8.03259 16.8427 7.3252C16.2797 6.647 15.5508 5.91839 14.75 5.25C13.9472 4.57999 13.1039 3.9967 12.3203 3.58887C11.5092 3.16673 10.8901 3.00021 10.499 3C10.119 2.99985 9.50282 3.16863 8.68357 3.60449C7.89443 4.02435 7.04446 4.62328 6.23533 5.30566C5.42838 5.98623 4.69417 6.72284 4.13083 7.39746C3.53803 8.1074 3.23492 8.63098 3.14841 8.88965C3.03673 9.22378 2.9709 9.92188 3.01267 10.9648C3.05227 11.9536 3.17836 13.082 3.33396 14.1641C3.48883 15.241 3.6694 16.247 3.8115 16.9854C3.8824 17.3538 3.94319 17.6543 3.9863 17.8613C4.00785 17.9648 4.02557 18.045 4.03708 18.0986C4.04284 18.1254 4.04692 18.146 4.04978 18.1592C4.05111 18.1653 4.05206 18.1699 4.05271 18.1729L4.05368 18.1768L4.07908 18.3281C4.16711 19.0833 3.67051 19.7975 2.91208 19.9648C2.15386 20.1321 1.40314 19.6935 1.16501 18.9717L1.124 18.8232V18.8213C1.124 18.8213 1.1235 18.8176 1.12302 18.8154C1.12207 18.8111 1.11984 18.8047 1.11814 18.7969C1.11468 18.781 1.10981 18.7579 1.10349 18.7285C1.09073 18.6691 1.07265 18.5825 1.04978 18.4727C1.00399 18.2527 0.939316 17.9378 0.865208 17.5527C0.717175 16.7835 0.527812 15.7284 0.364231 14.5908C0.201344 13.4581 0.0609608 12.2175 0.0155987 11.085C-0.0275806 10.0069 0.00401917 8.83057 0.302708 7.9375C0.571737 7.13324 1.17202 6.26032 1.8281 5.47461C2.51375 4.65351 3.37435 3.79483 4.30173 3.0127C5.22698 2.23238 6.25185 1.5001 7.27439 0.956055C8.2668 0.42806 9.40003 -0.00058024 10.5009 5.89594e-07Z" fill="#201857"/>
                <path d="M12.25 17.5C12.25 18.4665 11.4665 19.25 10.5 19.25C9.53347 19.25 8.74997 18.4665 8.74997 17.5V14C8.74997 13.0335 9.53347 12.25 10.5 12.25C11.4665 12.25 12.25 13.0335 12.25 14V17.5Z" fill="#CF0000"/>
              </svg>
            </a>
          {/if}
        </div>
        <!-- 중앙: 진입한 화면의 메뉴명(단순 텍스트) -->
        <span class="sub-title-wrap">
          <span class="sub-title">{subGnbTitle}</span>
          {#if isDetailRoute && mobileSubGnb.sub}<span class="sub-sub">{mobileSubGnb.sub}</span>{/if}
        </span>
        <button
          type="button"
          class="mob-gnb-avatar sub-avatar"
          onclick={() => (showProfileModal = true)}
          aria-label="내 정보"
          title="내 정보"
        >{userInitial}</button>
      </header>
    {:else}
    <header class="mob-gnb">
      <a href="/cms/mobile" class="mob-gnb-brand" aria-label="CRAZYSHOT 현장앱 홈">
        <img src="/logo-bi2.svg" alt="CRAZYSHOT" class="mob-gnb-logo-img" width="117" height="72" />
      </a>
      <button
        type="button"
        class="mob-gnb-avatar"
        onclick={() => (showProfileModal = true)}
        aria-label="내 정보"
        title="내 정보"
      >{userInitial}</button>
    </header>
    {/if}
  </div>
  <div class="mob-content">
    {@render children()}
  </div>
</div>

{#if showProfileModal}
  <div class="profile-backdrop" onclick={() => (showProfileModal = false)} role="presentation">
    <div
      class="profile-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="내 정보"
      onclick={(e) => e.stopPropagation()}
    >
      <button type="button" class="profile-modal-close" onclick={() => (showProfileModal = false)} aria-label="닫기">✕</button>

      <div class="profile-avatar-lg" aria-hidden="true">{userInitial}</div>

      <p class="profile-email">{data.session?.user?.email ?? '-'}</p>
      <span class="role-tag role-{data.cmsRole}">{roleLabel(data.cmsRole)}</span>

      <div class="profile-info-row">
        <span class="profile-info-label">접속일자</span>
        <span class="profile-info-value">{formatDateTime(data.session?.user?.last_sign_in_at)}</span>
      </div>

      <div class="profile-actions">
        <button type="button" class="profile-logout-btn" onclick={logout}>Sign Out</button>
      </div>
    </div>
  </div>
{/if}

<style>
.mobile-shell {
    height: 100dvh;
    background: var(--cs-lilac);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* GNB — CMS pill 스타일 (모바일 축소 적용) */
  .mob-topbar-wrap {
    flex-shrink: 0;
    padding: 14px 14px 0;
    background: var(--cs-lilac);
  }

  /* 서브 GNB 노출 화면 공통 — 서브 GNB와 본문 사이 간격 20px(Stephen 지시 2026-11-25, 본문 쪽 위 여백은 0으로 맞춤) */
  .mob-topbar-wrap.has-subgnb { padding-bottom: 20px; }

  .mob-gnb {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    height: 48.8px; /* 상하 20% 축소(61→48.8px), 가로폭은 유지 */
    background: #1d183e;
    border-radius: 17.6px;
    overflow: visible;
  }

  /* 서브 GNB — cms-uiux.md §2 서브 탭바(투명 배경·sub-tab 15px 반경·활성은 흰 면+퍼플 글자) 규격을 모바일 상담 화면에 적용 */
  .mob-subgnb {
    display: grid;
    align-items: center;
    grid-template-columns: 1fr auto 1fr;
    padding: 0 2px;
    min-height: 44px;
    background: transparent;
  }
  .sub-left { display: flex; align-items: center; gap: 4px; }
  .sub-home { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; flex-shrink: 0; }
  .sub-title-wrap { display: flex; flex-direction: column; align-items: center; min-width: 0; max-width: 150px; }
  .sub-title { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--text-m-body-16B); color: var(--cs-dark); }
  .sub-sub { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--text-m-script-12); color: var(--cs-text-light); line-height: 1.2; } /* 18px → 16px 한 단계 축소 */
  .sub-avatar { justify-self: end; }
  .sub-tab {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 6px 20px 6px 16px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--cs-surface-gray); /* 옅은 그레이 면 */
    color: var(--cs-text-mid);
    font: var(--text-m-script-14B);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .sub-tab:active { background: rgba(59, 47, 138, 0.08); color: var(--cs-text); }

  .mob-gnb-brand {
    display: block;
    line-height: 0;
    text-decoration: none;
    flex-shrink: 0;
  }

  .mob-gnb-logo-img {
    display: block;
    width: 93.6px; /* BI 20% 축소(117×72 → 93.6×57.6) */
    height: 57.6px;
    transform: translateY(-2.4px);
  }

  /* 아바타 이니셜 배지 — ui-mobile.md GNB 모바일 레이아웃 원칙 확정값 적용 */
  .mob-gnb-avatar {
    width: 40px;
    height: 40px;
    min-width: 40px;
    min-height: 40px;
    border-radius: 50%;
    background: rgba(85, 63, 224, 0.60);
    color: #ffffff;
    border: none;
    font-family: var(--font-en-display);
    font-size: 18px;
    font-weight: 700;
    text-transform: uppercase;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: filter 0.15s, opacity 0.15s;
  }
  .mob-gnb-avatar:hover { filter: brightness(0.92); }
  /* 메인 GNB 아바타 20% 축소(40→32px, 글자 18→14.4px) — 서브 GNB 아바타는 그대로 */
  .mob-gnb .mob-gnb-avatar { width: 32px; height: 32px; min-width: 32px; min-height: 32px; font-size: 14.4px; }

  .mob-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  /* 내 정보 모달 — cms-uiux.md §7-9 확인 모달 패턴 기반, 모바일 반응형 적용 */
  .profile-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(16,11,50,0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .profile-dialog {
    position: relative;
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    padding: 32px 28px 28px;
    width: 100%;
    max-width: 340px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  /* close-basic(기본닫기버튼) — ProductDetailPanel.svelte .clone-modal-close 표준 재사용 */
  .profile-modal-close {
    position: absolute;
    top: 14px;
    right: 14px;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    font-size: 14px;
    cursor: pointer;
    transition: background 0.12s;
  }
  .profile-modal-close:hover { background: rgba(255,53,53,0.1); color: var(--cs-red-badge); }

  .profile-avatar-lg {
    width: 64px;
    height: 64px;
    border-radius: var(--radius-full);
    background: var(--cs-purple-pale);
    color: var(--cs-dark);
    font-family: var(--font-en-display);
    font-size: 26px;
    font-weight: 700;
    text-transform: uppercase;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 14px;
  }

  .profile-email {
    font: var(--text-m-body-16B);
    color: var(--cs-text);
    margin: 0 0 8px;
    word-break: break-all;
  }

  .role-tag {
    display: inline-block;
    font: var(--text-pc-script-12);
    font-weight: 700;
    padding: 4px 12px;
    border-radius: var(--radius-full);
    margin-bottom: 20px;
  }
  .role-tag.role-superadmin { background: rgba(59,47,138,0.12); color: var(--cs-purple); }
  .role-tag.role-manager    { background: rgba(16,11,50,0.07);  color: var(--cs-text-dark); }
  .role-tag.role-partner    { background: rgba(255,69,0,0.08);  color: var(--cs-orange); }

  .profile-info-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    background: var(--cs-surface-gray);
    border-radius: var(--radius-sm);
    margin-bottom: 24px;
  }
  .profile-info-label { font: var(--text-m-script-12); color: var(--cs-text-mid); }
  /* 숫자 전용 폰트(D-DIN Exp) — '오후' 같은 한글은 한글 폰트로 대체 */
  .profile-info-value { font: var(--text-m-script-14B); font-family: var(--font-en-d-din), var(--font-kr); color: var(--cs-text); }

  .profile-actions {
    width: 100%;
    display: flex;
    gap: 10px;
  }

  .profile-logout-btn {
    flex: 1;
    height: 44px;
    background: var(--cs-red-badge);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-lg);
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .profile-logout-btn:hover { opacity: 0.85; }
</style>
