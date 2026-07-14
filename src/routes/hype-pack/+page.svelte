<script lang="ts">
  let carouselEl: HTMLElement | null = null
  let carouselIdx = $state(0)

  function onCarouselScroll() {
    if (!carouselEl) return
    const idx = Math.round(carouselEl.scrollLeft / 340)
    carouselIdx = Math.max(0, Math.min(2, idx))
  }

  function scrollToCard(idx: number) {
    if (!carouselEl) return
    carouselEl.scrollTo({ left: idx * 340, behavior: 'smooth' })
  }

  const KEYWORDS = ['CANON 100mm', 'FeiyuTech SCORP Mini 2', 'FDR-AX43', 'Air 3S Drone']

  const CAROUSEL_CARDS = [
    {
      category: 'Fandom Ready',
      title: '소니 CAM FX3 패키지',
      price: '80,000 원 / 1일',
      img: '/hype-pack/m-carousel-1.png',
    },
    {
      category: 'Steps to Pro',
      title: '나는 프로 패키지 시리즈',
      price: '80,000 원 / 1일',
      img: '/hype-pack/m-carousel-2.png',
    },
    {
      category: 'Casual log',
      title: '소니 FX3 패키 시리즈',
      price: '80,000 원 / 1일',
      img: '/hype-pack/m-carousel-3.png',
    },
  ]

  const HOT_PACK_CARDS = [
    { title: 'DJI Drone 팩', category: 'Steps to Pro', price: '80,000 원 / 1일', icon: 'mem',  img: '/hype-pack/m-hotpack-a.png' },
    { title: 'DJI Drone 팩', category: 'Casual log',   price: '80,000 원 / 1일', icon: 'deal', img: '/hype-pack/m-hotpack-b.png' },
    { title: 'DJI Drone 팩', category: 'Steps to Pro', price: '80,000 원 / 1일', icon: 'mem',  img: '/hype-pack/m-hotpack-a.png' },
    { title: 'DJI Drone 팩', category: 'Casual log',   price: '80,000 원 / 1일', icon: 'deal', img: '/hype-pack/m-hotpack-b.png' },
    { title: 'DJI Drone 팩', category: 'Steps to Pro', price: '80,000 원 / 1일', icon: 'mem',  img: '/hype-pack/m-hotpack-a.png' },
  ]

  const PACK_THEMES = [
    { name: 'Idol Pack',     label: '#7d2e55', img: '/hype-pack/d-pack-idol.png' },
    { name: 'Creator Pack',  label: '#fa373a', img: '/hype-pack/d-pack-creator-1.png' },
    { name: 'Activity Pack', label: '#00679f', img: '/hype-pack/d-pack-activity.png' },
    { name: 'Analog Pack',   label: '#9f6000', img: '/hype-pack/d-pack-analog.png' },
    { name: 'Traveler Pack', label: '#7b8215', img: '/hype-pack/d-pack-traveler.png' },
  ]

  const KTLOG_CARDS = [
    { span: 'full',   height: 620, category: 'With a Pro',   icons: ['mem', 'deal'], title: 'Explore the Hot\nStreets of Hongdae', price: '$ 350 / 1w', img: '/hype-pack/d-ktlog-main.png' },
    { span: 'normal', height: 620, category: 'With a Pro',   icons: ['mem', 'deal'], title: 'Taste Jongro',                        price: '$ 100 / 1h', img: '/hype-pack/d-ktlog-jongro.png' },
    { span: 'normal', height: 620, category: 'Creator Pack', icons: ['deal'],        title: 'Walk in Bukchon',                     price: '$ 100 / 1h', img: '/hype-pack/d-ktlog-bukchon.png' },
    { span: 'normal', height: 620, category: 'With a Pro',   icons: ['mem', 'deal'], title: 'Yangyang Beach Sunset',               price: '$ 100 / 1h', img: '/hype-pack/d-ktlog-yangyang.png' },
    { span: 'normal', height: 620, category: 'Creator Pack', icons: ['mem'],         title: 'Gyeongbokgung\nHanbok Experience',    price: '$ 150 / 1h', img: '/hype-pack/d-ktlog-gyeongbok.png' },
    { span: 'wide',   height: 620, category: 'With a Pro',   icons: ['mem', 'deal'], title: 'K-Pop Fan Meet\n& Concert Journey',   price: '$ 100 / 1h', img: '/hype-pack/d-ktlog-kpop-bg.png' },
  ]

  const SHOTLOG_HEADS = [
    {
      title: 'Flash Deals',
      headerBg: 'var(--cs-purple)',
      img: '/hype-pack/m-flash-deals.png',
      cardTitle: '다양한 액셔냄 대잔치',
      subtitle: 'DJI, 오즈모, 인스타 모두 맛봅시다',
    },
    {
      title: 'Fan Vlog',
      headerBg: 'var(--cs-red)',
      img: '/hype-pack/m-fan-vlog.png',
      cardTitle: '양양의 기억 담기',
      subtitle: '동해 양양바다의 기억을 담은 브이로그',
    },
    {
      title: 'Release',
      headerBg: 'var(--cs-purple)',
      img: '/hype-pack/m-release.png',
      cardTitle: 'DJI Mini2se Aerial Drone',
      subtitle: '드론시장에서 품질은 없다.',
    },
  ]

  const SHOTLOG_POSTS = [
    { title: '휴대용 디자인으로 이동 중에도 미디어 카드에 쉽게 접근 가능',                  time: '2시간 전·by 유말자', img: '/hype-pack/m-post-1.png' },
    { title: 'onn. 52인치 삼각대, 컴팩트 카메라, 스마트폰 및 GoPro 액션 카메라용', time: '2시간 전·by 유말자', img: '/hype-pack/m-post-2.png' },
    { title: 'K-트레일로그를 남기는 멋진 일은 우리들에게 즐거움의 폭증이다!!',           time: '2시간 전·by 유말자', img: '/hype-pack/m-post-3.png' },
  ]

  $effect(() => {
    document.body.classList.add('hype-pack-page')
    return () => document.body.classList.remove('hype-pack-page')
  })
</script>

<svelte:head>
  <style>
    @media (max-width: 767px) {
      body.hype-pack-page .gnb-mobile-wrap { display: none !important; }
    }
  </style>
</svelte:head>

<!-- ─── MOBILE NAV ──────────────────────────────────────────────────── -->
<div class="m-nav-wrap">
  <nav class="m-nav">
    <a href="/" class="m-nav-logo" aria-label="CRAZYSHOT 홈">
      <img src="/logo-bi2.svg" alt="CRAZYSHOT" width="96" height="59" class="m-nav-logo-img" />
    </a>
    <a href="/auth/login" class="m-nav-avatar" aria-label="내 계정">
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <path d="M0 20C0 5 5 0 20 0C35 0 40 5 40 20C40 35 35 40 20 40C5 40 0 35 0 20Z" fill="#C1BBEC"/>
        <path d="M19.719 20.383C22.325 20.383 24.514 21.136 26.071 22.504C27.637 23.881 28.469 25.802 28.469 27.923C28.469 28.613 27.909 29.173 27.219 29.173C26.529 29.173 25.969 28.613 25.969 27.923C25.969 26.483 25.419 25.26 24.42 24.382C23.411 23.495 21.85 22.883 19.719 22.883C17.588 22.883 16.027 23.495 15.018 24.382C14.019 25.26 13.469 26.484 13.469 27.924C13.469 28.614 12.909 29.174 12.219 29.174C11.529 29.174 10.969 28.614 10.969 27.924C10.969 25.803 11.801 23.881 13.367 22.504C14.924 21.136 17.113 20.383 19.719 20.383ZM19.719 9.676C22.383 9.676 24.522 11.815 24.522 14.479C24.522 17.142 22.383 19.281 19.719 19.281C17.055 19.281 14.916 17.142 14.916 14.479C14.916 11.815 17.055 9.676 19.719 9.676ZM19.719 12.176C18.436 12.176 17.416 13.195 17.416 14.479C17.416 15.762 18.436 16.781 19.719 16.781C21.002 16.781 22.022 15.762 22.022 14.479C22.022 13.195 21.002 12.176 19.719 12.176Z" fill="white"/>
      </svg>
    </a>
  </nav>
</div>

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
      {#each KEYWORDS as kw}
        <span class="m-chip">{kw}</span>
      {/each}
    </div>
  </div>

  <!-- 추천 HypePack 캐러셀 -->
  <div class="m-herd">
    <!-- 카드 슬라이더 -->
    <div
      class="m-carousel"
      bind:this={carouselEl}
      onscroll={onCarouselScroll}
      aria-label="추천 HypePack 캐러셀"
    >
      {#each CAROUSEL_CARDS as card, i}
        <article class="m-pack-card" aria-label={card.title}>
          <!-- 배경 이미지 -->
          <img src={card.img} alt="" class="m-pack-card-bg" aria-hidden="true" />
          <!-- 다크 그라데이션 오버레이 -->
          <div class="m-pack-card-overlay" aria-hidden="true"></div>
          <!-- 상단 도트 인디케이터 (카드 내부) -->
          <div class="m-pack-card-dots" aria-hidden="true">
            {#each CAROUSEL_CARDS as _, j}
              {#if j === i}
                <span class="m-pack-dot m-pack-dot-active"></span>
              {:else}
                <span class="m-pack-dot"></span>
              {/if}
            {/each}
          </div>
          <!-- 하단 콘텐츠 -->
          <div class="m-pack-card-content">
            <!-- 70px 멤버십 아이콘 -->
            <div class="m-pack-icon m-pack-icon-mem" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30" fill="none">
                <path d="M15 2l3.09 6.26L25 9.27l-5 4.87 1.18 6.88L15 17.77l-6.18 3.25L10 14.14 5 9.27l6.91-1.01L15 2z" fill="white"/>
              </svg>
            </div>
            <span class="m-category-badge">{card.category}</span>
            <h3 class="m-pack-card-title">{card.title}</h3>
            <p class="m-pack-card-price">{card.price}</p>
          </div>
        </article>
      {/each}
    </div>

    <!-- 외부 도트 인디케이터 (접근성용 컨트롤) -->
    <div class="m-dots" role="tablist" aria-label="캐러셀 위치">
      {#each CAROUSEL_CARDS as _, i}
        <button
          class="m-dot"
          class:m-dot-active={carouselIdx === i}
          onclick={() => scrollToCard(i)}
          role="tab"
          aria-selected={carouselIdx === i}
          aria-label={`${i + 1}번 카드`}
        ></button>
      {/each}
    </div>
  </div>

  <!-- 최근 광적 관심폭발! (Lists 섹션) -->
  <div class="m-hot-section">
    <div class="m-hot-title-wrap">
      <h2 class="m-hot-title">
        최근 <span class="m-hot-title-accent">광적</span> 관심폭발!
      </h2>
      <div class="m-section-bar" aria-hidden="true"></div>
      <p class="m-section-sub">평소 대비 제품정보 보기와 예약주문량이 많아요.</p>
    </div>
    <div class="m-hot-list">
      {#each HOT_PACK_CARDS as card}
        <article class="m-hot-card" aria-label={card.title}>
          <!-- 배경 이미지 -->
          <img src={card.img} alt="" class="m-hot-card-bg" aria-hidden="true" />
          <!-- 다크 오버레이 -->
          <div class="m-hot-card-overlay" aria-hidden="true"></div>
          <!-- 하단 콘텐츠 -->
          <div class="m-hot-card-content">
            <!-- 70px 아이콘 -->
            <div class="m-pack-icon {card.icon === 'deal' ? 'm-pack-icon-deal' : 'm-pack-icon-mem'}" aria-hidden="true">
              {#if card.icon === 'deal'}
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <path d="M4 14h20M14 4v20" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
                  <circle cx="14" cy="14" r="8" stroke="white" stroke-width="2"/>
                </svg>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <path d="M14 2l2.7 5.46L23 8.6l-4.5 4.38 1.06 6.19L14 16.2l-5.56 2.97 1.06-6.19L5 8.6l6.3-.91L14 2z" fill="white"/>
                </svg>
              {/if}
            </div>
            <span class="m-hot-badge">{card.category}</span>
            <h3 class="m-hot-card-title">{card.title}</h3>
            <p class="m-hot-card-price">{card.price}</p>
          </div>
        </article>
      {/each}
    </div>
  </div>

  <!-- Pack 테마목록 (모바일) -->
  <div class="m-pack-themes">
    <h2 class="m-pack-themes-title">Pack 테마목록</h2>
    <div class="m-pack-themes-list">
      {#each PACK_THEMES as pack}
        <article class="m-pack-theme-card" aria-label="{pack.name} 팩">
          <img src={pack.img} alt={pack.name} class="m-pack-theme-img" />
          <div class="m-pack-theme-badge-wrap">
            <div class="m-pack-theme-badge" style="background-color: {pack.label}; opacity: 0.88;">
              <span class="m-pack-theme-name">{pack.name}</span>
            </div>
          </div>
        </article>
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

    <!-- Flash Deals / Fan Vlog / Release 헤드 카드 -->
    <div class="m-shotlog-heads">
      {#each SHOTLOG_HEADS as card}
        <article class="m-shotlog-head-card" aria-label={card.title}>
          <!-- 컬러 헤더 바 -->
          <header class="m-shotlog-head-header" style="background: {card.headerBg};">
            <span class="m-shotlog-head-label">{card.title}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 8H13M13 8L8.5 3.5M13 8L8.5 12.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </header>
          <!-- 이미지 바디 (writing은 상단 오버레이) -->
          <div class="m-shotlog-head-body">
            <img src={card.img} alt="" class="m-shotlog-head-img" aria-hidden="true" />
            <!-- 상단 다크 그라데이션 + 텍스트 (Figma: gradient to bottom) -->
            <div class="m-shotlog-head-writing">
              <p class="m-shotlog-head-card-title">{card.cardTitle}</p>
              <p class="m-shotlog-head-subtitle">{card.subtitle}</p>
            </div>
          </div>
        </article>
      {/each}
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
        <div class="d-ad-banner-bg" aria-hidden="true">
          <img src="/hype-pack/d-ad-banner.png" alt="" class="d-ad-banner-img" aria-hidden="true" />
        </div>
        <div class="d-ad-banner-script">
          <p class="d-ad-banner-category">Analog Pack</p>
          <h3 class="d-ad-banner-product">Sanyo Xacti CG10</h3>
          <p class="d-ad-banner-price">1 day / 10,000 원</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Pack 테마목록 섹션 -->
  <section class="d-section">
    <div class="d-section-inner">
      <div class="d-title-bar">
        <h2 class="d-section-title">Pack 테마목록</h2>
      </div>
      <div class="d-pack-grid">
        {#each PACK_THEMES as pack}
          <article class="d-pack-card" aria-label="{pack.name} 팩">
            <img src={pack.img} alt="" class="d-pack-card-bg" aria-hidden="true" />
            <div class="d-pack-card-label" style="background: {pack.label};">
              <span class="d-pack-card-label-text">{pack.name}</span>
            </div>
          </article>
        {/each}
      </div>
    </div>
  </section>

  <!-- K-Trail Log With a Pro 섹션 -->
  <section class="d-section">
    <div class="d-section-inner">
      <div class="d-ktlog-titlebar">
        <div class="d-ktlog-titlebar-inner">
          <h2 class="d-ktlog-title">K-Trail Log With a Pro</h2>
          <div class="d-ktlog-chips">
            {#each KEYWORDS as kw}
              <span class="d-chip">{kw}</span>
            {/each}
          </div>
        </div>
      </div>

      <!-- 경험 카드 그리드 -->
      <div class="d-ktlog-grid">
        {#each KTLOG_CARDS as card}
          <article
            class="d-ktlog-card"
            class:d-ktlog-card-full={card.span === 'full'}
            class:d-ktlog-card-wide={card.span === 'wide'}
            style="height: {card.height}px;"
            aria-label={card.title}
          >
            <img src={card.img} alt="" class="d-ktlog-card-bg" aria-hidden="true" />
            <div class="d-ktlog-card-overlay" aria-hidden="true"></div>
            <div class="d-ktlog-card-content">
              <div class="d-ktlog-card-badges">
                {#each card.icons as icon}
                  <span
                    class="d-ktlog-badge {icon === 'mem' ? 'd-ktlog-badge-red' : 'd-ktlog-badge-purple'}"
                    aria-label={icon === 'mem' ? '멤버십 혜택' : '딜'}
                    aria-hidden="true"
                  >
                    {#if icon === 'mem'}
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                        <path d="M14 2l2.7 5.46L23 8.6l-4.5 4.38 1.06 6.19L14 16.2l-5.56 2.97 1.06-6.19L5 8.6l6.3-.91L14 2z" fill="white"/>
                      </svg>
                    {:else}
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                        <path d="M4 14h20M14 4v20" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
                        <circle cx="14" cy="14" r="8" stroke="white" stroke-width="2"/>
                      </svg>
                    {/if}
                  </span>
                {/each}
              </div>
              <p class="d-ktlog-card-category">{card.category}</p>
              <h3 class="d-ktlog-card-title">{card.title}</h3>
              <p class="d-ktlog-card-price">{card.price}</p>
            </div>
          </article>
        {/each}
      </div>
    </div>
  </section>

</div><!-- /d-body -->


<style>

  /* ═══════════════════════════════════════════════════════════
     MOBILE LAYOUT  (≤767px)
  ═══════════════════════════════════════════════════════════ */

  .m-nav-wrap { display: none; }
  .m-body     { display: none; }

  @media (max-width: 767px) {
    .m-nav-wrap { display: flex; }
    .m-body     { display: block; }
    .d-body     { display: none; }
  }

  /* 모바일 Nav */
  .m-nav-wrap {
    position: fixed;
    top: 0; left: 0; right: 0;
    z-index: 50;
    justify-content: center;
    padding: 16px 20px 8px;
    background: transparent;
    pointer-events: none;
  }
  .m-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    height: 55px;
    width: 100%;
    max-width: 390px;
    border-radius: 20px;
    background: linear-gradient(90deg, #1d183e 0%, #1d183e 100%);
    pointer-events: all;
    overflow: visible;
  }
  .m-nav-logo { display: block; text-decoration: none; line-height: 0; }
  .m-nav-logo-img { display: block; width: 96px; height: 59px; }
  .m-nav-avatar {
    display: flex; align-items: center; justify-content: center;
    min-width: 44px; min-height: 44px; text-decoration: none; flex-shrink: 0;
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

  /* ── 캐러셀 영역 (m-herd) ── */
  .m-herd {
    padding: 50px 0 0;
    position: relative;
  }
  .m-carousel {
    display: flex;
    gap: 30px;
    overflow-x: scroll;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding: 0 25px;
  }
  .m-carousel::-webkit-scrollbar { display: none; }

  /* 캐러셀 카드 */
  .m-pack-card {
    position: relative;
    width: 340px;
    min-width: 340px;
    height: 600px;
    border-radius: var(--radius-2xl); /* 50px */
    overflow: hidden;
    flex-shrink: 0;
    scroll-snap-align: start;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
  }
  .m-pack-card-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  .m-pack-card-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, #100B32 0%, rgba(16,11,50,0.6) 40%, rgba(16,11,50,0) 100%);
  }
  /* 카드 내부 상단 도트 */
  .m-pack-card-dots {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 20px 0;
    flex-shrink: 0;
  }
  .m-pack-dot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: rgba(255,255,255,0.3);
    transition: width 0.25s ease, background 0.25s ease;
    flex-shrink: 0;
  }
  .m-pack-dot-active {
    width: 30px;
    background: rgba(255,255,255,0.7);
  }
  /* 카드 하단 콘텐츠 */
  .m-pack-card-content {
    position: relative;
    z-index: 1;
    width: 100%;
    padding: 40px 30px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0;
  }

  /* 외부 도트 컨트롤 (접근성) */
  .m-dots {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px 0 0;
  }
  .m-dot {
    height: 10px;
    width: 10px;
    border-radius: 999px;
    background: rgba(16, 11, 50, 0.15);
    border: none;
    cursor: pointer;
    padding: 0;
    transition: width 0.25s ease, background 0.25s ease;
    min-width: 10px;
    min-height: 44px;
    display: flex;
    align-self: center;
  }
  .m-dot-active {
    width: 30px;
    min-width: 30px;
    background: var(--cs-dark);
  }

  /* 70px 아이콘 (mem=빨강, deal=보라) */
  .m-pack-icon {
    width: 70px;
    height: 70px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-bottom: 2px;
  }
  .m-pack-icon-mem  { background: var(--cs-red-badge); }
  .m-pack-icon-deal { background: var(--cs-purple-light); }

  .m-category-badge {
    display: inline-flex;
    align-items: center;
    background: var(--cs-purple-light); /* #553FE0 */
    border-radius: 15px;
    padding: 5px 20px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 500;
    color: var(--cs-white);
    width: fit-content;
    letter-spacing: -0.5px;
    line-height: 1.6;
  }
  .m-pack-card-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 24px;
    font-weight: 900;
    color: var(--cs-white);
    margin: 2px 0 0;
    letter-spacing: -0.5px;
    line-height: 1.6;
    white-space: pre-line;
  }
  .m-pack-card-price {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: var(--cs-red-badge);
    margin: 0;
    letter-spacing: -0.3px;
    line-height: 1.6;
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

  /* ── 최근 광적 관심폭발! (m-hot-section) ── */
  .m-hot-section {
    background: var(--cs-white);
    border-radius: 0 50px 0 0;
    padding: 70px 25px 100px;
    overflow: hidden;
    margin-top: 20px;
  }
  .m-hot-title-wrap {
    text-align: center;
    margin-bottom: 50px;
  }
  .m-hot-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 24px;
    font-weight: 500; /* Medium — Figma: font-medium */
    color: var(--cs-text);
    margin: 0;
    letter-spacing: -0.5px;
    line-height: 1.6;
    display: inline-block;
  }
  .m-hot-title-accent {
    color: var(--cs-red); /* #CF0000 */
  }
  .m-hot-list {
    display: flex;
    flex-direction: column;
    gap: 50px;
  }
  .m-hot-card {
    position: relative;
    width: 100%;
    max-width: 340px;
    height: 400px;
    border-radius: var(--radius-2xl); /* 50px */
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  .m-hot-card-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  .m-hot-card-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, #100B32 0%, rgba(16,11,50,0.6) 40%, rgba(16,11,50,0) 100%);
  }
  .m-hot-card-content {
    position: relative;
    z-index: 1;
    padding: 30px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .m-hot-badge {
    display: inline-flex;
    align-items: center;
    background: var(--cs-purple-light); /* #553FE0 */
    border-radius: 15px;
    padding: 5px 20px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 500;
    color: var(--cs-white);
    width: fit-content;
    letter-spacing: -0.5px;
    line-height: 1.6;
  }
  .m-hot-card-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 24px;
    font-weight: 900;
    color: var(--cs-white);
    margin: 0;
    letter-spacing: -0.5px;
    line-height: 1.6;
  }
  .m-hot-card-price {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: var(--cs-red-badge); /* #FF3535 */
    margin: 0;
    letter-spacing: -0.3px;
    line-height: 1.6;
  }

  /* ── Pack 테마목록 (모바일 전용) ── */
  .m-pack-themes {
    background: var(--cs-lilac);
    padding: 50px 25px 60px;
  }
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
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: 20px; /* --radius-lg */
    overflow: hidden;
    cursor: pointer;
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

  /* ── Shotlog 헤드 카드 ── */
  .m-shotlog-heads {
    display: flex;
    flex-wrap: wrap;
    gap: 50px;
    margin-bottom: 50px;
  }
  .m-shotlog-head-card {
    position: relative;
    width: 340px;
    height: 400px;
    border-radius: var(--radius-xl); /* 30px */
    overflow: hidden;
    box-shadow: 4px 4px 0px 0px rgba(39,27,122,0.5);
    display: flex;
    flex-direction: column;
  }
  .m-shotlog-head-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 30px;
    flex-shrink: 0;
    position: relative;
    z-index: 1;
  }
  .m-shotlog-head-label {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 24px;
    color: var(--cs-white);
    letter-spacing: -0.5px;
    line-height: 1;
  }
  /* 이미지 바디: 이미지가 아래, writing이 상단 오버레이 */
  .m-shotlog-head-body {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .m-shotlog-head-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  /* writing: 상단 다크 그라데이션 (Figma: gradient to bottom = top→dark) */
  .m-shotlog-head-writing {
    position: relative;
    z-index: 1;
    padding: 20px 30px;
    background: linear-gradient(to bottom, rgba(16,11,50,0.6) 0%, rgba(16,11,50,0) 100%);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .m-shotlog-head-card-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 24px;
    font-weight: 900;
    color: var(--cs-white);
    margin: 0;
    letter-spacing: -0.5px;
    line-height: 1.6;
  }
  .m-shotlog-head-subtitle {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: var(--cs-white);
    margin: 0;
    letter-spacing: -0.3px;
    line-height: 1.6;
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
    .d-body { display: block; }
  }

  .d-body {
    padding-top: 170px;
    padding-bottom: 100px;
    display: flex;
    flex-direction: column;
    gap: 80px;
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
    position: relative;
    height: 520px;
    border-radius: var(--radius-2xl);
    overflow: hidden;
    cursor: pointer;
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

  .d-ktlog-titlebar { width: 100%; }
  .d-ktlog-titlebar-inner {
    max-width: 1240px;
    margin: 0 auto;
    border-radius: var(--radius-xl);
    padding: 20px 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 16px;
  }
  .d-ktlog-title {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 20px;
    color: var(--cs-text);
    margin: 0;
    line-height: 1.6;
    white-space: nowrap;
  }
  .d-ktlog-chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .d-chip {
    display: inline-flex;
    align-items: center;
    background: var(--cs-purple-op10);
    border-radius: 18px;
    padding: 10px 25px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-text);
    white-space: nowrap;
    letter-spacing: -0.5px;
  }

  .d-ktlog-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    column-gap: 20px;
    row-gap: 50px;
  }
  .d-ktlog-card {
    position: relative;
    border-radius: var(--radius-2xl);
    overflow: hidden;
    cursor: pointer;
  }
  .d-ktlog-card-full { grid-column: 1 / -1; }
  .d-ktlog-card-wide { grid-column: span 2; }
  .d-ktlog-card-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
    transition: transform 0.3s ease;
  }
  .d-ktlog-card:hover .d-ktlog-card-bg { transform: scale(1.02); }
  .d-ktlog-card-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, rgba(16,11,50,0.85) 0%, rgba(16,11,50,0.4) 35%, rgba(16,11,50,0) 65%);
  }
  .d-ktlog-card-content {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    padding: 30px 40px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .d-ktlog-card-badges { display: flex; gap: 8px; margin-bottom: 4px; }
  .d-ktlog-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .d-ktlog-badge-red    { background: var(--cs-red-badge); }
  .d-ktlog-badge-purple { background: var(--cs-purple); }
  .d-ktlog-card-category {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: rgba(255,255,255,0.8);
    margin: 0;
    letter-spacing: -0.5px;
    line-height: 1.6;
  }
  .d-ktlog-card-title {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 35px;
    color: var(--cs-white);
    margin: 0;
    line-height: 1.3;
    white-space: pre-line;
  }
  .d-ktlog-card-price {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 35px;
    color: var(--cs-red-badge);
    margin: 0;
    line-height: 1.3;
  }

  /* 태블릿 반응형 */
  @media (min-width: 768px) and (max-width: 1024px) {
    .d-pack-grid { grid-template-columns: repeat(2, 1fr); gap: 30px; }
    .d-pack-card-label { left: 30px; }
    .d-ktlog-grid { grid-template-columns: repeat(2, 1fr); column-gap: 20px; row-gap: 30px; }
    .d-ktlog-card-full { grid-column: 1 / -1; }
    .d-ktlog-card-wide { grid-column: span 2; }
    .d-ktlog-card-title { font-size: 26px; }
    .d-ktlog-card-price { font-size: 24px; }
    .d-ad-banner-product, .d-ad-banner-price { font-size: 28px; }
  }
</style>
