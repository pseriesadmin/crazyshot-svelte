<script lang="ts">
  import { goto } from '$app/navigation'
  import type { ProductCategoryEnum } from '$lib/types/database'
  import type { CustomerBadge } from '$lib/types/badge'
  import CardKeywordChips from '$lib/components/products/CardKeywordChips.svelte'
  import BadgeChip from '$lib/components/cms/badge/BadgeChip.svelte'

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
    /** 썸네일에 겹쳐 보일 상품 배지(우선순위 순, 개수 제한 없이 전부 표시) — CMS 프로모션 '배지' 설정 */
    badges?: CustomerBadge[]
    /** 배지 기준 크기(px) — 미지정이면 표준 22(썸네일 변형은 16). CMS 배지 미리보기처럼 썸네일을 크게 보여 줄 때만 지정 */
    badgeSize?: number
    /** 썸네일과 상품명 사이에 라운드 바로 보일 키워드(CMS 상품설명 키워드 중 카드 노출로 선택한 것, products.card_keywords) — 없으면 줄 자체를 그리지 않는다 */
    cardKeywords?: string[]
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
    badges = [],
    badgeSize,
    cardKeywords = [],
  }: Props = $props()

  // 이미지형은 좌상단, 바(텍스트)형은 하단 중앙 — 표시 개수 상한은 두지 않는다(2026-11-16, Stephen 확정)
  const iconBadges = $derived(badges.filter((b) => b.kind !== 'textbar'))
  const barBadges = $derived(badges.filter((b) => b.kind === 'textbar'))

  // 2026-11-18: 모든 변형이 요금 → 상품명 순서(Stephen 지시 — list·pick 에 이어 홈 미칠 PICK(pick-home)도 맞바꿈, 기존 "상품명 먼저" 분기 삭제)

  let isWished = $state(false)
  $effect(() => { isWished = wished })
  /** 찜 버튼을 직접 누른 뒤에만 true — 아이콘 팝 모션을 첫 렌더가 아닌 터치 순간에만 재생 */
  let justToggled = $state(false)

  function handleWish(e: MouseEvent) {
    e.preventDefault() // list 변형(<a> 루트)에서 찜 클릭이 링크 이동으로 이어지지 않게 — 그 외 변형은 영향 없음
    e.stopPropagation()
    isWished = !isWished
    justToggled = true
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

    {#if iconBadges.length > 0}
      <span class="pc-badges">
        {#each iconBadges as b (`${b.badge_id}:${b.template_id}`)}
          <BadgeChip kind={b.kind} svg_url={b.svg_url} text={b.text} bg_color={b.bg_color} text_color={b.text_color} size={badgeSize ?? 22} />
        {/each}
      </span>
    {/if}
    {#if barBadges.length > 0}
      <span class="pc-badges-bar">
        {#each barBadges as b (`${b.badge_id}:${b.template_id}`)}
          <BadgeChip kind={b.kind} svg_url={b.svg_url} text={b.text} bg_color={b.bg_color} text_color={b.text_color} size={badgeSize ?? 22} />
        {/each}
      </span>
    {/if}

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
        {#if isWished}
          <svg class:pop={justToggled} viewBox="0 0 60 60" fill="none" aria-hidden="true">
            <path d="M60 30C60 46.5685 46.5685 60 30 60C13.4315 60 0 46.5685 0 30C0 13.4315 13.4315 0 30 0C46.5685 0 60 13.4315 60 30Z" fill="url(#cs-wish-on-grad)"/>
            <path d="M37.2833 16C43.095 16 47 21.4013 47 26.44C47 36.6444 30.7933 45 30.5 45C30.2067 45 14 36.6444 14 26.44C14 21.4013 17.905 16 23.7167 16C27.0533 16 29.235 17.6494 30.5 19.0994C31.765 17.6494 33.9467 16 37.2833 16Z" fill="white"/>
            <defs>
              <linearGradient id="cs-wish-on-grad" x1="0" y1="30" x2="60" y2="30" gradientUnits="userSpaceOnUse">
                <stop stop-color="#FF3535"/>
                <stop offset="0.408654" stop-color="#3B2F8A"/>
              </linearGradient>
            </defs>
          </svg>
        {:else}
          <svg class:pop={justToggled} viewBox="0 0 60 60" fill="none" aria-hidden="true">
            <path d="M60 30C60 46.5685 46.5685 60 30 60C13.4315 60 0 46.5685 0 30C0 13.4315 13.4315 0 30 0C46.5685 0 60 13.4315 60 30Z" fill="#C1BBEC" fill-opacity="0.3"/>
            <path d="M37.2833 16C43.095 16 47 21.4013 47 26.44C47 36.6444 30.7933 45 30.5 45C30.2067 45 14 36.6444 14 26.44C14 21.4013 17.905 16 23.7167 16C27.0533 16 29.235 17.6494 30.5 19.0994C31.765 17.6494 33.9467 16 37.2833 16Z" fill="white"/>
          </svg>
        {/if}
      </button>
    {/if}
  </div>

  <!-- 텍스트 영역 -->
  <div class="pc-info">
    {#if cardKeywords.length > 0}
      <CardKeywordChips keywords={cardKeywords} />
    {/if}
    {#if category && showCategory}
      <p class="pc-category">{category}</p>
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

    <p class="pc-name">{name}</p>

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
      {#if iconBadges.length > 0}
        <span class="pc-badges">
          {#each iconBadges as b (`${b.badge_id}:${b.template_id}`)}
            <BadgeChip kind={b.kind} svg_url={b.svg_url} text={b.text} bg_color={b.bg_color} text_color={b.text_color} size={badgeSize ?? 16} />
          {/each}
        </span>
      {/if}
      {#if barBadges.length > 0}
        <span class="pc-badges-bar">
          {#each barBadges as b (`${b.badge_id}:${b.template_id}`)}
            <BadgeChip kind={b.kind} svg_url={b.svg_url} text={b.text} bg_color={b.bg_color} text_color={b.text_color} size={badgeSize ?? 16} />
          {/each}
        </span>
      {/if}
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
  .pc-badges {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    max-width: calc(100% - 16px);
    pointer-events: none;
  }
  /* 바(텍스트)형 배지 — 썸네일 하단 중앙, 가장자리 여백 10px */
  .pc-badges-bar {
    position: absolute;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 4px;
    max-width: calc(100% - 20px);
    pointer-events: none;
  }

  .pc-clip {
    position: absolute;
    top: 7px;
    right: 7px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: none;
    background: transparent; /* 2026-11-18: 원 배경이 아이콘 SVG 안에 포함(OFF #C1BBEC / ON 레드→퍼플 그라데이션) */
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    transition: background 0.18s, transform 0.18s, color 0.18s;
    padding: 0;
  }
  .pc-clip svg {
    width: 100%;
    height: 100%;
  }
  /* 호버는 마우스 환경에서만 — 터치 기기에서 누른 뒤 확대가 남아 있는 현상 방지 */
  @media (hover: hover) {
    .pc-clip:hover { transform: scale(1.1); }
  }
  /* 터치 순간(2026-11-18 강조): 크게 눌림(0.9→0.7) + 손을 떼면 팝(.pop)으로 튀어 오르며 정착 */
  .pc-clip { transition: transform 0.12s ease-out; -webkit-tap-highlight-color: transparent; }
  .pc-clip:active { transform: scale(0.7); }
  .pc-clip svg.pop { animation: pc-clip-pop 0.5s cubic-bezier(0.25, 0.1, 0.25, 1); }
  @keyframes pc-clip-pop {
    0%   { transform: scale(0.7); }
    35%  { transform: scale(1.55); }
    55%  { transform: scale(0.88); }
    75%  { transform: scale(1.12); }
    100% { transform: scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .pc-clip svg.pop { animation: none; }
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
    font: var(--text-m-num-18B);           /* 18px Black D-DIN — 2026-11-17(Stephen 지시) 16→18px 한 사이즈 크게. 아래 font-family·weight 는 기존 방식 유지 */
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
      width: 100%;
      height: 100%;
    }

    /* 카테고리/가격/상품명 간 여백 30% 축소(요청, 2026-09-27) — 20px(--spacing-5) → 14px */
    .pc-info   { gap: 14px; padding: 14px 0 0; }

    .pc-category   { font: var(--text-pc-script-12); font-weight: 700; color: var(--cs-text-light); line-height: 1; margin: 0; }
    .pc-price-row  { gap: 5px; }
    .pc-price-group{ gap: 5px; }
    .pc-price-row   { flex-wrap: nowrap; gap: 5px; letter-spacing: -0.5px; }
    .pc-price-label { font: var(--text-pc-body-14); font-weight: 700; line-height: 1; }     /* 14px Bold */
    /* 22px · 2026-11-13(Stephen 지시): PC 도 숫자 전용 폰트(D-DIN, 한글 대체 포함)·900(0.5px 외곽선) — 색 기존 유지. 2026-11-17(Stephen 지시): 크기 18→22px 한 사이즈 크게(--text-pc-hsub-22) */
    .pc-price-num   { font: var(--text-pc-hsub-22); font-family: 'D-DIN Exp', var(--font-kr-heading); font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; -webkit-text-stroke: 0.5px currentColor; }
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
  .pc-card--list .pc-clip svg { width: 100%; height: 100%; }
  /* 모바일 목록 요금 — 카드(썸네일) 폭에 비례해 글자 크기를 줄여 다음 줄로 넘어가지 않게 한다(2026-11-17, Stephen 지시).
     상품정보 영역(.pc-info)을 컨테이너로 삼아 cqw(컨테이너 폭 %)로 지정, 기존 고정 크기(숫자 18·라벨 11·구분 14px)는 상한으로 유지.
     비율 기준: 숫자 18px ↔ 6자리 숫자 두 개(예 100,000 / 100,000)가 한 줄에 들어가는 카드 폭 약 170px → 숫자 10.2cqw, 라벨·구분·간격은 같은 비율 */
  @media (max-width: 767px) {
    .pc-card--list .pc-info { container-type: inline-size; }
    /* 상품명 말줄임 없이 전부 표시(줄바꿈, 2026-11-18) */
    .pc-card--list .pc-name { white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; line-height: 1.3; }
    .pc-card--list .pc-price-row { flex-wrap: nowrap; gap: 1.7cqw; letter-spacing: -0.44cqw; }
    .pc-card--list .pc-price-group { gap: 1.7cqw; }
    .pc-card--list .pc-price-label { font-size: min(11px, 6.1cqw); }
    .pc-card--list .pc-price-num { font-size: min(18px, 10.2cqw); }
    .pc-card--list .pc-price-sep { font-size: min(14px, 7.9cqw); }
  }

  /* pick — /products MD 추천(.md-pick-card 이식): 가로 스크롤 트랙 안의 고정폭 카드 */
  .pc-card.pc-card--pick { width: 139px; color: inherit; }   /* PC 232px × 0.60 ≈ 139px */
  .pc-card--pick .pc-img-wrap { width: 100%; height: auto; aspect-ratio: 1 / 1; }
  .pc-card--pick .pc-img { position: absolute; inset: 0; }
  .pc-card--pick .pc-category { text-transform: uppercase; }   /* 기존 .mdp-category */
  /* MD 추천 카드(/products pick 139px·홈 pick-home 최대 174px)는 모바일 요금 숫자 16px 유지 — pick 은 18px 에서 Day/12H 가 한 줄에 안 들어가(실측 375px), 홈 pick-home 은 한 사이즈 작게(2026-11-17 Stephen 지시). PC(768px 이상)는 영향 없도록 모바일 범위만 */
  @media (max-width: 767px) {
    .pc-card--pick .pc-price-num,
    .pc-card--pick-home .pc-price-num { font: var(--text-m-body-16B); font-family: 'D-DIN Exp', var(--font-kr-heading); font-weight: 900; line-height: 1; }
  }
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
    /* 하이프팩 테마 목록 — 상품명을 말줄임 없이 전부 표시(줄바꿈, 2026-11-18) */
    .pc-card--fluid-mobile .pc-name { white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; line-height: 1.3; }
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
  .pc-card--scroll-s .pc-clip svg { width: 100%; height: 100%; }
  @media (min-width: 768px) {
    .pc-card.pc-card--scroll-s { width: 203px; }
    .pc-card--scroll-s .pc-img-wrap { width: 203px; height: 203px; border-radius: 23px 9px 23px 9px; }
    .pc-card--scroll-s .pc-clip { width: 31px; height: 31px; top: 10px; right: 10px; }
    .pc-card--scroll-s .pc-clip svg { width: 100%; height: 100%; }
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
