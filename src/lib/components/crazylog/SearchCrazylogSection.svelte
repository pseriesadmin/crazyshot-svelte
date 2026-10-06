<script module lang="ts">
  export interface SearchCrazylogPost {
    id: string
    title: string
    logType: string
    author: string
    thumbnailUrl: string | null
    createdAt: string
  }
</script>

<script lang="ts">
  import { formatRelativeTimeKo } from '$lib/utils/relativeTimeKo'
  import Arrow02Icon from '$lib/components/common/Arrow02Icon.svelte'

  interface Props {
    posts?: SearchCrazylogPost[]
    /** 위에 상품 결과 섹션이 없을 때(첫 섹션) 우상단 라운드·상단 패딩 적용 */
    topRound?: boolean
    /** 있으면 목록 아래에 "더보기" 링크 노출(결과가 조회 한도를 채웠을 때만 전달) */
    moreHref?: string
  }

  let { posts = [], topRound = false, moreHref }: Props = $props()

  const FALLBACK_IMG = '/crazylog/content-hero.png'
</script>

{#if posts.length > 0}
<section class="log-section" class:log-section--top={topRound}>
  <div class="log-inner">
    <div class="log-header">
      <h2 class="log-title">크레이지로그</h2>
      <span class="log-count">{posts.length}</span>
    </div>

    <!-- 표시 순서 = API(MiniSearch) 점수순 그대로 -->
    <div class="log-grid">
      {#each posts as p (p.id)}
        <a class="log-card" href="/crazylog/view/{p.id}" aria-label={p.title}>
          <div class="log-img-wrap">
            <img class="log-img" src={p.thumbnailUrl ?? FALLBACK_IMG} alt="" loading="lazy" />
          </div>
          <div class="log-info">
            {#if p.logType}<p class="log-type">{p.logType}</p>{/if}
            <p class="log-name">{p.title}</p>
            <p class="log-meta">{formatRelativeTimeKo(p.createdAt)}·by {p.author}</p>
          </div>
        </a>
      {/each}
    </div>

    {#if moreHref}
      <div class="log-more-wrap">
        <a class="log-more" href={moreHref}>
          <span>더보기</span>
          <Arrow02Icon size={14} />
        </a>
      </div>
    {/if}
  </div>
</section>
{/if}

<style>
  /* 상품 결과 섹션(SearchProductGrid .results-section)과 같은 흰 섹션 — 바로 아래에 이어 붙는다 */
  .log-section {
    width: 100%;
    padding: 0 25px 100px;
    background: var(--cs-bg-primary, #ffffff);
  }
  .log-section--top {
    border-radius: 0 50px 0 0;
  }
  @media (min-width: 1024px) {
    .log-section {
      padding: 0 100px 80px;
    }
  }
  .log-inner {
    max-width: 1600px;
    margin: 0 auto;
  }
  .log-header {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 23.4px 0 18px;          /* 모바일: 상품 결과 헤더와 동일(상단 +30%) */
  }
  .log-title {
    margin: 0;
    font: var(--text-m-body-16L);    /* 모바일: 한 단계 작은 토큰(16px Medium) */
    line-height: 1.6;
    letter-spacing: -0.3px;
    color: var(--cs-text-dark, #444444);
    font-family: 'Noto Sans KR', sans-serif;
  }
  .log-count {
    font: var(--text-m-script-14);   /* 모바일: 한 단계 작은 토큰(14px Medium) */
    line-height: 1.6;
    letter-spacing: -0.5px;
    color: var(--cs-text-dark, #444444);
    font-family: 'Noto Sans KR', sans-serif;
  }

  /* 더보기 — 우측 정렬 텍스트 링크(터치 44px) */
  .log-more-wrap {
    display: flex;
    justify-content: flex-end;
    margin-top: 20px;
  }
  .log-more {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 44px;
    text-decoration: none;
    font: var(--text-m-script-14B);
    color: var(--cs-purple);
  }
  .log-more:hover {
    color: var(--cs-purple-hover);
  }

  /* 모바일 2열 — 상품 그리드(.product-grid)와 동일 간격 */
  .log-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 26px 10px;
  }
  .log-card {
    width: calc(50% - 5px);
    min-width: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    text-decoration: none;
    cursor: pointer;
  }
  .log-img-wrap {
    width: 100%;
    aspect-ratio: 1;
    overflow: hidden;
    background: var(--cs-lilac);
    border-radius: var(--radius-lg) var(--radius-sm) var(--radius-lg) var(--radius-sm);
  }
  .log-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.3s ease;
  }
  .log-card:hover .log-img {
    transform: scale(1.04);
  }
  .log-card:focus-visible {
    outline: 2px solid var(--cs-purple);
    outline-offset: 4px;
  }

  /* 정보 블록 — 상품 카드(.pc-info) 모바일 확정 토큰과 동일 구조·간격 */
  .log-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10.8px;
    padding: 10.8px 0 0;
    min-width: 0;
  }
  .log-type {
    margin: 0;
    font: var(--text-m-script-12);
    font-weight: 700;
    line-height: 1;
    color: var(--cs-text-light);
  }
  .log-name {
    margin: 0;
    width: 100%;
    font: var(--text-m-script-14B);
    line-height: 1.4;
    letter-spacing: -0.5px;
    color: var(--cs-purple-dark);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .log-meta {
    margin: 0;
    font: var(--text-m-script-12);
    line-height: 1;
    letter-spacing: -0.3px;
    color: var(--cs-text-mid);
  }

  @media (min-width: 768px) {
    /* PC — 결과 헤더 원래 크기 복원(상품 결과 헤더와 동일) */
    .log-header {
      padding: 30px 0;
    }
    .log-title {
      font-size: 18px;
    }
    .log-count {
      font-size: 16px;
    }
    .log-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 60px 30px;
    }
    .log-card {
      width: auto;
    }
    .log-img-wrap {
      border-radius: 33px 13px 33px 13px;
    }
    .log-info {
      gap: 14px;
      padding: 14px 0 0;
    }
    .log-type { font: var(--text-pc-script-12); font-weight: 700; line-height: 1; }
    .log-name { font: var(--text-pc-body-14); line-height: 1.4; }
    .log-meta { font: var(--text-pc-script-12); line-height: 1; }
    .log-more { font: var(--text-pc-body-14); }
  }
</style>
