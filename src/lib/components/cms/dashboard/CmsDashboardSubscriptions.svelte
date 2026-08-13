<script lang="ts" module>
  // SubRow 타입 — CmsDashboardTabs.svelte에서 import type { SubRow }로 재사용
  export interface SubRow {
    id: string
    user_id: string
    tier: string
    price_per_month: number
    billing_cycle_start: string
    billing_cycle_end: string
    created_at: string
    customer_name: string
  }
</script>

<script lang="ts">
  import CmsStatRing from '$lib/components/cms/CmsStatRing.svelte'
  import CmsKpiGrid from '$lib/components/cms/CmsKpiGrid.svelte'
  import type { KpiCardProps } from '$lib/components/cms/CmsKpiGrid.svelte'
  import CmsPagination from '$lib/components/cms/CmsPagination.svelte'

  interface Props {
    buckets: { easy: SubRow[]; pop: SubRow[]; crazy: SubRow[] }
  }

  let { buckets }: Props = $props()

  // 티어 한글 표시명 상수 (이 상수 1개만 바꾸면 전체 반영)
  const TIER_LABEL: Record<string, string> = {
    easy: '이지',
    pop: '팝',
    crazy: '크레이지',
  }

  // 티어별 배지 색상 (STATUS_STYLE 패턴과 동일하게 인라인 스타일로 관리)
  const TIER_STYLE: Record<string, { bg: string; color: string }> = {
    easy:  { bg: 'rgba(100,100,100,0.10)', color: 'var(--cs-text-mid)' },
    pop:   { bg: 'rgba(14,165,233,0.12)',  color: 'var(--cs-info)' },
    crazy: { bg: 'rgba(59,47,138,0.12)',   color: 'var(--cs-purple)' },
  }

  const CAVEAT = '활성 구독 기준 월 예상액 — 실결제 이력 합산 아님'

  // 비율 계산 (분모 0 방지)
  const total = $derived(buckets.easy.length + buckets.pop.length + buckets.crazy.length)

  function pctOf(count: number, tot: number): number {
    if (tot === 0) return 0
    return Math.round((count / tot) * 100)
  }

  // 티어별 월 예상액 합계
  const easyTotal  = $derived(buckets.easy.reduce((s, r) => s + r.price_per_month, 0))
  const popTotal   = $derived(buckets.pop.reduce((s, r) => s + r.price_per_month, 0))
  const crazyTotal = $derived(buckets.crazy.reduce((s, r) => s + r.price_per_month, 0))

  // KPI 카드 (총 구독자 1 + 티어별 월예상액 3 = 4장, columns=3 → 2행)
  const kpiCards: KpiCardProps[] = $derived([
    {
      label: '총 활성 구독자 수',
      value: total,
      unit: '명',
      tone: 'primary' as const,
    },
    {
      label: TIER_LABEL.easy + ' 월 예상액',
      value: easyTotal.toLocaleString(),
      unit: '원',
      sub: CAVEAT,
      tone: 'neutral' as const,
    },
    {
      label: TIER_LABEL.pop + ' 월 예상액',
      value: popTotal.toLocaleString(),
      unit: '원',
      sub: CAVEAT,
      tone: 'info' as const,
    },
    {
      label: TIER_LABEL.crazy + ' 월 예상액',
      value: crazyTotal.toLocaleString(),
      unit: '원',
      sub: CAVEAT,
      tone: 'primary' as const,
    },
  ])

  // 테이블 전체 목록 (이지 → 팝 → 크레이지 순)
  const allRows = $derived([...buckets.easy, ...buckets.pop, ...buckets.crazy])

  // 클라이언트 사이드 페이지네이션 (20개 초과 시 활성)
  const PAGE_SIZE = 20
  let currentPage = $state(1)
  const totalPages = $derived(Math.max(1, Math.ceil(allRows.length / PAGE_SIZE)))
  const pagedRows = $derived(
    allRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  )

  function formatDate(dateStr: string): string {
    if (!dateStr) return '—'
    return dateStr.slice(0, 10)
  }
</script>

<div class="subs-wrap">
  <!-- 원형 링 3개 가로 배치 -->
  <div class="rings-row">
    <div class="ring-item">
      <CmsStatRing
        value={pctOf(buckets.easy.length, total)}
        centerText={String(buckets.easy.length)}
        label="{TIER_LABEL.easy} 구독자"
        tone="neutral"
        size={140}
      />
    </div>
    <div class="ring-item">
      <CmsStatRing
        value={pctOf(buckets.pop.length, total)}
        centerText={String(buckets.pop.length)}
        label="{TIER_LABEL.pop} 구독자"
        tone="info"
        size={140}
      />
    </div>
    <div class="ring-item">
      <CmsStatRing
        value={pctOf(buckets.crazy.length, total)}
        centerText={String(buckets.crazy.length)}
        label="{TIER_LABEL.crazy} 구독자"
        tone="primary"
        size={140}
      />
    </div>
  </div>

  <!-- 보조 KPI 카드 -->
  <div class="kpi-section">
    <CmsKpiGrid columns={3} cards={kpiCards} />
  </div>

  <!-- 구독자 목록 테이블 -->
  <div class="table-section">
    <div class="table-hd">
      <span class="section-title">구독자 목록</span>
      <span class="total-badge">{allRows.length}명</span>
    </div>

    {#if allRows.length === 0}
      <div class="empty-state">활성 구독자가 없습니다.</div>
    {:else}
      <div class="table-wrap">
        <table class="subs-table">
          <thead>
            <tr>
              <th>고객명 / 고객 ID</th>
              <th>티어</th>
              <th>월 요금</th>
              <th>구독 시작일</th>
              <th>갱신일</th>
            </tr>
          </thead>
          <tbody>
            {#each pagedRows as row (row.id)}
              <tr>
                <td>
                  {#if row.customer_name}
                    <div class="name">{row.customer_name}</div>
                  {/if}
                  <div class="uid">{row.user_id.slice(0, 8)}&hellip;</div>
                </td>
                <td>
                  <span
                    class="tier-badge"
                    style:background={TIER_STYLE[row.tier]?.bg ?? 'rgba(100,100,100,0.10)'}
                    style:color={TIER_STYLE[row.tier]?.color ?? 'var(--cs-text-mid)'}
                  >
                    {TIER_LABEL[row.tier] ?? row.tier}
                  </span>
                </td>
                <td class="td-amount">{row.price_per_month.toLocaleString()}원</td>
                <td>{formatDate(row.billing_cycle_start)}</td>
                <td>{formatDate(row.billing_cycle_end)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if totalPages > 1}
        <CmsPagination
          page={currentPage}
          {totalPages}
          onpage={(p) => { currentPage = p }}
          variant="bottom"
          ariaLabel="구독자 목록 페이지 탐색"
        />
      {/if}
    {/if}
  </div>
</div>

<style>
  .subs-wrap {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  /* 링 영역 */
  .rings-row {
    display: flex;
    gap: 32px;
    justify-content: center;
    align-items: center;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    padding: 32px 40px;
  }
  .ring-item {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
  }

  /* KPI 섹션 */
  .kpi-section {
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    padding: 20px;
  }

  /* 테이블 섹션 */
  .table-section {
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    padding: 20px;
  }
  .table-hd {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
  }
  .section-title {
    font: var(--text-pc-title-16);
    color: var(--cs-text);
    font-weight: 700;
  }
  .total-badge {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-white);
    background: var(--cs-purple);
    border-radius: var(--radius-full);
    padding: 2px 8px;
  }
  .empty-state {
    padding: 40px;
    text-align: center;
    color: var(--cs-text-mid);
    font: var(--text-pc-body-14);
  }

  .table-wrap { overflow-x: auto; }
  .subs-table {
    width: 100%;
    border-collapse: collapse;
    color: var(--cs-text);
  }
  .subs-table th {
    text-align: left;
    padding: 8px 12px;
    border-bottom: 1px solid var(--cs-lilac);
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
    white-space: nowrap;
  }
  .subs-table td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--cs-lilac);
    vertical-align: middle;
    font: var(--text-pc-body-14);
  }
  .subs-table tbody tr:last-child td { border-bottom: none; }
  .subs-table tbody tr:hover { background: var(--cs-surface-gray); }

  .name {
    font: var(--text-pc-body-14);
    font-weight: 600;
    color: var(--cs-text);
  }
  .uid {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    font-family: monospace;
  }

  .td-amount {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .tier-badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: var(--radius-full);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }
</style>
