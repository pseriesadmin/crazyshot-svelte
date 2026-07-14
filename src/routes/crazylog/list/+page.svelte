<script lang="ts">
  import { page } from '$app/state'

  const TABS = ['공유', '리뷰', '이벤트', '전체'] as const
  type Tab = typeof TABS[number]

  const STAT_TAB_MAP: Record<string, Tab> = {
    'Review':      '리뷰',
    'Share':       '공유',
    'K-Trail log': '이벤트',
  }

  const urlTab = page.url.searchParams.get('tab') as Tab | null
  let activeTab = $state<Tab>(
    (urlTab && (TABS as readonly string[]).includes(urlTab)) ? (urlTab as Tab) : '공유'
  )

  interface MobilePost {
    id: number
    title: string
    time: string
    author: string
    img: string
  }

  interface PcPost {
    id: number
    bar: string
    title: string
    desc: string
    img: string
    rounded: boolean
    isBullet?: boolean
  }

  const MOBILE_POSTS: MobilePost[] = [
    { id: 1, title: '[사용기] SONY FE 24-105  가볍게 고퀄 영상을 바로 만들어주다',       time: '1시간 전', author: '홍기동', img: '/crazylog/article-img1.png' },
    { id: 2, title: '액션캠의 왕좌를 되찾으러 돌아왔다.\nGoPro HERO13 Black',           time: '2시간 전', author: '유말자', img: '/crazylog/article-img2.png' },
    { id: 3, title: '휴대용 디자인으로 이동 중에도 미디어 카드에 쉽게 접근 가능',         time: '2시간 전', author: '유말자', img: '/crazylog/article-img3.png' },
    { id: 4, title: 'onn. 52인치 삼각대, 컴팩트 카메라, 스마트폰 및 GoPro 액션 카메라용 스', time: '2시간 전', author: '유말자', img: '/crazylog/article-img4.png' },
    { id: 5, title: 'K-트레일로그를 남기는 멋진 일은 우리들에게 즐거움의 폭증이다!!',     time: '2시간 전', author: '유말자', img: '/crazylog/article-img5.png' },
  ]

  const PC_POSTS: PcPost[] = [
    { id: 1, bar: '#3b2f8a', title: 'SONY FE 24-105 F4 G OSS',                          desc: 'Bower 6-in-1 Multi Selfie Tripod with Smartphone & GoPro Mount, Rechargeable Wireless Remote - Black',                                                img: '/crazylog/post-img1.png', rounded: true  },
    { id: 2, bar: '#553fe0', title: 'GoPro HERO13 Black',                               desc: 'Best-in-Class 5.3K Video - 5.3K video delivers breathtaking image quality with 91% more resolution than 4K and an incredible 665% more than 1080p.', img: '/crazylog/post-img2.png', rounded: false },
    { id: 3, bar: '#3b2f8a', title: 'SONY FE 24-105 F4 G OSS',                          desc: 'Bower 6-in-1 Multi Selfie Tripod with Smartphone & GoPro Mount, Rechargeable Wireless Remote - Black',                                                img: '/crazylog/post-img3.png', rounded: true  },
    { id: 4, bar: '#ff3535', title: '[Accessories] onn USB C/USB 2.0 Memory Card Reader for SD/Mic...', desc: 'SD and microSD card reader with USB and USB-C connectors for versatile connectivity',                                                img: '/crazylog/post-img4.png', rounded: false, isBullet: true },
    { id: 5, bar: '#3b2f8a', title: 'SONY FE 24-105 F4 G OSS',                          desc: 'Bower 6-in-1 Multi Selfie Tripod with Smartphone & GoPro Mount, Rechargeable Wireless Remote - Black',                                                img: '/crazylog/post-img1.png', rounded: true  },
    { id: 6, bar: '#553fe0', title: 'GoPro HERO13 Black',                               desc: 'Best-in-Class 5.3K Video - 5.3K video delivers breathtaking image quality with 91% more resolution than 4K and an incredible 665% more than 1080p.', img: '/crazylog/post-img2.png', rounded: false },
    { id: 7, bar: '#3b2f8a', title: 'SONY FE 24-105 F4 G OSS',                          desc: 'Bower 6-in-1 Multi Selfie Tripod with Smartphone & GoPro Mount, Rechargeable Wireless Remote - Black',                                                img: '/crazylog/post-img3.png', rounded: true  },
    { id: 8, bar: '#ff3535', title: '[Accessories] onn USB C/USB 2.0 Memory Card Reader for SD/Mic...', desc: 'SD and microSD card reader with USB and USB-C connectors for versatile connectivity',                                                img: '/crazylog/post-img4.png', rounded: false, isBullet: true },
  ]

  const PC_STATS = [
    { label: 'Review',      count: '212' },
    { label: 'Share',       count: '43'  },
    { label: 'K-Trail log', count: '39'  },
  ]

  let filteredPosts = $derived(
    activeTab === '전체' || activeTab === '공유'
      ? MOBILE_POSTS
      : activeTab === '리뷰'
        ? MOBILE_POSTS.slice(0, 3)
        : MOBILE_POSTS.slice(2, 4)
  )

  $effect(() => {
    document.body.classList.add('crazylog-list')
    return () => document.body.classList.remove('crazylog-list')
  })
</script>

<svelte:head>
  <style>
    @media (max-width: 767px) {
      body.crazylog-list .gnb-mobile-wrap { display: none !important; }
    }
  </style>
</svelte:head>

<!-- ══════════════════════════════════════════════════════════════
     Crazylog 목록 리스트 — 퍼블리싱 소스: Publish Crazylog list Design/App.tsx
══════════════════════════════════════════════════════════════ -->
<div class="list-root">
  <div class="list-wrap">

    <!-- ① 모바일 전용: TopNavBar ─────────────────────────────── -->
    <div class="m-top-nav">
      <div class="m-nav-pill">
        <button class="m-nav-icon-btn" onclick={() => history.back()} aria-label="뒤로 가기">
          <svg width="17" height="12" viewBox="0 0 17 12" fill="none" aria-hidden="true">
            <path d="M16 6H1M1 6L6 1M1 6L6 11" stroke="#444444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <span class="m-nav-title">모든 로그</span>
        <button class="m-nav-icon-btn" aria-label="메뉴 열기">
          <svg width="20" height="17" viewBox="0 0 20 17" fill="none" aria-hidden="true">
            <path d="M1 1.5H19"  stroke="#201857" stroke-width="2" stroke-linecap="round"/>
            <path d="M1 8.5H19"  stroke="#201857" stroke-width="2" stroke-linecap="round"/>
            <path d="M1 15.5H12" stroke="#201857" stroke-width="2" stroke-linecap="round"/>
            <circle cx="17" cy="15.5" r="3" fill="#CF0000"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- ② 공통: TabMenu ──────────────────────────────────────── -->
    <div class="tab-section">
      <div class="tab-inner">
        {#each TABS as tab}
          <button
            class="tab-btn"
            class:tab-btn-active={activeTab === tab}
            onclick={() => activeTab = tab}
          >
            {tab}
          </button>
        {/each}
      </div>
    </div>

    <!-- ③ 모바일 전용: WriteCtaCard ─────────────────────────── -->
    <div class="m-write-cta">
      <div class="m-cta-card">
        <div class="m-cta-text">
          <p class="m-cta-title">내로그 등록</p>
          <p class="m-cta-sub">멋진 로그로 <span class="m-cta-accent">내 채널</span> 알리기</p>
        </div>
        <button class="m-write-btn" aria-label="로그 작성하기">
          <svg width="25" height="27" viewBox="0 0 25 27" fill="none" aria-hidden="true">
            <path fill-rule="evenodd" clip-rule="evenodd"
              d="M17.5 2.5L22.5 7.5L8.5 21.5H3.5V16.5L17.5 2.5ZM17.5 5.33L19.67 7.5L7.5 19.67V18.5H6.33L17.5 5.33ZM3.5 23.5H21.5V25.5H3.5V23.5Z"
              fill="white"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- ④ 모바일 전용: MobileContentList ────────────────────── -->
    <div class="m-content">
      <div class="m-posts">
        {#each filteredPosts as post (post.id)}
          <div class="m-post-card">
            <div class="m-post-img-wrap">
              <img src={post.img} alt="" class="m-post-img" loading="lazy"/>
            </div>
            <div class="m-post-body">
              <p class="m-post-title">{post.title}</p>
              <p class="m-post-meta">{post.time}·by {post.author}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- ⑤ PC 전용: PcContentList ───────────────────────────── -->
    <div class="pc-content">
      <div class="pc-inner">

        <!-- PcIndexBar (gradient 영역 내부) -->
        <div class="pc-index-bar">
          {#each PC_STATS as stat}
            <button
              class="pc-stat-pill"
              class:pc-stat-pill-active={activeTab === STAT_TAB_MAP[stat.label]}
              onclick={() => activeTab = STAT_TAB_MAP[stat.label]}
            >
              <span class="pc-stat-label">{stat.label}</span>
              <span class="pc-stat-count">{stat.count}</span>
            </button>
          {/each}
        </div>

        <!-- PC 포스트 목록 -->
        <div class="pc-posts">
          {#each PC_POSTS as post (post.id)}
            <div class="pc-post">
              <div class="pc-bar" style="background: {post.bar}"></div>
              <div class="pc-text">
                <p class="pc-title">{post.title}</p>
                {#if post.isBullet}
                  <ul class="pc-desc-list">
                    <li class="pc-desc-bullet">{post.desc}</li>
                  </ul>
                {:else}
                  <p class="pc-desc">{post.desc}</p>
                {/if}
              </div>
              <div
                class="pc-img-wrap"
                style="border-radius: {post.rounded ? '0 20px 20px 0' : '0'}"
              >
                <img src={post.img} alt="" class="pc-img" loading="lazy"/>
              </div>
            </div>
          {/each}
        </div>

      </div>
    </div>

  </div>
</div>

<style>
  /* ── 루트 컨테이너 ─────────────────────────────────────────── */
  .list-root {
    background: var(--cs-lilac);
    min-height: 100vh;
    width: 100%;
  }
  .list-wrap {
    width: 100%;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
  }

  /* ── TopNavBar (모바일 전용) ──────────────────────────────── */
  .m-top-nav {
    width: 100%;
    padding: 40px 25px 0;
  }
  .m-nav-pill {
    background: var(--cs-purple-op10);
    border-radius: 20px;
    min-height: 60px;
    max-width: 1240px;
    margin: 0 auto;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 20px;
  }
  .m-nav-icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    flex-shrink: 0;
  }
  .m-nav-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 16px;
    color: var(--cs-text);
    letter-spacing: -0.5px;
    line-height: 1.6;
  }

  /* ── TabMenu (모바일 전용) ────────────────────────────────── */
  .tab-section {
    width: 100%;
    padding: 50px 25px 0;
  }
  @media (min-width: 768px) {
    .tab-section { display: none; }
  }
  .tab-inner {
    display: flex;
    align-items: center;
    max-width: 1240px;
    margin: 0 auto;
    width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tab-inner::-webkit-scrollbar { display: none; }
  .tab-btn {
    flex-shrink: 0;
    padding: 10px 30px;
    border-radius: var(--radius-xl);
    border: none;
    cursor: pointer;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 16px;
    letter-spacing: -0.5px;
    line-height: 1.6;
    background: transparent;
    color: var(--cs-text);
    min-height: 44px;
    transition: background 0.15s, color 0.15s;
  }
  .tab-btn-active {
    background: var(--cs-purple-dark);
    color: var(--cs-white);
  }

  /* ── WriteCtaCard (모바일 전용) ───────────────────────────── */
  .m-write-cta {
    width: 100%;
    padding: 50px 25px 30px;
  }
  .m-cta-card {
    background: var(--cs-white);
    border-radius: var(--radius-md);  /* card.mobile = 15px (front design system) */
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 30px;
  }
  .m-cta-text {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .m-cta-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 18px;
    color: var(--cs-text);
    letter-spacing: -0.3px;
    line-height: 1.6;
    margin: 0;
  }
  .m-cta-sub {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 500;
    font-size: 14px;
    color: var(--cs-text-dark);
    letter-spacing: -0.5px;
    line-height: 1.6;
    margin: 0;
  }
  .m-cta-accent {
    color: var(--cs-purple-light);
  }
  .m-write-btn {
    background: var(--cs-purple-light);
    border-radius: 25px;
    width: 70px;
    height: 70px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    cursor: pointer;
    transition: filter 0.15s;
  }
  .m-write-btn:hover { filter: brightness(1.1); }

  /* ── MobileContentList (모바일 전용) ─────────────────────── */
  .m-content {
    width: 100%;
    border-radius: 0 50px 0 50px;
    padding: 70px 25px 100px;
    background: linear-gradient(
      to bottom,
      rgba(225, 222, 243, 0.95) 0%,
      rgba(225, 222, 243, 0.8) 26%,
      rgba(225, 222, 243, 0) 50.5%
    );
  }
  .m-posts {
    display: flex;
    flex-direction: column;
    gap: 50px;
    width: 100%;
  }
  .m-post-card {
    background: var(--cs-white);
    border-radius: var(--radius-md);  /* card.mobile = 15px (front design system) */
    width: 100%;
    overflow: hidden;
  }
  .m-post-img-wrap {
    width: 100%;
    height: 150px;
    overflow: hidden;
    position: relative;
  }
  .m-post-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  .m-post-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 20px 30px;
  }
  .m-post-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 18px;
    color: var(--cs-text-dark);
    letter-spacing: -0.3px;
    line-height: 1.6;
    white-space: pre-wrap;
    margin: 0;
  }
  .m-post-meta {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 500;
    font-size: 12px;
    color: var(--cs-text-mid);
    letter-spacing: -0.5px;
    line-height: 1.6;
    margin: 0;
  }

  /* ── PcContentList (PC 전용) ──────────────────────────────── */
  .pc-content {
    width: 100%;
    border-radius: 0 50px 0 50px;
    padding: calc(var(--layout-header-h) + 60px) 25px 100px; /* GNB 120px + 여백 40px */
    background: linear-gradient(
      to bottom,
      rgba(225, 222, 243, 0.95) 0%,
      rgba(225, 222, 243, 0.8) 26%,
      rgba(225, 222, 243, 0) 50.5%
    );
  }
  .pc-inner {
    max-width: 1240px;
    margin: 0 auto;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 50px;
  }

  /* PcIndexBar */
  .pc-index-bar {
    display: flex;
    gap: 10px;
  }
  .pc-stat-pill {
    background: rgba(59,47,138,0.55);
    flex: 1;
    border-radius: var(--radius-xl);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 21px 40px;
    border: none;
    cursor: pointer;
    transition: background 0.2s, transform 0.2s, box-shadow 0.2s;
    min-height: 44px;
  }
  .pc-stat-pill-active {
    background: var(--cs-purple);
  }
  .pc-stat-pill:hover:not(.pc-stat-pill-active) {
    background: var(--cs-purple-light);
    transform: translateY(-3px);
    box-shadow: 0 8px 28px rgba(85,63,224,0.45);
  }
  .pc-stat-label {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 20px;
    color: var(--cs-white);
    letter-spacing: -0.5px;
    line-height: 1.6;
  }
  .pc-stat-count {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 16px;
    color: var(--cs-white);
    letter-spacing: -0.5px;
    line-height: 2;
  }

  /* PC 포스트 목록 */
  .pc-posts {
    display: flex;
    flex-direction: column;
    gap: 20px;          /* 50px → 20px: 카드 간 여백 축소 */
    width: 100%;
  }
  .pc-post {
    background: var(--cs-white);
    border-radius: var(--radius-lg);  /* card.pc = 20px (front design system) */
    overflow: hidden;
    display: flex;
    align-items: stretch;
    width: 100%;
    height: 180px;      /* 명시 고정 높이: 300px → 180px */
  }
  .pc-bar {
    width: 15px;
    flex-shrink: 0;
  }
  .pc-text {
    flex: 7;            /* 70% */
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 12px;
    padding: 24px 30px; /* 40px → 24px 30px */
  }
  .pc-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 16px;
    color: var(--cs-text-dark);
    letter-spacing: -0.5px;
    line-height: 1.5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin: 0;
  }
  .pc-desc {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 14px;
    color: var(--cs-text-dark);
    letter-spacing: -0.5px;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin: 0;
  }
  .pc-desc-list {
    margin: 0;
    padding-left: 21px;
  }
  .pc-desc-bullet {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 14px;
    color: var(--cs-text-dark);
    letter-spacing: -0.5px;
    line-height: 1.5;
  }
  .pc-img-wrap {
    flex: 3;            /* 30% */
    flex-shrink: 0;
    min-width: 180px;   /* 최소 너비 보장 */
    overflow: hidden;
    position: relative;
  }
  .pc-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    pointer-events: none;
  }

  /* ── 반응형 ───────────────────────────────────────────────── */
  @media (max-width: 767px) {
    .list-wrap  { max-width: 430px; }
    .pc-content { display: none; }
  }

  @media (min-width: 768px) {
    .list-wrap  { max-width: 1600px; }
    .m-top-nav,
    .m-write-cta,
    .m-content  { display: none; }
    /* Common GNB(100px) + 상단 여백 50px */
    .tab-section { padding-top: calc(var(--layout-header-h) + 50px); }
  }
</style>
