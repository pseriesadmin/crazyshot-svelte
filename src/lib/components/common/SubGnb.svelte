<script lang="ts">
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
<div class="sub-gnb-mobile-wrap" class:gnb-hidden={gnbHidden}>
<div class="sub-gnb-mobile" class:floating class:gnb-hidden={gnbHidden}>
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
  .sub-gnb-mobile-wrap {
    overflow: hidden;
    max-height: 100px;
    transition: max-height 0.3s ease;
    width: 100%;
  }
  .sub-gnb-mobile-wrap.gnb-hidden {
    max-height: 0;
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
  .sub-gnb-mobile.gnb-hidden {
    transform: translateY(-100%);
  }

  .sub-gnb-mobile.floating {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    padding: 24px 20px 0;
    z-index: 10;
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
