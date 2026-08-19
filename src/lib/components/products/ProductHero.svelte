<script lang="ts">
  import { goto } from '$app/navigation'
  import SubGnb from '$lib/components/common/SubGnb.svelte'

  interface DisplayCategory {
    id: string;
    code: string;
    name: string;
    sort_order: number;
    icon_url: string | null;
  }

  interface Props {
    imageUrls?: string[];
    category?: string;
    categoryLabel?: string | null;
    productName?: string;
    categories?: DisplayCategory[];
  }

  let { imageUrls = [], category = 'camera', categoryLabel = null, productName = '', categories = [] }: Props = $props();

  // /products "카테고리 설정"과 동일 정본(icon_url 있는 항목만 아이콘 행에 노출 — 아이콘 없는
  // 카테고리는 /products에서도 텍스트 라벨만 보이지만, 이 컴포넌트는 아이콘 전용 레이아웃이라
  // 아이콘 없는 항목은 표시하지 않는다)
  const iconCategories = $derived(categories.filter((c) => c.icon_url));

  let activeThumb = $state(0);

  function getCloudinaryUrl(publicId: string, w: number, h: number): string {
    return `https://res.cloudinary.com/crazyshot/image/upload/w_${w},h_${h},c_fill,f_auto,q_auto/${publicId}.jpg`;
  }

  function getBgImage(idx: number): string {
    if (!imageUrls[idx]) return '';
    if (imageUrls[idx].startsWith('/') || imageUrls[idx].startsWith('blob:')) return imageUrls[idx];
    if (imageUrls[idx].startsWith('http')) return imageUrls[idx];
    return getCloudinaryUrl(imageUrls[idx], 1240, 1000);
  }

  function isLocalPath(url: string): boolean {
    return url.startsWith('/') || url.startsWith('blob:');
  }

  // BUG-FIX(2026-08-10): 하드코딩 영문 맵(CATEGORY_MAP) 제거 — 백오피스에서 설정된
  // 라벨(부모가 조회해 categoryLabel prop으로 전달)을 그대로 쓰고, 없으면 원본 코드값 표시
  const displayCategoryLabel = $derived(categoryLabel ?? category);

  function goBack() {
    if (history.length > 1) {
      history.back();
    } else {
      goto('/products');
    }
  }
</script>

<div class="hero-wrap">
  <!-- Background image -->
  <div class="hero-bg" style={(!imageUrls[activeThumb] || !isLocalPath(imageUrls[activeThumb])) ? (imageUrls[activeThumb] ? `background-image: url('${getBgImage(activeThumb)}')` : '') : ''}>
    {#if imageUrls[activeThumb] && isLocalPath(imageUrls[activeThumb])}
      <img
        src={imageUrls[activeThumb]}
        alt=""
        class="hero-bg-img"
      />
    {/if}
  </div>

  <!-- GNB: Mobile floating pill -->
  <SubGnb title={displayCategoryLabel} floating />

  <!-- GNB: PC — sub-gnb_navi_c (상품상세정보 전용 GNB, sub-gnb_navi_b와 동일 CSS) -->
  <header class="sub-gnb-b">
    <div class="sub-gnb-b-inner">
      <button type="button" class="sub-gnb-b-pill" onclick={goBack} aria-label="뒤로 가기">
        <div class="sub-gnb-b-pill-left">
          <svg class="sub-gnb-b-arrow" viewBox="0 0 21.3844 17.1421" fill="none" aria-hidden="true">
            <path d="M19.8844 8.5707L1.5 8.57107M8.57107 1.5L1.5 8.57107L8.57107 15.6421" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/>
          </svg>
          <span class="sub-gnb-b-back">Back</span>
        </div>
        <span class="sub-gnb-b-title">{displayCategoryLabel}</span>
      </button>

      <div class="sub-gnb-b-cats">
        {#each iconCategories as cat (cat.id)}
          <button
            class="sub-gnb-b-cat-btn"
            title={cat.name}
            type="button"
            onclick={() => goto(`/products?category=${cat.id}`)}
          >
            <img class="sub-gnb-b-cat-icon" src={cat.icon_url} alt={cat.name} />
          </button>
        {/each}
      </div>
    </div>
  </header>

  <!-- Bottom: Mobile dots / PC thumbnails -->
  <div class="hero-bottom">
    <!-- Mobile dot indicator -->
    {#if imageUrls.length > 0}
      <div class="dots-mobile">
        {#each imageUrls as _, i}
          <button
            class="dot"
            class:dot-active={i === activeThumb}
            onclick={() => activeThumb = i}
            aria-label="{i+1}번째 이미지"
          ></button>
        {/each}
      </div>
    {/if}

    <!-- PC thumbnail strip -->
    {#if imageUrls.length > 0}
      <div class="thumbs-pc">
        {#each imageUrls as url, i}
          <button
            class="thumb"
            class:thumb-active={i === activeThumb}
            onclick={() => activeThumb = i}
            aria-label="{i+1}번째 이미지"
          >
            <img
              src={url.startsWith('http') ? url : getCloudinaryUrl(url, 140, 140)}
              alt="{productName} 이미지 {i+1}"
              loading="lazy"
            />
            <div class="thumb-overlay"></div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .hero-wrap {
    position: relative;
    height: 800px;
    width: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  @media (min-width: 641px) {
    .hero-wrap { height: 1000px; }
  }

  .hero-bg {
    position: absolute;
    inset: 0;
    background-color: #e1def3;
    background-size: cover;
    background-position: center 20%;
    z-index: 0;
    overflow: hidden;
  }
  .hero-bg-img {
    position: absolute;
    height: 101.41%;
    width: 208.02%;
    left: -63.03%;
    top: -0.66%;
    max-width: none;
    object-fit: cover;
  }

  /* GNB Mobile */
  .gnb-mobile {
    position: relative;
    z-index: 10;
    padding: 40px 25px 0;
  }
  @media (min-width: 641px) { .gnb-mobile { display: none; } }

  .gnb-pill {
    background: var(--cs-lilac-nav);
    backdrop-filter: blur(8px);
    border-radius: var(--radius-lg);
    min-height: 60px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 20px;
  }
  .back-btn {
    min-width: 44px;
    min-height: 44px;
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .gnb-cat-label {
    font: var(--text-m-body-16B);
    color: var(--cs-text);
    text-align: center;
  }

  /* GNB PC — sub-gnb_navi_c (상품상세정보 전용 GNB, sub-gnb_navi_b와 동일 CSS) */
  .sub-gnb-b {
    position: sticky;
    top: 0;
    z-index: 50;
    background: transparent;
    border-bottom: none;
    display: none;
  }
  @media (min-width: 641px) {
    .sub-gnb-b { display: block; }
  }

  .sub-gnb-b-inner {
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

  .sub-gnb-b-pill {
    background: rgba(225, 222, 243, 0.4);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 40px;
    border-radius: 25px;
    width: 100%;
    max-width: 460px;
    min-width: 0;
    min-height: 62px;
    flex: 0 1 460px;
    box-sizing: border-box;
    color: var(--cs-text);
    transition: background 0.2s;
  }
  .sub-gnb-b-pill:hover { background: rgba(225, 222, 243, 0.85); }

  .sub-gnb-b-pill-left {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }

  .sub-gnb-b-arrow {
    width: 22px;
    height: 18px;
    flex-shrink: 0;
    color: var(--cs-text-light);
  }

  .sub-gnb-b-back {
    font: var(--text-pc-title-16);
    color: var(--cs-text-mid);
    white-space: nowrap;
  }

  .sub-gnb-b-title {
    font: var(--text-pc-menu-en-20);
    color: var(--cs-text-mid);
    flex-shrink: 0;
    white-space: nowrap;
  }

  .sub-gnb-b-cats {
    display: flex;
    flex-wrap: nowrap;
    gap: 30px;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  .sub-gnb-b-cat-btn {
    background: #E1DEF3;
    border: none;
    cursor: pointer;
    border-radius: 35px;
    width: 70px;
    height: 70px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
    transition: background 0.2s;
  }
  .sub-gnb-b-cat-btn:hover { background: #D0CCEB; }

  .sub-gnb-b-cat-icon {
    width: 72px;
    height: 72px;
    object-fit: contain;
  }

  /* Bottom */
  .hero-bottom {
    position: relative;
    z-index: 10;
    margin-top: auto;
  }

  /* Mobile dots */
  .dots-mobile {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  @media (min-width: 641px) { .dots-mobile { display: none; } }

  .dot {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dot::after {
    content: '';
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(255,255,255,0.3);
    display: block;
  }
  .dot-active::after { background: rgba(255,255,255,0.9); width: 30px; border-radius: 15px; }

  /* PC thumbnails */
  .thumbs-pc {
    display: none;
    gap: 30px;
    align-items: flex-end;
    justify-content: center;
    padding: 40px 35px 25px;
    width: 100%;
    max-width: var(--layout-pc-max);
    margin: 0 auto;
    box-sizing: border-box;
  }
  @media (min-width: 641px) { .thumbs-pc { display: flex; } }

  .thumb {
    position: relative;
    width: 70px;
    height: 70px;
    border-radius: var(--radius-lg);
    border: none;
    cursor: pointer;
    overflow: hidden;
    padding: 0;
    flex-shrink: 0;
  }
  .thumb img, .thumb-fallback {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: rgba(255,255,255,0.08);
  }
  .thumb-fallback { background: var(--cs-purple-op10); }
  .thumb-overlay {
    position: absolute;
    inset: 0;
    background: rgba(29,24,62,0.5);
    border-radius: var(--radius-lg);
    transition: opacity 0.15s;
  }
  .thumb-active .thumb-overlay { opacity: 0; }
</style>
