<script lang="ts">
  import { goto } from '$app/navigation'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  let searchInput = $state(data.search ?? '')

  $effect(() => { searchInput = data.search ?? '' })

  function applySearch() {
    const params = new URLSearchParams()
    if (searchInput.trim()) params.set('search', searchInput.trim())
    goto(`/cms/customers/score?${params.toString()}`, { replaceState: true })
  }

  function getScoreClass(score: number): string {
    if (score >= 85) return 'score-high'
    if (score >= 70) return 'score-mid'
    if (score >= 50) return 'score-low'
    return 'score-critical'
  }

  function formatDelta(old_s: number, new_s: number): string {
    const d = new_s - old_s
    return d > 0 ? `+${d}` : `${d}`
  }

  function deltaClass(old_s: number, new_s: number): string {
    return new_s > old_s ? 'delta-pos' : 'delta-neg'
  }

  function formatDateTime(dt: string): string {
    return dt ? dt.slice(0, 16).replace('T', ' ') : '-'
  }

  function getSource(metadata: Record<string, unknown> | null): string {
    if (!metadata) return '-'
    const src = metadata.source as string | undefined
    if (src === 'admin_manual') return '관리자 수동'
    if (src === 'auto_recalc')  return '자동 재산정'
    return src ?? '-'
  }
</script>

<div class="page-wrap">
  <div class="page-header">
    <h1 class="page-title">스코어 관리</h1>
    <p class="page-sub">크레이지스코어 조정 이력을 확인합니다. (최근 100건)</p>
  </div>

  <!-- 툴바 -->
  <div class="toolbar">
    <div class="search-wrap">
      <input
        class="search-in"
        type="search"
        placeholder="이름·이메일 검색"
        bind:value={searchInput}
        onkeydown={(e) => e.key === 'Enter' && applySearch()}
      />
      <button class="btn-secondary" onclick={applySearch}>검색</button>
    </div>
    <span class="count-badge">총 {data.entries.length}건</span>
  </div>

  <!-- 테이블 -->
  <div class="table-card">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>이름 / 이메일</th>
            <th>이전 점수</th>
            <th>→</th>
            <th>변경 점수</th>
            <th>변동</th>
            <th>조정 방식</th>
            <th>사유</th>
            <th>일시</th>
          </tr>
        </thead>
        <tbody>
          {#each data.entries as entry (entry.id)}
            <tr>
              <td>
                <div class="user-cell">
                  <span class="user-name">{entry.user_name ?? '-'}</span>
                  <span class="user-email">{entry.user_email ?? '-'}</span>
                </div>
              </td>
              <td>
                <span class="score-val {getScoreClass(entry.old_score)}">{entry.old_score}점</span>
              </td>
              <td class="arrow-cell">→</td>
              <td>
                <span class="score-val {getScoreClass(entry.new_score)}">{entry.new_score}점</span>
              </td>
              <td>
                <span class="delta-badge {deltaClass(entry.old_score, entry.new_score)}">
                  {formatDelta(entry.old_score, entry.new_score)}
                </span>
              </td>
              <td>
                <span class="source-tag">{getSource(entry.metadata)}</span>
              </td>
              <td class="reason-cell">{entry.reason}</td>
              <td class="dt-cell">{formatDateTime(entry.created_at)}</td>
            </tr>
          {:else}
            <tr>
              <td colspan="8" class="no-data">스코어 조정 이력이 없습니다.</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <!-- 안내 -->
  <div class="info-panel">
    스코어 수동 조정은 <a href="/cms/customers">고객목록</a>에서 고객을 선택한 후 [크레이지스코어] 탭을 이용하세요.
  </div>
</div>

<style>
  .page-wrap {
    flex: 1; min-height: 0; overflow-y: auto;
    padding: 20px 24px 32px;
    display: flex; flex-direction: column; gap: 16px;
  }
  .page-header { margin-bottom: 4px; }
  .page-title  { font: var(--text-pc-title-18); color: var(--cs-text); margin: 0 0 4px; }
  .page-sub    { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0; }

  .toolbar { display: flex; align-items: center; gap: 12px; justify-content: space-between; }
  .search-wrap { display: flex; gap: 6px; }
  .search-in {
    background: var(--cs-white); border: 1px solid #ECEBF4; border-radius: var(--radius-sm);
    padding: 10px 20px; font: var(--text-pc-body-14); color: var(--cs-text); width: 240px;
  }
  .search-in:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; border-color: var(--cs-purple); }
  .btn-secondary {
    display: inline-flex; align-items: center; height: 44px; padding: 0 20px;
    background: var(--cs-white); color: var(--cs-purple-dark); border: 1px solid #201857;
    border-radius: var(--radius-md); font: var(--text-pc-body-14); cursor: pointer; transition: background 0.12s;
  }
  .btn-secondary:hover { background: rgba(59,47,138,0.06); }
  .count-badge { font: var(--text-pc-script-12); color: var(--cs-text-mid); background: var(--cs-surface-gray); padding: 4px 10px; border-radius: var(--radius-sm); }

  .table-card { background: var(--cs-white); border-radius: var(--cms-radius-md); overflow: hidden; box-shadow: 0px 1px 4px rgba(0,0,0,0.06); }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font: var(--text-pc-body-14); color: var(--cs-text); }
  thead th {
    background: var(--cs-lilac); color: var(--cs-text-mid); font: var(--text-pc-script-12); font-weight: 700;
    padding: 10px 16px; text-align: left; white-space: nowrap; border-bottom: 1px solid #ECEBF4;
  }
  tbody tr { border-bottom: 1px solid var(--cs-surface-gray); }
  tbody tr:hover { background: rgba(59,47,138,0.04); }
  tbody tr:last-child { border-bottom: none; }
  td { padding: 10px 16px; vertical-align: middle; }

  .user-cell { display: flex; flex-direction: column; gap: 2px; }
  .user-name  { font-weight: 700; }
  .user-email { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

  .score-val { font-weight: 700; }
  .score-high     { color: var(--cs-success-light); }
  .score-mid      { color: var(--cs-text); }
  .score-low      { color: var(--cs-warning); }
  .score-critical { color: var(--cs-red-badge); }

  .arrow-cell { color: var(--cs-text-light); font: var(--text-pc-script-12); padding-inline: 0; }

  .delta-badge {
    display: inline-flex; align-items: center; padding: 2px 8px;
    border-radius: var(--radius-sm); font: var(--text-pc-script-12); font-weight: 700;
  }
  .delta-pos { background: rgba(16,185,129,0.12); color: var(--cs-success-light); }
  .delta-neg { background: rgba(255,53,53,0.10);  color: var(--cs-red-badge); }

  .source-tag {
    display: inline-flex; align-items: center; padding: 2px 8px;
    border-radius: var(--radius-sm); font: var(--text-pc-descript-10);
    background: rgba(59,47,138,0.08); color: var(--cs-purple);
  }

  .reason-cell { max-width: 200px; color: var(--cs-text-mid); font: var(--text-pc-script-12); }
  .dt-cell     { font: var(--text-pc-script-12); color: var(--cs-text-mid); white-space: nowrap; }

  .no-data { text-align: center; padding: 40px 20px; color: var(--cs-text-light); font: var(--text-pc-body-14); }

  .info-panel {
    background: #F3F4F6; border-radius: var(--cms-radius-sm);
    padding: 12px 14px; font: var(--text-pc-descript-10); color: var(--cs-text-mid); line-height: 160%;
  }
  .info-panel a { color: var(--cs-purple); text-decoration: underline; }
</style>
