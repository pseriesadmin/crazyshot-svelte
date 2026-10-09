<script lang="ts">
  import { tick } from 'svelte'
  import { goto } from '$app/navigation'
  import MobileMoreMenu from '$lib/components/common/MobileMoreMenu.svelte'

  interface Props {
    title: string
    floating?: boolean
    pcOnly?: boolean        // 모바일 숨김 — 히어로 floating과 중복 방지
    mobileOnly?: boolean    // PC 숨김 — cart처럼 자체 PC 헤더가 있을 때
    transparent?: boolean   // PC 배경 제거 — 히어로 이미지 위 overlay 배치 시
    noGnbOffset?: boolean   // GNB 없는 페이지 — PC sticky top을 0으로
    /** 페이지 타이틀 서체 — §13-2: en=Tilt Warp 계열, kr=SB Aggro/Noto 한글 메뉴 */
    titleLocale?: 'en' | 'kr'
    /** 지정하면 뒤로가기가 브라우저 기록(history.back) 대신 이 주소로 이동한다 — 새 탭·팝업으로 열려 이전 기록이 없거나
     *  화면끼리 서로 되돌아가는 순환(예: /account ↔ /account/rental)이 생길 수 있는 화면용 */
    backHref?: string
    /** backHref 이동 시 기록을 새로 쌓지 않고 현재 항목을 교체한다(순환 방지) */
    backReplace?: boolean
  }

  let {
    title,
    floating = false,
    pcOnly = false,
    mobileOnly = false,
    transparent = false,
    noGnbOffset = false,
    titleLocale = 'kr',
    backHref,
    backReplace = false
  }: Props = $props()

  let moreMenuOpen = $state(false)

  // 스크롤 인터랙션: 다운 → 보임, 업 → 가림
  let gnbHidden = $state(false)
  let lastScrollY = 0

  function onScroll() {
    const y = window.scrollY
    // GNB 반대: 스크롤 다운 → 보임, 스크롤 업 → 가림
    gnbHidden = y > lastScrollY && y > 60
    lastScrollY = y
  }

  $effect(() => {
    lastScrollY = window.scrollY
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  })

  // ── 모바일: 위로 스크롤하면 헤더가 자동으로 다시 나타난다(아래로 스크롤하면 숨김) ──
  // 헤더는 문서 흐름 안에 있어 스크롤하면 화면 밖으로 나간다. 위로 스크롤하는 순간 화면 상단에 고정(fixed)해 슬라이드 인하고,
  // 아래로 스크롤하면 슬라이드 아웃 뒤 원래 자리(흐름)로 돌려놓는다.
  // ⛔ 고정으로 바꿀 때 래퍼의 높이를 px로 고정해 문서 높이를 유지한다 — 높이가 바뀌면 바닥에서 브라우저의 scrollY 보정과
  //    표시/숨김 판정이 되먹임 루프(반복 떨림)를 만든다(2026-10-08 /account 하단 떨림). 이 높이 고정을 지우지 말 것.
  let wrapEl = $state<HTMLDivElement | undefined>()
  let barEl = $state<HTMLDivElement | undefined>()
  let stuck = $state(false)      // 화면 상단에 고정(fixed) 중
  let mHidden = $state(false)    // 고정 상태에서의 슬라이드 아웃
  let idleHidden = $state(false) // 숨김이 끝나 흐름으로 돌아왔는데 그 자리가 화면에 일부 걸칠 때(맨 위 근처) 갑자기 나타나지 않게 감춰 둠
  let noAnim = $state(false)     // 고정↔흐름 전환 프레임에서는 transform 전환을 끈다(되돌아오는 애니메이션 방지)
  let mWrapH = 0                 // 고정 전환 시 측정한 래퍼 높이(해제 직후 레이아웃 갱신 전에도 위치 계산에 사용)
  let stuckTop = $state<string | undefined>()  // 흐름에서 바로 숨길 때 고정 헤더의 시작 top(현재 보이는 위치와 같게 해 위치가 튀지 않음), 기본은 0
  let mLastY = 0
  let mLocked = false
  let mLockTimer: ReturnType<typeof setTimeout> | undefined
  let mReleaseTimer: ReturnType<typeof setTimeout> | undefined
  const M_DELTA = 8        // 이 이하의 미세 이동은 무시(고무줄 반동·관성 되튕김)
  const M_EDGE_PX = 2      // 바닥 경계는 판정에서 제외
  const M_LOCK_MS = 350    // 전환 직후 입력 무시(레이아웃·툴바 변화로 생기는 보정 스크롤)
  // 모션(CSS와 짝): 숨김은 천천히(0.5s, 한 템포 느리게), 노출은 살짝 늦게 시작(0.12s 지연)해 0.4s로 들어온다
  const M_HIDE_MS = 500

  // 헤더의 "원래 자리"(문서 흐름 속 위치) — 일반 모드는 래퍼, floating(상품상세 히어로 위에 떠 있는 막대)은 래퍼가 높이 0이라
  // 막대의 기준 컨테이너(히어로) 상단이 원래 자리다. PC(≥768px)처럼 숨겨져 있으면 null.
  function measureAnchor(): { top: number; bottom: number } | null {
    if (!wrapEl) return null
    if (floating) {
      const host = wrapEl.offsetParent as HTMLElement | null
      if (!host || !barEl || barEl.offsetHeight === 0) return null
      const r = host.getBoundingClientRect()
      const h = stuck ? mWrapH : barEl.offsetHeight
      return { top: r.top, bottom: r.top + h }
    }
    const r = wrapEl.getBoundingClientRect()
    if (r.height === 0) return null
    return { top: r.top, bottom: r.bottom }
  }

  function lockMobile(ms: number = M_LOCK_MS) {
    mLocked = true
    clearTimeout(mLockTimer)
    mLockTimer = setTimeout(() => { mLocked = false; mLastY = window.scrollY }, ms)
  }

  function releaseMobile() {
    clearTimeout(mReleaseTimer)
    if (!stuck) return
    noAnim = true
    stuck = false
    mHidden = false
    stuckTop = undefined
    if (wrapEl) {
      const y = window.scrollY
      const top = (measureAnchor()?.top ?? wrapEl.getBoundingClientRect().top) + y
      wrapEl.style.height = ''
      // 흐름으로 돌아온 자리가 화면에 일부 보이는 구간(맨 위 근처)이면 갑자기 나타나지 않게 감춰 둔다 — 다시 위로 스크롤하면 슬라이드 인
      idleHidden = y > top + 1 && y < top + mWrapH
    }
    void tick().then(() => { void barEl?.offsetHeight; noAnim = false })
  }

  async function revealMobile() {
    clearTimeout(mReleaseTimer)
    if (!stuck) {
      if (!wrapEl || !barEl) return
      mWrapH = barEl.offsetHeight
      if (!floating) wrapEl.style.height = `${mWrapH}px` // 흐름에서 빠져도 같은 높이 유지(floating은 원래 흐름 밖이라 불필요 — 넣으면 히어로 본문이 밀림)
      idleHidden = false
      noAnim = true                                       // 위치 전환(흐름→고정) 프레임에는 애니메이션 없이 숨김 상태로 놓고
      mHidden = true                                      // 화면 위에서 시작
      stuck = true
      lockMobile()
      await tick()
      void barEl.offsetHeight                             // 숨김 상태를 한 번 확정한 뒤
      noAnim = false                                      // 전환을 켜고 슬라이드 인(숨김과 같은 0.3s ease)
      void barEl.offsetHeight
    }
    stuckTop = undefined                                  // 노출은 항상 화면 맨 위(top:0)에서
    mHidden = false
    lockMobile()
  }

  function concealMobile() {
    mHidden = true
    lockMobile(M_HIDE_MS)                                 // 숨김 모션이 끝날 때까지 반대 입력 무시
    clearTimeout(mReleaseTimer)
    mReleaseTimer = setTimeout(releaseMobile, M_HIDE_MS + 20)   // 슬라이드 아웃이 끝나면 원래 자리(흐름)로
  }

  // 흐름 속(맨 위 근처)에서 처음 아래로 스크롤할 때 — 헤더를 지금 보이는 위치 그대로 고정으로 바꾼 뒤 위로 슬라이드해 사라지게 한다.
  // 문서 높이는 그대로(래퍼 높이 고정)이고 헤더만 움직이므로 본문은 평소처럼 스크롤된다.
  async function concealFromFlow(top: number) {
    if (!wrapEl || !barEl) return
    clearTimeout(mReleaseTimer)
    mWrapH = barEl.offsetHeight
    if (!floating) wrapEl.style.height = `${mWrapH}px`
    stuckTop = `${Math.round(top)}px`                     // 현재 보이는 위치에서 출발
    idleHidden = false
    noAnim = true
    mHidden = false
    stuck = true
    lockMobile(M_HIDE_MS)
    await tick()
    void barEl.offsetHeight
    noAnim = false
    mHidden = true                                        // 위로 슬라이드 아웃(천천히)
    clearTimeout(mReleaseTimer)
    mReleaseTimer = setTimeout(releaseMobile, M_HIDE_MS + 20)
  }

  function onMobileScroll() {
    if (!wrapEl || mLocked) return
    const rect = measureAnchor()
    if (!rect) return                                      // PC(≥768px)에서는 숨김
    const y = window.scrollY
    const wrapTop = rect.top + y
    const wrapBottom = rect.bottom + y
    if (y <= wrapTop + 1) {                                // 원래 자리에 도달 — 흐름 속 헤더 그대로(고정과 위치가 같아 끊김 없음)
      if (stuck) releaseMobile()
      idleHidden = false
      mLastY = y
      return
    }
    if (y > wrapBottom && idleHidden) idleHidden = false   // 헤더 자리가 화면 밖으로 나가면 감춤 해제(어차피 안 보임)
    const max = document.documentElement.scrollHeight - window.innerHeight
    if (y >= max - M_EDGE_PX) { mLastY = Math.max(0, Math.min(y, max)); return }
    const dy = y - mLastY
    if (Math.abs(dy) < M_DELTA) return
    mLastY = y
    if (dy < 0) {
      if (stuck || y > wrapBottom || idleHidden) void revealMobile()   // 위로 스크롤 — 헤더가 화면 밖이거나 감춰져 있으면 상단에 나타남
    } else if (stuck) {
      concealMobile()                                      // 아래로 스크롤 — 다시 숨김
    } else if (!idleHidden && rect.bottom > 0) {
      void concealFromFlow(rect.top)                       // 헤더가 아직 화면에 보이면 — 그 자리에서 슬라이드 아웃
    }
  }

  $effect(() => {
    if (pcOnly) return
    mLastY = window.scrollY
    window.addEventListener('scroll', onMobileScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onMobileScroll)
      clearTimeout(mLockTimer)
      clearTimeout(mReleaseTimer)
    }
  })

  function goBack() {
    if (backHref) {
      goto(backHref, { replaceState: backReplace })
      return
    }
    if (history.length > 1) {
      history.back()
    } else {
      goto('/products')
    }
  }

</script>

<!-- ── PC Sub GNB (≥768px) — floating/mobileOnly 모드에서는 렌더링 안 함 ── -->
{#if !floating && !mobileOnly}
<header class="sub-gnb-pc" class:transparent class:gnb-hidden={gnbHidden} class:no-gnb-offset={noGnbOffset}>
  <div class="sub-gnb-pc-inner">
    <button class="pc-pill" onclick={goBack} aria-label="뒤로가기">
      <div class="pc-pill-left">
        <svg class="pc-pill-arrow" viewBox="0 0 21.3844 17.1421" fill="none" aria-hidden="true">
          <path d="M19.8844 8.5707L1.5 8.57107M8.57107 1.5L1.5 8.57107L8.57107 15.6421" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/>
        </svg>
        <span class="pc-back-text">Back</span>
      </div>
      <span class="pc-title" class:pc-title--kr={titleLocale === 'kr'}>{title}</span>
    </button>
  </div>
</header>
{/if}

<!-- ── Mobile Sub GNB (≤640px) — pcOnly 시 렌더링 안 함 ── -->
{#if !pcOnly}
<div class="sub-gnb-mobile-wrap" bind:this={wrapEl}>
<div class="sub-gnb-mobile" class:floating class:stuck class:m-hidden={mHidden} class:idle-hidden={idleHidden} class:no-anim={noAnim} style:top={stuckTop} bind:this={barEl}>
  <div class="gnb-pill">
    <button class="back-btn" onclick={goBack} aria-label="뒤로가기">
      <svg width="15" height="10" viewBox="0 0 17 12" fill="none" aria-hidden="true">
        <path d="M1 6H16M1 6L6 1M1 6L6 11" stroke="#444444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <span class="gnb-title">{title}</span>
    <button class="menu-btn" onclick={() => moreMenuOpen = true} aria-label="더보기 메뉴">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="17" viewBox="0 0 20 17" fill="none" aria-hidden="true">
        <path d="M18.5 6.75C19.3284 6.75 20 7.42157 20 8.25C20 9.07843 19.3284 9.75 18.5 9.75H1.5C0.671573 9.75 0 9.07843 0 8.25C0 7.42157 0.671573 6.75 1.5 6.75H18.5Z" fill="#CF0000"/>
        <path d="M18.5 14C19.1904 14 19.75 14.5596 19.75 15.25C19.75 15.9404 19.1904 16.5 18.5 16.5H1.5C0.809644 16.5 0.25 15.9404 0.25 15.25C0.25 14.5596 0.809644 14 1.5 14H18.5ZM18.5 0C19.1904 0 19.75 0.559644 19.75 1.25C19.75 1.94036 19.1904 2.5 18.5 2.5H1.5C0.809644 2.5 0.25 1.94036 0.25 1.25C0.25 0.559644 0.809644 0 1.5 0H18.5Z" fill="#201857"/>
      </svg>
    </button>
  </div>
</div>
</div>

<MobileMoreMenu open={moreMenuOpen} onclose={() => moreMenuOpen = false} />
{/if}

<style>
  /* ══ PC Sub GNB ══ */
  .sub-gnb-pc {
    display: none;
    transition: transform 0.3s ease;
  }
  .sub-gnb-pc.gnb-hidden {
    transform: translateY(-100%);
  }

  /* [GNB-BREAKPOINT-FIX 2026-08-10] 641px → 768px: GNB.svelte(768px 전환)와 불일치로
     641~767px 구간에서 GNB=모바일/SubGnb=PC로 어긋나던 문제 수정. 복원 시 641px로 되돌릴 것. */
  @media (min-width: 768px) {
    .sub-gnb-pc {
      display: block;
      position: sticky;
      top: var(--layout-header-h, 100px);
      z-index: 50;
      background: transparent;
      border-bottom: none;
    }
    .sub-gnb-pc.no-gnb-offset {
      top: 0;
    }

    .sub-gnb-pc.transparent {
      background: transparent;
      border-bottom: none;
      position: relative;
    }

    .sub-gnb-pc-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 30px;
      width: 100%;
      max-width: var(--layout-pc-max);
      margin: 0 auto;
      padding: 20px var(--layout-pc-pad);
      flex-wrap: nowrap;
      box-sizing: border-box;
    }

    /* §13-2 sub-gnb_navi_b — cart/+page.svelte .sub-gnb-b-pill 정본(2026-09-21 축소) */
    .pc-pill {
      background: rgba(225, 222, 243, 0.4);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 40px;
      border-radius: var(--radius-lg);
      width: 100%;
      max-width: none;
      min-width: 0;
      min-height: 43px;
      flex: 1 1 auto;
      box-sizing: border-box;
      color: var(--cs-text);
      transition: background 0.2s;
    }

    .pc-pill:hover {
      background: rgba(225, 222, 243, 0.85);
    }

    .pc-pill-left {
      display: flex;
      align-items: center;
      gap: 9px;
      min-width: 0;
    }

    .pc-pill-arrow {
      width: 11px;
      height: 9px;
      flex-shrink: 0;
    }

    .pc-back-text {
      font: var(--text-pc-body-14);
      color: var(--cs-text);
      white-space: nowrap;
    }

    .pc-title {
      font: var(--text-pc-menu-en-20);
      font-size: 18px;
      color: var(--cs-text);
      flex-shrink: 0;
      white-space: nowrap;
    }
    .pc-title.pc-title--kr {
      font: var(--text-pc-menu-kr-20);
      font-size: 18px;
    }
  }

  @media (min-width: 768px) and (max-width: 1024px) {
    .sub-gnb-pc-inner {
      padding: 16px var(--layout-tab-pad);
      gap: 20px;
    }
    .pc-pill {
      padding: 14px 28px;
      min-height: 56px;
    }
  }

  /* ══ Mobile Sub GNB ══ */
  /* 숨김은 .sub-gnb-mobile의 transform만으로 처리한다 — 래퍼 높이(max-height)를 접으면 문서 높이가 바뀌어
     바닥에서 브라우저의 scrollY 보정 ↔ 표시/숨김 판정이 되먹임 루프(반복 떨림)를 만든다(2026-10-08 /account 하단 떨림). 되돌리지 말 것. */
  .sub-gnb-mobile-wrap {
    overflow: hidden;
    max-height: 100px;
    width: 100%;
  }

  .sub-gnb-mobile {
    display: block;
    position: relative;
    z-index: 50;
    padding: 16px 25px 0;
    align-self: stretch;
    transform: translateY(0);
    transition: transform 0.3s ease;
  }
  /* 위로 스크롤 시 화면 상단에 고정 노출(래퍼가 같은 높이를 유지하므로 문서 높이는 변하지 않는다) */
  .sub-gnb-mobile.stuck {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 55;
    padding-bottom: 8px;
  }
  /* 모션은 도착 상태의 transition이 적용된다 — 노출(고정, 숨김 해제)은 살짝 늦게 시작해 부드럽게 들어오고(0.12s 지연·0.4s·ease-out),
     숨김(.m-hidden)은 한 템포 느리게 천천히 사라진다(0.5s·ease-in-out). 지연은 노출에만 있어 숨김 반응이 굼뜨지 않는다. */
  .sub-gnb-mobile.stuck {
    transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.12s;
  }
  .sub-gnb-mobile.m-hidden {
    transform: translateY(-100%);
    transition: transform 0.5s cubic-bezier(0.45, 0, 0.2, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    .sub-gnb-mobile.stuck,
    .sub-gnb-mobile.m-hidden { transition-duration: 0.01ms; transition-delay: 0s; }
  }
  /* 고정↔흐름 위치가 바뀌는 프레임에는 전환을 끈다(되돌아오는 애니메이션 방지) — 슬라이드 인·아웃 모션은 위 .stuck/.m-hidden 규칙 */
  .sub-gnb-mobile.no-anim {
    transition: none;
  }
  /* 숨김이 끝나 흐름으로 돌아왔는데 자리가 화면에 일부 걸치는 구간 — 갑자기 나타나지 않도록 감춘다(위로 스크롤하면 슬라이드 인) */
  .sub-gnb-mobile.idle-hidden {
    visibility: hidden;
  }

  .sub-gnb-mobile.floating {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    padding: 24px 20px 0;
    z-index: 10;
  }
  /* floating 막대도 위로 스크롤하면 화면 상단 고정으로 나타난다(일반 모드와 같은 모션) — 위 .floating의 absolute가 .stuck의 fixed를 덮어쓰지 않게 */
  .sub-gnb-mobile.floating.stuck {
    position: fixed;
    top: 0;
    z-index: 55;
    padding-bottom: 8px;
  }

  /* [GNB-BREAKPOINT-FIX 2026-08-10] 641px → 768px: 위 PC 블록과 짝 맞춤. 복원 시 641px로. */
  @media (min-width: 768px) {
    .sub-gnb-mobile-wrap,
    .sub-gnb-mobile {
      display: none;
    }
  }

  .gnb-pill {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--cs-lilac-nav);
    border: 1px solid rgba(255, 255, 255, 0.6);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-radius: var(--radius-lg);
    padding: 14px 20px;
    min-height: 52px;
    width: 100%;
  }

  .back-btn,
  .menu-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    background: none;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    margin: -8px;
  }

  .gnb-title {
    font: var(--text-m-body-16B);
    color: var(--cs-text);
    text-align: center;
    flex: 1;
    padding: 0 8px;
    letter-spacing: -0.3px;
  }

  /* ── 카테고리 드롭다운 (Mobile) ── */
  .cat-menu {
    position: absolute;
    top: calc(100% - 4px);
    left: 20px;
    right: 20px;
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    box-shadow: 0 8px 32px rgba(16, 11, 50, 0.18);
    padding: 20px 16px;
    z-index: 100;
    animation: menuIn 0.18s ease;
  }

  @keyframes menuIn {
    from { opacity: 0; transform: translateY(-8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .cat-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px 0;
  }

  .cat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px 4px;
    text-decoration: none;
    border-radius: var(--radius-md);
    transition: background 0.12s;
  }

  .cat-item:hover,
  .cat-item:active { background: var(--cs-lilac); }

  .cat-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
  }

  .cat-label {
    font: var(--text-m-script-12);
    color: var(--cs-text-dark);
    text-align: center;
    white-space: nowrap;
  }

  .cat-overlay {
    position: fixed;
    inset: 0;
    background: transparent;
    z-index: 99;
    border: none;
    cursor: default;
  }
</style>
