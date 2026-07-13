<script lang="ts">
  let activeTab = $state(0)

  const TABS = [
    { label: 'Review',      count: 212 },
    { label: 'Share',       count: 43  },
    { label: 'K-Trail log', count: 39  },
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
    cards: CardItem[]
  }

  const M_LISTS: ListSection[] = [
    {
      titleParts: [
        { text: '주목받는 신상 ' },
        { text: '리뷰', accent: true, accentColor: '#ff3535' },
      ],
      cards: [
        { category: 'Flash Deals', headerBg: '#3b2f8a', img: '/crazylog/card-img1.png', title: '다양한 액션캠 대잔치',                sub: 'DJI, 오즈모, 인스타 모두 맛봅시다' },
        { category: 'Release',     headerBg: '#3b2f8a', img: '/crazylog/card-img3.png', title: 'DJI Mini2se Aerial Drone',            sub: '드론시장에서 품질은 없다.' },
        { category: 'Release',     headerBg: '#3b2f8a', img: '/crazylog/card-img4.png', title: 'Panoramas-One Lens to Rule Them All', sub: '올어라운드 렌즈의 끝판왕' },
      ],
    },
    {
      titleParts: [
        { text: '공유', accent: true, accentColor: '#ff3535' },
        { text: "하면 '좋아요'" },
      ],
      cards: [
        { category: 'Fan vlog', headerBg: '#cf0000', img: '/crazylog/card-img2.png', title: '양양의 기억 담기', sub: '동해 양양바다의 기억을 담은 브이로그' },
        { category: 'Fan vlog', headerBg: '#cf0000', img: '/crazylog/card-img6.png', title: '해외 콘서트 현장', sub: '올어라운드 렌즈의 끝판왕' },
      ],
    },
    {
      titleParts: [
        { text: '광활한 ' },
        { text: '할인', accent: true, accentColor: '#553fe0' },
        { text: '이벤트' },
      ],
      cards: [
        { category: 'Flash Deals', headerBg: '#553fe0', img: '/crazylog/card-img1.png', title: '다양한 액션캠 대잔치', sub: 'DJI, 오즈모, 인스타 모두 맛봅시다' },
        { category: 'Flash Deals', headerBg: '#553fe0', img: '/crazylog/card-img7.png', title: '패키지 렌탈 타임세일', sub: '소니 알파 패키지 맛보기' },
      ],
    },
  ]

  const M_ARTICLES = [
    { img: '/crazylog/article-img1.png', title: '[사용기] SONY FE 24-105  가볍게 고퀄 영상을 바로 만들어주다',            meta: '1시간 전·by 홍기동' },
    { img: '/crazylog/article-img2.png', title: '액션캠의 왕좌를 되찾으러 돌아왔다. GoPro HERO13 Black',                 meta: '2시간 전·by 유말자' },
    { img: '/crazylog/article-img3.png', title: '휴대용 디자인으로 이동 중에도 미디어 카드에 쉽게 접근 가능',             meta: '2시간 전·by 유말자' },
    { img: '/crazylog/article-img4.png', title: 'onn. 52인치 삼각대, 컴팩트 카메라, 스마트폰 및 GoPro 액션 카메라용 스', meta: '2시간 전·by 유말자' },
    { img: '/crazylog/article-img5.png', title: 'K-트레일로그를 남기는 멋진 일은 우리들에게 즐거움의 폭증이다!!',         meta: '2시간 전·by 유말자' },
  ]

  const D_POSTS = [
    { bar: '#3b2f8a', title: 'SONY FE 24-105 F4 G OSS',                                         desc: 'Bower 6-in-1 Multi Selfie Tripod with Smartphone & GoPro Mount, Rechargeable Wireless Remote - Black',                                                img: '/crazylog/post-img1.png' },
    { bar: '#553fe0', title: 'GoPro HERO13 Black',                                               desc: 'Best-in-Class 5.3K Video - 5.3K video delivers breathtaking image quality with 91% more resolution than 4K and an incredible 665% more than 1080p.', img: '/crazylog/post-img2.png' },
    { bar: '#3b2f8a', title: 'SONY FE 24-105 F4 G OSS',                                         desc: 'Bower 6-in-1 Multi Selfie Tripod with Smartphone & GoPro Mount, Rechargeable Wireless Remote - Black',                                                img: '/crazylog/post-img3.png' },
    { bar: '#ff3535', title: '[Accessories] onn USB C/USB 2.0 Memory Card Reader for SD/Mic...', desc: 'SD and microSD card reader with USB and USB-C connectors for versatile connectivity',                                                                   img: '/crazylog/post-img4.png' },
    { bar: '#3b2f8a', title: 'SONY FE 24-105 F4 G OSS',                                         desc: 'Bower 6-in-1 Multi Selfie Tripod with Smartphone & GoPro Mount, Rechargeable Wireless Remote - Black',                                                img: '/crazylog/post-img1.png' },
    { bar: '#553fe0', title: 'GoPro HERO13 Black',                                               desc: 'Best-in-Class 5.3K Video - 5.3K video delivers breathtaking image quality with 91% more resolution than 4K and an incredible 665% more than 1080p.', img: '/crazylog/post-img2.png' },
    { bar: '#3b2f8a', title: 'SONY FE 24-105 F4 G OSS',                                         desc: 'Bower 6-in-1 Multi Selfie Tripod with Smartphone & GoPro Mount, Rechargeable Wireless Remote - Black',                                                img: '/crazylog/post-img3.png' },
    { bar: '#ff3535', title: '[Accessories] onn USB C/USB 2.0 Memory Card Reader for SD/Mic...', desc: 'SD and microSD card reader with USB and USB-C connectors for versatile connectivity',                                                                   img: '/crazylog/post-img4.png' },
  ]
</script>

<!-- ═══════════════════════════════════════
     DESKTOP (min-width: 768px)
     0401Shotlog 기반: What's Buzzing 그리드 + 포스트 목록
═══════════════════════════════════════ -->
<div class="d-page">

  <!-- What's Buzzing 1: 2×2 grid -->
  <section class="d-wb-section">
    <div class="d-wb-wrap">
      <div class="d-wb-grid">

        <!-- col-1 row-1: Title1 — 텍스트 타이틀 박스 (lilac bg) -->
        <!-- Figma: col-1 row-1, justify-self-stretch, self-start -->
        <div class="d-title1">
          <div class="d-title1-inner">
            <!-- Figma: CrazylogHeader — flex-col gap-[5px] items-center -->
            <div class="d-header">
              <div class="d-header-icon">
                <svg width="34" height="17" viewBox="0 0 38 20" fill="none">
                  <path d="M3 18L19 4L35 18" stroke="#100B32" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <p class="d-header-heading">요즘 크레이지·로그</p>
            </div>
            <!-- Figma: subtitle 22px Bold #201857 -->
            <p class="d-header-subtitle">신상 리뷰도, 내 유튜브채널 홍보도 크레이지로그로!</p>
          </div>
        </div>

        <!-- col-1 row-2: Shotlog (Flash Deals card) -->
        <!-- Figma: col-1 row-2, h-[400px], bg hero-shotlog1.png, bg-[#201857] header + gradient writing -->
        <div class="d-shotlog">
          <div class="d-shotlog-bg">
            <img src="/crazylog/hero-shotlog1.png" alt="" class="d-shotlog-bg-img" />
          </div>
          <!-- Figma: Title — bg-[#201857] px-[50px] py-[20px] flex justify-between -->
          <div class="d-shotlog-header">
            <span class="d-shotlog-label">Flash Deals</span>
            <div class="d-shotlog-arrow">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="transform: scaleY(-1)">
                <path d="M2 5L8 11L14 5" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/>
              </svg>
            </div>
          </div>
          <!-- Figma: Writing2 — gradient bg-gradient-to-t from-rgba(16,11,50,0) to-#100b32 via-40% -->
          <div class="d-shotlog-writing">
            <p class="d-shotlog-writing-text">From Portraits to Panoramas-One Lens to Rule Them All</p>
          </div>
        </div>

        <!-- col-2 row-1: Shotlog1 (hero-shotlog.png, h-[300px]) -->
        <!-- Figma: col-2 row-1, h-[300px], self-start -->
        <div class="d-shotlog1">
          <div class="d-shotlog1-bg">
            <img src="/crazylog/hero-shotlog.png" alt="" class="d-shotlog1-bg-img" />
          </div>
          <!-- Figma: Writing1 — h-[90px] gradient -->
          <div class="d-shotlog1-writing"></div>
        </div>

        <!-- col-2 row-2: Shotlog2 (hero-shotlog2.png, fill remaining) -->
        <!-- Figma: col-2 row-2, self-stretch, fills remaining height -->
        <div class="d-shotlog2">
          <img src="/crazylog/hero-shotlog2.png" alt="" class="d-shotlog2-img" />
          <!-- Figma: Writing — h-[104px] gradient bottom -->
          <div class="d-shotlog2-writing"></div>
        </div>

      </div>
    </div>
  </section>

  <!-- Shotlog: ItemIndexBar + PostsEng -->
  <section class="d-posts-section">
    <div class="d-posts-wrap">

      <!-- ItemIndexBar: Review / Share / K-Trail log -->
      <!-- Figma: bg-[#3b2f8a] rounded-[30px] px-40 py-30, flex gap-[10px] -->
      <div class="d-index-bar">
        {#each TABS as tab, i}
          <button
            class="d-index-btn"
            class:d-index-btn-active={activeTab === i}
            onclick={() => activeTab = i}
          >
            <span class="d-index-label">{tab.label}</span>
            <span class="d-index-count">{tab.count}</span>
          </button>
        {/each}
      </div>

      <!-- PostsEng: 8 rows -->
      <!-- Figma: flex-col gap-[50px] -->
      <div class="d-posts">
        {#each D_POSTS as post}
          <article class="d-post">
            <!-- Figma: IndexBar — 15px wide colored left bar -->
            <div class="d-post-bar" style="background:{post.bar}"></div>
            <!-- Figma: Writing — flex-[1_0_0] p-[40px] gap-[15px] -->
            <div class="d-post-writing">
              <p class="d-post-title">{post.title}</p>
              <p class="d-post-desc">{post.desc}</p>
            </div>
            <!-- Figma: Img — 600px wide, 300px tall -->
            <div class="d-post-img-wrap">
              <img src={post.img} alt="" class="d-post-img" />
            </div>
          </article>
        {/each}
      </div>

    </div>
  </section>

</div>

<!-- ═══════════════════════════════════════
     MOBILE (max-width: 767px)
     0401Crazylog 기반
═══════════════════════════════════════ -->
<div class="m-page">

  <!-- HeadKeyword -->
  <section class="m-head">
    <div class="m-head-inner">
      <!-- Figma: Head — flex-col gap-[5px] items-center -->
      <div class="m-head-top">
        <div class="m-head-icon">
          <svg width="34" height="17" viewBox="0 0 38 20" fill="none">
            <path d="M3 18L19 4L35 18" stroke="#FF3535" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h1 class="m-head-title">요즘 핫트렌디 로그!</h1>
      </div>
      <!-- Figma: body text — 18px Medium #666 -->
      <p class="m-head-desc">한정특가 이벤트부터 제품 출시정보까지,<br/>언제나 최신 흐름을 따라가세요.</p>
      <!-- Figma: Frame3 — keyword chips + help circle -->
      <div class="m-chips">
        {#each M_KEYWORDS as kw}
          <span class="m-chip">{kw}</span>
        {/each}
        <svg class="m-chip-help" width="30" height="30" viewBox="0 0 30 30" fill="none" aria-label="도움말">
          <circle cx="15" cy="15" r="15" fill="#FF3535"/>
          <path d="M11 12.5C11 10.567 12.567 9 14.5 9S18 10.567 18 12.5c0 1.5-1 2.5-2 3v1" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
          <circle cx="15" cy="19.5" r="1" fill="white"/>
        </svg>
      </div>
    </div>
  </section>

  <!-- HeadPosts: 3 sections (horizontal card carousel) -->
  {#each M_LISTS as list}
    <section class="m-list">
      <!-- Figma: com.product.title.bar — flex items-center justify-between py-[40px] -->
      <div class="m-list-header">
        <p class="m-list-title">
          {#each list.titleParts as part}
            {#if part.accent}
              <span style="color:{part.accentColor}">{part.text}</span>
            {:else}
              {part.text}
            {/if}
          {/each}
        </p>
        <div class="m-list-icons">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="transform:scaleY(-1)">
            <path d="M2 5L8 11L14 5" stroke="#3B2F8A" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/>
          </svg>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <rect width="22" height="22" rx="7" fill="#E1DEF3"/>
            <path d="M11 6v10M6 11h10" stroke="#553FE0" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
      </div>
      <!-- Figma: horizontal scroll snap carousel -->
      <div class="m-carousel">
        {#each list.cards as card, ci}
          <div class="m-card">
            <div class="m-card-bg">
              <img src={card.img} alt="" class="m-card-bg-img" />
            </div>
            <!-- Figma: shrink-0 header bar -->
            <div class="m-card-header" style="background:{card.headerBg}">
              <span class="m-card-category">{card.category}</span>
              <button class="m-card-more" aria-label="더보기">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <rect width="22" height="22" rx="7" fill="rgba(225,222,243,0.9)"/>
                  <path d="M6 11h10M11 6v10" stroke="#553FE0" stroke-width="2.5" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
            <!-- Figma: Script — flex-[1_0_0] flex-col justify-between items-center -->
            <div class="m-card-script">
              <!-- Figma: Writing — gradient bg-gradient-to-t from-rgba(16,11,50,0) to-#100b32 -->
              <div class="m-card-writing">
                <p class="m-card-title">{card.title}</p>
                <p class="m-card-sub">{card.sub}</p>
              </div>
              <!-- 인디케이터 dots -->
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

  <!-- Component (콘텐츠): gradient bg + article cards -->
  <section class="m-content">
    <div class="m-content-inner">
      {#each M_ARTICLES as article}
        <article class="m-article">
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

</div>

<style>
  /* ════════════════════════════════════════
     DESKTOP — 기본 숨김, 768px+ 표시
  ════════════════════════════════════════ */
  .d-page { display: none; }
  @media (min-width: 768px) { .d-page { display: block; } }

  /* ── What's Buzzing 섹션 ── */
  .d-wb-section {
    padding-top: 130px;    /* GNB 100px + 여백 30px */
    padding-bottom: 150px;
  }
  .d-wb-wrap {
    max-width: 1240px;
    margin: 0 auto;
    padding: 0 30px;
  }

  /* Figma: 2×2 grid, 630px, gap 30px, rounded-50px overflow-clip */
  .d-wb-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 230px 370px;   /* row1=Title/Shotlog1, row2=FlashDeals/Shotlog2 */
    gap: 30px;
    height: 630px;
    border-radius: 50px;
    overflow: hidden;
  }

  /* ── col-1 row-1: Title1 (lilac bg) ── */
  .d-title1 {
    grid-column: 1;
    grid-row: 1;
    background: var(--cs-lilac);
    border-radius: 50px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    overflow: hidden;
  }
  /* Figma: content-stretch flex-col gap-[20px] items-start px-[40px] */
  .d-title1-inner {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 40px;
  }
  /* Figma: CrazylogHeader — flex-col gap-[5px] items-center */
  .d-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
  }
  .d-header-icon { flex-shrink: 0; }
  /* Figma: 35px SB AggroOTF #100b32 whitespace-nowrap */
  .d-header-heading {
    font-family: 'SB AggroOTF', 'Noto Sans KR', sans-serif;
    font-size: 35px;
    font-weight: 700;
    color: #100b32;
    margin: 0;
    white-space: nowrap;
  }
  /* Figma: 22px Bold Noto #201857 leading-[2] whitespace-nowrap */
  .d-header-subtitle {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 22px;
    font-weight: 700;
    color: #201857;
    margin: 0;
    line-height: 2;
    white-space: nowrap;
  }

  /* ── col-1 row-2: Shotlog (Flash Deals, h-400px) ── */
  .d-shotlog {
    grid-column: 1;
    grid-row: 2;
    position: relative;
    border-radius: 50px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .d-shotlog-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .d-shotlog-bg-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  /* Figma: bg-[#201857] px-[50px] py-[20px] flex justify-between */
  .d-shotlog-header {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
    background: #201857;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 50px;
  }
  /* Figma: Tilt Warp 20px white tracking-[-0.5px] */
  .d-shotlog-label {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 20px;
    color: white;
    letter-spacing: -0.5px;
  }
  .d-shotlog-arrow { flex-shrink: 0; }
  /* Figma: Writing2 — bg-gradient-to-t from-rgba(16,11,50,0) to-#100b32 via-[40%] shrink-0 */
  .d-shotlog-writing {
    position: relative;
    z-index: 1;
    flex: 1;
    background: linear-gradient(to top, rgba(16,11,50,0) 0%, rgba(16,11,50,0.6) 40%, #100b32 100%);
    padding: 20px 40px;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
  }
  /* Figma: 25px Black(900) Noto white leading-[2] */
  .d-shotlog-writing-text {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 25px;
    font-weight: 900;
    color: white;
    margin: 0;
    line-height: 2;
  }

  /* ── col-2 row-1: Shotlog1 (hero-shotlog.png, h-300px, self-start) ── */
  .d-shotlog1 {
    grid-column: 2;
    grid-row: 1;
    position: relative;
    border-radius: 50px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .d-shotlog1-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .d-shotlog1-bg-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  /* Figma: Writing1 — h-[90px] gradient */
  .d-shotlog1-writing {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
    height: 90px;
    background: linear-gradient(to top, rgba(16,11,50,0) 0%, rgba(16,11,50,0.6) 40%, #100b32 100%);
  }

  /* ── col-2 row-2: Shotlog2 (hero-shotlog2.png, fill) ── */
  .d-shotlog2 {
    grid-column: 2;
    grid-row: 2;
    position: relative;
    border-radius: 50px;
    overflow: hidden;
  }
  .d-shotlog2-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  /* Figma: Writing — h-[104px] gradient bottom */
  .d-shotlog2-writing {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 104px;
    background: linear-gradient(to top, rgba(16,11,50,0) 0%, rgba(16,11,50,0.6) 40%, #100b32 100%);
    z-index: 1;
  }

  /* ── 포스트 섹션 ── */
  .d-posts-section { padding-bottom: 80px; }
  .d-posts-wrap {
    max-width: 1240px;
    margin: 0 auto;
    padding: 0 30px;
    display: flex;
    flex-direction: column;
    gap: 50px;
  }

  /* Figma: ItemIndexBar — flex gap-[10px] bg-[#3b2f8a] rounded-[30px] px-40 py-30 */
  .d-index-bar {
    display: flex;
    gap: 10px;
  }
  .d-index-btn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    background: var(--cs-purple);
    border: none;
    border-radius: var(--radius-xl);
    padding: 30px 40px;
    cursor: pointer;
    transition: opacity 0.15s;
    opacity: 0.55;
    min-height: 44px;
  }
  .d-index-btn-active { opacity: 1; }
  .d-index-btn:hover:not(.d-index-btn-active) { opacity: 0.8; }
  /* Figma: Tilt Warp 20px white */
  .d-index-label {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 20px;
    color: white;
    letter-spacing: -0.5px;
  }
  /* Figma: Noto 16px 700 white leading-[2] */
  .d-index-count {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: white;
    line-height: 2;
  }

  /* Figma: PostsEng — flex-col gap-[50px] */
  .d-posts {
    display: flex;
    flex-direction: column;
    gap: 50px;
  }

  /* Figma: List — bg-white overflow-clip rounded-[30px] flex items-start justify-between */
  .d-post {
    background: white;
    border-radius: 30px;
    overflow: hidden;
    display: flex;
    align-items: stretch;
  }

  /* Figma: IndexBar — 15px wide colored bar (shrink-0) */
  .d-post-bar {
    width: 15px;
    flex-shrink: 0;
  }

  /* Figma: Writing — flex-[1_0_0] p-[40px] gap-[15px] flex-col justify-center */
  .d-post-writing {
    flex: 1 0 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 15px;
    padding: 40px;
  }
  /* Figma: 16px Bold Noto #444 leading-[2] whitespace-nowrap */
  .d-post-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: #444444;
    margin: 0;
    line-height: 2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Figma: 14px Bold Noto #444 leading-[1] */
  .d-post-desc {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 700;
    color: #444444;
    margin: 0;
    line-height: 1.6;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  /* Figma: Img — 600px wide, 300px tall */
  .d-post-img-wrap {
    width: 600px;
    height: 300px;
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
    border-radius: 0 30px 30px 0;
  }
  .d-post-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }

  /* ════════════════════════════════════════
     MOBILE — 기본 표시, 768px+ 숨김
  ════════════════════════════════════════ */
  .m-page { display: block; }
  @media (min-width: 768px) { .m-page { display: none; } }

  /* ── HeadKeyword ── */
  .m-head { padding-top: 95px; }
  .m-head-inner {
    padding: 50px 25px 30px;
    display: flex;
    flex-direction: column;
    gap: 30px;
  }
  /* Figma: Head — flex-col gap-[5px] items-center */
  .m-head-top {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
  }
  .m-head-icon { flex-shrink: 0; }
  /* Figma: 30px Bold SB Aggro #FF3535 */
  .m-head-title {
    font-family: 'SB AggroOTF', 'Noto Sans KR', sans-serif;
    font-size: 30px;
    font-weight: 700;
    color: #ff3535;
    margin: 0;
    line-height: normal;
  }
  /* Figma: 18px Medium Noto #666 */
  .m-head-desc {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 18px;
    font-weight: 500;
    color: #666666;
    margin: 0;
    line-height: 1.6;
  }
  /* Figma: Frame3 — flex-wrap gap-[10px] */
  .m-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  /* Figma: bg-[#e1def3] rounded-[13px] px-[25px] py-[8px] text-[14px] Medium #444 */
  .m-chip {
    background: #e1def3;
    border-radius: 13px;
    padding: 8px 25px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 500;
    color: #444444;
    white-space: nowrap;
  }
  .m-chip-help { width: 30px; height: 30px; flex-shrink: 0; }

  /* ── HeadPosts: 3 list sections ── */
  .m-list { padding: 0 25px 10px; }
  /* Figma: py-[40px] flex justify-between items-center */
  .m-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 40px 0;
  }
  /* Figma: 21px Bold Noto #100B32 */
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

  /* Figma: horizontal scroll — flex gap-[50px] overflow-x snap */
  .m-carousel {
    display: flex;
    gap: 50px;
    overflow-x: auto;
    padding-bottom: 20px;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .m-carousel::-webkit-scrollbar { display: none; }

  /* Figma: card — min-w-[340px] max-w-[605px] min-h-[300px] max-h-[400px] rounded-[30px] shadow */
  .m-card {
    position: relative;
    flex-shrink: 0;
    width: 340px;
    height: 400px;
    min-width: 340px;
    border-radius: 30px;
    box-shadow: 4px 4px 0px rgba(39,27,122,0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    scroll-snap-align: start;
  }
  .m-card-bg {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: 30px;
    pointer-events: none;
  }
  .m-card-bg-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  /* Figma: shrink-0 header bar */
  .m-card-header {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 30px;
  }
  /* Figma: Tilt Warp 24px white */
  .m-card-category {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 24px;
    color: white;
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
  /* Figma: Script — flex-[1_0_0] flex-col justify-between items-center */
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
  /* Figma: Writing — bg-gradient-to-t from-rgba(16,11,50,0) to-#100b32 via-[40%] */
  .m-card-writing {
    flex-shrink: 0;
    width: 100%;
    background: linear-gradient(to top, rgba(16,11,50,0) 0%, rgba(16,11,50,0.6) 40%, #100b32 100%);
    padding: 20px 30px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  /* Figma: 24px Black(900) Noto white leading-[1.6] */
  .m-card-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 24px;
    font-weight: 900;
    color: white;
    margin: 0;
    line-height: 1.6;
    letter-spacing: -0.5px;
  }
  /* Figma: 18px Bold Noto white */
  .m-card-sub {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: white;
    margin: 0;
    line-height: 1.6;
    letter-spacing: -0.3px;
  }
  /* Figma: dots — py-[20px] flex gap items-center */
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

  /* ── Component (콘텐츠): gradient bg + article cards ── */
  /* Figma: from-rgba(225,222,243,0.95) via-rgba(225,222,243,0.8) to-rgba(225,222,243,0)
     rounded-bl-[50px] rounded-tr-[50px] pt-[70px] pb-[100px] px-[25px] */
  .m-content-inner {
    background: linear-gradient(180deg,
      rgba(225,222,243,0.95) 0%,
      rgba(225,222,243,0.8)  26%,
      rgba(225,222,243,0)    50.5%
    );
    border-radius: 0 50px 0 50px;
    padding: 70px 25px 100px;
    display: flex;
    flex-direction: column;
    gap: 50px;
  }
  /* Figma: bg-white rounded-[30px] w-340px overflow-hidden */
  .m-article {
    background: white;
    border-radius: 30px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    width: 340px;
  }
  /* Figma: h-[150px] min-w-[340px] */
  .m-article-img-wrap {
    height: 150px;
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
  /* Figma: writing section px-[30px] py-[20px] gap-[10px] */
  .m-article-body {
    padding: 20px 30px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  /* Figma: 18px Bold Noto #444 leading-[1.6] */
  .m-article-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: #444444;
    margin: 0;
    line-height: 1.6;
    letter-spacing: -0.3px;
  }
  /* Figma: 12px Medium Noto #666 */
  .m-article-meta {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: #666666;
    margin: 0;
    line-height: 1.6;
  }
</style>
