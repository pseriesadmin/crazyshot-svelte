<script lang="ts">
  import { goto } from '$app/navigation'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const PLAN_FILTERS = [
    { value: '',      label: '전체 등급' },
    { value: 'easy',  label: 'EASY' },
    { value: 'pop',   label: 'POP' },
    { value: 'crazy', label: 'CRAZY' },
  ]

  const STATUSES = [
    { value: '',          label: '전체 상태' },
    { value: 'active',    label: '활성' },
    { value: 'cancelled', label: '취소' },
    { value: 'paused',    label: '일시정지' },
    { value: 'expired',   label: '만료' },
  ]

  function setFilter(key: string, val: string) {
    const params = new URLSearchParams(window.location.search)
    if (val) params.set(key, val); else params.delete(key)
    goto(`/cms/customers/membership?${params.toString()}`, { replaceState: true })
  }

  function formatDate(dt: string | null): string {
    return dt ? dt.slice(0, 10) : '-'
  }

  function statusLabel(s: string): string {
    const m: Record<string, string> = { active: '활성', cancelled: '취소', paused: '일시정지', expired: '만료' }
    return m[s] ?? s
  }
</script>

<div class="page-wrap">
  <div class="page-header">
    <h1 class="page-title">멤버십 현황</h1>
    <p class="page-sub">구독 중인 회원과 멤버십 이력을 관리합니다.</p>
  </div>

  <!-- KPI 카드 -->
  <div class="kpi-row">
    <div class="kpi-card kpi-easy">
      <span class="kpi-label">EASY 구독자</span>
      <span class="kpi-value">{data.stats.easy}명</span>
      <span class="kpi-price">9,900원/월</span>
    </div>
    <div class="kpi-card kpi-pop">
      <span class="kpi-label">POP 구독자</span>
      <span class="kpi-value">{data.stats.pop}명</span>
      <span class="kpi-price">19,900원/월</span>
    </div>
    <div class="kpi-card kpi-crazy">
      <span class="kpi-label">CRAZY 구독자</span>
      <span class="kpi-value">{data.stats.crazy}명</span>
      <span class="kpi-price">29,900원/월</span>
    </div>
  </div>

  <!-- 안내 배너 -->
  <div class="info-panel">
    구독 등급 변경은 사용자가 직접 진행해야 합니다. 관리자는 취소·일시정지만 가능합니다. (<a href="/cms/customers">고객목록</a>에서 고객 선택 후 구독이력 탭 이용)
  </div>

  <!-- 필터 -->
  <div class="filter-row">
    <div class="filter-chips">
      {#each PLAN_FILTERS as t}
        <button
          class="chip"
          class:chip-active={(data.filterPlan ?? '') === t.value}
          onclick={() => setFilter('plan', t.value)}
        >{t.label}</button>
      {/each}
    </div>
    <div class="filter-chips">
      {#each STATUSES as s}
        <button
          class="chip"
          class:chip-active={(data.filterStatus ?? '') === s.value}
          onclick={() => setFilter('status', s.value)}
        >{s.label}</button>
      {/each}
    </div>
  </div>

  <!-- 테이블 -->
  <div class="table-card">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>이름 / 이메일</th>
            <th>플랜</th>
            <th>구독 기간</th>
            <th>상태</th>
            <th>등록일</th>
          </tr>
        </thead>
        <tbody>
          {#each data.subscriptions as sub (sub.id)}
            {@const planKey = (sub.plan_name ?? '').toLowerCase()}
            <tr>
              <td>
                <div class="user-cell">
                  <span class="user-name">{sub.user_name ?? '-'}</span>
                  <span class="user-email">{sub.user_email ?? '-'}</span>
                </div>
              </td>
              <td>
                <span class="grade-badge grade-{planKey}">{sub.plan_name ?? '-'}</span>
              </td>
              <td class="date-range">
                <span>{formatDate(sub.started_at)}</span>
                <span class="date-sep">~</span>
                <span>{formatDate(sub.expires_at)}</span>
              </td>
              <td>
                <span class="status-badge status-{sub.status}">{statusLabel(sub.status)}</span>
              </td>
              <td>{formatDate(sub.created_at)}</td>
            </tr>
          {:else}
            <tr>
              <td colspan="5" class="no-data">조건에 맞는 구독 이력이 없습니다.</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>

<style>
  .page-wrap {
    flex: 1; min-height: 0; overflow-y: auto;
    padding: 20px 24px 32px;
    display: flex; flex-direction: column; gap: 16px;
  }
  .page-header { margin-bottom: 4px; }
  .page-title { font: var(--text-pc-title-18); color: var(--cs-text); margin: 0 0 4px; }
  .page-sub   { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0; }

  /* KPI */
  .kpi-row { display: flex; gap: 12px; }
  .kpi-card {
    flex: 1; background: var(--cs-white); border-radius: var(--cms-radius-sm);
    padding: 16px; display: flex; flex-direction: column; gap: 4px;
    box-shadow: 0px 1px 4px rgba(0,0,0,0.06);
    border-top: 3px solid transparent;
  }
  .kpi-easy  { border-top-color: var(--cs-info); }
  .kpi-pop   { border-top-color: var(--cs-purple); }
  .kpi-crazy { border-top-color: var(--cs-orange); }
  .kpi-label { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .kpi-value { font: var(--text-pc-title-18); font-weight: 700; color: var(--cs-text); }
  .kpi-price { font: var(--text-pc-descript-10); color: var(--cs-text-light); }

  /* 정보 패널 */
  .info-panel {
    background: #F3F4F6; border-radius: var(--cms-radius-sm);
    padding: 12px 14px; font: var(--text-pc-descript-10); color: var(--cs-text-mid); line-height: 160%;
  }
  .info-panel a { color: var(--cs-purple); text-decoration: underline; }

  /* 필터 */
  .filter-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .filter-chips { display: flex; gap: 4px; }
  .chip {
    display: inline-flex; align-items: center; height: 30px; border-radius: var(--radius-sm);
    padding: 5px 10px; font: var(--text-pc-script-12); font-weight: 400;
    cursor: pointer; border: 1px solid #ECEBF4; background: var(--cs-white); color: var(--cs-text);
    transition: background 0.12s; white-space: nowrap;
  }
  .chip:hover  { background: rgba(59,47,138,0.06); }
  .chip-active { background: var(--cs-purple-dark); color: var(--cs-white); border-color: var(--cs-purple-dark); }

  /* 테이블 */
  .table-card {
    background: var(--cs-white); border-radius: var(--cms-radius-md);
    overflow: hidden; box-shadow: 0px 1px 4px rgba(0,0,0,0.06);
  }
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

  .grade-badge {
    display: inline-flex; align-items: center; padding: 2px 8px;
    border-radius: var(--radius-sm); font: var(--text-pc-script-12); font-weight: 700;
  }
  .grade-easy  { background: rgba(14,165,233,0.12); color: var(--cs-info); }
  .grade-pop   { background: rgba(59,47,138,0.10);  color: var(--cs-purple); }
  .grade-crazy { background: rgba(255,69,0,0.12);   color: var(--cs-orange); }

  .date-range { display: flex; gap: 4px; align-items: center; font: var(--text-pc-script-12); }
  .date-sep   { color: var(--cs-text-light); }

  .status-badge {
    display: inline-flex; align-items: center; padding: 2px 8px;
    border-radius: var(--radius-sm); font: var(--text-pc-script-12); font-weight: 700;
  }
  .status-active    { background: rgba(16,185,129,0.12); color: var(--cs-success-light); }
  .status-cancelled { background: rgba(255,53,53,0.10);  color: var(--cs-red-badge); }
  .status-paused    { background: rgba(245,158,11,0.12); color: var(--cs-warning); }
  .status-expired   { background: var(--cs-surface-gray); color: var(--cs-text-light); }

  .no-data { text-align: center; padding: 40px 20px; color: var(--cs-text-light); font: var(--text-pc-body-14); }
</style>
