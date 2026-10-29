<script module lang="ts">
  /** 가로 스크롤 위치 → 이미지 번호(한 장 폭 단위 반올림, 처음·끝으로 고정). 폭·개수가 비정상이면 0 */
  export function slideIndexFromScroll(scrollLeft: number, width: number, count: number): number {
    if (!Number.isFinite(scrollLeft) || !Number.isFinite(width) || width <= 0 || count <= 0) return 0
    return Math.min(count - 1, Math.max(0, Math.round(scrollLeft / width)))
  }
</script>

<script lang="ts">
  import { goto } from '$app/navigation'
  import SubGnb from '$lib/components/common/SubGnb.svelte'

  interface DisplayCategory {
    id: string;
    code: string;
    name: string;
    sort_order: number;
    icon_url: string | null;
    icon_active_url?: string | null;
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

  // 모바일 좌우 스와이프 — 점을 눌러 이동하는 동안(programmaticTarget)에는 지나가는 칸 때문에 점이 깜빡이지 않게 스크롤 반영을 멈춘다
  // 1×1 투명 GIF — 첫 슬라이드 <picture>의 대체 이미지(모바일이 아닐 때 네트워크 요청 없이 자리만 채움)
  const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  // 모바일 '이미지 전체 보기' — 기본은 cover(꽉 채움), 켜면 세로 800px는 유지한 채 이미지를 줄여 전체를 보여준다(모든 이미지 공통)
  let fitAll = $state(false);

  let track = $state<HTMLElement | null>(null);
  let programmaticTarget: number | null = null;

  function onTrackScroll() {
    if (!track) return;
    const idx = slideIndexFromScroll(track.scrollLeft, track.clientWidth, imageUrls.length);
    if (programmaticTarget !== null) {
      if (idx === programmaticTarget) programmaticTarget = null;
      return;
    }
    if (idx !== activeThumb) activeThumb = idx;
  }

  // 사용자가 손으로 트랙을 잡으면 점 이동 중 보호를 풀고 곧바로 스와이프를 따라간다
  $effect(() => {
    if (!track) return;
    const el = track;
    const release = () => { programmaticTarget = null; };
    el.addEventListener('pointerdown', release, { passive: true });
    return () => el.removeEventListener('pointerdown', release);
  });

  // 점·썸네일로 활성 이미지가 바뀌면 트랙도 그 위치로(이미 그 위치면 건드리지 않음)
  $effect(() => {
    const target = activeThumb;
    if (!track || !track.clientWidth) return;
    if (slideIndexFromScroll(track.scrollLeft, track.clientWidth, imageUrls.length) === target) return;
    programmaticTarget = target;
    track.scrollTo({ left: target * track.clientWidth, behavior: 'smooth' });
  });

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

  <!-- 모바일(≤640px) 좌우 스와이프 트랙 — PC는 위 hero-bg + 썸네일 -->
  <div class="hero-track" class:fit-all={fitAll} bind:this={track} onscroll={onTrackScroll}>
    {#each imageUrls as _, i}
      <div class="hero-slide">
        {#if i === 0}
          <!-- 첫 장은 즉시 로딩이 필요한 모바일에서만 요청 — PC는 숨겨진 트랙이 hero-bg와 같은 이미지를 한 번 더 받지 않도록 조건부 소스 + 투명 대체 이미지 -->
          <picture>
            <source media="(max-width: 640px)" srcset={getBgImage(0)} />
            <img src={TRANSPARENT_PIXEL} alt="{productName} 이미지 {i + 1}" draggable="false" />
          </picture>
        {:else}
          <img src={getBgImage(i)} alt="{productName} 이미지 {i + 1}" loading="lazy" draggable="false" />
        {/if}
      </div>
    {/each}
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
        <span class="sub-gnb-b-title sub-gnb-b-title--kr">{displayCategoryLabel}</span>
      </button>

      <div class="sub-gnb-b-cats">
        {#each iconCategories as cat (cat.id)}
          <button
            class="sub-gnb-b-cat-btn"
            class:has-on={!!cat.icon_active_url}
            class:active={cat.id === category}
            title={cat.name}
            type="button"
            onclick={() => goto(`/products?category=${cat.id}`)}
          >
            <img class="sub-gnb-b-cat-icon sub-gnb-b-cat-icon-off" src={cat.icon_url} alt={cat.name} />
            {#if cat.icon_active_url}
              <!-- ON 이미지(호버·현재 카테고리 공용, 상자 배경 포함 SVG) — /products 카테고리 메뉴와 동일 설정 공유 -->
              <img class="sub-gnb-b-cat-icon sub-gnb-b-cat-icon-on" src={cat.icon_active_url} alt="" aria-hidden="true" />
            {/if}
          </button>
        {/each}
      </div>
    </div>
  </header>

  <!-- Bottom: Mobile dots / PC thumbnails -->
  <div class="hero-bottom">
    <!-- 모바일 이미지 전체 보기 전환 — 아이콘은 이미지 뷰어(MediaViewer) '크기 맞춤' 버튼과 동일 -->
    {#if imageUrls.length > 0}
      <button
        type="button"
        class="fit-toggle"
        class:active={fitAll}
        onclick={() => (fitAll = !fitAll)}
        aria-label={fitAll ? '이미지 꽉 채워 보기' : '이미지 전체 보기'}
        title={fitAll ? '이미지 꽉 채워 보기' : '이미지 전체 보기'}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          {#if fitAll}
            <!-- 줄어든 상태 — 누르면 다시 꽉 채우므로 이미지 뷰어 '크기 맞춤' 아이콘(화살촉 바깥쪽) -->
            <path d="M10.5 3H15v4.5M7.5 15H3v-4.5M15 3l-4.8 4.8M3 15l4.8-4.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          {:else}
            <!-- 꽉 찬 상태 — 누르면 줄여서 전체를 보여주므로 반전 형태(화살촉 안쪽) -->
            <path d="M15 7.5h-4.5V3M3 10.5h4.5V15M10.5 7.5L15 3M7.5 10.5L3 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          {/if}
        </svg>
      </button>
    {/if}

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

  /* 모바일 좌우 스와이프 트랙 — 한 장씩 멈춤(스냅), 이미지는 기존과 동일하게 cover·세로 800px 유지 */
  .hero-track {
    display: none;
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x mandatory;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    background: var(--cs-purple-op10);
  }
  .hero-track::-webkit-scrollbar { display: none; }
  .hero-slide {
    flex: 0 0 100%;
    height: 100%;
    scroll-snap-align: center;
    scroll-snap-stop: always;
    background: var(--cs-purple-op10);
  }
  .hero-slide picture { display: contents; }
  .hero-slide img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center 20%;
  }
  /* 전체 보기 — 세로 800px는 그대로, 이미지를 영역 안에 전부 들어오도록 가운데에 맞춤(남는 곳은 슬라이드 배경색) */
  .hero-track.fit-all .hero-slide img {
    object-fit: contain;
    object-position: center;
  }
  @media (max-width: 640px) {
    .hero-track { display: flex; }
    /* 트랙이 이미지를 그리므로 모바일에서는 단일 배경을 숨김(PC는 그대로 사용) */
    .hero-bg { display: none; }
    /* 하단 영역이 화면 폭 전체를 덮어 스와이프를 막지 않도록 — 점 버튼만 눌림 */
    .hero-bottom { pointer-events: none; }
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

  /* pill — §13-2 sub-gnb_navi_b 축소 규격(cart 정본). 카테고리 행(.sub-gnb-b-cats)은 navi_c 전용 */
  .sub-gnb-b-pill {
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
    max-width: 460px;
    min-width: 0;
    min-height: 43px;
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
    width: 11px;
    height: 9px;
    flex-shrink: 0;
  }

  .sub-gnb-b-back {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    white-space: nowrap;
  }

  .sub-gnb-b-title {
    font: var(--text-pc-menu-en-20);
    font-size: 18px;
    color: var(--cs-text);
    flex-shrink: 0;
    white-space: nowrap;
  }
  .sub-gnb-b-title--kr {
    font: var(--text-pc-menu-kr-20);
    font-size: 18px;
  }

  @media (max-width: 1024px) {
    .sub-gnb-b-inner {
      padding: 16px var(--layout-tab-pad);
      gap: 20px;
    }
    .sub-gnb-b-pill {
      padding: 14px 28px;
      min-height: 56px;
    }
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
  /* ON 이미지가 있는 카테고리: 상자 배경 대신 OFF/ON 이미지 교차 전환 */
  .sub-gnb-b-cat-btn.has-on { position: relative; background: transparent; }
  .sub-gnb-b-cat-btn.has-on:hover { background: transparent; }
  .sub-gnb-b-cat-btn.has-on .sub-gnb-b-cat-icon { position: absolute; inset: 0; width: 100%; height: 100%; transition: opacity 0.25s ease; }
  .sub-gnb-b-cat-btn.has-on .sub-gnb-b-cat-icon-on { opacity: 0; }
  .sub-gnb-b-cat-btn.has-on:hover .sub-gnb-b-cat-icon-on,
  .sub-gnb-b-cat-btn.has-on.active .sub-gnb-b-cat-icon-on { opacity: 1; }
  .sub-gnb-b-cat-btn.has-on:hover .sub-gnb-b-cat-icon-off,
  .sub-gnb-b-cat-btn.has-on.active .sub-gnb-b-cat-icon-off { opacity: 0; }

  /* Bottom */
  .hero-bottom {
    position: relative;
    z-index: 10;
    margin-top: auto;
  }

  /* 이미지 전체 보기 전환(모바일 전용) — 이미지 뷰어 .mv-btn 크기·아이콘(44px 원형) + 하단 점과 같은 반투명 흰 면(30%, 켜짐도 동일 — 켜짐은 아이콘 색만 어둡게), hover는 배경색만 */
  .fit-toggle {
    position: absolute;
    left: 25px;
    bottom: 20px;
    width: 44px;
    height: 44px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(255,255,255,0.3);
    color: var(--cs-white);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
    transition: background 0.12s, color 0.12s;
  }
  .fit-toggle:hover { background: rgba(255,255,255,0.5); }
  .fit-toggle.active { color: var(--cs-text-mid); }
  @media (min-width: 641px) { .fit-toggle { display: none; } }

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
    pointer-events: auto;
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
