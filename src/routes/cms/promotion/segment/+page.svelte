<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const SEGMENT_ORDER = [
    'new_member',
    'first_purchase_ready',
    'repurchase_ready',
    'vip',
    'high_value',
    'cart_abandon',
    'dormant',
  ]

  const SEGMENT_COLOR: Record<string, string> = {
    new_member:           'var(--cs-info)',
    vip:                  'var(--cs-warning)',
    dormant:              'var(--cs-text-light)',
    cart_abandon:         'var(--cs-red-badge)',
    first_purchase_ready: 'var(--cs-success-light)',
    repurchase_ready:     'var(--cs-purple)',
    high_value:           'var(--cs-orange)',
  }

  let isRefreshing = $state(false)
  let refreshMsg   = $state('')

  // 세그먼트 맵 (segment → count)
  const segmentMap = $derived(
    Object.fromEntries(
      (data.stats.segments ?? []).map(s => [s.segment, s])
    )
  )

  // 정렬된 세그먼트 목록
  const orderedSegments = $derived(
    SEGMENT_ORDER.filter(k => segmentMap[k] !== undefined)
      .concat(
        (data.stats.segments ?? [])
          .map(s => s.segment)
          .filter(s => !SEGMENT_ORDER.includes(s))
      )
  )

  function selectSegment(seg: string) {
    const url = new URL($page.url)
    if (url.searchParams.get('segment') === seg) {
      url.searchParams.delete('segment')
    } else {
      url.searchParams.set('segment', seg)
    }
    goto(url.toString(), { replaceState: true })
  }

  async function handleRefresh() {
    isRefreshing = true
    refreshMsg   = ''
    try {
      const res = await fetch('/api/cms/segment/refresh', { method: 'POST' })
      const json = await res.json()
      if (json.success) {
        refreshMsg = `세그먼트 갱신 완료 (${json.segments_updated ?? 0}건)`
        setTimeout(() => goto($page.url.toString(), { invalidateAll: true }), 800)
      } else {
        refreshMsg = '갱신 실패: ' + (json.error ?? '알 수 없는 오류')
      }
    } catch {
      refreshMsg = '네트워크 오류가 발생했습니다.'
    } finally {
      isRefreshing = false
    }
  }

  function maskPhone(phone: string | null): string {
    if (!phone) return '-'
    return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
  }

  function maskEmail(email: string | null): string {
    if (!email) return '-'
    const [local, domain] = email.split('@')
    if (!local || !domain) return email
    return local.slice(0, 2) + '****@' + domain
  }

  function fmtDate(iso: string) {
    return iso.slice(0, 10)
  }
</script>

<div class="page-wrap">
  <!-- 헤더 -->
  <div class="page-header">
    <div>
      <h1 class="page-title">고객 세그먼트</h1>
      <p class="page-sub">행동 데이터 기반 자동 분류 · 쿠폰·포인트 배포 연동</p>
    </div>
    <button class="btn-ghost" onclick={handleRefresh} disabled={isRefreshing}>
      {isRefreshing ? '갱신 중...' : '세그먼트 갱신'}
    </button>
  </div>

  {#if refreshMsg}
    <div class="info-banner" role="alert">{refreshMsg}</div>
  {/if}

  <!-- KPI 카드 3종 -->
  <div class="kpi-row">
    <div class="kpi-card">
      <div class="kpi-label">추적 사용자</div>
      <div class="kpi-value">{(data.stats.total_tracked_users ?? 0).toLocaleString()}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">최근 7일 이벤트</div>
      <div class="kpi-value">{(data.stats.total_events_7d ?? 0).toLocaleString()}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">마지막 갱신</div>
      <div class="kpi-value kpi-value--sm">
        {data.stats.last_refresh ? fmtDate(data.stats.last_refresh) : '미실행'}
      </div>
    </div>
  </div>

  <!-- 세그먼트 카드 목록 -->
  <div class="seg-cards">
    {#if orderedSegments.length === 0}
      <p class="no-data">세그먼트 데이터가 없습니다. '세그먼트 갱신' 버튼을 눌러주세요.</p>
    {:else}
      {#each orderedSegments as key (key)}
        {@const s = segmentMap[key]}
        <button
          class="seg-card"
          class:seg-card--active={data.activeSegment === key}
          onclick={() => selectSegment(key)}
          style="--seg-color:{SEGMENT_COLOR[key] ?? 'var(--cs-purple)'}"
        >
          <div class="seg-card-dot"></div>
          <div class="seg-card-body">
            <div class="seg-card-name">{data.segmentLabels[key] ?? key}</div>
            <div class="seg-card-count">{(s?.count ?? 0).toLocaleString()}명</div>
          </div>
          {#if s?.avg_score}
            <div class="seg-card-score">평균 {s.avg_score}점</div>
          {/if}
        </button>
      {/each}
    {/if}
  </div>

  <!-- 사용자 목록 (세그먼트 선택 시) -->
  {#if data.activeSegment}
    <div class="user-panel">
      <div class="user-panel-header">
        <h2 class="user-panel-title">
          {data.segmentLabels[data.activeSegment] ?? data.activeSegment}
          <span class="user-panel-count">({data.segmentUsers.length}명)</span>
        </h2>
        <a
          href="/cms/promotion/coupon?tab=distribute&segment={data.activeSegment}"
          class="btn-primary"
        >
          쿠폰 배포
        </a>
      </div>

      {#if data.segmentUsers.length === 0}
        <p class="no-data">해당 세그먼트에 사용자가 없습니다.</p>
      {:else}
        <div class="table-card">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>이름</th>
                  <th>연락처</th>
                  <th>이메일</th>
                  <th>점수</th>
                  <th>산정일</th>
                </tr>
              </thead>
              <tbody>
                {#each data.segmentUsers as u (u.user_id)}
                  <tr>
                    <td>{u.full_name ?? '-'}</td>
                    <td>{maskPhone(u.phone)}</td>
                    <td>{maskEmail(u.email)}</td>
                    <td>
                      {#if u.score !== null}
                        <span class="badge badge-info">{u.score}점</span>
                      {:else}
                        -
                      {/if}
                    </td>
                    <td>{fmtDate(u.computed_at)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .page-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 20px 24px 32px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .page-title {
    font: var(--text-pc-htitle-25);
    color: var(--cs-text);
    margin: 0 0 4px;
  }
  .page-sub {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0;
  }

  .info-banner {
    background: var(--cs-bg-success);
    border-left: 3px solid var(--cs-success-light);
    border-radius: var(--cms-radius-sm);
    padding: 8px 14px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-success);
  }

  /* KPI */
  .kpi-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .kpi-card {
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    padding: 20px;
  }
  .kpi-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin-bottom: 8px;
  }
  .kpi-value {
    font: var(--text-pc-title-18);
    color: var(--cs-text);
  }
  .kpi-value--sm {
    font: var(--text-pc-body-14);
  }

  /* 세그먼트 카드 */
  .seg-cards {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }
  .seg-card {
    background: var(--cs-white);
    border: 2px solid transparent;
    border-radius: var(--cms-radius-md);
    padding: 16px;
    cursor: pointer;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: border-color 0.15s, background 0.15s;
  }
  .seg-card:hover {
    border-color: rgba(59,47,138,0.20);
    background: rgba(59,47,138,0.04);
  }
  .seg-card--active {
    border-color: var(--seg-color);
    background: rgba(59,47,138,0.06);
  }
  .seg-card-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--seg-color);
    flex-shrink: 0;
  }
  .seg-card-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .seg-card-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
  }
  .seg-card-count {
    font: var(--text-pc-title-18);
    color: var(--seg-color);
  }
  .seg-card-score {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }

  /* 사용자 패널 */
  .user-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .user-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .user-panel-title {
    font: var(--text-pc-title-18);
    color: var(--cs-text);
    margin: 0;
  }
  .user-panel-count {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    margin-left: 6px;
  }

  /* 테이블 공통 */
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
  tbody tr { border-bottom: 1px solid var(--cs-surface-gray); }
  tbody tr:hover { background: rgba(59,47,138,0.04); }
  tbody tr:last-child { border-bottom: none; }
  td { padding: 10px 16px; vertical-align: middle; }

  /* 배지 */
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    white-space: nowrap;
  }
  .badge-info { background: rgba(59,47,138,0.08); color: var(--cs-purple); }

  /* 버튼 */
  .btn-ghost {
    background: transparent;
    border: 1.5px solid var(--cs-purple);
    border-radius: var(--radius-sm);
    color: var(--cs-purple);
    padding: 7px 14px;
    font: var(--text-pc-body-14);
    height: 36px;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .btn-ghost:hover    { background: rgba(59,47,138,0.06); }
  .btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-primary {
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-sm);
    padding: 8px 16px;
    font: var(--text-pc-body-14);
    height: 36px;
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    transition: background 0.15s;
  }
  .btn-primary:hover { background: var(--cs-purple-hover); }

  .no-data {
    text-align: center;
    padding: 40px 20px;
    font: var(--text-pc-body-14);
    color: var(--cs-text-light);
  }
</style>
