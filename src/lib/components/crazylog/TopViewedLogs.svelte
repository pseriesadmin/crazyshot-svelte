<script lang="ts">
  // 크레이지로그 상세 하단 — 같은 분류에서 조회수 많은 순 로그 목록(최대 10개).
  // 카드 모양은 목록 화면(/crazylog/list)의 모바일 이미지 카드(.m-post-card)와 동일하고, PC·모바일 모두 같은 카드를 쓴다.
  interface TopViewedItem {
    id: string
    title: string
    logType: string
    createdAt: string
    thumbnailUrl: string | null
  }
  interface Props {
    posts: TopViewedItem[]
  }
  let { posts }: Props = $props()

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (mins < 1) return '방금 전'
    if (hours < 1) return `${mins}분 전`
    if (days < 1) return `${hours}시간 전`
    if (days < 30) return `${days}일 전`
    return new Date(iso).toLocaleDateString('ko-KR')
  }
</script>

{#if posts.length > 0}
  <ul class="tv-list">
    {#each posts as post (post.id)}
      <li>
        <a href="/crazylog/view/{post.id}" class="tv-card" aria-label={post.title}>
          {#if post.thumbnailUrl}
            <img src={post.thumbnailUrl} alt="" loading="lazy" class="tv-bg" aria-hidden="true" />
          {:else}
            <div class="tv-bg tv-bg-empty" aria-hidden="true"></div>
          {/if}
          <div class="tv-overlay" aria-hidden="true"></div>
          <div class="tv-content">
            <span class="tv-date">{post.logType} · {relativeTime(post.createdAt)}</span>
            <p class="tv-title">{post.title}</p>
          </div>
        </a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .tv-list {
    list-style: none;
    margin: 0;
    padding: 0;
    width: 100%;
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--layout-section-gap);   /* 50px — 목록 화면 모바일 카드 간격(.m-posts)과 같은 공통 값, PC·모바일 동일 */
  }
  @media (min-width: 768px) {
    .tv-list { grid-template-columns: repeat(2, 1fr); }
  }
  .tv-card {
    position: relative;
    display: block;
    width: 100%;
    height: 264px;
    border-radius: 30px;
    overflow: hidden;
    background: var(--cs-dark);
    text-decoration: none;
    color: inherit;
  }
  .tv-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  .tv-bg-empty { background: var(--cs-dark); }
  .tv-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to top,
      rgba(16, 11, 50, 0.82) 0%,
      rgba(16, 11, 50, 0.30) 60%,
      rgba(16, 11, 50, 0.05) 100%
    );
  }
  .tv-content {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 18px 22px 20px;
    gap: 4px;
  }
  .tv-date {
    font: var(--text-m-script-12);
    color: rgba(255, 255, 255, 0.65);
    letter-spacing: 0.2px;
  }
  .tv-title {
    font: var(--text-m-ad-kr-18);
    color: var(--cs-white);
    margin: 0;
    line-height: 1.4;
    letter-spacing: -0.3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
