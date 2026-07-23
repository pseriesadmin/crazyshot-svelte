<script lang="ts">
  import { goto } from '$app/navigation'
  import type { PageData } from './$types'
  import CrazylogWriteCard from '$lib/components/common/CrazylogWriteCard.svelte'
  import BottomTabBar from '$lib/components/common/BottomTabBar.svelte'
  import SubGnb from '$lib/components/common/SubGnb.svelte'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const TABS = ['상품리뷰', '일상공유', '채널홍보', '전체'] as const
  type Tab = typeof TABS[number]

  const initialTab = data.activeTab
  let activeTab = $state<Tab>(
    (TABS as readonly string[]).includes(initialTab) ? (initialTab as Tab) : '전체'
  )

  const BAR_COLORS: Record<string, string> = {
    '상품리뷰': '#ff3535',
    '일상공유': '#553fe0',
    '채널홍보': '#3b2f8a',
  }

  function barColor(logType: string): string {
    return BAR_COLORS[logType] ?? '#3b2f8a'
  }

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime()
    const mins  = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days  = Math.floor(diff / 86400000)
    if (mins  <  1) return '방금 전'
    if (hours <  1) return `${mins}분 전`
    if (days  <  1) return `${hours}시간 전`
    if (days  < 30) return `${days}일 전`
    return new Date(iso).toLocaleDateString('ko-KR')
  }

  function onTabClick(tab: Tab) {
    activeTab = tab
    goto(`?tab=${tab}`, { replaceState: true })
  }

  const PC_STAT_TABS: { label: string; tab: Tab; countKey: 'review' | 'share' | 'promo' }[] = [
    { label: '상품리뷰', tab: '상품리뷰', countKey: 'review' },
    { label: '일상공유', tab: '일상공유', countKey: 'share'  },
    { label: '채널홍보', tab: '채널홍보', countKey: 'promo'  },
  ]

  let writeCardVisible = $state(true)

  $effect(() => {
    let lastY = window.scrollY
    function onScroll() {
      const currentY = window.scrollY
      writeCardVisible = currentY <= lastY
      lastY = currentY
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  })
</script>

<!-- ══════════════════════════════════════════════════════════════
     Crazylog 목록 리스트 — 퍼블리싱 소스: Publish Crazylog list Design/App.tsx
══════════════════════════════════════════════════════════════ -->
<SubGnb title="모든 로그" />

<div class="list-root">
  <div class="list-wrap">

    <!-- ② 공통: TabMenu ──────────────────────────────────────── -->
    <div class="tab-section">
      <div class="tab-inner">
        {#each TABS as tab}
          <button
            class="tab-btn"
            class:tab-btn-active={activeTab === tab}
            onclick={() => onTabClick(tab)}
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
        <a href="/crazylog/new" class="m-write-btn" aria-label="로그 작성하기">
          <svg width="25" height="27" viewBox="0 0 25 27" fill="none" aria-hidden="true">
            <path fill-rule="evenodd" clip-rule="evenodd"
              d="M17.5 2.5L22.5 7.5L8.5 21.5H3.5V16.5L17.5 2.5ZM17.5 5.33L19.67 7.5L7.5 19.67V18.5H6.33L17.5 5.33ZM3.5 23.5H21.5V25.5H3.5V23.5Z"
              fill="white"/>
          </svg>
        </a>
      </div>
    </div>

    <!-- ④ 모바일 전용: MobileContentList ────────────────────── -->
    <div class="m-content">
      <div class="m-posts">
        {#if data.posts.length === 0}
          <p class="m-empty">아직 등록된 로그가 없습니다.</p>
        {:else}
          {#each data.posts as post (post.id)}
            <a href="/crazylog/view/{post.id}" class="m-post-card">
              {#if post.thumbnailUrl}
                <div class="m-post-thumb">
                  <img src={post.thumbnailUrl} alt={post.title} loading="lazy" class="m-post-thumb-img" />
                </div>
              {/if}
              <div class="m-post-body" class:m-post-body-only={!post.thumbnailUrl}>
                <span class="m-post-log-type">{post.logType}</span>
                <p class="m-post-title">{post.title}</p>
                <p class="m-post-meta">{relativeTime(post.createdAt)}·by {post.author}</p>
              </div>
            </a>
          {/each}
        {/if}
      </div>
    </div>

    <!-- ⑤ PC 전용: PcContentList ───────────────────────────── -->
    <div class="pc-content">
      <div class="pc-inner">

        <!-- PcIndexBar -->
        <div class="pc-index-bar">
          {#each PC_STAT_TABS as stat}
            <button
              class="pc-stat-pill"
              class:pc-stat-pill-active={activeTab === stat.tab}
              onclick={() => onTabClick(stat.tab)}
            >
              <span class="pc-stat-label">{stat.label}</span>
              <span class="pc-stat-count-pill">{data.counts[stat.countKey]}</span>
            </button>
          {/each}
        </div>

        <!-- PC 포스트 목록 -->
        <div class="pc-posts">
          {#if data.posts.length === 0}
            <p class="pc-empty">아직 등록된 로그가 없습니다.</p>
          {:else}
            {#each data.posts as post (post.id)}
              <a href="/crazylog/view/{post.id}" class="pc-post">
                <div class="pc-bar" style="background: {barColor(post.logType)}"></div>
                <div class="pc-text">
                  <span class="pc-log-type">{post.logType}</span>
                  <p class="pc-title">{post.title}</p>
                  <p class="pc-meta">{relativeTime(post.createdAt)}·by {post.author}</p>
                </div>
                <div class="pc-thumb">
                  <img
                    src={post.thumbnailUrl ?? '/crazylog/content-hero.png'}
                    alt={post.title}
                    loading="lazy"
                    class="pc-thumb-img"
                  />
                </div>
              </a>
            {/each}
          {/if}
        </div>

      </div>
    </div>

  </div>
</div>

<CrazylogWriteCard
  currentUser={data.currentUser}
  isLoggedIn={data.isLoggedIn}
  visible={writeCardVisible}
/>

<BottomTabBar />

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
    text-decoration: none;
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
  .m-post-card {
    text-decoration: none;
    color: inherit;
  }
  .m-post-thumb {
    width: 100%;
    height: 200px;
    overflow: hidden;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
  }
  .m-post-thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .m-post-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 20px 30px;
  }
  .m-post-body-only {
    background: var(--cs-white);
    border-radius: var(--radius-md);
  }
  .m-post-log-type {
    font: var(--text-m-tag-11);
    color: var(--cs-purple);
    letter-spacing: 0.3px;
    text-transform: uppercase;
  }
  .m-empty {
    text-align: center;
    color: var(--cs-text-light);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    padding: 40px 0;
    margin: 0;
  }
  .m-post-title {
    font: var(--text-m-title-18B);
    color: var(--cs-text-dark);
    white-space: pre-wrap;
    margin: 0;
  }
  .m-post-meta {
    font: var(--text-m-script-12);
    color: var(--cs-text-mid);
    letter-spacing: -0.5px;
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
    background: var(--cs-purple);
    flex: 1;
    border-radius: var(--radius-xl);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 27px 40px;
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
  .pc-stat-count-pill {
    background: rgba(255,255,255,0.15);
    border-radius: 9999px;
    padding: 2px 12px;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 16px;
    color: var(--cs-white);
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
    border-radius: var(--radius-lg);
    overflow: hidden;
    display: flex;
    align-items: stretch;
    width: 100%;
    height: 180px;
    text-decoration: none;
    color: inherit;
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
    font: var(--text-pc-title-16);
    color: var(--cs-text-dark);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin: 0;
  }
  .pc-log-type {
    font: var(--text-pc-tag-11);
    color: var(--cs-purple);
    letter-spacing: 0.3px;
    text-transform: uppercase;
    margin: 0 0 4px;
    display: block;
  }
  .pc-meta {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    letter-spacing: -0.3px;
    margin: 0;
  }
  .pc-thumb {
    flex: 3;               /* 30% */
    flex-shrink: 0;
    overflow: hidden;
    border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
    background: var(--cs-lilac);
  }
  .pc-thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .pc-empty {
    text-align: center;
    color: var(--cs-text-light);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    padding: 40px 0;
    margin: 0;
  }

  /* ── 반응형 ───────────────────────────────────────────────── */
  @media (max-width: 767px) {
    .list-wrap  { max-width: 430px; }
    .pc-content { display: none; }
  }

  @media (min-width: 768px) {
    .list-wrap  { max-width: 1600px; }
    .m-write-cta,
    .m-content  { display: none; }
    /* Common GNB(100px) + 상단 여백 50px */
    .tab-section { padding-top: calc(var(--layout-header-h) + 50px); }
  }
</style>
