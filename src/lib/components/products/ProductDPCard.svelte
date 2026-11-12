<script lang="ts">
  import { goto } from '$app/navigation'
  import type { ProductCategoryEnum } from '$lib/types/database'

  interface Props {
    id?: string
    name: string
    category?: ProductCategoryEnum | string
    imageUrl: string
    price24h?: number | null
    price12h?: number | null
    isSaleOnly?: boolean
    salePrice?: number | null
    href?: string
    wished?: boolean
    onWishToggle?: (id: string | undefined) => void
    /**
     * 표준(standard)을 기준으로 영역 특성에 맞춘 변형 — 기본 standard 는 기존과 완전히 동일.
     *  - list : /products 모바일 목록(.m-prod-card 에서 이식) — 폭 100%(2열 그리드 셀)·정사각 비율·배경 #e1def3·찜 버튼 32px·호버 시 카드 1.02배, 루트는 <a>. 정보 구조는 홈 MD 추천(pick-home)과 동일: 상품명이 가격 위·상품명 purple Bold·정보 상단 여백 14.04px
     *  - thumb: 썸네일만(설명서 목록 등) — 정보·찜 없음, 비대화형, 크기는 부모가 --pc-thumb-size(기본 84px)로 지정
     *  - pick : /products MD 추천(.md-pick-card 에서 이식) — 폭 모바일 139px·PC 232px, 루트 <a>, 호버=이미지만 확대(표준 동작). 정보 구조는 list·pick-home 과 동일(상품명이 가격 위·purple Bold·상단 여백 14.04px, 2026-11-05)
     *  - fluid / fluid-mobile: 2열 그리드 셀 안에서 카드·이미지 폭 100%(정사각 비율) — fluid=모든 폭(검색 결과), fluid-mobile=≤640px 만(하이프팩 테마 목록). 반경·찜·정보는 표준 값 그대로
     *  - scroll-m: 가로 스크롤 한 줄 카드 M — 모바일 139px·PC 232px(상품 상세 '최신 등록 상품')
     *  - scroll-s: 가로 스크롤 한 줄 카드 S(표준의 ×0.7) — 모바일 122px·PC 203px, 반경·찜 버튼도 같은 비율(마이페이지 찜 목록)
     *  - pick-home: 홈 MD 추천(.md-pick-card 에서 이식) — 가로 스크롤 트랙에서 2장 노출(폭 (트랙−15px)/2, 최대 174px, 스냅 시작 정렬), 카테고리 없음, 상품명이 가격 위, 상품명 purple·Bold, 정보 상단 여백 14.04px, 루트 <a>
     * 새 변형을 추가할 때는 .claude/plan/상품 썸네일 표준화 — 파편 스타일 등록부(2026-11-05).md 에 기존 커스텀 값을 먼저 옮겨 적는다.
     */
    variant?: 'standard' | 'list' | 'thumb' | 'pick' | 'pick-home' | 'fluid' | 'fluid-mobile' | 'scroll-m' | 'scroll-s'
    /** 상품별로 등록한 서브카피(products.product_caption, CMS '상품카피' 20자 이내) — 있으면 가격 줄 아래에 표시. 없으면 줄 자체를 그리지 않는다 */
    subCopy?: string | null
    /** 카테고리 줄 노출 — 표준은 숨김(기본 false, 2026-11-05 Stephen 지시). 필요한 영역만 true 로 켠다 */
    showCategory?: boolean
  }

  let {
    id,
    name,
    category = '',
    imageUrl,
    price24h = null,
    price12h = null,
    isSaleOnly = false,
    salePrice = null,
    href,
    wished = false,
    onWishToggle,
    variant = 'standard',
    showCategory = false,
    subCopy = null,
  }: Props = $props()

  /** 상품명이 가격 위에 오는 변형(홈 MD 추천 구조 — 2026-11-05 Stephen 지시로 list 도 동일) */
  const nameFirst = $derived(variant === 'pick-home' || variant === 'list' || variant === 'pick')

  let isWished = $state(false)
  $effect(() => { isWished = wished })

  function handleWish(e: MouseEvent) {
    e.preventDefault() // list 변형(<a> 루트)에서 찜 클릭이 링크 이동으로 이어지지 않게 — 그 외 변형은 영향 없음
    e.stopPropagation()
    isWished = !isWished
    onWishToggle?.(id)
  }

  function handleClick() {
    if (href) goto(href)
  }

  function formatPrice(n: number): string {
    return n.toLocaleString('ko-KR')
  }
</script>

{#snippet inner()}
  <!-- 이미지 영역 290×290 -->
  <div class="pc-img-wrap">
    <img src={imageUrl} alt={name} loading="lazy" class="pc-img" />

    <!-- 찜 버튼: 로그인 상태(onWishToggle 전달)면 찜 여부와 무관하게 항상 표시.
         비찜=기본(흰 아이콘), 찜=.active(빨강). 2026-08-27 커밋 21a5479에서 "찜된 상품만 표시"로
         잘못 바뀌어 비찜 상품에서 찜 추가 수단이 사라졌던 회귀를 복구(2026-09-29) -->
    {#if onWishToggle !== undefined}
      <button
        class="pc-clip"
        class:active={isWished}
        onclick={handleWish}
        aria-label={isWished ? '찜 해제' : '찜하기'}
        aria-pressed={isWished}
      >
        <svg width="34" height="34" viewBox="0 0 63 63" fill="none" aria-hidden="true">
          <path d="M31.3184 17.7266C34.3143 14.7584 39.1662 14.7584 42.1621 17.7266C45.1654 20.7024 45.1656 25.5331 42.1621 28.5088L29.5205 41.0322C27.7302 42.8059 24.8332 42.8059 23.043 41.0322C21.2452 39.2508 21.245 36.3565 23.043 34.5752L34.5674 23.1582C35.1558 22.5752 36.1054 22.5796 36.6885 23.168C37.2715 23.7564 37.2671 24.706 36.6787 25.2891L25.1543 36.707C24.5414 37.3146 24.5413 38.2939 25.1543 38.9014C25.7753 39.5166 26.7882 39.5165 27.4092 38.9014L40.0508 26.377C41.8692 24.575 41.8692 21.6594 40.0508 19.8574C38.2241 18.0477 35.2563 18.0477 33.4297 19.8574L20.7686 32.4014C17.744 35.3979 17.744 40.2506 20.7686 43.2471C23.8008 46.251 28.7227 46.2511 31.7549 43.2471L44.9443 30.1797C45.5328 29.5967 46.4824 29.6011 47.0654 30.1895C47.6484 30.7779 47.644 31.7275 47.0557 32.3105L33.8662 45.3779C29.6647 49.5405 22.8588 49.5405 18.6572 45.3779C14.4479 41.2076 14.448 34.4408 18.6572 30.2705L31.3184 17.7266Z" fill="currentColor"/>
        </svg>
      </button>
    {/if}
  </div>

  <!-- 텍스트 영역 -->
  <div class="pc-info">
    {#if category && showCategory}
      <p class="pc-category">{category}</p>
    {/if}

    {#if nameFirst}
      <p class="pc-name">{name}</p>
    {/if}

    {#if isSaleOnly}
      <div class="pc-price-row">
        <span class="pc-price-group">
          <span class="pc-price-label">Price</span>
          <span class="pc-price-num">{formatPrice(salePrice ?? 0)}</span>
        </span>
      </div>
    {:else if price24h !== null || price12h !== null}
      <div class="pc-price-row">
        {#if price24h !== null}
          <span class="pc-price-group">
            <span class="pc-price-label">Day</span>
            <span class="pc-price-num">{formatPrice(price24h)}</span>
          </span>
        {/if}
        {#if price24h !== null && price12h !== null}
          <span class="pc-price-sep">/</span>
        {/if}
        {#if price12h !== null}
          <span class="pc-price-group">
            <span class="pc-price-label">12H</span>
            <span class="pc-price-num">{formatPrice(price12h)}</span>
          </span>
        {/if}
      </div>
    {/if}

    {#if !nameFirst}
      <p class="pc-name">{name}</p>
    {/if}

    {#if subCopy}
      <p class="pc-subcopy">{subCopy}</p>
    {/if}
  </div>
{/snippet}

{#if variant === 'thumb'}
  <!-- 썸네일만(비대화형) — 이미지 박스는 표준(.pc-img-wrap/.pc-img)과 같은 구조.
       버튼 안(설명서 목록 행)에서도 올바른 HTML 이 되도록 span 으로 만들고 CSS 로 블록 처리 -->
  <span class="pc-card pc-card--thumb">
    <span class="pc-img-wrap">
      <img src={imageUrl} alt="" loading="lazy" class="pc-img" />
    </span>
  </span>
{:else if (variant === 'list' || variant === 'pick' || variant === 'pick-home') && href}
  <a class="pc-card pc-card--{variant}" {href} aria-label={name}>
    {@render inner()}
  </a>
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="pc-card{variant === 'standard' ? '' : ` pc-card--${variant}`}"
    onclick={handleClick}
    onkeydown={(e) => { if (e.key === 'Enter') handleClick() }}
    role="button"
    tabindex="0"
    aria-label={name}
  >
    {@render inner()}
  </div>
{/if}

<style>
  /* ━━━ Mobile 기본 (174px = 290 × 0.6) ━━━ */
  .pc-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 174px;
    flex-shrink: 0;
    cursor: pointer;
    text-decoration: none;
    outline-offset: 4px;
  }
  .pc-card:focus-visible {
    outline: 2px solid var(--cs-purple);
  }

  .pc-img-wrap {
    position: relative;
    width: 174px;
    height: 174px;
    border-radius: var(--radius-lg) var(--radius-sm) var(--radius-lg) var(--radius-sm);
    overflow: hidden;
    background: var(--cs-lilac);
    flex-shrink: 0;
  }
  .pc-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    display: block;
    transition: transform 0.3s ease;
  }
  .pc-card:hover .pc-img {
    transform: scale(1.04);
  }

  .pc-clip {
    position: absolute;
    top: 7px;
    right: 7px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: none;
    background: color-mix(in srgb, var(--cs-red-xlight) 80%, transparent); /* 비찜 상태 red-5 토큰(#FFEAEA), 알파 80% 유지 */
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    transition: background 0.18s, transform 0.18s, color 0.18s;
    padding: 0;
  }
  .pc-clip svg {
    width: 14px;
    height: 14px;
  }
  .pc-clip:hover {
    background: #ffb8b8;
    transform: scale(1.1);
  }
  .pc-clip.active {
    background: rgba(255, 207, 207, 0.8);
    color: #FF3535;
  }
  .pc-clip.active svg path {
    fill: #FF3535;
  }
  .pc-clip:active {
    transform: scale(0.9);
  }

  .pc-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    /* 모바일 상품정보 표준(front-uiux.md §14-4 확정값, 2026-09-29) — 12px(--spacing-3)의 90% */
    gap: 10.8px;
    padding: 10.8px 0 0;
    width: 100%;
    min-width: 0;
  }

  /* Mobile 타이포 토큰 (한 단계 업) */
  .pc-category {
    font: var(--text-m-script-12);         /* 12px Medium → Bold 오버라이드 */
    font-weight: 700;
    color: var(--cs-text-light);
    line-height: 1;
    margin: 0;
  }

  .pc-price-row {
    display: flex;
    /* box-center로는 레이블(14px)과 숫자(16px Black) 폰트 내부 여백 차이 때문에 레이블이
       위로 뜬 것처럼 보임(2026-09-27, 모바일 Best Pick과 동일 원인) — 베이스라인 정렬로
       교체. 모바일·PC 공용 규칙이라 두 breakpoint에 동시 적용됨 */
    align-items: baseline;
    gap: 3px;
    /* purple-90 컬러토큰 반영 */
    color: var(--cs-purple-dark);
    letter-spacing: -0.8px;   /* 모바일 자간(PC는 아래 @media에서 -0.5px 복원) */
    flex-wrap: wrap;
  }
  .pc-price-group {
    display: flex;
    align-items: baseline;
    gap: 3px;
  }
  .pc-price-label {
    font: var(--text-m-tag-11);            /* 11px — 모바일 확정값, 굵기 Medium 유지 */
    font-weight: 500;
    line-height: 1;
  }
  .pc-price-num {
    font: var(--text-m-body-16B);          /* 16px Bold → Black 오버라이드 */
    font-weight: 900;
    /* 2026-11-12(Stephen 지시): 모바일 금액 숫자에 숫자 전용 폰트(--text-m-num-18B 와 같은 D-DIN, 한글 대체 포함) 적용 — 크기(16px)·색은 기존 유지, PC 는 아래 @media 의 font 축약형이 그대로 덮어써 무변경 */
    font-family: 'D-DIN Exp', var(--font-kr-heading);
    /* D-DIN 은 700 이 최대 웨이트라 900 만으로는 Bold(700) 로 렌더 — 장바구니와 같은 방식으로 같은 색 0.5px 외곽선을 더해 900 만큼 굵게(Stephen 지시 '900 이 반영되지 않음'). PC 는 아래 @media 에서 해제 */
    -webkit-text-stroke: 0.5px currentColor;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    /* purple-60 컬러토큰 반영 */
    color: var(--cs-purple-light);
  }
  .pc-price-sep {
    font: var(--text-m-script-14B);        /* 14px Bold */
    line-height: 1;
    color: var(--cs-purple-pale);          /* purple-20 (모바일 확정값) */
  }

  .pc-name {
    /* 모바일 확정값(2026-09-29): 12px Medium · purple-90 · 행간 112%(PC는 아래 @media에서 14px/line-height 1 유지) */
    font: var(--text-m-script-12);
    color: var(--cs-purple-dark);
    letter-spacing: -0.5px;
    line-height: 1.12;
    margin: 0;
    width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ━━━ PC (290px = Figma 정본) ━━━ */
  @media (min-width: 768px) {
    .pc-card     { width: 290px; }

    .pc-img-wrap {
      width: 290px;
      height: 290px;
      border-radius: 33px 13px 33px 13px; /* mobile 174→290px 배율(×5/3)로 20/8 비율 확대 */
    }

    .pc-clip {
      top: 14px;
      right: 14px;
      width: 44px;
      height: 44px;
    }
    .pc-clip svg {
      width: 34px;
      height: 34px;
    }

    /* 카테고리/가격/상품명 간 여백 30% 축소(요청, 2026-09-27) — 20px(--spacing-5) → 14px */
    .pc-info   { gap: 14px; padding: 14px 0 0; }

    .pc-category   { font: var(--text-pc-script-12); font-weight: 700; color: var(--cs-text-light); line-height: 1; margin: 0; }
    .pc-price-row  { gap: 5px; }
    .pc-price-group{ gap: 5px; }
    .pc-price-row   { flex-wrap: nowrap; gap: 5px; letter-spacing: -0.5px; }
    .pc-price-label { font: var(--text-pc-body-14); font-weight: 700; line-height: 1; }     /* 14px Bold */
    .pc-price-num   { font: var(--text-pc-title-18); font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; -webkit-text-stroke: 0; } /* 18px Bold — 모바일 전용 외곽선 해제 */
    .pc-price-sep   { font: var(--text-pc-body-14); line-height: 1; color: inherit; }     /* 14px Bold */
    /* PC도 동일한 볼드 없는 폰트토큰 사용(요청: PC·모바일 동일 반영) */
    .pc-name        { font: var(--text-m-script-14); letter-spacing: -0.5px; line-height: 1; margin: 0; }
  }

  /* ━━━ 변형(variant) — 표준을 기준으로 영역 특성만 덮어쓴다. 각 값의 출처·이력은
     .claude/plan/상품 썸네일 표준화 — 파편 스타일 등록부(2026-11-05).md ━━━
     `.pc-card.pc-card--x`·`.pc-card--x .pc-*` 로 쓰는 이유: 표준 PC 규칙(@media, 클래스 1개)보다 항상 이기게 하려는 것 */

  /* list — /products 모바일 목록(.m-prod-card 이식, 2열 그리드 셀 안에서 폭 100%) */
  .pc-card.pc-card--list {
    width: 100%;
    color: inherit;
    transition: transform 0.2s;
  }
  .pc-card--list:hover { transform: scale(1.02); }   /* 카드 전체 1.02배(이미지 확대 대신) — 기존 .m-prod-card 동작 */
  .pc-card--list .pc-img-wrap {
    width: 100%;
    height: auto;
    aspect-ratio: 1 / 1;
    border-radius: var(--radius-lg) var(--radius-sm) var(--radius-lg) var(--radius-sm);
    background: #e1def3;                              /* 기존 .m-prod-img-box 배경 */
  }
  .pc-card--list .pc-img { position: absolute; inset: 0; }
  .pc-card--list:hover .pc-img { transform: none; }
  .pc-card--list .pc-clip { top: 11px; right: 11px; width: 32px; height: 32px; }   /* 기존 .mprod-clip */
  .pc-card--list .pc-clip svg { width: 26px; height: 26px; }

  /* pick — /products MD 추천(.md-pick-card 이식): 가로 스크롤 트랙 안의 고정폭 카드 */
  .pc-card.pc-card--pick { width: 139px; color: inherit; }   /* PC 232px × 0.60 ≈ 139px */
  .pc-card--pick .pc-img-wrap { width: 100%; height: auto; aspect-ratio: 1 / 1; }
  .pc-card--pick .pc-img { position: absolute; inset: 0; }
  .pc-card--pick .pc-category { text-transform: uppercase; }   /* 기존 .mdp-category */
  @media (min-width: 768px) {
    .pc-card.pc-card--pick { width: 232px; }   /* 표준 290px 대비 20% 축소(요청 2026-09-29) */
  }

  /* pick-home — 홈 MD 추천(.md-pick-card 이식): 2열 그리드 셀 폭 100%, 최대 174px */
  .pc-card.pc-card--pick-home {
    flex: 0 0 auto;
    width: min(174px, calc((100% - 15px) / 2));   /* 가로 스크롤 트랙에서 2장 노출 — 15px = 홈 .md-picks-track 의 gap */
    scroll-snap-align: start;
    color: inherit;
  }
  .pc-card--pick-home .pc-img-wrap {
    width: 100%;
    height: auto;
    aspect-ratio: 1 / 1.57;   /* 세로폭 +30%(1:1.3) → 10% 더(1.43) → 10% 더 = 1.43 × 1.1 ≈ 1.57(2026-11-05 Stephen 지시, 가로 160px 기준 높이 약 251px) */
    border-radius: var(--radius-lg) var(--radius-sm) var(--radius-lg) var(--radius-sm);
  }
  .pc-card--pick-home .pc-img { position: absolute; inset: 0; }

  /* fluid / fluid-mobile — 2열 그리드 셀 안에서 폭 100%(기존 SearchProductGrid·하이프팩 테마 목록의 :global 오버라이드 이식) */
  .pc-card.pc-card--fluid { width: 100%; max-width: 100%; min-width: 0; flex-shrink: 1; }
  .pc-card--fluid .pc-img-wrap { width: 100%; height: auto; aspect-ratio: 1; flex-shrink: 1; }
  @media (max-width: 640px) {
    .pc-card.pc-card--fluid-mobile { width: 100%; max-width: 100%; min-width: 0; flex-shrink: 1; }
    .pc-card--fluid-mobile .pc-img-wrap { width: 100%; height: auto; aspect-ratio: 1; flex-shrink: 1; }
  }

  /* scroll-m — 모바일 139px(= PC 232px × 0.60, 반경 20/8), PC 232px(표준 290px −20%, 반경 33/13) — 기존 상품 상세 '최신 등록 상품' 오버라이드 이식 */
  .pc-card.pc-card--scroll-m { width: 139px; }
  .pc-card--scroll-m .pc-img-wrap { width: 139px; height: 139px; border-radius: 20px 8px 20px 8px; }
  @media (min-width: 768px) {
    .pc-card.pc-card--scroll-m { width: 232px; }
    .pc-card--scroll-m .pc-img-wrap { width: 232px; height: 232px; border-radius: 33px 13px 33px 13px; }
  }

  /* scroll-s — 표준 ×0.7: 모바일 174→122px(반경 14/6, 찜 15px·아이콘 10px·여백 5px), PC 290→203px(반경 23/9, 찜 31px·아이콘 24px·여백 10px) — 기존 WishlistScroll 오버라이드 이식 */
  .pc-card.pc-card--scroll-s { width: 122px; }
  .pc-card--scroll-s .pc-img-wrap { width: 122px; height: 122px; border-radius: 14px 6px 14px 6px; }
  .pc-card--scroll-s .pc-clip { width: 15px; height: 15px; top: 5px; right: 5px; }
  .pc-card--scroll-s .pc-clip svg { width: 10px; height: 10px; }
  @media (min-width: 768px) {
    .pc-card.pc-card--scroll-s { width: 203px; }
    .pc-card--scroll-s .pc-img-wrap { width: 203px; height: 203px; border-radius: 23px 9px 23px 9px; }
    .pc-card--scroll-s .pc-clip { width: 31px; height: 31px; top: 10px; right: 10px; }
    .pc-card--scroll-s .pc-clip svg { width: 24px; height: 24px; }
  }

  /* 홈 MD 추천 정보 구조 공통(pick-home·list): 썸네일↔정보 간격 10.8px +30%(2026-11-04 Stephen 지시), 상품명 볼드 + purple 토큰(2026-11-04 Stephen 지시), list 도 동일하게(2026-11-05) */
  .pc-card--pick-home .pc-info,
  .pc-card--list .pc-info,
  .pc-card--pick .pc-info { padding-top: 14.04px; }
  .pc-card--pick-home .pc-name,
  .pc-card--list .pc-name,
  .pc-card--pick .pc-name { font-weight: 700; color: var(--cs-purple); }

  /* 서브카피(상품카피) — 가격 줄 아래 보조 문구, 최대 2줄 */
  .pc-subcopy {
    margin: 0;
    width: 100%;
    font: var(--text-m-script-12);
    color: var(--cs-text-mid);
    letter-spacing: -0.5px;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* thumb — 썸네일만(설명서 목록 등): 크기는 부모가 --pc-thumb-size 로 지정, 반경 10px(이미지 반경 표준) */
  .pc-card.pc-card--thumb {
    width: var(--pc-thumb-size, 84px);
    cursor: default;
  }
  .pc-card--thumb .pc-img-wrap {
    display: block;
    width: var(--pc-thumb-size, 84px);
    height: var(--pc-thumb-size, 84px);
    border-radius: var(--cms-radius-sm);
  }
  .pc-card--thumb:hover .pc-img { transform: none; }
</style>
