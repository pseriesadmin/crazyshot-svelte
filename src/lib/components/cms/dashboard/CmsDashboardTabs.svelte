<script lang="ts">
  import CmsDashboardGantt from './CmsDashboardGantt.svelte'
  import CmsDashboardSubscriptions from './CmsDashboardSubscriptions.svelte'
  import CmsDashboardTodayStats from './CmsDashboardTodayStats.svelte'
  import CmsDashboardConsultCards from './CmsDashboardConsultCards.svelte'
  import type { SubRow } from './CmsDashboardSubscriptions.svelte'
  import type { RentalListRow } from '../../../../routes/cms/reservation/+page.server'
  import type { ChatSession } from '$lib/types/chat'

  interface TopCannedResponse {
    canned_response_id: string
    title: string
    category: string | null
    reply_count: number
  }

  interface DashboardData {
    cmsRole: string | null
    ganttWindow: { from: string; to: string; rows: RentalListRow[] }
    subscriptionData: { easy: SubRow[]; pop: SubRow[]; crazy: SubRow[] }
    todayStats: Record<string, number> | null
    couponToday: { issued: number; used: number }
    chatSessions: ChatSession[]
    topCannedResponses: TopCannedResponse[]
  }

  interface Props { data: DashboardData }
  let { data }: Props = $props()

  const TABS = [
    { id: 'gantt' as const,        label: '예약승인 및 대여 일정' },
    { id: 'consult' as const,      label: '상담목록카드 현황' },
    { id: 'subscription' as const, label: '정기구독 현황' },
    { id: 'today' as const,        label: '오늘 통계' },
  ]

  let activeTab = $state<'gantt' | 'consult' | 'subscription' | 'today'>('gantt')
</script>

<div class="dashboard-wrap">
  <!-- 4개 탭 바 (analytics 페이지 .tab-bar/.tab-btn 패턴 동일 적용) -->
  <div class="tab-bar">
    {#each TABS as tab}
      <button
        class="tab-btn"
        class:tab-active={activeTab === tab.id}
        onclick={() => (activeTab = tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- 각 탭 바디: Phase 1~4에서 실제 컴포넌트로 교체 예정 -->
  {#if activeTab === 'gantt'}
    <CmsDashboardGantt initial={data.ganttWindow} />
  {:else if activeTab === 'consult'}
    <CmsDashboardConsultCards initialSessions={data.chatSessions} topCannedResponses={data.topCannedResponses} />
  {:else if activeTab === 'subscription'}
    <CmsDashboardSubscriptions buckets={data.subscriptionData} />
  {:else if activeTab === 'today'}
    <CmsDashboardTodayStats stats={data.todayStats} coupon={data.couponToday} />
  {/if}
</div>

<style>
  /* CMS 표준: overflow-y: auto + min-width: 1280px (cms-uiux.md GATE C) */
  .dashboard-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    min-width: 1280px;
    padding: 20px 24px 32px;
    display: flex;
    flex-direction: column;
  }

  /* analytics 페이지 .tab-bar/.tab-btn 패턴과 동일 */
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
  .tab-btn:hover { background: rgba(59, 47, 138, 0.08); color: var(--cs-text); }
  .tab-btn.tab-active {
    background: var(--cs-white);
    color: var(--cs-purple);
  }

</style>
