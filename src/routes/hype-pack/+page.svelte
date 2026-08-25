<script lang="ts">
  import BottomTabBar from '$lib/components/common/BottomTabBar.svelte'
  import HypePackBannerModal from '$lib/components/hype-pack/HypePackBannerModal.svelte'
  import HypePackThemeGroupModal from '$lib/components/hype-pack/HypePackThemeGroupModal.svelte'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  let activeModal = $state<'banner' | 'themeGroups' | null>(null)

  const KEYWORDS_FALLBACK = ['CANON 100mm', 'FeiyuTech SCORP Mini 2', 'FDR-AX43', 'Air 3S Drone']
  // Use CMS-managed keywords when set, else fallback
  const displayKeywords = $derived(
    data.banner.keywords.length > 0 ? data.banner.keywords : KEYWORDS_FALLBACK
  )

  // Compute the banner item to display (random or first)
  function getDisplayBannerItem() {
    const items = data.banner.items
    if (!items.length) return null
    if (data.banner.mode === 'random') return items[Math.floor(Math.random() * items.length)]
    return items[0]
  }
  const bannerItem = getDisplayBannerItem()
  const bannerHref = bannerItem ? `/products/${bannerItem.slug ?? bannerItem.product_id}` : null

  function formatWon(n: number): string {
    return `${n.toLocaleString('ko-KR')} 원`
  }

  interface DisplayTheme {
    id: string | null
    name: string
    img: string
    label: string
  }

  const PACK_THEMES_FALLBACK: DisplayTheme[] = [
    { id: null, name: 'Idol Pack',     label: '#7d2e55', img: '/hype-pack/d-pack-idol.png' },
    { id: null, name: 'Creator Pack',  label: '#fa373a', img: '/hype-pack/d-pack-creator-1.png' },
    { id: null, name: 'Activity Pack', label: '#00679f', img: '/hype-pack/d-pack-activity.png' },
    { id: null, name: 'Analog Pack',   label: '#9f6000', img: '/hype-pack/d-pack-analog.png' },
    { id: null, name: 'Traveler Pack', label: '#7b8215', img: '/hype-pack/d-pack-traveler.png' },
  ]

  // CMS 관리 테마그룹이 있으면 우선 사용, 비어있으면 기존 하드코딩 샘플로 폴백
  const displayThemeGroups = $derived<DisplayTheme[]>(
    data.themeGroups && data.themeGroups.length > 0
      ? data.themeGroups.map((g) => ({
          id:    g.id,
          name:  g.title,
          img:   g.image_url || '/hype-pack/d-pack-idol.png',
          label: '#100B32',
        }))
      : PACK_THEMES_FALLBACK
  )

  const SHOTLOG_POSTS = [
    { title: '휴대용 디자인으로 이동 중에도 미디어 카드에 쉽게 접근 가능',                  time: '2시간 전·by 유말자', img: '/hype-pack/m-post-1.png' },
    { title: 'onn. 52인치 삼각대, 컴팩트 카메라, 스마트폰 및 GoPro 액션 카메라용', time: '2시간 전·by 유말자', img: '/hype-pack/m-post-2.png' },
    { title: 'K-트레일로그를 남기는 멋진 일은 우리들에게 즐거움의 폭증이다!!',           time: '2시간 전·by 유말자', img: '/hype-pack/m-post-3.png' },
  ]

</script>

<!-- ─── MOBILE BODY ────────────────────────────────────────────────── -->
<div class="m-body">

  <!-- ScrollMenuBar: 추천 HypePack + 키워드 칩 -->
  <div class="m-scroll-menu">
    <div class="m-scroll-menu-top">
      <h2 class="m-section-title">추천 HypePack</h2>
      <button class="m-help-btn" aria-label="도움말">
        <!-- help icon: #FF3535 circle -->
        <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
          <path fill-rule="evenodd" clip-rule="evenodd"
            d="M15 0C6.716 0 0 6.716 0 15s6.716 15 15 15 15-6.716 15-15S23.284 0 15 0zm0 22a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0-16c2.76 0 5 2.24 5 5 0 2.17-1.39 4.04-3.34 4.73L16.5 17h-3v-1.5c0-.83.67-1.5 1.5-1.5 1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2h-3c0-2.76 2.24-5 5-5z"
            fill="#FF3535"/>
        </svg>
      </button>
    </div>
    <div class="m-chips-wrap">
      {#each displayKeywords as kw}
        <span class="m-chip">{kw}</span>
      {/each}
    </div>
  </div>

  <!-- 광고 배너 (AdPack, 모바일) -->
  <div class="m-ad-banner">
    {#if bannerHref}
      <a href={bannerHref} class="m-ad-banner-link" aria-label="{bannerItem?.name} 상품 상세로 이동">
        <img
          src={bannerItem?.mobile_image_url ?? '/hype-pack/d-ad-banner.png'}
          alt=""
          class="m-ad-banner-img"
          aria-hidden="true"
        />
        <div class="m-ad-banner-overlay" aria-hidden="true"></div>
        <div class="m-ad-banner-script">
          <p class="m-ad-banner-category">{bannerItem?.subtitle ?? 'Analog Pack'}</p>
          <h3 class="m-ad-banner-product">{bannerItem?.name ?? 'Sanyo Xacti CG10'}</h3>
          <p class="m-ad-banner-price">
            {bannerItem?.price24h ? `1 day / ${formatWon(bannerItem.price24h)}` : '1 day / 10,000 원'}
          </p>
          {#if bannerItem?.price12h}
            <p class="m-ad-banner-price">12H / {formatWon(bannerItem.price12h)}</p>
          {/if}
        </div>
      </a>
    {:else}
      <img src="/hype-pack/d-ad-banner.png" alt="" class="m-ad-banner-img" aria-hidden="true" />
      <div class="m-ad-banner-overlay" aria-hidden="true"></div>
      <div class="m-ad-banner-script">
        <p class="m-ad-banner-category">Analog Pack</p>
        <h3 class="m-ad-banner-product">Sanyo Xacti CG10</h3>
        <p class="m-ad-banner-price">1 day / 10,000 원</p>
      </div>
    {/if}
    {#if data.isCms}
      <button
        class="admin-edit-btn admin-banner-btn"
        onclick={() => { activeModal = 'banner' }}
        aria-label="배너 상품 설정"
      >⚙ 배너 설정</button>
    {/if}
  </div>

  <!-- Pack 테마목록 (모바일) -->
  <div class="m-pack-themes">
    <div class="theme-pick-head">
      <h2 class="m-pack-themes-title">Pack 테마목록</h2>
      {#if data.isCms}
        <button class="theme-cms-btn" onclick={() => { activeModal = 'themeGroups' }}>⚙ 테마그룹 관리</button>
      {/if}
    </div>
    <div class="m-pack-themes-list">
      {#each displayThemeGroups as pack}
        {#if pack.id}
          <a href="/hype-pack/theme/{pack.id}" class="m-pack-theme-card" aria-label="{pack.name} 팩">
            <img src={pack.img} alt={pack.name} class="m-pack-theme-img" />
            <div class="m-pack-theme-badge-wrap">
              <div class="m-pack-theme-badge" style="background-color: {pack.label}; opacity: 0.88;">
                <span class="m-pack-theme-name">{pack.name}</span>
              </div>
            </div>
          </a>
        {:else}
          <article class="m-pack-theme-card" aria-label="{pack.name} 팩">
            <img src={pack.img} alt={pack.name} class="m-pack-theme-img" />
            <div class="m-pack-theme-badge-wrap">
              <div class="m-pack-theme-badge" style="background-color: {pack.label}; opacity: 0.88;">
                <span class="m-pack-theme-name">{pack.name}</span>
              </div>
            </div>
          </article>
        {/if}
      {/each}
    </div>
  </div>

  <!-- SubView 섹션 (보라 배경) -->
  <div class="m-subview">
    <div class="m-subview-title-wrap">
      <h2 class="m-subview-title">
        <span class="m-subview-title-accent">강렬</span>하게 보기추천!
      </h2>
      <div class="m-section-bar" aria-hidden="true"></div>
      <p class="m-section-sub">대여 예약전에 참고하면 좋은 콘텐츠를 제안해요.</p>
    </div>

    <!-- Shotlog 포스트 카드 -->
    <div class="m-shotlog-posts">
      {#each SHOTLOG_POSTS as post}
        <article class="m-shotlog-post" aria-label={post.title}>
          <img src={post.img} alt="" class="m-shotlog-post-img" aria-hidden="true" />
          <div class="m-shotlog-post-writing">
            <p class="m-shotlog-post-title">{post.title}</p>
            <p class="m-shotlog-post-meta">{post.time}</p>
          </div>
        </article>
      {/each}
    </div>
  </div>

</div><!-- /m-body -->


<!-- ─── DESKTOP BODY ───────────────────────────────────────────────── -->
<div class="d-body">

  <!-- 추천 Package 섹션 -->
  <section class="d-section">
    <div class="d-section-inner">
      <div class="d-title-bar">
        <h2 class="d-section-title">추천 Package</h2>
      </div>
      <!-- 광고 배너 (AdPack) -->
      <div class="d-ad-banner">
        {#if bannerHref}
          <a href={bannerHref} class="d-ad-banner-link" aria-label="{bannerItem?.name} 상품 상세로 이동">
            <div class="d-ad-banner-bg" aria-hidden="true">
              <img
                src={bannerItem?.pc_image_url ?? '/hype-pack/d-ad-banner.png'}
                alt=""
                class="d-ad-banner-img"
                aria-hidden="true"
              />
            </div>
            <div class="d-ad-banner-script">
              <p class="d-ad-banner-category">{bannerItem?.subtitle ?? 'Analog Pack'}</p>
              <h3 class="d-ad-banner-product">{bannerItem?.name ?? 'Sanyo Xacti CG10'}</h3>
              <p class="d-ad-banner-price">
                {bannerItem?.price24h ? `1 day / ${formatWon(bannerItem.price24h)}` : '1 day / 10,000 원'}
              </p>
              {#if bannerItem?.price12h}
                <p class="d-ad-banner-price">12H / {formatWon(bannerItem.price12h)}</p>
              {/if}
            </div>
          </a>
        {:else}
          <div class="d-ad-banner-bg" aria-hidden="true">
            <img
              src="/hype-pack/d-ad-banner.png"
              alt=""
              class="d-ad-banner-img"
              aria-hidden="true"
            />
          </div>
          <div class="d-ad-banner-script">
            <p class="d-ad-banner-category">Analog Pack</p>
            <h3 class="d-ad-banner-product">Sanyo Xacti CG10</h3>
            <p class="d-ad-banner-price">1 day / 10,000 원</p>
          </div>
        {/if}
        {#if data.isCms}
          <button
            class="admin-edit-btn admin-banner-btn"
            onclick={() => { activeModal = 'banner' }}
            aria-label="배너 상품 설정"
          >⚙ 배너 설정</button>
        {/if}
      </div>
    </div>
  </section>

  <!-- Pack 테마목록 섹션 -->
  <section class="d-section">
    <div class="d-section-inner">
      <div class="d-title-bar theme-pick-head">
        <h2 class="d-section-title">Pack 테마목록</h2>
        {#if data.isCms}
          <button class="theme-cms-btn" onclick={() => { activeModal = 'themeGroups' }}>⚙ 테마그룹 관리</button>
        {/if}
      </div>
      <div class="d-pack-grid">
        {#each displayThemeGroups as pack}
          {#if pack.id}
            <a href="/hype-pack/theme/{pack.id}" class="d-pack-card" aria-label="{pack.name} 팩">
              <img src={pack.img} alt="" class="d-pack-card-bg" aria-hidden="true" />
              <div class="d-pack-card-label" style="background: {pack.label};">
                <span class="d-pack-card-label-text">{pack.name}</span>
              </div>
            </a>
          {:else}
            <article class="d-pack-card" aria-label="{pack.name} 팩">
              <img src={pack.img} alt="" class="d-pack-card-bg" aria-hidden="true" />
              <div class="d-pack-card-label" style="background: {pack.label};">
                <span class="d-pack-card-label-text">{pack.name}</span>
              </div>
            </article>
          {/if}
        {/each}
      </div>
    </div>
  </section>


</div><!-- /d-body -->

<BottomTabBar />

{#if data.isCms && activeModal === 'banner'}
  <HypePackBannerModal
    initialSettings={data.bannerRaw}
    packageCategoryKey={data.packageCategoryKey}
    onclose={() => { activeModal = null }}
  />
{:else if data.isCms && activeModal === 'themeGroups'}
  <HypePackThemeGroupModal
    groups={data.themeGroups}
    packageCategoryKey={data.packageCategoryKey}
    onclose={() => { activeModal = null }}
  />
{/if}

<style>

  /* ═══════════════════════════════════════════════════════════
     MOBILE LAYOUT  (≤767px)
  ═══════════════════════════════════════════════════════════ */

  .m-body { display: none; }

  @media (max-width: 767px) {
    .m-body  { display: block; }
    .d-body  { display: none; }
  }

  /* 모바일 바디 전체 */
  .m-body {
    background: var(--cs-lilac);
    padding-top: 87px;
    overflow-x: hidden;
  }

  /* ── ScrollMenuBar ── */
  .m-scroll-menu {
    padding: 20px 25px 0;
  }
  .m-scroll-menu-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 15px;
  }
  .m-section-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 21px;
    font-weight: 700;
    color: var(--cs-text);
    margin: 0;
    letter-spacing: -0.3px;
    line-height: 1.6;
  }
  .m-help-btn {
    display: flex; align-items: center; justify-content: center;
    min-width: 44px; min-height: 44px;
    background: none; border: none; cursor: pointer; padding: 0; flex-shrink: 0;
  }
  .m-chips-wrap { display: flex; flex-wrap: wrap; gap: 10px; }
  .m-chip {
    display: inline-flex; align-items: center;
    background: var(--cs-purple-op10);
    border-radius: 13px;
    padding: 8px 25px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 500;
    color: var(--cs-text-dark);
    white-space: nowrap;
    letter-spacing: -0.5px;
  }

  /* ── 광고 배너 (m-ad-banner) ── */
  .m-ad-banner {
    position: relative;
    width: calc(100% - 50px);
    height: 460px;
    margin: 24px auto 0;
    border-radius: var(--radius-2xl);
    overflow: hidden;
    background: linear-gradient(99.5deg, rgb(213,199,148) 1.5%, rgb(255,254,240) 98%);
  }
  .m-ad-banner-link { display: block; width: 100%; height: 100%; }
  .m-ad-banner-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
  .m-ad-banner-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(16,11,50,0) 40%, rgba(16,11,50,0.55) 100%);
    pointer-events: none;
  }
  .m-ad-banner-script {
    position: absolute;
    left: 20px;
    bottom: 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .m-ad-banner-category {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 14px;
    color: rgba(255,255,255,0.85);
    margin: 0;
    letter-spacing: -0.3px;
  }
  .m-ad-banner-product {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 24px;
    color: var(--cs-white);
    margin: 0;
    line-height: 1.3;
  }
  .m-ad-banner-price {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 18px;
    color: var(--cs-white);
    margin: 0;
    white-space: nowrap;
  }

  /* ── 섹션 공통: 그라데이션 바 + 서브타이틀 ── */
  .m-section-bar {
    width: 40px;
    height: 8px;
    border-radius: 20px;
    background: linear-gradient(90deg, #FF3535 0%, #3B2F8A 40.865%);
    margin: 15px auto;
  }
  .m-section-sub {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-text-mid);
    margin: 0;
    text-align: center;
    letter-spacing: -0.5px;
    line-height: 2;
  }

  /* ── Pack 테마목록 (모바일 전용) ── */
  .m-pack-themes {
    background: var(--cs-lilac);
    padding: 50px 25px 60px;
  }
  .m-pack-themes .theme-pick-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 0 0 25px;
  }
  .m-pack-themes .theme-pick-head .m-pack-themes-title { margin: 0; }
  .m-pack-themes-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 21px;
    font-weight: 700;
    color: var(--cs-text);
    margin: 0 0 25px;
    letter-spacing: -0.3px;
    line-height: 1.6;
  }
  .m-pack-themes-list {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }
  .m-pack-theme-card {
    display: block;
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: 20px; /* --radius-lg */
    overflow: hidden;
    cursor: pointer;
    text-decoration: none;
  }
  .m-pack-theme-img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
    transition: transform 0.3s ease-out;
  }
  .m-pack-theme-card:hover .m-pack-theme-img { transform: scale(1.05); }
  .m-pack-theme-badge-wrap {
    position: absolute;
    bottom: 16px;
    left: 16px;
  }
  .m-pack-theme-badge {
    padding: 7px 18px;
    border-radius: 9999px;
  }
  .m-pack-theme-name {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 15px;
    color: var(--cs-white);
    line-height: 1.3;
    white-space: nowrap;
  }

  /* ── SubView 섹션 ── */
  .m-subview {
    background: var(--cs-purple-op10); /* #E1DEF3 */
    border-radius: 0 50px 0 0;
    padding: 70px 25px 100px;
  }
  .m-subview-title-wrap {
    text-align: center;
    margin-bottom: 50px;
  }
  .m-subview-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 24px;
    font-weight: 500; /* Medium — Figma: font-medium */
    color: var(--cs-text);
    margin: 0;
    letter-spacing: -0.5px;
    line-height: 1.6;
    display: inline-block;
  }
  .m-subview-title-accent {
    color: var(--cs-red); /* #CF0000 — Figma: #cf0000 */
  }

  /* ── Shotlog 포스트 카드 ── */
  .m-shotlog-posts {
    display: flex;
    flex-direction: column;
    gap: 50px;
    max-width: 340px;
  }
  .m-shotlog-post {
    background: var(--cs-white);
    border-radius: var(--radius-xl); /* 30px — Figma: rounded-[30px] */
    overflow: hidden;
  }
  .m-shotlog-post-img {
    display: block;
    height: 150px;
    width: 100%;
    object-fit: cover;
  }
  .m-shotlog-post-writing {
    padding: 20px 30px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .m-shotlog-post-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: var(--cs-text-dark);
    margin: 0;
    letter-spacing: -0.3px;
    line-height: 1.6;
  }
  .m-shotlog-post-meta {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: var(--cs-text-mid);
    margin: 0;
    letter-spacing: -0.5px;
    line-height: 1.6;
  }


  /* ═══════════════════════════════════════════════════════════
     DESKTOP LAYOUT  (≥768px)
  ═══════════════════════════════════════════════════════════ */

  .d-body { display: none; }
  @media (min-width: 768px) {
    .d-body {
      display: flex;
      flex-direction: column;
      gap: 80px;
    }
  }

  .d-body {
    padding-top: 170px;
    padding-bottom: 100px;
  }

  .d-section { width: 100%; }
  .d-section-inner {
    max-width: 1240px;
    margin: 0 auto;
    padding: 0 20px;
    display: flex;
    flex-direction: column;
    gap: 30px;
  }

  .d-title-bar {
    padding: 20px 40px;
    max-width: 1240px;
    border-radius: var(--radius-xl);
  }
  .d-title-bar.theme-pick-head {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }
  .d-title-bar.theme-pick-head .theme-cms-btn {
    position: absolute;
    right: 40px;
    top: 50%;
    transform: translateY(-50%);
  }
  .d-section-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 25px;
    font-weight: 900;
    color: var(--cs-text);
    margin: 0;
    letter-spacing: -0.5px;
    line-height: 2;
    text-align: center;
  }

  .d-ad-banner {
    position: relative;
    width: 100%;
    height: 450px;
    border-radius: var(--radius-2xl);
    overflow: hidden;
    background: linear-gradient(99.5deg, rgb(213,199,148) 1.5%, rgb(255,254,240) 98%);
  }
  .d-ad-banner-link { display: block; width: 100%; height: 100%; }
  .d-ad-banner-bg { position: absolute; inset: 0; }
  .d-ad-banner-img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
  .d-ad-banner-script {
    position: absolute;
    right: 70px;
    bottom: 50px;
    text-align: right;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .d-ad-banner-category {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 20px;
    color: var(--cs-text-mid);
    text-align: right;
    margin: 0;
    letter-spacing: -0.5px;
    line-height: 1.6;
  }
  .d-ad-banner-product {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 35px;
    color: var(--cs-text);
    text-align: right;
    margin: 0;
    line-height: 1.3;
  }
  .d-ad-banner-price {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 35px;
    color: var(--cs-purple-light);
    text-align: right;
    margin: 0;
    white-space: nowrap;
    line-height: 1.3;
  }

  .d-pack-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 50px;
  }
  .d-pack-card {
    display: block;
    position: relative;
    height: 520px;
    border-radius: var(--radius-2xl);
    overflow: hidden;
    cursor: pointer;
    text-decoration: none;
  }
  .d-pack-card-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
    transition: transform 0.3s ease;
  }
  .d-pack-card:hover .d-pack-card-bg { transform: scale(1.03); }
  .d-pack-card-label {
    position: absolute;
    bottom: 55px;
    left: 55px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 65px;
    width: 270px;
    border-radius: var(--radius-2xl);
    border: 1px solid rgba(255,255,255,0.7);
    opacity: 0.8;
  }
  .d-pack-card-label-text {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 32px;
    color: var(--cs-white);
    text-align: center;
    line-height: 1.3;
  }

  /* 1025~1239px: 3열 카드 폭이 레이블(325px)보다 좁아지는 구간 → 2열로 전환 */
  @media (min-width: 1025px) and (max-width: 1239px) {
    .d-pack-grid { grid-template-columns: repeat(2, 1fr); gap: 30px; }
    .d-pack-card-label { left: 30px; }
  }

  /* 태블릿 반응형 */
  @media (min-width: 768px) and (max-width: 1024px) {
    .d-pack-grid { grid-template-columns: repeat(2, 1fr); gap: 30px; }
    .d-pack-card-label { left: 30px; }
    .d-ad-banner-product, .d-ad-banner-price { font-size: 28px; }
  }

  /* 관리자 배너 편집 버튼 */
  .admin-edit-btn {
    position: absolute;
    z-index: 10;
    background: rgba(16, 11, 50, 0.75);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: var(--radius-md, 15px);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    line-height: 1;
    backdrop-filter: blur(4px);
    transition: background 0.15s;
  }
  .admin-edit-btn:hover { background: rgba(59, 47, 138, 0.9); }
  .admin-banner-btn {
    top: 16px;
    right: 16px;
    padding: 8px 14px;
  }

  /* 관리자 테마그룹 관리 버튼 — admin-edit-btn과 동일 톤(비-absolute, 인라인 배치) */
  .theme-cms-btn {
    z-index: 10;
    background: rgba(16, 11, 50, 0.75);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: var(--radius-md, 15px);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    line-height: 1;
    padding: 8px 14px;
    backdrop-filter: blur(4px);
    transition: background 0.15s;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .theme-cms-btn:hover { background: rgba(59, 47, 138, 0.9); }

</style>
