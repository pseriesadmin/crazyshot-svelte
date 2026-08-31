<script lang="ts">
  import { authState, performSignOut } from '$lib/stores/auth'
  import { goto } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'

  interface Props {
    pathname?: string
  }
  let { pathname = '/' }: Props = $props()

  let isLoggingOut = $state(false)

  // 등록된 프로필 이미지 — GNB 아바타에 반영(없으면 이니셜 표시로 폴백, 이번 세션 신규)
  let gnbAvatarUrl = $state<string | null>(null)

  $effect(() => {
    const userId = $authState.user?.id
    if (!userId || isGuestUser) { gnbAvatarUrl = null; return }
    let cancelled = false
    supabase
      .from('user_profiles')
      .select('avatar_url')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) gnbAvatarUrl = (data as { avatar_url: string | null } | null)?.avatar_url ?? null
      })
    return () => { cancelled = true }
  })

  // 스크롤 인터랙션: 다운 → 보임, 업 → 가림
  let gnbHidden = $state(false)
  let lastScrollY = 0

  function onScroll() {
    const y = window.scrollY
    gnbHidden = y > lastScrollY && y > 60
    lastScrollY = y
  }

  $effect(() => {
    lastScrollY = window.scrollY
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  })

  // 기름 유기체 Canvas 애니메이션
  let holoCanvas = $state<HTMLCanvasElement | null>(null)

  $effect(() => {
    if ($authState.loading || !$authState.user || isGuestUser || !holoCanvas) return
    return runOrganism(holoCanvas)
  })

  function runOrganism(canvas: HTMLCanvasElement): () => void {
    const ctx = canvas.getContext('2d')!
    if (!ctx) return () => {}

    const W = canvas.width, H = canvas.height
    const CX = W / 2, CY = H / 2, R = W / 2
    const START = performance.now()
    const DUR = 3640

    // GLSL cosineInversion 포팅 — 박막 간섭(thin-film) 팔레트
    function oilColor(t: number): [number, number, number] {
      const τ = 6.28318
      return [
        (0.5 + 0.5 * Math.cos(τ * (t + 0.00))) * 255,
        (0.5 + 0.5 * Math.cos(τ * (t + 0.33))) * 255,
        (0.5 + 0.5 * Math.cos(τ * (t + 0.67))) * 255
      ]
    }

    // 참조 코드 noise 함수 — 유기체 흐름 왜곡
    function noise(x: number, y: number, z: number) {
      return Math.sin(x + Math.sin(y + z)) * Math.cos(y + Math.sin(x - z))
    }

    // 원형 edge-fade 마스크 사전계산 (프레임당 sqrt 연산 제거)
    const mask = new Float32Array(W * H)
    for (let py = 0; py < H; py++) {
      for (let px2 = 0; px2 < W; px2++) {
        const d = Math.hypot(px2 - CX, py - CY)
        const inner = R * 0.65
        mask[py * W + px2] = d >= R ? -1
          : d < inner ? 1
          : 1 - ((d - inner) / (R - inner)) ** 1.2
      }
    }

    const img = ctx.createImageData(W, H)
    const px = img.data
    let raf = 0

    function frame() {
      const elapsed = performance.now() - START
      const t = Math.min(elapsed / DUR, 1)
      const tick = elapsed / 1000

      // 페이드 엔벨로프
      const fade = t < 0.12 ? t / 0.12 : t < 0.68 ? 1 : 1 - (t - 0.68) / 0.32

      for (let i = 0; i < W * H; i++) {
        const m = mask[i]
        const base = i * 4
        if (m < 0) { px[base + 3] = 0; continue }

        const ix = i % W
        const iy = (i / W) | 0
        const nx = (ix - CX) / R
        const ny = (iy - CY) / R

        // 2옥타브 유체 흐름 노이즈
        const n = noise(nx * 2.8 + tick * 0.55, ny * 2.8 + tick * 0.45, tick * 0.28) * 0.65
                + noise(nx * 4.5 - tick * 0.38, ny * 4.5 + tick * 0.32, tick * 0.5 + 1.7) * 0.35

        // cosine 팔레트로 박막 색상 매핑
        const [r, g, b] = oilColor(n * 0.5 + 0.5 + tick * 0.14)
        px[base]     = r
        px[base + 1] = g
        px[base + 2] = b
        px[base + 3] = (fade * m * 255) | 0
      }

      ctx.putImageData(img, 0, 0)
      if (t < 1) raf = requestAnimationFrame(frame)
      else ctx.clearRect(0, 0, W, H)
    }

    raf = requestAnimationFrame(frame)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }

  let userInitial = $derived(() => {
    const user = $authState.user
    if (!user) return ''
    const email = user.email ?? ''
    return email[0]?.toUpperCase() ?? '?'
  })

  // 익명 auth(채팅 게스트) 판별: email 없음 또는 is_anonymous=true
  let isGuestUser = $derived(
    !!$authState.user && (($authState.user as { is_anonymous?: boolean }).is_anonymous === true || !$authState.user.email)
  )

  async function handleSignOut() {
    if (isLoggingOut) return
    isLoggingOut = true
    try {
      await performSignOut()
      goto('/')
    } finally {
      isLoggingOut = false
    }
  }

  const MENU_ITEMS = [
    { id: 'hype',    label: 'Hype Pack',   href: '/hype-pack' },
    { id: 'all',     label: 'ALL',         href: '/products' },
    { id: 'members', label: 'Members',     href: '/members' },
    { id: 'log',     label: 'Crazylog',    href: '/crazylog' },
    { id: 'help',    label: 'Help Center', href: '/help' },
  ]

  function isActive(item: { id: string; href: string }): boolean {
    if (item.href === '/products') return pathname.startsWith('/products')
    if (item.href === '/hype-pack') return pathname.startsWith('/hype-pack')
    if (item.href === '/crazylog') return pathname.startsWith('/crazylog')
    if (item.href === '/members') return pathname.startsWith('/members')
    if (item.href === '/help') return pathname.startsWith('/help')
    return false
  }
</script>

<!-- ── Desktop GNB (768px↑) ────────────────────────────────────── -->
<div class="gnb-desktop-wrap" class:gnb-hidden={gnbHidden}>
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
      {#if !$authState.loading}
        {#if $authState.user && !isGuestUser}
          <button class="gnb-avatar-initial" onclick={() => goto('/account')} aria-label="내 계정">
            {#if gnbAvatarUrl}
              <img src={gnbAvatarUrl} alt="" class="gnb-avatar-img" />
            {:else}
              {userInitial()}
            {/if}
          </button>
        {:else}
          <a href="/auth/login" class="gnb-signin-btn">Sign In</a>
        {/if}
      {/if}
    </div>
  </nav>
</div>

<!-- ── Mobile Top Bar (768px 미만) ──────────────────────────────── -->
<div class="gnb-mobile-wrap" class:gnb-hidden={gnbHidden}>
  <nav class="gnb-mobile-nav">
    <a href="/" class="gnb-logo" aria-label="CRAZYSHOT 홈">
      <img src="/logo-bi2.svg" alt="CRAZYSHOT" class="gnb-logo-img gnb-logo-mobile" width="103" height="64" />
    </a>

    {#if !$authState.loading}
      {#if $authState.user && !isGuestUser}
        <button class="gnb-avatar-btn gnb-avatar-btn-initial" onclick={() => goto('/account')} aria-label="내 계정">
          <canvas class="gnb-holo-canvas" width="120" height="120" aria-hidden="true" bind:this={holoCanvas}></canvas>
          {#if gnbAvatarUrl}
            <img src={gnbAvatarUrl} alt="" class="gnb-avatar-img gnb-avatar-img-mobile" />
          {:else}
            <span class="gnb-avatar-initial-text">{userInitial()}</span>
          {/if}
        </button>
      {:else}
        <a href="/auth/login" class="gnb-avatar-btn" aria-label="내 계정">
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <path d="M0 20C0 5 5 0 20 0C35 0 40 5 40 20C40 35 35 40 20 40C5 40 0 35 0 20Z" fill="#C1BBEC"/>
            <path d="M19.719 20.3828C22.3245 20.3828 24.514 21.136 26.0706 22.5039C27.6372 23.8808 28.4689 25.802 28.469 27.9229C28.469 28.6132 27.9094 29.1729 27.219 29.1729C26.5286 29.1729 25.969 28.6132 25.969 27.9229C25.9689 26.4832 25.419 25.2597 24.4202 24.3818C23.4109 23.4949 21.8503 22.8828 19.719 22.8828C17.5878 22.8828 16.0271 23.4947 15.0178 24.3818C14.0189 25.2599 13.469 26.484 13.469 27.9238C13.4688 28.614 12.9093 29.1738 12.219 29.1738C11.5287 29.1738 10.9692 28.614 10.969 27.9238C10.969 25.8029 11.8006 23.881 13.3674 22.5039C14.9239 21.1359 17.1134 20.3828 19.719 20.3828ZM19.719 9.67578C22.383 9.67584 24.5217 11.8145 24.5217 14.4785C24.5216 17.1424 22.3829 19.2812 19.719 19.2812C17.0551 19.2812 14.9164 17.1424 14.9163 14.4785C14.9163 11.8145 17.055 9.67585 19.719 9.67578ZM19.719 12.1758C18.4357 12.1758 17.4163 13.1952 17.4163 14.4785C17.4164 15.7617 18.4358 16.7812 19.719 16.7812C21.0022 16.7812 22.0216 15.7617 22.0217 14.4785C22.0217 13.1952 21.0023 12.1758 19.719 12.1758Z" fill="white"/>
          </svg>
        </a>
      {/if}
    {/if}

  </nav>
</div>
<style>
  /* ── 스크롤 인터랙션 공통 ── */
  .gnb-desktop-wrap,
  .gnb-mobile-wrap {
    transition: transform 0.3s ease;
  }
  .gnb-desktop-wrap.gnb-hidden,
  .gnb-mobile-wrap.gnb-hidden {
    transform: translateY(-100%);
  }

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
  .gnb-desktop-wrap.gnb-hidden { transform: translateY(-100%); }
  @media (min-width: 768px) {
    .gnb-desktop-wrap { display: flex; }
  }

  .gnb-desktop-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: clamp(16px, 5vw, 150px);   /* 고정 150px → fluid: 소형 PC 오버플로 방지 */
    padding: 0 clamp(16px, 2.5vw, 30px);
    height: 90px;
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

  .gnb-avatar-initial {
    display: flex;
    align-items: center;
    justify-content: center;
    width: clamp(50px, 6.5vw, 70px);
    height: clamp(50px, 6.5vw, 70px);
    border-radius: 50%;
    overflow: hidden;
    background: var(--cs-purple-pale);
    color: var(--cs-dark);
    font-family: var(--font-en-display);
    font-size: clamp(18px, 2vw, 26px);
    font-weight: 700;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    transition: filter 0.15s, opacity 0.15s;
    text-transform: uppercase;
  }
  .gnb-avatar-initial:hover { filter: brightness(0.92); }
  .gnb-avatar-initial:disabled { opacity: 0.5; cursor: not-allowed; }

  /* 등록된 프로필 이미지 — 이니셜 대체 표시 (이번 세션 신규) */
  .gnb-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
  }
  .gnb-avatar-img-mobile {
    position: relative;
    z-index: 3;
  }

  /* ── Mobile ── */
  .gnb-mobile-wrap {
    display: flex;
    width: 100%;
    justify-content: center;
    padding: 18px 20px 9px;
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
    border-radius: 22px;
    background: #1d183e;
    overflow: visible;
    pointer-events: all;
  }

  /* 모바일 로고: 64px tall in 55px nav → 상하 각 4.5px 균등 overflow(align-items:center 자연 정렬)
     이전 translateY(-3px) 오프셋은 과거 크기(117x72/nav 61px) 기준값이라 현재 크기에서
     상단 7.5px·하단 1.5px로 비대칭 쏠림을 유발해 제거함 */
  .gnb-logo-mobile {
    width: 103px;
    height: 64px;
  }

  .gnb-avatar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    min-width: 40px;
    min-height: 40px;
    text-decoration: none;
    flex-shrink: 0;
    opacity: 0.85;
    transition: opacity 0.15s;
  }
  .gnb-avatar-btn:active { opacity: 0.6; }

  .gnb-avatar-btn-initial {
    position: relative;
    overflow: hidden;
    background: rgba(85, 63, 224, 0.60);
    border: none;
    color: var(--cs-dark);
    font-family: var(--font-en-display);
    font-size: 18px;
    font-weight: 700;
    cursor: pointer;
    text-transform: uppercase;
    border-radius: 50%;
  }
  .gnb-avatar-btn-initial:disabled { opacity: 0.5; cursor: not-allowed; }

  /* 이니셜 텍스트 — 모든 레이어 위 */
  .gnb-avatar-initial-text {
    position: relative;
    z-index: 3;
    pointer-events: none;
    color: #ffffff;
  }

  /* ── 유기체 Canvas 레이어 ── */
  .gnb-holo-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 1;
  }

</style>
