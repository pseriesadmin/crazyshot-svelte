<script lang="ts">
  import { goto } from '$app/navigation'
  import { navigating, page } from '$app/state'
  import { supabase } from '$lib/services/supabase'
  import { Toaster } from 'svelte-sonner'
  import { csToast } from '$lib/utils/toast'
  import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
  import type { LayoutData } from './$types'

  interface Props {
    data: LayoutData
    children: import('svelte').Snippet
  }

  let { data, children }: Props = $props()

  // 접근 거부 notice 파라미터 감지 → toast 표시 후 URL 클린업
  $effect(() => {
    const notice = page.url.searchParams.get('notice')
    if (notice === 'access_denied') {
      csToast.error('사용 권한이 없습니다.')
      const url = new window.URL(window.location.href)
      url.searchParams.delete('notice')
      history.replaceState(history.state, '', url.toString())
    }
  })

  let manualLogout = false

  async function handleLogout(): Promise<void> {
    manualLogout = true
    await supabase.auth.signOut()
    const t = encodeURIComponent(new Date().toISOString())
    goto(`/cms/login?logout=manual&t=${t}`)
  }

  // 세션 만료 감지 (활성 중 token refresh 실패 시)
  $effect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && !manualLogout && data.cmsRole) {
        const t = encodeURIComponent(new Date().toISOString())
        goto(`/cms/login?logout=expired&t=${t}`)
      }
    })
    return () => subscription.unsubscribe()
  })

  type SubMenu = { label: string; href: string }
  type MainMenu = { id: string; label: string; subMenus: SubMenu[] }

  const mainMenus: MainMenu[] = [
    {
      id: 'consulting',
      label: '상담',
      subMenus: [{ label: '채팅', href: '/cms/chat' }],
    },
    { id: 'reservation', label: '예약', subMenus: [] },
    {
      id: 'products',
      label: '상품',
      subMenus: [
        { label: '상품목록', href: '/cms/products' },
        { label: '상품등록', href: '/cms/products/new' },
        { label: '코드설정', href: '/cms/codes' },
      ],
    },
    { id: 'rental', label: '대여', subMenus: [] },
    {
      id: 'settings',
      label: '설정',
      subMenus: [
        ...(hasSettingsAccess(data.cmsRole ?? '')
          ? [
              { label: '계정관리', href: '/cms/accounts' },
              { label: '계정목록', href: '/cms/accounts/list' },
            ]
          : []),
      ],
    },
  ]

  function resolveActiveMenuId(pathname: string): string {
    if (pathname.startsWith('/cms/codes')) return 'products'
    if (pathname.startsWith('/cms/accounts')) return 'settings'
    if (pathname.startsWith('/cms/reservation')) return 'reservation'
    if (pathname.startsWith('/cms/products')) return 'products'
    if (pathname.startsWith('/cms/rental')) return 'rental'
    return 'consulting'
  }

  let activeMenuId = $derived(resolveActiveMenuId(page.url.pathname))
  let activeMenu   = $derived(mainMenus.find((m) => m.id === activeMenuId) ?? mainMenus[0])

  function mainMenuHref(menu: MainMenu): string {
    return menu.subMenus[0]?.href ?? '#'
  }
</script>

{#if data.cmsRole}
  <div class="cms-shell">

    <!-- 네비게이션 로딩 바 -->
    {#if navigating}
      <div class="nav-progress-bar" role="progressbar" aria-label="페이지 로딩 중"></div>
    {/if}

    <!-- ① 최상단 탭바 (Figma top-global 스타일) -->
    <div class="cms-topbar-wrap">
      <header class="cms-topbar">
        <!-- 브랜드 -->
        <div class="topbar-brand">
          <a href="/cms" class="brand-logo-link" aria-label="CRAZYSHOT CMS 홈">
            <img src="/logo-bi2.svg" alt="CRAZYSHOT" class="brand-logo" width="132" height="82" />
          </a>
        </div>

        <!-- 우측: 메뉴 + 로그아웃 (Figma menu-bar) -->
        <div class="topbar-right">
          <nav class="topbar-nav" aria-label="대메뉴">
            {#each mainMenus as menu}
              <a
                href={mainMenuHref(menu)}
                class="top-tab"
                class:active={activeMenuId === menu.id}
                aria-current={activeMenuId === menu.id ? 'page' : undefined}
                data-sveltekit-preload-data="hover"
              >{menu.label}</a>
            {/each}
          </nav>
          <!-- 로그아웃 버튼 (Figma Sign In 스타일 — 빨간 필) -->
          <button class="logout-btn" onclick={handleLogout}>Sign Out</button>
        </div>
      </header>
    </div>

    <!-- ② 서브 탭바 -->
    {#if activeMenu.subMenus.length > 0}
      <div class="cms-subtabbar" role="navigation" aria-label="서브메뉴">
        {#each activeMenu.subMenus as sub}
          <a
            href={sub.href}
            class="sub-tab"
            class:active={page.url.pathname === sub.href}
            data-sveltekit-preload-data="hover"
          >{sub.label}</a>
        {/each}
      </div>
    {/if}

    <!-- ③ 콘텐츠 -->
    <main class="cms-main">
      {@render children()}
    </main>

  </div>
{:else}
  {@render children()}
{/if}

<Toaster position="bottom-center" richColors closeButton />

<style>
  /* ══ CMS 크로스브라우저 기반 (Chrome · Firefox · Safari 모던 PC 대응) ══ */

  /* PC 전체화면 고정 — 모바일 반응형 없음 */
  :global(html), :global(body) {
    min-width: 1280px;
    overflow-x: auto;
  }

  /* ── 폰트 렌더링 일관성 (Safari/Chrome 안티앨리어싱) ── */
  :global(.cms-shell *) {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* ── 스크롤바 일관성 (Webkit: Chrome/Safari / Firefox) ── */
  :global(.cms-shell ::-webkit-scrollbar)       { width: 6px; height: 6px; }
  :global(.cms-shell ::-webkit-scrollbar-track) { background: transparent; }
  :global(.cms-shell ::-webkit-scrollbar-thumb) {
    background: rgba(59, 47, 138, 0.20);
    border-radius: 3px;
  }
  :global(.cms-shell ::-webkit-scrollbar-thumb:hover) {
    background: rgba(59, 47, 138, 0.40);
  }
  /* Firefox scrollbar */
  :global(.cms-shell *) {
    scrollbar-width: thin;
    scrollbar-color: rgba(59,47,138,0.20) transparent;
  }

  /* ── 버튼/인풋 브라우저 기본 스타일 리셋 ── */
  :global(.cms-shell button) { cursor: pointer; font-family: inherit; }
  :global(.cms-shell input, .cms-shell select, .cms-shell textarea) {
    font-family: inherit;
  }

  /* ── autofill 색상 오염 방지 (Chrome·Safari) ── */
  :global(.cms-shell input:-webkit-autofill),
  :global(.cms-shell input:-webkit-autofill:hover),
  :global(.cms-shell input:-webkit-autofill:focus) {
    -webkit-text-fill-color: var(--cs-text);
    -webkit-box-shadow: 0 0 0 1000px var(--cs-surface-gray) inset;
    transition: background-color 5000s ease-in-out 0s;
  }

  /* ── focus-visible: 키보드 접근 시에만 링 표시 ── */
  :global(.cms-shell :focus) { outline: none; }
  :global(.cms-shell :focus-visible) {
    outline: 2px solid var(--cs-purple);
    outline-offset: 2px;
  }
  /* 이미 개별 스타일이 있는 input·select는 자체 outline 유지 */
  :global(.cms-shell input:focus-visible),
  :global(.cms-shell select:focus-visible),
  :global(.cms-shell textarea:focus-visible) {
    outline: 2px solid var(--cs-purple);
    outline-offset: -2px;
  }

  /* ── select 크로스브라우저 기본 리셋 ── */
  :global(.cms-shell select) {
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
  }
  /* ── 링크 색상 일관성 ── */
  :global(.cms-shell a) { color: inherit; }

  .cms-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    min-height: 100vh;
    min-width: 1280px;
    background: var(--cs-lilac);
    overflow: hidden;
  }

  /* ─── 탑바 래퍼 (여백 주어 pill 효과) ─── */
  .cms-topbar-wrap {
    flex-shrink: 0;
    padding: 20px 16px 0;
    background: var(--cs-lilac);
  }

  /* ─── 최상단 탭바 (Figma top-global) ─── */
  .cms-topbar {
    background: var(--cs-dark);
    border-radius: var(--radius-xl);
    display: flex;
    align-items: center;
    justify-content: space-between;  /* 로고 좌 / 메뉴+버튼 우 */
    padding: 0 30px;
    height: 74px;
    gap: 0;
  }

  /* ─── 브랜드 로고 ─── */
  .topbar-brand {
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }
  .brand-logo-link {
    display: block;
    line-height: 0;
    text-decoration: none;
    flex-shrink: 0;
  }
  .brand-logo {
    /* topbar 74px 기준, 사용자 GNB 비율(178×110/100px) 동일 적용 */
    width: 132px;
    height: 82px;
    display: block;
  }

  /* ─── 우측 메뉴 그룹 (Figma menu-bar) ─── */
  .topbar-right {
    display: flex;
    align-items: center;
    gap: 50px;
  }

  /* ─── 대메뉴 탭 (Figma menu-eng: Tilt Warp 20px, gap 50px) ─── */
  .topbar-nav {
    display: flex;
    align-items: center;
    gap: 50px;
  }

  .top-tab {
    display: flex;
    align-items: center;
    color: rgba(255, 255, 255, 0.50);
    text-decoration: none;
    font: var(--text-pc-ad-kr-22); /* SB AggroOTF 22px 500 — 한글 강조 메뉴 */
    white-space: nowrap;
    min-height: 44px;
    transition: color 0.15s;
  }
  .top-tab:hover  { color: rgba(255, 255, 255, 0.85); }
  .top-tab.active { color: var(--cs-white); }

  /* ─── 로그아웃 버튼 (Figma Sign In 스타일 — 빨간 필) ─── */
  .logout-btn {
    background: var(--cs-red-badge);   /* #FF3535 */
    border: none;
    border-radius: var(--radius-lg);   /* 20px — Figma bt radius */
    color: var(--cs-white);
    font: var(--text-pc-menu-en-20);   /* Tilt Warp 20px — Figma pc-menu_en_20 */
    padding: 0;
    width: 130px;
    height: 54px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.15s;
  }
  .logout-btn:hover { opacity: 0.85; }

  /* ─── 서브 탭바 — 중앙 정렬 ─── */
  .cms-subtabbar {
    flex-shrink: 0;
    background: transparent;
    display: flex;
    justify-content: center;          /* 중앙 정렬 */
    gap: 4px;
    padding: 10px 16px 6px;
  }

  .sub-tab {
    display: flex;
    align-items: center;
    padding: 6px 20px;
    border-radius: var(--radius-md);
    color: var(--cs-text-mid);
    text-decoration: none;
    font: var(--text-m-script-14B);
    background: transparent;
    white-space: nowrap;
    min-height: 34px;
    transition: background 0.15s, color 0.15s;
  }
  .sub-tab:hover  { background: rgba(59, 47, 138, 0.08); color: var(--cs-text); }
  .sub-tab.active { background: var(--cs-white); color: var(--cs-purple); }

  /* ─── 네비게이션 로딩 바 ─── */
  .nav-progress-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    z-index: 9999;
    background: linear-gradient(
      90deg,
      var(--cs-purple) 0%,
      var(--cs-purple-light) 50%,
      var(--cs-orange) 100%
    );
    background-size: 200% 100%;
    animation: nav-progress 1.4s ease-in-out infinite;
  }
  @keyframes nav-progress {
    0%   { background-position: 200% 0; opacity: 1; }
    70%  { background-position: -50% 0; opacity: 1; }
    100% { background-position: -100% 0; opacity: 0.6; }
  }

  /* ─── 콘텐츠 ─── */
  .cms-main {
    flex: 1;
    min-height: 0;        /* flex 자식이 컨텐츠 크기 이하로 수축할 수 있도록 */
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
</style>
