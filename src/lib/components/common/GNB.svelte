<script lang="ts">
  interface Props {
    pathname?: string
  }
  let { pathname = '/' }: Props = $props()

  const MENU_ITEMS = [
    { id: 'hype',    label: 'Hype Pack',   href: '/hype-pack' },
    { id: 'all',     label: 'ALL',         href: '/products' },
    { id: 'members', label: 'Members',     href: '/members' },
    { id: 'log',     label: 'Crazylog',    href: '/crazylog' },
    { id: 'help',    label: 'Help Center', href: '/' },
  ]

  function isActive(item: { id: string; href: string }): boolean {
    if (item.href === '/products') return pathname.startsWith('/products')
    if (item.href === '/hype-pack') return pathname.startsWith('/hype-pack')
    if (item.href === '/crazylog') return pathname.startsWith('/crazylog')
    if (item.href === '/members') return pathname.startsWith('/members')
    return false
  }
</script>

<!-- ── Desktop GNB (768px↑) ────────────────────────────────────── -->
<div class="gnb-desktop-wrap">
  <nav class="gnb-desktop-nav">
    <a href="/" class="gnb-logo" aria-label="CRAZYSHOT 홈">
      <img src="/logo-bi2.svg" alt="CRAZYSHOT" class="gnb-logo-img gnb-logo-pc" width="178" height="110" />
    </a>

    <div class="gnb-desktop-right">
      {#each MENU_ITEMS as item}
        <a href={item.href} class="gnb-menu-item" class:active={isActive(item)}>
          {item.label}
        </a>
      {/each}
      <a href="/auth/login" class="gnb-signin-btn">Sign In</a>
    </div>
  </nav>
</div>

<!-- ── Mobile Top Bar (768px 미만) ──────────────────────────────── -->
<div class="gnb-mobile-wrap">
  <nav class="gnb-mobile-nav">
    <a href="/" class="gnb-logo" aria-label="CRAZYSHOT 홈">
      <img src="/logo-bi2.svg" alt="CRAZYSHOT" class="gnb-logo-img gnb-logo-mobile" width="96" height="59" />
    </a>

    <a href="/auth/login" class="gnb-avatar-btn" aria-label="내 계정">
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <path d="M0 20C0 5 5 0 20 0C35 0 40 5 40 20C40 35 35 40 20 40C5 40 0 35 0 20Z" fill="#C1BBEC"/>
        <path d="M19.719 20.3828C22.3245 20.3828 24.514 21.136 26.0706 22.5039C27.6372 23.8808 28.4689 25.802 28.469 27.9229C28.469 28.6132 27.9094 29.1729 27.219 29.1729C26.5286 29.1729 25.969 28.6132 25.969 27.9229C25.9689 26.4832 25.419 25.2597 24.4202 24.3818C23.4109 23.4949 21.8503 22.8828 19.719 22.8828C17.5878 22.8828 16.0271 23.4947 15.0178 24.3818C14.0189 25.2599 13.469 26.484 13.469 27.9238C13.4688 28.614 12.9093 29.1738 12.219 29.1738C11.5287 29.1738 10.9692 28.614 10.969 27.9238C10.969 25.8029 11.8006 23.881 13.3674 22.5039C14.9239 21.1359 17.1134 20.3828 19.719 20.3828ZM19.719 9.67578C22.383 9.67584 24.5217 11.8145 24.5217 14.4785C24.5216 17.1424 22.3829 19.2812 19.719 19.2812C17.0551 19.2812 14.9164 17.1424 14.9163 14.4785C14.9163 11.8145 17.055 9.67585 19.719 9.67578ZM19.719 12.1758C18.4357 12.1758 17.4163 13.1952 17.4163 14.4785C17.4164 15.7617 18.4358 16.7812 19.719 16.7812C21.0022 16.7812 22.0216 15.7617 22.0217 14.4785C22.0217 13.1952 21.0023 12.1758 19.719 12.1758Z" fill="white"/>
      </svg>
    </a>

  </nav>
</div>

<style>
  /* ── Desktop ── */
  .gnb-desktop-wrap {
    display: none;
    width: 100%;
    justify-content: center;
    padding: 20px 20px 0;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 50;
    pointer-events: none;
    -webkit-transform: translateZ(0);
    transform: translateZ(0);
  }
  @media (min-width: 768px) {
    .gnb-desktop-wrap { display: flex; }
  }

  .gnb-desktop-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: clamp(16px, 5vw, 150px);   /* 고정 150px → fluid: 소형 PC 오버플로 방지 */
    padding: 0 clamp(16px, 2.5vw, 30px);
    height: 100px;
    width: 100%;
    max-width: var(--layout-pc-max);
    border-radius: 30px;
    background: var(--cs-dark);
    pointer-events: all;
    overflow: visible;               /* 로고 110px 수직 오버플로 유지 (브랜드 아이덴티티) */
  }

  .gnb-logo {
    display: block;
    flex-shrink: 0;
    text-decoration: none;
    line-height: 0;
  }

  .gnb-logo-img {
    display: block;
  }

  /* PC 로고: 110px tall in 100px nav → 5px overflow top & bottom (브랜드 아이덴티티) */
  .gnb-logo-pc {
    width: clamp(120px, 14vw, 178px);
    height: auto;
  }

  .gnb-desktop-right {
    display: flex;
    align-items: center;
    gap: clamp(12px, 2.2vw, 50px);  /* 고정 50px → fluid */
    flex-shrink: 1;                   /* 0 → 1: 소형 PC에서 축소 허용 */
    min-width: 0;                     /* flex 축소 허용 */
  }

  .gnb-menu-item {
    position: relative;
    color: white;
    font-family: var(--font-en-display);
    font-size: clamp(14px, 1.5vw, 20px);  /* fluid: 소형 PC 대응 */
    letter-spacing: -0.5px;
    line-height: 1.6;
    text-decoration: none;
    white-space: nowrap;
    opacity: 0.9;
    transition: color 0.15s, opacity 0.15s;
  }
  .gnb-menu-item:hover { color: var(--crazy-shot-red-80, #FF3535); opacity: 1; }
  .gnb-menu-item.active { color: var(--crazy-shot-red-80, #FF3535); opacity: 1; }

  .gnb-signin-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cs-red-badge);
    color: white;
    font-family: var(--font-en-display);
    font-size: clamp(14px, 1.5vw, 20px);  /* fluid */
    letter-spacing: -0.5px;
    text-decoration: none;
    border-radius: clamp(14px, 1.5vw, 20px);
    min-width: clamp(90px, 10vw, 145px);  /* fluid: pill 내부 유지 */
    width: auto;
    padding: 0 clamp(14px, 2vw, 24px);
    height: clamp(50px, 6.5vw, 70px);    /* fluid 높이 */
    flex-shrink: 0;                        /* Sign In은 항상 완전 노출 */
    transition: filter 0.15s;
    white-space: nowrap;
  }
  .gnb-signin-btn:hover { filter: brightness(1.12); }

  /* ── Mobile ── */
  .gnb-mobile-wrap {
    display: flex;
    width: 100%;
    justify-content: center;
    padding: 16px 20px 8px;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 50;
    background: transparent;
    pointer-events: none;
    /* iOS Safari: html/body height:100% 환경에서 fixed 요소가 스크롤 중 사라지는 버그 방지 */
    -webkit-transform: translateZ(0);
    transform: translateZ(0);
  }
  @media (min-width: 768px) {
    .gnb-mobile-wrap { display: none; }
  }

  .gnb-mobile-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    height: 55px;
    width: 100%;
    max-width: 390px;
    border-radius: 20px;
    background: #1d183e;
    overflow: visible;
    pointer-events: all;
  }

  /* 모바일 로고: 59px tall in 55px nav → 2px overflow each (브랜드 아이덴티티) */
  .gnb-logo-mobile {
    width: 96px;
    height: 59px;
  }

  .gnb-avatar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    text-decoration: none;
    flex-shrink: 0;
    opacity: 0.85;
    transition: opacity 0.15s;
  }
  .gnb-avatar-btn:active { opacity: 0.6; }

</style>
