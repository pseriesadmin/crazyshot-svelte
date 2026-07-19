<script lang="ts">
  import type { PageData } from './$types'
  interface Props { data: PageData }
  let { data }: Props = $props()

  const TABS = [
    { label: '상품리뷰', countKey: 'review' as const },
    { label: '일상공유', countKey: 'share'  as const },
    { label: '채널홍보', countKey: 'promo'  as const },
  ]

  const TAB_MAP: Record<string, string> = {
    '상품리뷰': '상품리뷰',
    '일상공유': '일상공유',
    '채널홍보': '채널홍보',
  }

  const M_KEYWORDS = ['양양의 기억 로그', 'Mini2se 리뷰 로그', '신상로그', 'Air 3S Drone', 'Air 3S Drone', 'Air 3S Drone']

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

        <!-- col-1: 병렬 래퍼 — text tile + Flash Deals 수직 스택 -->
        <div class="d-col1-wrap">

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
        <!-- Figma: h-[400px], bg hero-shotlog1.png, bg-[#201857] header + gradient writing -->
        <a href="/crazylog/view/1" class="d-shotlog">
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
            <p class="d-shotlog-writing-sub">올어라운드 렌즈의 끝판왕</p>
          </div>
        </a>

        </div><!-- /d-col1-wrap -->

        <!-- col-2: 병렬 래퍼 — grid-row 1/3 span, justify-end으로 bottom 730px 정렬 -->
        <div class="d-col2-wrap">

        <!-- col-2 row-1: Shotlog1 (hero-shotlog.png) -->
        <!-- Figma: col-2 row-1, bg-[#cf0000] "K-Trail log" header + writing -->
        <a href="/crazylog/view/1" class="d-shotlog1">
          <div class="d-shotlog1-bg">
            <img src="/crazylog/hero-shotlog.png" alt="" class="d-shotlog1-bg-img" />
          </div>
          <div class="d-shotlog1-header">
            <span class="d-shotlog1-label">채널홍보</span>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="transform:scaleY(-1)">
              <path d="M2 5L8 11L14 5" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/>
            </svg>
          </div>
          <div class="d-shotlog1-writing">
            <p class="d-shotlog1-title">경복궁 한복 체험</p>
            <p class="d-shotlog1-sub">K-트레일 나들이 완벽 가이드</p>
          </div>
        </a>

        <!-- col-2 row-2: Shotlog2 (hero-shotlog2.png) -->
        <!-- Figma: col-2 row-2, bg-[#3b2f8a] "Release" header + writing -->
        <a href="/crazylog/view/1" class="d-shotlog2">
          <div class="d-shotlog2-bg">
            <img src="/crazylog/hero-shotlog2.png" alt="" class="d-shotlog2-img" />
          </div>
          <div class="d-shotlog2-header">
            <span class="d-shotlog2-label">Release</span>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="transform:scaleY(-1)">
              <path d="M2 5L8 11L14 5" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/>
            </svg>
          </div>
          <div class="d-shotlog2-writing">
            <p class="d-shotlog2-title">DJI Mini2se Aerial Drone</p>
            <p class="d-shotlog2-sub">드론시장에서 품질은 없다.</p>
          </div>
        </a>

        </div><!-- /d-col2-wrap -->

      </div>
    </div>
  </section>

  <!-- Shotlog: ItemIndexBar + PostsEng -->
  <section class="d-posts-section">
    <div class="d-posts-wrap">

      <!-- ItemIndexBar: Review / Share / K-Trail log -->
      <!-- Figma: bg-[#3b2f8a] rounded-[30px] px-40 py-30, flex gap-[10px] -->
      <div class="d-index-bar">
        {#each TABS as tab}
          <a href="/crazylog/list?tab={TAB_MAP[tab.label]}" class="d-index-btn">
            <span class="d-index-label">{tab.label}</span>
            <span class="d-index-count-pill">{data.counts[tab.countKey]}</span>
          </a>
        {/each}
      </div>

      <!-- PostsEng: 8 rows -->
      <!-- Figma: flex-col gap-[50px] -->
      <div class="d-posts">
        {#each data.posts as post}
          <a href="/crazylog/view/{post.id}" class="d-post">
            <div class="d-post-bar" style="background:{post.bar}"></div>
            <div class="d-post-writing">
              <p class="d-post-title">{post.title}</p>
              {#if post.desc}
                <p class="d-post-desc">{post.desc}</p>
              {/if}
            </div>
            <div class="d-post-img-wrap" style={post.rounded ? 'border-radius:0 30px 30px 0' : ''}>
              {#if post.img}
                <img src={post.img} alt={post.title} class="d-post-img" />
              {:else}
                <div class="d-post-img-placeholder" style="background:{post.bar}20"></div>
              {/if}
            </div>
          </a>
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
          <a href="/crazylog/new" aria-label="로그 작성" style="display:inline-flex;min-width:44px;min-height:44px;align-items:center;justify-content:center;">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect width="22" height="22" rx="7" fill="#E1DEF3"/>
              <path d="M11 6v10M6 11h10" stroke="#553FE0" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </a>
        </div>
      </div>
      <!-- Figma: horizontal scroll snap carousel -->
      <div class="m-carousel">
        {#each list.cards as card, ci}
          <a href="/crazylog/view/1" class="m-card">
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
          </a>
        {/each}
      </div>
    </section>
  {/each}

  <!-- Component (콘텐츠): gradient bg + article cards -->
  <section class="m-content">
    <div class="m-content-inner">
      {#each data.posts as post}
        <a href="/crazylog/view/{post.id}" class="m-article">
          {#if post.img}
            <div class="m-article-img-wrap">
              <img src={post.img} alt={post.title} class="m-article-img" />
            </div>
          {/if}
          <div class="m-article-body">
            <p class="m-article-title">{post.title}</p>
            {#if post.desc}
              <p class="m-article-meta">{post.desc}</p>
            {/if}
          </div>
        </a>
      {/each}
    </div>
  </section>

</div>

<style>
  /* ════════════════════════════════════════
     DESKTOP — 기본 숨김, 768px+ 표시
  ════════════════════════════════════════ */
  .d-page { display: none; }
  @media (min-width: 768px) {
    .d-page {
      display: flex;
      flex-direction: column;
      gap: 50px;
      align-items: center;
      padding: 150px 0 50px; /* GNB 100px + Figma py-[50px] */
    }
  }

  /* ── What's Buzzing 섹션 ── */
  .d-wb-section { width: 100%; }
  .d-wb-wrap {
    max-width: 1240px;
    margin: 0 auto;
    padding: 0 30px;
  }

  /* 병렬 flex: col-1(text+Flash Deals) / col-2 래퍼(K-Trail+Release) 나란히
     되돌리기: display:flex → display:grid / grid-template-columns/rows 복원
               d-col2-wrap 삭제 / d-shotlog1·d-shotlog2 grid-column/row 복원 */
  .d-wb-grid {
    display: flex;
    flex-direction: row;
    gap: 30px;
    height: 730px;
    border-radius: 50px;
    overflow: hidden;
  }

  /* col-2 래퍼: 730px 전체 높이 / 카드 2개를 하단 정렬 */
  .d-col2-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 30px;
    justify-content: flex-end;   /* K-Trail log + Release를 bottom 기준 정렬 */
  }

  /* col-1 래퍼: text tile(300px) + Flash Deals(400px) 수직 스택 */
  .d-col1-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 30px;
  }

  /* ── col-1 row-1: Title1 (lilac bg) ── */
  .d-title1 {
    background: var(--cs-lilac);
    border-radius: 50px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    overflow: hidden;
    height: 300px;
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
    position: relative;
    border-radius: 50px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    flex: 1;
    text-decoration: none;
    cursor: pointer;
  }
  .d-shotlog:hover .d-shotlog-bg-img { transform: scale(1.05); }
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
    transition: transform 0.4s ease;
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

  /* D-4: writing subtitle */
  .d-shotlog-writing-sub {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: white;
    margin: 0;
    line-height: 2;
    letter-spacing: -0.5px;
  }

  /* ── col-2 row-1: Shotlog1 (hero-shotlog.png) ── */
  .d-shotlog1 {
    position: relative;
    border-radius: 50px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    height: 300px;
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
    transition: transform 0.5s ease;
  }
  .d-shotlog1:hover .d-shotlog1-bg-img { transform: scale(1.10); }
  /* Figma: bg-[#cf0000] header */
  .d-shotlog1-header {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
    background: #cf0000;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 50px;
  }
  .d-shotlog1-label {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 20px;
    color: white;
    letter-spacing: -0.5px;
  }
  .d-shotlog1-writing {
    position: relative;
    z-index: 1;
    flex: 1;
    background: linear-gradient(to top, rgba(16,11,50,0) 0%, rgba(16,11,50,0.6) 40%, #100b32 100%);
    padding: 20px 40px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .d-shotlog1-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 25px;
    font-weight: 900;
    color: white;
    margin: 0;
    line-height: 2;
  }
  .d-shotlog1-sub {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: white;
    margin: 0;
    line-height: 2;
    letter-spacing: -0.5px;
  }

  /* ── col-2 row-2: Shotlog2 (hero-shotlog2.png, fill) ── */
  .d-shotlog2 {
    position: relative;
    border-radius: 50px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    height: 300px;
  }
  .d-shotlog2-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .d-shotlog2-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  /* Figma: bg-[#3b2f8a] header */
  .d-shotlog2-header {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
    background: #3b2f8a;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 50px;
  }
  .d-shotlog2-label {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 20px;
    color: white;
    letter-spacing: -0.5px;
  }
  .d-shotlog2-writing {
    position: relative;
    z-index: 1;
    flex: 1;
    background: linear-gradient(to top, rgba(16,11,50,0) 0%, rgba(16,11,50,0.6) 40%, #100b32 100%);
    padding: 20px 40px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .d-shotlog2-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 25px;
    font-weight: 900;
    color: white;
    margin: 0;
    line-height: 2;
  }
  .d-shotlog2-sub {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: white;
    margin: 0;
    line-height: 2;
    letter-spacing: -0.5px;
  }

  /* ── 포스트 섹션 ── */
  .d-posts-section { width: 100%; }
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
    background: #3b2f8a;
    border: none;
    border-radius: var(--radius-xl);
    padding: 27px 40px;
    cursor: pointer;
    transition: background 0.2s, transform 0.2s, box-shadow 0.2s;
    min-height: 44px;
  }
  .d-index-btn-active { background: var(--cs-purple); }
  .d-index-btn:hover:not(.d-index-btn-active) {
    background: #553fe0;
    transform: translateY(-3px);
    box-shadow: 0 8px 28px rgba(85,63,224,0.45);
  }
  /* Figma: Tilt Warp 20px white */
  .d-index-label {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 20px;
    color: white;
    letter-spacing: -0.5px;
  }
  /* D-5: Figma: Noto 16px 700 white leading-[2] — bg-white/15 rounded-full pill */
  .d-index-count-pill {
    background: rgba(255,255,255,0.15);
    border-radius: 9999px;
    padding: 2px 12px;
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

  /* list 카드 스타일 반영 */
  .d-post {
    background: var(--cs-white);
    border-radius: var(--radius-lg);  /* 20px — /list 카드와 동일 */
    overflow: hidden;
    display: flex;
    align-items: stretch;
    height: 180px;
    text-decoration: none;
    cursor: pointer;
    transition: box-shadow 0.2s;
  }
  .d-post:hover { box-shadow: 0 4px 20px rgba(16,11,50,0.12); }

  /* D-7: grid card hover */
  .d-shotlog, .d-shotlog1, .d-shotlog2 { transition: transform 0.5s ease, box-shadow 0.5s ease; }
  .d-shotlog:hover, .d-shotlog1:hover, .d-shotlog2:hover {
    transform: translateY(-4px);
    box-shadow: 0 20px 60px rgba(16,11,50,0.45);
  }
  .d-shotlog-bg-img { transition: transform 0.5s ease; }
  .d-shotlog:hover .d-shotlog-bg-img { transform: scale(1.10); }
  .d-shotlog2:hover .d-shotlog2-img { transform: scale(1.10); }

  /* list 스타일: colored bar */
  .d-post-bar {
    width: 15px;
    flex-shrink: 0;
  }

  /* list 스타일: writing 영역 — padding·gap 축소 */
  .d-post-writing {
    flex: 7;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 12px;
    padding: 24px 30px;
  }
  /* list 카드 타이틀: 16px */
  .d-post-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-text-dark);
    margin: 0;
    line-height: 1.5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .d-post-desc {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-text-dark);
    margin: 0;
    line-height: 1.5;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  /* isList 항목 — <ul><li> 형식 */
  .d-post-desc-list {
    margin: 0;
    padding-left: 21px;
  }
  .d-post-desc-list-item {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-text-dark);
    line-height: 1.5;
  }

  /* list 스타일: 이미지 영역 */
  .d-post-img-wrap {
    flex: 3;
    flex-shrink: 0;
    min-width: 180px;
    position: relative;
    overflow: hidden;
    /* border-radius는 rounded 항목에만 인라인 style로 적용 */
  }
  .d-post-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  .d-post-img-placeholder {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
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
    width: 100%;
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
