<script lang="ts">
  import { authState, performSignOut } from '$lib/stores/auth'
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import { loginHref } from '$lib/utils/loginRedirect'
  import { supabase } from '$lib/services/supabase'
  import { fade } from 'svelte/transition'

  // 비로그인 로그인 링크 — 지금 화면을 redirect로 붙여 로그인 후 직전 화면으로 복귀
  const signInHref = $derived(loginHref($page.url.pathname, $page.url.search))

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

  // 알림 수신 표시(2026-11-03, Stephen 지시): 대여현황 카드 변경정보(관리자가 바꾼 예약 상태)·새 쿠폰이 마지막 확인 이후 생겼으면
  // 모바일 아바타 둘레에 회전하는 도트 링을 띄운다. '마지막 확인'은 이 기기(localStorage)에 계정별로 저장하고(Stephen 선택: 기기 저장 — DB 변경 없음),
  // /account 화면(마이페이지·대여현황)에 들어가면 확인한 것으로 본다. 처음 사용(저장값 없음)은 기준선만 저장해 오탐을 막는다. 조회·저장 실패는 조용히 무시(링만 꺼짐).
  const NOTICE_STORAGE_PREFIX = 'cs_gnb_notice_v1:'
  // /account 아래 화면에서는 GNB 가 그려지지 않아(+layout.svelte) 이 컴포넌트가 '마이페이지를 봤다'를 직접 알 수 없다 —
  // 항상 떠 있는 레이아웃이 방문한 계정 id 를 이 키에 남기고, GNB 가 다시 나타나 조회에 성공하면 확인 처리 후 지운다
  const NOTICE_VISIT_KEY = 'cs_gnb_notice_visit_v1'
  const NOTICE_REFETCH_MS = 60_000            // 화면 이동마다 조회하지 않도록 비-계정 화면에서는 1분 간격
  // 관리자 처리로만 바뀌는 단계 — 고객 본인의 신청(hold) 직후 오탐을 피하려 hold·draft 는 제외
  const NOTICE_RENTAL_STATUSES = ['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'cancelled']
  let hasNotice = $state(false)
  // 알림 링의 점 16개 — 원 둘레에 같은 간격(22.5°)으로 놓고 앞쪽(회전 진행 방향)으로 갈수록 점이 커지고 진해져 꼬리처럼 보이게 한다(회전감이 부드럽게 읽힘)
  const NOTICE_DOT_COUNT = 16
  const NOTICE_DOTS = Array.from({ length: NOTICE_DOT_COUNT }, (_, i) => {
    const t = i / (NOTICE_DOT_COUNT - 1)
    const rad = (i * (360 / NOTICE_DOT_COUNT) - 90) * (Math.PI / 180)
    return { cx: 24 + 21 * Math.cos(rad), cy: 24 + 21 * Math.sin(rad), r: 0.9 + 1.5 * t, o: 0.3 + 0.7 * t }
  })
  let lastNoticeFetch = 0

  interface NoticeSeen { rentals: string[]; coupons: string[] }

  function readNoticeSeen(uid: string): NoticeSeen | null {
    try {
      const raw = localStorage.getItem(NOTICE_STORAGE_PREFIX + uid)
      if (!raw) return null
      const v = JSON.parse(raw) as Partial<NoticeSeen>
      return Array.isArray(v.rentals) && Array.isArray(v.coupons) ? { rentals: v.rentals, coupons: v.coupons } : null
    } catch { return null }
  }

  function writeNoticeSeen(uid: string, seen: NoticeSeen): void {
    try { localStorage.setItem(NOTICE_STORAGE_PREFIX + uid, JSON.stringify(seen)) } catch { /* 저장 불가(사생활 보호 모드 등) — 링만 못 켜질 뿐 */ }
  }

  $effect(() => {
    const uid = $authState.user?.id
    const onAccount = $page.url.pathname.startsWith('/account')
    if (!uid || isGuestUser) { hasNotice = false; return }
    let visitedAccount = false
    try { visitedAccount = localStorage.getItem(NOTICE_VISIT_KEY) === uid } catch { /* 읽기 불가 — 방문 기록만 무시 */ }
    const markSeen = onAccount || visitedAccount
    if (!markSeen && Date.now() - lastNoticeFetch < NOTICE_REFETCH_MS) return
    lastNoticeFetch = Date.now()
    let cancelled = false
    void (async () => {
      try {
        const [rentalRes, couponRes] = await Promise.all([
          supabase.from('rental_reservations').select('id, status, updated_at')
            .eq('user_id', uid).in('status', NOTICE_RENTAL_STATUSES)
            .order('submitted_at', { ascending: false }).limit(30),
          // 최신 발급분부터 50장 — 정렬 없이 limit 만 걸면 보유 쿠폰이 50장을 넘을 때 새 쿠폰이 빠지거나 조회마다 다른 50장이 와서 감지가 어긋난다
          supabase.from('user_coupons').select('id').eq('user_id', uid).is('used_at', null)
            .order('created_at', { ascending: false }).limit(50),
        ])
        if (cancelled || rentalRes.error || couponRes.error) return
        const rentalRows = (rentalRes.data ?? []) as { id: string; status: string | null; updated_at: string | null }[]
        const couponRows = (couponRes.data ?? []) as { id: string }[]
        const current: NoticeSeen = {
          rentals: rentalRows.map((r) => `${r.id}:${r.status}:${r.updated_at}`),
          coupons: couponRows.map((c) => c.id),
        }
        const seen = readNoticeSeen(uid)
        if (!seen || markSeen) {   // 처음이거나 마이페이지를 보는 중·보고 온 직후 → 확인한 것으로 기록하고 링 끔
          writeNoticeSeen(uid, current)
          if (visitedAccount) { try { localStorage.removeItem(NOTICE_VISIT_KEY) } catch { /* 지우기 불가 — 다음에 다시 확인 처리될 뿐 */ } }
          hasNotice = false
          return
        }
        hasNotice = current.rentals.some((x) => !seen.rentals.includes(x)) || current.coupons.some((x) => !seen.coupons.includes(x))
      } catch {
        if (!cancelled) hasNotice = false
      }
    })()
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
              <img src={gnbAvatarUrl} alt="" class="gnb-avatar-img" decoding="async" />
            {:else}
              {userInitial()}
            {/if}
          </button>
        {:else}
          <a href={signInHref} class="gnb-signin-btn">Sign In</a>
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
        <span class="gnb-avatar-wrap">
          <button class="gnb-avatar-btn gnb-avatar-btn-initial" onclick={() => goto('/account')} aria-label={hasNotice ? '내 계정 (새 알림 있음)' : '내 계정'}>
            <canvas class="gnb-holo-canvas" width="120" height="120" aria-hidden="true" bind:this={holoCanvas}></canvas>
            {#if gnbAvatarUrl}
              <img src={gnbAvatarUrl} alt="" class="gnb-avatar-img gnb-avatar-img-mobile" decoding="async" />
            {:else}
              <span class="gnb-avatar-initial-text">{userInitial()}</span>
            {/if}
          </button>
          {#if hasNotice}
            <!-- 알림 수신: 아바타 바깥을 도는 도트 링(버튼은 overflow:hidden 이라 형제로 둔다) -->
            <svg class="gnb-notice-ring" viewBox="0 0 48 48" aria-hidden="true" in:fade={{ duration: 450 }} out:fade={{ duration: 300 }}>
              <g class="gnb-notice-pulse">
                {#each NOTICE_DOTS as d}
                  <circle cx={d.cx} cy={d.cy} r={d.r} opacity={d.o} />
                {/each}
              </g>
            </svg>
          {/if}
        </span>
      {:else}
        <a href={signInHref} class="gnb-avatar-btn" aria-label="내 계정">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <path d="M0 20C0 5 5 0 20 0C35 0 40 5 40 20C40 35 35 40 20 40C5 40 0 35 0 20Z" fill="#C1BBEC"/>
            <path d="M19.719 20.3828C22.3245 20.3828 24.514 21.136 26.0706 22.5039C27.6372 23.8808 28.4689 25.802 28.469 27.9229C28.469 28.6132 27.9094 29.1729 27.219 29.1729C26.5286 29.1729 25.969 28.6132 25.969 27.9229C25.9689 26.4832 25.419 25.2597 24.4202 24.3818C23.4109 23.4949 21.8503 22.8828 19.719 22.8828C17.5878 22.8828 16.0271 23.4947 15.0178 24.3818C14.0189 25.2599 13.469 26.484 13.469 27.9238C13.4688 28.614 12.9093 29.1738 12.219 29.1738C11.5287 29.1738 10.9692 28.614 10.969 27.9238C10.969 25.8029 11.8006 23.881 13.3674 22.5039C14.9239 21.1359 17.1134 20.3828 19.719 20.3828ZM19.719 9.67578C22.383 9.67584 24.5217 11.8145 24.5217 14.4785C24.5216 17.1424 22.3829 19.2812 19.719 19.2812C17.0551 19.2812 14.9164 17.1424 14.9163 14.4785C14.9163 11.8145 17.055 9.67585 19.719 9.67578ZM19.719 12.1758C18.4357 12.1758 17.4163 13.1952 17.4163 14.4785C17.4164 15.7617 18.4358 16.7812 19.719 16.7812C21.0022 16.7812 22.0216 15.7617 22.0217 14.4785C22.0217 13.1952 21.0023 12.1758 19.719 12.1758Z" fill="white"/>
          </svg>
        </a>
      {/if}
    {/if}

  </nav>
</div>
<style>
  /* 터치 하이라이트 제거 — 안드로이드 크롬이 탭한 링크·버튼에 잠깐 씌우는 반투명 박스(눌림 피드백은 각 요소의 :active 스타일이 담당) */
  .gnb-desktop-wrap a,
  .gnb-desktop-wrap button,
  .gnb-mobile-wrap a,
  .gnb-mobile-wrap button {
    -webkit-tap-highlight-color: transparent;
  }

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
    width: clamp(40px, 5.2vw, 56px);
    height: clamp(40px, 5.2vw, 56px);
    border-radius: 50%;
    overflow: hidden;
    background: var(--cs-purple-pale);
    color: var(--cs-dark);
    font-family: var(--font-en-display);
    font-size: clamp(14.4px, 1.6vw, 20.8px);
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

  /* 아바타 + 알림 링 래퍼 — 아바타 10% 확대(32→35.2px, Stephen 지시 2026-11-03) */
  .gnb-avatar-wrap {
    position: relative;
    display: flex;
    flex-shrink: 0;
    width: 35.2px;
    height: 35.2px;
  }
  /* 알림 수신 도트 링 — 아바타 바깥(래퍼 기준 사방 6px)을 도는 동그란 점 16개(꼬리처럼 커지고 진해짐) */
  .gnb-notice-ring {
    position: absolute;
    inset: -6px;
    width: calc(100% + 12px);
    height: calc(100% + 12px);
    pointer-events: none;
    /* 일정한 속도의 연속 회전 + GPU 합성 레이어로 끊김 최소화.
       ⚠ 여기에 정적 transform(translateZ 등)을 두지 말 것 — 키프레임과 변환 함수 목록이 달라지면 행렬 보간이 되어
       360° 회전이 항등 행렬과 같아 "돌지 않는" 것처럼 보인다(2026-11-03 실제 결함) */
    animation: gnb-notice-spin 4.8s linear infinite;
    will-change: transform;
  }
  .gnb-notice-ring circle {
    fill: var(--cs-red-badge);
  }
  /* 페이드 인·아웃 — 회전하는 동안 링 전체가 부드럽게 옅어졌다 짙어지기를 반복(등장·사라짐은 Svelte fade 로 처리) */
  .gnb-notice-pulse {
    animation: gnb-notice-pulse 2.4s ease-in-out infinite;
  }
  @keyframes gnb-notice-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.35; }
  }
  @keyframes gnb-notice-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .gnb-notice-ring,
    .gnb-notice-pulse { animation: none; }
  }

  .gnb-avatar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 35.2px;
    height: 35.2px;
    min-width: 35.2px;
    min-height: 35.2px;
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
    font-size: 15.84px;
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
