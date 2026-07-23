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
    href?: string
    wished?: boolean
    onWishToggle?: (id: string | undefined) => void
  }

  let {
    id,
    name,
    category = '',
    imageUrl,
    price24h = null,
    price12h = null,
    href,
    wished = false,
    onWishToggle,
  }: Props = $props()

  let isWished = $state(false)
  $effect(() => { isWished = wished })

  function handleWish(e: MouseEvent) {
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pc-card"
  onclick={handleClick}
  onkeydown={(e) => { if (e.key === 'Enter') handleClick() }}
  role="button"
  tabindex="0"
  aria-label={name}
>
  <!-- 이미지 영역 290×290 -->
  <div class="pc-img-wrap">
    <img src={imageUrl} alt={name} class="pc-img" />

    {#if onWishToggle !== undefined}
      <button
        class="pc-heart"
        class:active={isWished}
        onclick={handleWish}
        aria-label={isWished ? '찜 해제' : '찜하기'}
        aria-pressed={isWished}
      >
        <svg width="16" height="14" viewBox="0 0 16 14" fill="none" aria-hidden="true">
          <path
            d="M8 13S1 8.5 1 4.5C1 2.57 2.57 1 4.5 1c1.05 0 2 .5 2.7 1.29L8 3.5l.8-.21C9.5 1.5 10.45 1 11.5 1 13.43 1 15 2.57 15 4.5 15 8.5 8 13 8 13z"
            stroke="currentColor"
            stroke-width="1.6"
          />
        </svg>
      </button>
    {/if}
  </div>

  <!-- 텍스트 영역 -->
  <div class="pc-info">
    {#if category}
      <p class="pc-category">{category}</p>
    {/if}

    {#if price24h !== null || price12h !== null}
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
  </div>
</div>

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
    border-radius: 18px;
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

  .pc-heart {
    position: absolute;
    top: 7px;
    right: 7px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: none;
    background: rgba(236, 235, 244, 0.75);
    backdrop-filter: blur(6px);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--cs-purple);
    transition: background 0.18s, transform 0.18s, color 0.18s;
    padding: 0;
  }
  .pc-heart svg {
    width: 10px;
    height: 9px;
  }
  .pc-heart:hover {
    background: rgba(255, 53, 53, 0.15);
    transform: scale(1.1);
  }
  .pc-heart.active {
    background: rgba(255, 53, 53, 0.18);
    color: #FF3535;
  }
  .pc-heart.active svg path {
    fill: #FF3535;
    stroke: #FF3535;
  }
  .pc-heart:active {
    transform: scale(0.9);
  }

  .pc-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--spacing-3);
    padding: var(--spacing-3) 0 0;
    width: 100%;
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
    align-items: center;
    gap: 3px;
    color: var(--cs-text);
    letter-spacing: -0.5px;
    flex-wrap: wrap;
  }
  .pc-price-group {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .pc-price-label {
    font: var(--text-m-script-14B);        /* 14px Bold */
    line-height: 1;
  }
  .pc-price-num {
    font: var(--text-m-body-16B);          /* 16px Bold → Black 오버라이드 */
    font-weight: 900;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .pc-price-sep {
    font: var(--text-m-script-14B);        /* 14px Bold */
    line-height: 1;
  }

  .pc-name {
    font: var(--text-m-script-14B);        /* 14px Bold */
    color: var(--cs-text-mid);
    letter-spacing: -0.5px;
    line-height: 1;
    margin: 0;
  }

  /* ━━━ PC (290px = Figma 정본) ━━━ */
  @media (min-width: 768px) {
    .pc-card     { width: 290px; }

    .pc-img-wrap {
      width: 290px;
      height: 290px;
      border-radius: 30px;
    }

    .pc-heart {
      top: 12px;
      right: 12px;
      width: 36px;
      height: 36px;
    }
    .pc-heart svg {
      width: 16px;
      height: 14px;
    }

    .pc-info   { gap: var(--spacing-5); padding: var(--spacing-5) 0 0; }

    .pc-category   { font: var(--text-pc-script-12); font-weight: 700; color: var(--cs-text-light); line-height: 1; margin: 0; }
    .pc-price-row  { gap: 5px; }
    .pc-price-group{ gap: 5px; }
    .pc-price-row   { flex-wrap: nowrap; gap: 5px; }
    .pc-price-label { font: var(--text-pc-body-14); line-height: 1; }     /* 14px Bold */
    .pc-price-num   { font: var(--text-pc-title-18); font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; } /* 18px Bold */
    .pc-price-sep   { font: var(--text-pc-body-14); line-height: 1; }     /* 14px Bold */
    .pc-name        { font: var(--text-pc-body-14); letter-spacing: -0.5px; line-height: 1; margin: 0; }
  }
</style>
