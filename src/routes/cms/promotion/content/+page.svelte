<script lang="ts">
  import type { PageData } from './$types'
  import CmsKpiGrid from '$lib/components/cms/CmsKpiGrid.svelte'
  import CmsStatRing from '$lib/components/cms/CmsStatRing.svelte'
  import CmsStatBars from '$lib/components/cms/CmsStatBars.svelte'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const LOG_TYPES = ['상품리뷰', '일상공유', '채널홍보']

  const publishRate = $derived(
    data.stats.total_posts > 0
      ? Math.round((data.stats.published_posts / data.stats.total_posts) * 1000) / 10
      : 0
  )

  const avgViews = $derived(
    data.stats.published_posts > 0
      ? Math.round(data.stats.total_views / data.stats.published_posts)
      : 0
  )
</script>

<div class="page-wrap">
  <div class="page-header">
    <h1 class="page-title">크레이지로그 콘텐츠</h1>
    <p class="page-sub">사용자 로그 게시물 현황과 인기 콘텐츠를 확인합니다.</p>
  </div>

  <CmsKpiGrid columns={3} cards={[
    { label: '총 게시물 수', value: data.stats.total_posts.toLocaleString('ko-KR'), unit: '건', tone: 'primary' },
    { label: '게시된 게시물', value: data.stats.published_posts.toLocaleString('ko-KR'), unit: '건', tone: 'info' },
    { label: '총 조회수', value: data.stats.total_views.toLocaleString('ko-KR'), unit: '회', tone: 'primary' },
  ]} />

  <div class="hero-stats">
    <div class="hero-ring">
      <CmsStatRing value={publishRate} label="게시율" tone="primary" size={140} />
    </div>
    <div class="hero-bars">
      <div class="hero-bars-title">카테고리별 게시물 수 (평균 조회수 {avgViews.toLocaleString('ko-KR')}회)</div>
      <CmsStatBars unit="건" items={LOG_TYPES.map((type, i) => ({
        label: type,
        value: data.stats.posts_by_log_type[type] ?? 0,
        tone: (i % 2 === 0 ? 'primary' : 'info') as 'primary' | 'info',
      }))} />
    </div>
  </div>

  <div class="table-card">
    {#if data.stats.top_posts.length === 0}
      <p class="no-data">인기 게시물 데이터가 없습니다.</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>제목</th>
              <th>카테고리</th>
              <th class="txt-right">조회수</th>
            </tr>
          </thead>
          <tbody>
            {#each data.stats.top_posts as post}
              <tr>
                <td><a href="/crazylog/view/{post.id}" target="_blank" rel="noopener">{post.title}</a></td>
                <td><span class="seg-badge">{post.log_type ?? '-'}</span></td>
                <td class="txt-right">{post.view_count.toLocaleString('ko-KR')}회</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

<style>
  .page-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 20px 24px 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .page-header { margin-bottom: 4px; }
  .page-title  { font: var(--text-pc-htitle-25); color: var(--cs-text); margin: 0 0 4px; }
  .page-sub    { font: var(--text-pc-script-12);  color: var(--cs-text-mid); margin: 0; }

  .hero-stats {
    display: flex; gap: 24px;
    background: var(--cs-white); border-radius: var(--cms-radius-lg);
    padding: 28px 32px;
    box-shadow: 0px 1px 4px rgba(0,0,0,0.06);
  }
  .hero-ring {
    display: flex; align-items: center; justify-content: center;
    flex: 0 0 auto; padding-right: 24px;
    border-right: 1px solid var(--cs-surface-gray);
  }
  .hero-bars { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 14px; }
  .hero-bars-title { font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text); }

  .table-card {
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    overflow: hidden;
  }
  .table-wrap { overflow-x: auto; }

  table {
    width: 100%;
    border-collapse: collapse;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
  }
  thead th {
    background: var(--cs-lilac);
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    padding: 10px 16px;
    text-align: left;
    white-space: nowrap;
  }
  thead th.txt-right { text-align: right; }
  tbody tr { border-bottom: 1px solid var(--cs-surface-gray); }
  tbody tr:hover { background: rgba(59,47,138,0.04); }
  tbody tr:last-child { border-bottom: none; }
  td { padding: 10px 16px; vertical-align: middle; }
  td.txt-right { text-align: right; }
  td a { color: var(--cs-purple); text-decoration: none; }
  td a:hover { text-decoration: underline; }

  .seg-badge {
    display: inline-block;
    background: rgba(59,47,138,0.08);
    color: var(--cs-purple);
    border-radius: var(--radius-sm);
    padding: 2px 8px;
    font: var(--text-pc-script-12);
  }

  .no-data {
    text-align: center;
    padding: 40px 20px;
    font: var(--text-pc-body-14);
    color: var(--cs-text-light);
    margin: 0;
  }
</style>
