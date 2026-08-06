<script lang="ts">
  import type { PageData } from './$types'
  import type { AnalyticsData, BannerStats } from './+page.server'
  import CmsKpiGrid from '$lib/components/cms/CmsKpiGrid.svelte'
  import CmsStatRing from '$lib/components/cms/CmsStatRing.svelte'
  import CmsStatBars from '$lib/components/cms/CmsStatBars.svelte'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const TABS = [
    { id: 'kpi',      label: '전체 KPI' },
    { id: 'coupon',   label: '쿠폰 성과' },
    { id: 'banner',   label: '배너 성과' },
    { id: 'segment',  label: '세그먼트 성과' },
  ] as const

  let activeTab = $state<'kpi' | 'coupon' | 'banner' | 'segment'>('kpi')

  const analytics: AnalyticsData = $derived(data.analytics)
  const bannerStats: BannerStats = $derived(data.bannerStats)
  const totalPageviews: number   = $derived(data.totalPageviews)

  // 배너 슬롯 한국어 라벨
  const SLOT_LABELS: Record<string, string> = {
    hero_pc:          'PC 히어로',
    hero_mobile:      '모바일 히어로',
    mid_banner_pc:    'PC 중간 배너',
    mid_banner_mobile:'모바일 중간 배너',
  }

  // 세그먼트 한국어 라벨
  const SEG_LABELS: Record<string, string> = {
    new_member:           '신규회원',
    vip:                  'VIP',
    dormant:              '휴면',
    cart_abandon:         '장바구니이탈',
    first_purchase_ready: '첫구매예정',
    repurchase_ready:     '재구매예정',
  }

  // 배너 슬롯 목록 (데이터에 없으면 0 표시)
  const BANNER_SLOTS = ['hero_pc', 'hero_mobile', 'mid_banner_pc', 'mid_banner_mobile']

  // 총 클릭 수
  const totalClicks = $derived(
    BANNER_SLOTS.reduce((sum, slot) => sum + (bannerStats[slot]?.clicks ?? 0), 0)
  )

  // 금액 포맷
  function fmtKRW(n: number): string {
    return n.toLocaleString('ko-KR') + '원'
  }

  // % 포맷 (소수 1자리)
  function fmtPct(n: number): string {
    return n.toFixed(1) + '%'
  }

  // 배너 비율
  function bannerPct(clicks: number): string {
    if (!totalPageviews) return '0.0%'
    return ((clicks / totalPageviews) * 100).toFixed(2) + '%'
  }
</script>

<div class="page-wrap">
  <!-- 페이지 헤더 -->
  <div class="page-header">
    <h1 class="page-title">프로모션 성과 분석</h1>
    <p class="page-sub">쿠폰·배너·세그먼트 캠페인의 종합 성과를 확인합니다.</p>
  </div>

  <!-- 탭 바 -->
  <div class="tab-bar">
    {#each TABS as tab}
      <button
        class="tab-btn"
        class:tab-active={activeTab === tab.id}
        onclick={() => (activeTab = tab.id as typeof activeTab)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- 탭1: 전체 KPI -->
  {#if activeTab === 'kpi'}
    <div class="hero-stats">
      <div class="hero-ring">
        <CmsStatRing value={analytics.conversion_rate} label="구매 전환율" tone="primary" size={140} />
      </div>
      <div class="hero-bars">
        <div class="hero-bars-title">배너 슬롯별 클릭 수</div>
        <CmsStatBars unit="회" items={BANNER_SLOTS.map((slot, i) => ({
          label: SLOT_LABELS[slot] ?? slot,
          value: bannerStats[slot]?.clicks ?? 0,
          tone: (i % 2 === 0 ? 'primary' : 'info') as 'primary' | 'info',
        }))} />
      </div>
    </div>

    <CmsKpiGrid columns={3} cards={[
      { label: '총 매출',       value: fmtKRW(analytics.total_revenue),   sub: '확정 예약 기준 누적 매출',   tone: 'primary' },
      { label: '구매 전환율',   value: fmtPct(analytics.conversion_rate), sub: '방문 대비 예약 완료 비율',   tone: 'info' },
      { label: 'CTR (배너)',    value: fmtPct(analytics.ctr),             sub: '배너 노출 대비 클릭률',      tone: 'info' },
      { label: '활성 캠페인',   value: analytics.active_campaigns, unit: '건', sub: '현재 진행 중인 프로모션', tone: 'primary', size: 'sm' },
      { label: 'LTV',           value: '—', sub: '데이터 수집 중 (Phase 4 예정)', tone: 'neutral', size: 'sm' },
      { label: 'CAC',           value: '—', sub: '데이터 수집 중 (Phase 4 예정)', tone: 'neutral', size: 'sm' },
    ]} />
  {/if}

  <!-- 탭2: 쿠폰 성과 -->
  {#if activeTab === 'coupon'}
    <div class="table-card">
      {#if analytics.top_coupons.length === 0}
        <p class="no-data">쿠폰 성과 데이터가 없습니다.</p>
      {:else}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>쿠폰 코드</th>
                <th class="txt-right">사용 수</th>
                <th class="txt-right">발급 수</th>
                <th class="txt-right">전환율</th>
              </tr>
            </thead>
            <tbody>
              {#each analytics.top_coupons as c}
                <tr>
                  <td><code class="code-pill">{c.coupon_code}</code></td>
                  <td class="txt-right">{c.used_count.toLocaleString('ko-KR')}회</td>
                  <td class="txt-right">{c.issued_count.toLocaleString('ko-KR')}회</td>
                  <td class="txt-right">{fmtPct(c.conversion)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}

  <!-- 탭3: 배너 성과 -->
  {#if activeTab === 'banner'}
    <div class="section-info">
      <span class="info-label">기준 페이지뷰</span>
      <span class="info-value">{totalPageviews.toLocaleString('ko-KR')}회</span>
    </div>
    <div class="table-card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>슬롯</th>
              <th class="txt-right">클릭 수</th>
              <th class="txt-right">CTR</th>
            </tr>
          </thead>
          <tbody>
            {#each BANNER_SLOTS as slot}
              {@const clicks = bannerStats[slot]?.clicks ?? 0}
              <tr>
                <td>{SLOT_LABELS[slot] ?? slot}</td>
                <td class="txt-right">{clicks.toLocaleString('ko-KR')}회</td>
                <td class="txt-right">{bannerPct(clicks)}</td>
              </tr>
            {/each}
            <tr class="total-row">
              <td>합계</td>
              <td class="txt-right">{totalClicks.toLocaleString('ko-KR')}회</td>
              <td class="txt-right">{bannerPct(totalClicks)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- 탭4: 세그먼트 성과 -->
  {#if activeTab === 'segment'}
    <div class="table-card">
      {#if analytics.segment_performance.length === 0}
        <p class="no-data">세그먼트 성과 데이터가 없습니다.</p>
      {:else}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>세그먼트</th>
                <th class="txt-right">사용자 수</th>
                <th class="txt-right">평균 점수</th>
              </tr>
            </thead>
            <tbody>
              {#each analytics.segment_performance as seg}
                <tr>
                  <td>
                    <span class="seg-badge">
                      {SEG_LABELS[seg.segment] ?? seg.segment}
                    </span>
                  </td>
                  <td class="txt-right">{seg.user_count.toLocaleString('ko-KR')}명</td>
                  <td class="txt-right">{seg.avg_score.toFixed(1)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* ── 레이아웃 ── */
  .page-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 20px 24px 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* ── 헤더 ── */
  .page-header { margin-bottom: 4px; }
  .page-title  { font: var(--text-pc-htitle-25); color: var(--cs-text); margin: 0 0 4px; }
  .page-sub    { font: var(--text-pc-script-12);  color: var(--cs-text-mid); margin: 0; }

  /* ── 탭 바 (cms-uiux.md §505-514 표준 .sub-tab 패턴 통일) ── */
  .tab-bar {
    display: flex;
    gap: 4px;
    margin-bottom: 20px;
  }

  .tab-btn {
    padding: 6px 18px;
    border: none;
    border-radius: var(--cms-radius-sm);
    background: transparent;
    color: var(--cs-text-mid);
    font: var(--text-pc-body-14);
    cursor: pointer;
    min-height: 34px;
    transition: background 0.15s, color 0.15s;
  }
  .tab-btn:hover   { background: rgba(59,47,138,0.08); color: var(--cs-text); }
  .tab-btn.tab-active {
    background: var(--cs-white);
    color: var(--cs-purple);
  }

  /* ── KPI 그리드: CmsKpiGrid/CmsKpiCard 공용 컴포넌트로 대체 ── */

  /* ─ 히어로 통계 (게이지 + 바그래프) ─ */
  .hero-stats {
    display: flex; gap: 24px;
    background: var(--cs-white); border-radius: var(--cms-radius-lg);
    padding: 28px 32px; margin-bottom: 20px;
    box-shadow: 0px 1px 4px rgba(0,0,0,0.06);
  }
  .hero-ring {
    display: flex; align-items: center; justify-content: center;
    flex: 0 0 auto; padding-right: 24px;
    border-right: 1px solid var(--cs-surface-gray);
  }
  .hero-bars { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 14px; }
  .hero-bars-title { font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text); }

  /* ── 배너 요약 정보 ── */
  .section-info {
    background: var(--cs-white);
    border-radius: var(--cms-radius-sm);
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .info-label { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .info-value { font: var(--text-pc-body-14);   color: var(--cs-text); }

  /* ── 테이블 카드 ── */
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
  tbody tr.total-row {
    background: rgba(59,47,138,0.06);
    font-weight: 700;
  }

  td {
    padding: 10px 16px;
    vertical-align: middle;
  }
  td.txt-right { text-align: right; }

  /* ── 코드 pill ── */
  .code-pill {
    background: rgba(59,47,138,0.08);
    color: var(--cs-purple);
    border-radius: var(--radius-sm);
    padding: 2px 8px;
    font: var(--text-pc-script-12);
    font-family: monospace;
  }

  /* ── 세그먼트 배지 ── */
  .seg-badge {
    display: inline-block;
    background: rgba(59,47,138,0.08);
    color: var(--cs-purple);
    border-radius: var(--radius-sm);
    padding: 2px 8px;
    font: var(--text-pc-script-12);
  }

  /* ── 빈 상태 ── */
  .no-data {
    text-align: center;
    padding: 40px 20px;
    font: var(--text-pc-body-14);
    color: var(--cs-text-light);
    margin: 0;
  }
</style>
