<script lang="ts">
  let activeTab = $state(0)

  const TABS = [
    { label: 'Review', count: 212 },
    { label: 'Share',  count: 43 },
    { label: 'K-Trail log', count: 39 },
  ]

  const M_KEYWORDS = ['양양의 기억 로그', 'Mini2se 리뷰 로그', '신상로그', 'Air 3S Drone']

  interface CardItem {
    category: string
    headerBg: string
    img: string
    title: string
    sub: string
  }

  interface ListSection {
    titleParts: { text: string; accent?: boolean; accentColor?: string }[]
    badge: string
    badgeColor: string
    cards: CardItem[]
  }

  const M_LISTS: ListSection[] = [
    {
      titleParts: [
        { text: '주목받는 신상 ' },
        { text: '리뷰', accent: true, accentColor: '#ff3535' },
      ],
      badge: '리뷰',
      badgeColor: 'red',
      cards: [
        {
          category: 'Flash Deals',
          headerBg: '#3b2f8a',
          img: '/crazylog/card-img1.png',
          title: '다양한 액션캠 대잔치',
          sub: 'DJI, 오즈모, 인스타 모두 맛봅시다',
        },
        {
          category: 'Release',
          headerBg: '#3b2f8a',
          img: '/crazylog/card-img3.png',
          title: 'DJI Mini2se Aerial Drone',
          sub: '드론시장에서 품질은 없다.',
        },
        {
          category: 'Release',
          headerBg: '#3b2f8a',
          img: '/crazylog/card-img4.png',
          title: 'Panoramas-One Lens to Rule Them All',
          sub: '올어라운드 렌즈의 끝판왕',
        },
      ],
    },
    {
      titleParts: [
        { text: '공유', accent: true, accentColor: '#ff3535' },
        { text: "하면 '좋아요' " },
      ],
      badge: '',
      badgeColor: '',
      cards: [
        {
          category: 'Fan vlog',
          headerBg: '#cf0000',
          img: '/crazylog/card-img2.png',
          title: '양양의 기억 담기',
          sub: '동해 양양바다의 기억을 담은 브이로그',
        },
        {
          category: 'Fan vlog',
          headerBg: '#cf0000',
          img: '/crazylog/card-img6.png',
          title: '해외 콘서트 현장',
          sub: '올어라운드 렌즈의 끝판왕',
        },
      ],
    },
    {
      titleParts: [
        { text: '광활한 ' },
        { text: '할인', accent: true, accentColor: '#553fe0' },
        { text: '이벤트' },
      ],
      badge: '할인',
      badgeColor: 'blue',
      cards: [
        {
          category: 'Flash Deals',
          headerBg: '#553fe0',
          img: '/crazylog/card-img1.png',
          title: '다양한 액션캠 대잔치',
          sub: 'DJI, 오즈모, 인스타 모두 맛봅시다',
        },
        {
          category: 'Flash Deals',
          headerBg: '#553fe0',
          img: '/crazylog/card-img7.png',
          title: '패키지 렌탈 타임세일',
          sub: '소니 알파 패키지 맛보기',
        },
      ],
    },
  ]

  interface ArticleItem {
    img: string
    title: string
    meta: string
  }

  const M_ARTICLES: ArticleItem[] = [
    {
      img: '/crazylog/article-img1.png',
      title: '[사용기] SONY FE 24-105  가볍게 고퀄 영상을 바로 만들어주다',
      meta: '1시간 전·by 홍기동',
    },
    {
      img: '/crazylog/article-img2.png',
      title: '액션캠의 왕좌를 되찾으러 돌아왔다. GoPro HERO13 Black',
      meta: '2시간 전·by 유말자',
    },
    {
      img: '/crazylog/article-img3.png',
      title: '휴대용 디자인으로 이동 중에도 미디어 카드에 쉽게 접근 가능',
      meta: '2시간 전·by 유말자',
    },
    {
      img: '/crazylog/article-img4.png',
      title: 'onn. 52인치 삼각대, 컴팩트 카메라, 스마트폰 및 GoPro 액션 카메라용 스',
      meta: '2시간 전·by 유말자',
    },
    {
      img: '/crazylog/article-img5.png',
      title: 'K-트레일로그를 남기는 멋진 일은 우리들에게 즐거움의 폭증이다!!',
      meta: '2시간 전·by 유말자',
    },
  ]

  const D_POST_BARS = [
    'var(--cs-purple)',
    'var(--cs-purple-light)',
    'var(--cs-red-badge)',
    'var(--cs-purple)',
    '#201857',
    'var(--cs-purple-light)',
    'var(--cs-red-badge)',
    'var(--cs-purple)',
  ]

  const D_POSTS = [
    { title: '양양 서핑 로그 — 소니 FX3와 함께한 3일간의 여정', tag: 'Review', time: '3일 전 · by @surfer_kim',    img: '/crazylog/article-img1.png' },
    { title: 'Mini2se 드론으로 담은 제주 일출과 성산일출봉',      tag: 'Share',  time: '5일 전 · by @jejudrone',    img: '/crazylog/article-img2.png' },
    { title: 'Air 3S Drone으로 찍은 북한산 정상 파노라마',         tag: 'Review', time: '1주 전 · by @mountain_log', img: '/crazylog/article-img3.png' },
    { title: '서울 야경 타임랩스 — FDR-AX43 실전 리뷰',           tag: 'Review', time: '2주 전 · by @nightseoul',   img: '/crazylog/article-img4.png' },
    { title: '홍대 거리 K-Trail log 비디오 다이어리',               tag: 'K-Trail log', time: '2주 전 · by @ktrail_hong', img: '/crazylog/article-img5.png' },
    { title: 'CANON 100mm 접사 렌즈로 찍은 꽃 사진 리뷰',          tag: 'Review', time: '3주 전 · by @lensreview',   img: '/crazylog/article-img1.png' },
    { title: '부산 해운대 선셋 드론 영상 공유합니다',               tag: 'Share',  time: '3주 전 · by @busan_sky',    img: '/crazylog/article-img2.png' },
    { title: '경복궁 한복 체험 로그 — 필름 카메라 감성',           tag: 'K-Trail log', time: '1달 전 · by @hanbok_log', img: '/crazylog/article-img3.png' },
  ]
</script>

<!-- ───────────── PC 히어로: What's Buzzing ───────────── -->
<section class="d-hero-section">
  <div class="d-hero-wrap">
    <div class="d-hero-grid">
      <!-- 좌측 대형 이미지 -->
      <div class="d-hero-main">
        <img src="/crazylog/hero-shotlog.png" alt="크레이지로그 히어로" class="d-hero-bg-img" />
      </div>
      <!-- 우측 상단 이미지 -->
      <div class="d-hero-top-right">
        <img src="/crazylog/hero-shotlog1.png" alt="크레이지로그" class="d-hero-bg-img" />
      </div>
      <!-- 우측 하단 (2분할: Flash Deals 카드 + 타이틀) -->
      <div class="d-hero-bottom">
        <div class="d-hero-card-dark">
          <span class="d-hero-card-tag" style="font-family: 'Tilt Warp', sans-serif;">Flash Deals</span>
          <p class="d-hero-card-title">한정특가<br/>이벤트 진행중</p>
          <p class="d-hero-card-sub">지금 바로 확인하세요</p>
        </div>
        <div class="d-hero-title-box">
          <p class="d-hero-section-label">What's Buzzing</p>
          <h1 class="d-hero-title">요즘 크레이지·로그</h1>
          <p class="d-hero-subtitle">신상 리뷰도, 내 유튜브채널 홍보도<br/>크레이지로그로!</p>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ───────────── 모바일 키워드 헤더 ───────────── -->
<section class="m-head-section">
  <div class="m-head-kw">
    <div class="m-head-top">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" class="m-chevron">
        <path d="M9 18L15 12L9 6" stroke="var(--cs-red-badge)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <h1 class="m-head-title">요즘 핫트렌디 로그!</h1>
    </div>
    <p class="m-head-desc">한정특가 이벤트부터 제품 출시정보까지,<br/>언제나 최신 흐름을 따라가세요.</p>
    <div class="m-chips">
      {#each M_KEYWORDS as kw}
        <span class="m-chip">{kw}</span>
      {/each}
    </div>
  </div>
</section>

<!-- ───────────── 모바일 카드 리스트 (HeadPosts) ───────────── -->
{#each M_LISTS as list}
  <section class="m-list-section">
    <div class="m-list-header">
      <p class="m-list-title">
        {#each list.titleParts as part}
          {#if part.accent}
            <span style="color: {part.accentColor};">{part.text}</span>
          {:else}
            {part.text}
          {/if}
        {/each}
      </p>
      <div class="m-list-icons">
        <!-- -scale-y-100 flipped chevron (Figma: justify-between 가운데 아이콘) -->
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="transform: scaleY(-1);">
          <path d="M2 5L8 11L14 5" stroke="#3B2F8A" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/>
        </svg>
        <!-- + 아이콘 22×22 -->
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <rect width="22" height="22" rx="7" fill="#E1DEF3"/>
          <path d="M11 6v10M6 11h10" stroke="#553FE0" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
    </div>
    <div class="m-carousel">
      {#each list.cards as card, ci}
        <div class="m-card">
          <!-- 배경 이미지: absolute inset-0 overflow-hidden -->
          <div class="m-card-img-wrap">
            <img src={card.img} alt="" class="m-card-bg-img" />
          </div>
          <!-- 상단 컬러 타이틀바 (shrink-0) -->
          <div class="m-card-header" style="background: {card.headerBg};">
            <span class="m-card-category">{card.category}</span>
            <button class="m-card-more" aria-label="더보기">
              <svg width="13" height="13" viewBox="0 0 22 22" fill="none">
                <rect width="22" height="22" rx="7" fill="rgba(225,222,243,0.9)"/>
                <path d="M6 11h10M11 6v10" stroke="#553FE0" stroke-width="2.5" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
          <!-- Script: flex-1 justify-between — Writing 상단 / Dots 하단 -->
          <div class="m-card-script">
            <!-- Writing: 그라데이션 top=dark → bottom=transparent -->
            <div class="m-card-writing">
              <p class="m-card-title">{card.title}</p>
              <p class="m-card-sub">{card.sub}</p>
            </div>
            <!-- 인디케이터 dots (하단) -->
            <div class="m-card-dots">
              {#each list.cards as _, di}
                <span class="m-dot" class:m-dot-active={di === ci}></span>
              {/each}
            </div>
          </div>
        </div>
      {/each}
    </div>
  </section>
{/each}

<!-- ───────────── 인덱스 탭바 (공통) ───────────── -->
<section class="tab-section">
  <div class="tab-bar">
    {#each TABS as tab, i}
      <button
        class="tab-btn"
        class:tab-btn-active={activeTab === i}
        onclick={() => activeTab = i}
      >
        <span class="tab-label">{tab.label}</span>
        <span class="tab-count">{tab.count}</span>
      </button>
    {/each}
  </div>
</section>

<!-- ───────────── 모바일 콘텐츠 카드 ───────────── -->
<section class="m-content-section">
  <div class="m-content-inner">
    {#each M_ARTICLES as article}
      <article class="m-article-card">
        <div class="m-article-img-wrap">
          <img src={article.img} alt="" class="m-article-img" />
        </div>
        <div class="m-article-body">
          <p class="m-article-title">{article.title}</p>
          <p class="m-article-meta">{article.meta}</p>
        </div>
      </article>
    {/each}
  </div>
</section>

<!-- ───────────── PC 포스트 목록 ───────────── -->
<section class="d-posts-section">
  <div class="d-posts-wrap">
    {#each D_POSTS as post, i}
      <article class="d-post-card">
        <div class="d-post-bar" style="background: {D_POST_BARS[i]};"></div>
        <div class="d-post-body">
          <span class="d-post-tag">{post.tag}</span>
          <h3 class="d-post-title">{post.title}</h3>
          <p class="d-post-meta">{post.time}</p>
        </div>
        <div class="d-post-img-wrap">
          <img src={post.img} alt="" class="d-post-img" />
        </div>
      </article>
    {/each}
  </div>
</section>


<style>
  /* ═══════════════════════════════════════════
     PC 히어로 — What's Buzzing 2×2 그리드
  ═══════════════════════════════════════════ */
  .d-hero-section {
    display: none;
    padding-top: 130px;
  }
  @media (min-width: 769px) {
    .d-hero-section { display: block; }
  }
  .d-hero-wrap {
    max-width: 1240px;
    margin: 0 auto;
    padding: 0 40px;
  }
  .d-hero-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 300px 300px;
    gap: 30px;
    height: 630px;
    border-radius: var(--radius-2xl);
    overflow: hidden;
  }
  .d-hero-main {
    grid-column: 1;
    grid-row: 1 / 3;
    border-radius: var(--radius-2xl);
    overflow: hidden;
    position: relative;
  }
  .d-hero-top-right {
    grid-column: 2;
    grid-row: 1;
    border-radius: var(--radius-2xl);
    overflow: hidden;
    position: relative;
  }
  .d-hero-bg-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  .d-hero-bottom {
    grid-column: 2;
    grid-row: 2;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 30px;
  }
  .d-hero-title-box {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 24px;
    background: var(--cs-lilac);
    border-radius: var(--radius-2xl);
  }
  .d-hero-card-dark {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 30px;
    background: var(--cs-purple-dark);
    border-radius: var(--radius-2xl);
  }
  .d-hero-card-tag {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 18px;
    color: var(--cs-red-badge);
    margin-bottom: 10px;
    display: block;
  }
  .d-hero-card-title {
    font: var(--text-pc-htitle-25);
    color: var(--cs-white);
    margin: 0 0 8px;
    line-height: 1.3;
  }
  .d-hero-card-sub {
    font: var(--text-pc-script-12);
    color: var(--cs-purple-pale);
    margin: 0;
  }
  .d-hero-section-label {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 20px;
    color: var(--cs-text-mid);
    margin: 0 0 12px;
  }
  .d-hero-title {
    font-family: 'SB AggroOTF', 'Noto Sans KR', sans-serif;
    font-size: 35px;
    font-weight: 700;
    color: var(--cs-purple-dark);
    margin: 0 0 12px;
    line-height: 1.2;
  }
  .d-hero-subtitle {
    font: var(--text-pc-hsub-22);
    font-size: 16px;
    color: var(--cs-purple-dark);
    margin: 0;
    line-height: 1.5;
  }

  /* ═══════════════════════════════════════════
     모바일 키워드 헤더
  ═══════════════════════════════════════════ */
  .m-head-section {
    display: block;
    padding-top: 95px;
  }
  @media (min-width: 769px) {
    .m-head-section { display: none; }
  }
  .m-head-kw {
    padding: 50px 25px 30px;
  }
  .m-head-top {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
  }
  .m-chevron { flex-shrink: 0; }
  .m-head-title {
    font-family: 'SB AggroOTF', 'Noto Sans KR', sans-serif;
    font-size: 30px;
    font-weight: 700;
    color: var(--cs-red-badge);
    margin: 0;
    line-height: 1.2;
  }
  .m-head-desc {
    font: var(--text-m-title-18B);
    font-weight: 500;
    color: var(--cs-text-mid);
    margin: 0 0 20px;
    line-height: 1.6;
  }
  .m-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .m-chip {
    background: var(--cs-purple-op10);
    border-radius: 13px;
    padding: 8px 25px;
    font: var(--text-m-script-14);
    color: var(--cs-text-dark);
    white-space: nowrap;
  }

  /* ═══════════════════════════════════════════
     모바일 헤드 카드 리스트 (HeadPosts)
     Figma: pt-[30px] px-[25px]
  ═══════════════════════════════════════════ */
  .m-list-section {
    display: block;
    padding: 30px 25px 10px;
  }
  @media (min-width: 769px) {
    .m-list-section { display: none; }
  }
  /* Figma: com.product.title.bar — flex items-center justify-between py-[40px] */
  .m-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 40px 0;
    width: 100%;
    max-width: 1240px;
    min-width: 340px;
  }
  .m-list-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 21px;
    font-weight: 700;
    color: var(--cs-text);
    margin: 0;
    letter-spacing: -0.3px;
    line-height: 1.6;
  }
  .m-list-icons {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  /* 카드 캐러셀 */
  .m-carousel {
    display: flex;
    gap: 50px;
    overflow-x: auto;
    padding: 0 25px 20px;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .m-carousel::-webkit-scrollbar { display: none; }

  /* ─── 개별 카드 — 이미지 전체 배경 구조 ─── */
  .m-card {
    position: relative;
    flex-shrink: 0;
    width: 340px;
    height: 400px;
    min-width: 340px;
    max-width: 605px;
    min-height: 300px;
    max-height: 400px;
    border-radius: 30px;
    box-shadow: 4px 4px 0px rgba(39,27,122,0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    scroll-snap-align: start;
  }

  /* 배경 이미지 래퍼: absolute inset-0 overflow-hidden (Figma) */
  .m-card-img-wrap {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    border-radius: 30px;
  }
  /* 이미지: absolute inset-0 object-cover size-full */
  .m-card-bg-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* 상단 컬러 타이틀바 */
  .m-card-header {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 30px;
  }
  .m-card-category {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 24px;
    color: var(--cs-white);
    letter-spacing: -0.5px;
  }
  .m-card-more {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
  }

  /* Script: flex flex-[1_0_0] flex-col justify-between (Writing 상단, Dots 하단) */
  .m-card-script {
    position: relative;
    z-index: 1;
    flex: 1 0 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  /* Writing: bg-gradient-to-t from-transparent(bottom) via-0.6(40%) to-dark(top)
     Figma: from-[rgba(16,11,50,0)] via-[40%] via-[rgba(16,11,50,0.6)] to-[#100b32]
     → top=dark, bottom=transparent. Writing은 Script 상단에 위치. */
  .m-card-writing {
    flex-shrink: 0;
    width: 100%;
    background: linear-gradient(to top,
      rgba(16,11,50,0) 0%,
      rgba(16,11,50,0.6) 40%,
      #100b32 100%
    );
    padding: 20px 30px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    align-items: flex-start;
  }
  .m-card-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 24px;
    font-weight: 900;
    color: var(--cs-white);
    margin: 0 0 5px;
    line-height: 1.6;
    letter-spacing: -0.5px;
  }
  .m-card-sub {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: var(--cs-white);
    margin: 0;
    line-height: 1.6;
    letter-spacing: -0.3px;
  }

  /* 인디케이터 도트 — Script 하단 (Figma: py-[20px]) */
  .m-card-dots {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 20px 0;
  }
  .m-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(255,255,255,0.3);
    transition: all 0.2s;
  }
  .m-dot-active {
    width: 30px;
    border-radius: 15px;
    background: rgba(255,255,255,0.6);
  }

  /* ═══════════════════════════════════════════
     인덱스 탭바 (공통)
  ═══════════════════════════════════════════ */
  .tab-section {
    padding: 30px 20px;
  }
  @media (min-width: 769px) {
    .tab-section {
      padding: 50px 40px 30px;
      max-width: 1240px;
      margin: 0 auto;
    }
  }
  .tab-bar {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
  }
  .tab-btn {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    background: var(--cs-purple);
    border: none;
    border-radius: var(--radius-xl);
    padding: 16px 30px;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
    opacity: 0.55;
    min-height: 44px;
  }
  @media (min-width: 769px) {
    .tab-btn { padding: 30px 40px; }
  }
  .tab-btn-active { opacity: 1; }
  .tab-btn:hover:not(.tab-btn-active) { opacity: 0.75; }
  .tab-label {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 18px;
    color: var(--cs-white);
  }
  @media (min-width: 769px) {
    .tab-label { font-size: 20px; }
  }
  .tab-count {
    font: var(--text-pc-title-16);
    color: var(--cs-white);
    opacity: 0.7;
  }

  /* ═══════════════════════════════════════════
     모바일 콘텐츠 카드 섹션 (그라데이션 배경)
  ═══════════════════════════════════════════ */
  .m-content-section {
    display: block;
  }
  @media (min-width: 769px) {
    .m-content-section { display: none; }
  }
  .m-content-inner {
    background: linear-gradient(180deg,
      rgba(225,222,243,0.95) 0%,
      rgba(225,222,243,0.8) 25.962%,
      rgba(225,222,243,0) 50.481%
    );
    border-radius: 0 50px 0 50px; /* Figma: rounded-tr + rounded-bl */
    padding: 70px 25px 100px;
    display: flex;
    flex-direction: column;
    gap: 50px;
  }
  .m-article-card {
    background: var(--cs-white);
    border-radius: var(--radius-xl);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .m-article-img-wrap {
    height: 150px;
    min-width: 340px;
    width: 100%;
    position: relative;
    overflow: hidden;
  }
  .m-article-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  .m-article-body {
    padding: 20px 30px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .m-article-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: var(--cs-text-dark);
    margin: 0;
    line-height: 1.6;
    letter-spacing: -0.3px;
  }
  .m-article-meta {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: var(--cs-text-mid);
    margin: 0;
    line-height: 1.6;
    letter-spacing: -0.5px;
  }

  /* ═══════════════════════════════════════════
     PC 포스트 목록
  ═══════════════════════════════════════════ */
  .d-posts-section {
    display: none;
    padding-bottom: 80px;
  }
  @media (min-width: 769px) {
    .d-posts-section { display: block; }
  }
  .d-posts-wrap {
    max-width: 1240px;
    margin: 0 auto;
    padding: 0 40px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .d-post-card {
    display: flex;
    align-items: stretch;
    background: var(--cs-white);
    border-radius: var(--radius-xl);
    overflow: hidden;
    min-height: 120px;
    transition: box-shadow 0.15s;
  }
  .d-post-card:hover { box-shadow: 0 2px 16px rgba(59,47,138,0.10); }
  .d-post-bar {
    width: 15px;
    flex-shrink: 0;
  }
  .d-post-body {
    flex: 1;
    padding: 24px 28px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .d-post-tag {
    font: var(--text-pc-script-12);
    color: var(--cs-purple);
    font-weight: 700;
    text-transform: uppercase;
  }
  .d-post-title {
    font: var(--text-pc-title-18);
    color: var(--cs-text);
    margin: 0;
    line-height: 1.4;
  }
  .d-post-meta {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0;
  }
  .d-post-img-wrap {
    width: 300px;
    flex-shrink: 0;
    overflow: hidden;
    position: relative;
  }
  .d-post-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
