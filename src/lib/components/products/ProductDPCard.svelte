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
    <img src={imageUrl} alt={name} loading="lazy" class="pc-img" />

    {#if onWishToggle !== undefined && isWished}
      <button
        class="pc-clip active"
        onclick={handleWish}
        aria-label="찜 해제"
        aria-pressed="true"
      >
        <svg width="34" height="34" viewBox="0 0 63 63" fill="none" aria-hidden="true">
          <path d="M31.3184 17.7266C34.3143 14.7584 39.1662 14.7584 42.1621 17.7266C45.1654 20.7024 45.1656 25.5331 42.1621 28.5088L29.5205 41.0322C27.7302 42.8059 24.8332 42.8059 23.043 41.0322C21.2452 39.2508 21.245 36.3565 23.043 34.5752L34.5674 23.1582C35.1558 22.5752 36.1054 22.5796 36.6885 23.168C37.2715 23.7564 37.2671 24.706 36.6787 25.2891L25.1543 36.707C24.5414 37.3146 24.5413 38.2939 25.1543 38.9014C25.7753 39.5166 26.7882 39.5165 27.4092 38.9014L40.0508 26.377C41.8692 24.575 41.8692 21.6594 40.0508 19.8574C38.2241 18.0477 35.2563 18.0477 33.4297 19.8574L20.7686 32.4014C17.744 35.3979 17.744 40.2506 20.7686 43.2471C23.8008 46.251 28.7227 46.2511 31.7549 43.2471L44.9443 30.1797C45.5328 29.5967 46.4824 29.6011 47.0654 30.1895C47.6484 30.7779 47.644 31.7275 47.0557 32.3105L33.8662 45.3779C29.6647 49.5405 22.8588 49.5405 18.6572 45.3779C14.4479 41.2076 14.448 34.4408 18.6572 30.2705L31.3184 17.7266Z" fill="currentColor"/>
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
    background: rgba(255, 207, 207, 0.8); /* var(--cs-chat-in-bg) #FFCFCF 80% 투명도 */
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
    gap: var(--spacing-3);
    padding: var(--spacing-3) 0 0;
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
