<script lang="ts">
  import { authState, performSignOut } from '$lib/stores/auth'
  import { page } from '$app/stores'
  import { loginHref } from '$lib/utils/loginRedirect'

  // 로그인 링크 — 지금 화면을 redirect로 붙여 로그인 후 직전 화면으로 복귀
  const signInHref = $derived(loginHref($page.url.pathname, $page.url.search))

  interface Props {
    open?: boolean
    onclose?: () => void
  }

  let { open = false, onclose = () => {} }: Props = $props()

  let isLoggedIn = $derived(!!$authState.user)

  const MENU_ITEMS = [
    { label: 'Hypepack', href: '/hype-pack' },
    { label: 'All',      href: '/products' },
    { label: 'Members',  href: '/members' },
    { label: 'Crazylog', href: '/crazylog' },
    { label: 'Help',     href: '/help' },
  ]

  // 메뉴 열릴 때 body 스크롤 차단
  $effect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  })

  async function handleLogout() {
    await performSignOut()
    onclose()
  }
</script>

{#if open}
<div class="mm-overlay" role="dialog" aria-modal="true" aria-label="더보기 메뉴">

  <!-- ── 헤더: 로고(좌) + 닫기(우) ── 피그마 시안 기준 ── -->
  <div class="mm-header">
    <a href="/" class="mm-logo" aria-label="CRAZYSHOT 홈" onclick={onclose}>
      <img src="/logo-bi2.svg" alt="CRAZYSHOT" class="mm-logo-img" width="112" height="72" />
    </a>

    <button class="mm-icon-btn" aria-label="메뉴 닫기" onclick={onclose}>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path
          d="M17.0116 0.512578C17.695 -0.170859 18.804 -0.170859 19.4874 0.512578C20.1705 1.19595 20.1705 2.30389 19.4874 2.98726L12.4747 9.99886L19.4874 17.0116C20.1709 17.695 20.1709 18.804 19.4874 19.4874C18.804 20.1709 17.695 20.1709 17.0116 19.4874L9.99886 12.4747L2.98726 19.4874C2.30389 20.1705 1.19595 20.1705 0.512578 19.4874C-0.170859 18.804 -0.170859 17.695 0.512578 17.0116L7.52418 9.99886L0.512578 2.98726C-0.170859 2.30382 -0.170859 1.19602 0.512578 0.512578C1.19602 -0.170859 2.30382 -0.170859 2.98726 0.512578L9.99886 7.52418L17.0116 0.512578Z"
          fill="#C1BBEC"
        />
      </svg>
    </button>
  </div>

  <!-- ── 메뉴 목록 ───────────────────────────────────────────── -->
  <nav class="mm-nav" aria-label="전체 메뉴">
    {#each MENU_ITEMS as item}
      <a href={item.href} class="mm-item" onclick={onclose}>{item.label}</a>
    {/each}
  </nav>

  <!-- ── 하단 액션 버튼 ──────────────────────────────────────── -->
  <div class="mm-footer">
    {#if isLoggedIn}
      <!-- 로그인 상태: 로그아웃 -->
      <button class="mm-action-btn" onclick={handleLogout}>
        <span class="mm-action-text">로그아웃</span>
        <span class="mm-action-arrow" aria-hidden="true">
          <svg width="17" height="12" viewBox="0 0 17 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 6H16M11.3845 1L16 6L11.3845 11" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </button>
    {:else}
      <!-- 미로그인 상태: 로그인 버튼 + 회원가입 링크 -->
      <a href={signInHref} class="mm-action-btn" onclick={onclose}>
        <span class="mm-action-text">Sign in</span>
        <span class="mm-action-arrow" aria-hidden="true">
          <svg width="17" height="12" viewBox="0 0 17 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 6H16M11.3845 1L16 6L11.3845 11" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </a>
      <a href="/auth/login?mode=signup" class="mm-signup-link" onclick={onclose}>Sign up</a>
    {/if}
  </div>

</div>
{/if}

<style>
  /* ── 전체 오버레이 ───────────────────────────────── */
  .mm-overlay {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: var(--cs-dark);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 39px;
    padding: 33px 25px;
    overflow-y: auto;
    /* 진입 애니메이션 */
    animation: mm-slide-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  @keyframes mm-slide-in {
    from { opacity: 0; transform: translateX(100%); }
    to   { opacity: 1; transform: translateX(0); }
  }

  /* ── 헤더 ───────────────────────────────────────── */
  .mm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    width: 100%;
    flex-shrink: 0;
  }

  .mm-logo {
    display: block;
    line-height: 0;
    text-decoration: none;
    flex-shrink: 0;
  }

  .mm-logo-img {
    display: block;
    width: 112px;
    height: 72px;
  }

  .mm-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    text-decoration: none;
    flex-shrink: 0;
    transition: opacity 0.15s;
  }
  .mm-icon-btn:hover  { opacity: 0.75; }
  .mm-icon-btn:active { opacity: 0.5; }
  /* 닫기(✕) 호버·터치(눌림) 모션(2026-11-13, Stephen 지시) — 3바퀴를 부드럽고 빠르게 가속하며 돌다가 끝에서 천천히 줄이며 멈춘다(느리게 시작 → 중간 최고 속도 → 긴 감속). 1080deg = 3바퀴라 끝나면 원래 모양 */
  .mm-icon-btn svg { transform-origin: 50% 50%; }
  .mm-icon-btn:hover svg,
  .mm-icon-btn:active svg {
    animation: mm-close-spin 1.3s cubic-bezier(0.6, 0, 0.15, 1) both;
  }
  @keyframes mm-close-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(1080deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .mm-icon-btn:hover svg,
    .mm-icon-btn:active svg { animation: none; }
  }

  /* ── 메뉴 목록 ──────────────────────────────────── */
  .mm-nav {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    height: 500px;
    min-height: 500px;
    padding: 50px 0;
    width: 100%;
    flex-shrink: 0;
  }

  .mm-item {
    font-family: var(--font-en-display);   /* Tilt Warp */
    font-size: 30px;
    font-weight: 400;
    color: var(--cs-purple-pale);          /* #C1BBEC */
    text-decoration: none;
    white-space: nowrap;
    line-height: 1.3;
    font-variation-settings: 'XROT' 0, 'YROT' 0;
    transition: color 0.18s;
    min-height: 44px;
    display: flex;
    align-items: center;
  }
  .mm-item:hover  { color: var(--cs-white); }
  .mm-item:active { opacity: 0.65; }

  /* ── 하단 버튼 ──────────────────────────────────── */
  .mm-footer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: 100%;
    flex-shrink: 0;
  }

  .mm-action-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-width: 300px;
    padding: 15px 50px;
    background: var(--cs-login-btn-gradient);
    border: none;
    border-radius: var(--radius-2xl);
    cursor: pointer;
    text-decoration: none;
    transition: opacity 0.15s, transform 0.15s;
  }
  .mm-action-btn:hover  { opacity: 0.9; transform: translateY(-1px); }
  .mm-action-btn:active { opacity: 1; transform: translateY(0); }
  /* 화살표 호버·터치(눌림) 모션(2026-11-13, Stephen 지시) — ①살짝 왼쪽으로 빠르게 튕기기 3번 → ②오른쪽으로 아주 빠르게 지나 버튼 배경 밖으로 이탈
     → ③글자(Sign in) 오른쪽 쪽에서 다시 나타나 제자리. 배경 밖으로 나간 화살표가 보이지 않도록 버튼 영역을 잘라낸다(overflow: hidden). 로그인·로그아웃 버튼 공통. */
  .mm-action-btn { overflow: hidden; }
  .mm-action-btn:hover .mm-action-arrow,
  .mm-action-btn:active .mm-action-arrow {
    animation: mm-arrow-bounce-out-in 1.3s cubic-bezier(0.22, 0.61, 0.36, 1) both;
  }
  @keyframes mm-arrow-bounce-out-in {
    0%    { transform: translateX(0);     opacity: 1; }
    7%    { transform: translateX(-6px); }
    14%   { transform: translateX(0); }
    21%   { transform: translateX(-6px); }
    28%   { transform: translateX(0); }
    35%   { transform: translateX(-6px); }
    42%   { transform: translateX(0);     opacity: 1; }
    50%   { transform: translateX(110px); opacity: 1; }   /* 아주 빠르게 오른쪽으로 배경 밖 이탈 */
    50.1% { transform: translateX(-64px); opacity: 0; }   /* 보이지 않는 상태로 글자 오른쪽 쪽으로 이동 */
    58%   { transform: translateX(-52px); opacity: 1; }   /* 글자 오른쪽에서 나타남 */
    100%  { transform: translateX(0);     opacity: 1; }   /* 제자리 */
  }
  @media (prefers-reduced-motion: reduce) {
    .mm-action-btn:hover .mm-action-arrow,
    .mm-action-btn:active .mm-action-arrow { animation: none; }
  }

  .mm-action-text {
    flex: 1;
    text-align: center;
    font: var(--text-m-title-18B);
    letter-spacing: -0.3px;
    color: var(--cs-white);
    white-space: nowrap;
  }

  .mm-action-arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .mm-signup-link {
    font: var(--text-m-title-18B);
    letter-spacing: -0.3px;
    color: var(--cs-white);
    text-decoration: none;
    min-height: 44px;
    display: flex;
    align-items: center;
    transition: opacity 0.15s;
  }
  .mm-signup-link:hover { opacity: 0.7; }
</style>
