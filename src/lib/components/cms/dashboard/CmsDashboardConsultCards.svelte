<script lang="ts">
  import { untrack } from 'svelte'
  import { goto } from '$app/navigation'
  import type { ChatSession } from '$lib/types/chat'
  import { subscribeToSessions } from '$lib/services/chatService'
  import CmsStatRing from '$lib/components/cms/CmsStatRing.svelte'

  interface TopCannedResponse {
    canned_response_id: string
    title: string
    category: string | null
    reply_count: number
  }

  interface Props {
    initialSessions: ChatSession[]
    topCannedResponses?: TopCannedResponse[]
  }
  let { initialSessions, topCannedResponses = [] }: Props = $props()

  // untrack(): SSR 초기값을 의도적으로 1회만 캡처 — 이후 realtime 구독이 sessions를 독립
  // 관리(CmsDashboardGantt.svelte의 untrack() 시드 패턴과 동일, QA [이슈3] 2026-08-13 수정)
  let sessions = $state<ChatSession[]>(untrack(() => [...initialSessions]))

  // AdminChatPanel.svelte:382-384 원문 그대로 복사 (AdminChatPanel import 안 함)
  const STATUS_LABEL: Record<string, string> = {
    open: '진행중',
    pending: '대기',
    closed: '종료',
  }

  // canned_responses.category CHECK 값(185_canned_responses.sql) 한글 라벨
  const CATEGORY_LABEL: Record<string, string> = {
    return: '반납',
    payment: '결제',
    reservation: '예약',
    damage: '파손',
    general: '일반',
  }

  function relativeTime(dateStr: string): string {
    const now = Date.now()
    const then = new Date(dateStr).getTime()
    const diff = now - then
    if (diff < 60_000) return '방금 전'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`
    return `${Math.floor(diff / 86_400_000)}일 전`
  }

  function displayName(session: ChatSession): string {
    return session.user_name ?? session.user_handle ?? '익명'
  }

  function openSession(id: string): void {
    goto('/cms/chat?session=' + id)
  }

  // 0~100 비율 계산 (분모 0 방어) — CmsStatRing.value는 반드시 비율값
  function pct(numerator: number, denominator: number): number {
    if (!denominator) return 0
    return Math.max(0, Math.min(100, (numerator / denominator) * 100))
  }

  // ── 히어로: 상태별(진행중/대기/종료) 원형 그래프 3종 ─────────────────────
  const openCount = $derived(sessions.filter((s) => s.status === 'open').length)
  const pendingCount = $derived(sessions.filter((s) => s.status === 'pending').length)
  const closedCount = $derived(sessions.filter((s) => s.status === 'closed').length)
  const totalCount = $derived(sessions.length)

  // ── 최근 중요 알림 목록 — is_urgent 세션을 최신순 상위 5건만 ─────────────
  const urgentSessions = $derived(
    sessions
      .filter((s) => s.is_urgent)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 5),
  )

  // core-rules.md: Realtime — $effect cleanup에서 .unsubscribe() 필수
  $effect(() => {
    const unsubscribe = subscribeToSessions((updated: ChatSession) => {
      const idx = sessions.findIndex((s) => s.id === updated.id)
      if (idx >= 0) {
        // UPDATE: 기존 세션의 조인 데이터(user_name 등)를 보존하면서 DB 필드만 갱신
        sessions = sessions.map((s, i) => (i === idx ? { ...s, ...updated } : s))
      } else {
        // INSERT: 신규 세션 맨 앞에 추가
        sessions = [updated, ...sessions]
      }
    })
    return unsubscribe
  })
</script>

{#if sessions.length === 0}
  <div class="empty-state">진행 중인 상담이 없습니다</div>
{:else}
  <div class="consult-wrap">
    <!-- 히어로: 상태별 원형 그래프 3종 -->
    <div class="hero-stats">
      <div class="hero-rings">
        <div class="hero-ring">
          <CmsStatRing value={pct(openCount, totalCount)} centerText={String(openCount)} label="진행중" tone="primary" size={128} />
        </div>
        <div class="hero-ring">
          <CmsStatRing value={pct(pendingCount, totalCount)} centerText={String(pendingCount)} label="대기" tone="warn" size={128} />
        </div>
        <div class="hero-ring">
          <CmsStatRing value={pct(closedCount, totalCount)} centerText={String(closedCount)} label="종료" tone="neutral" size={128} />
        </div>
      </div>
      <div class="hero-summary">
        <span class="hero-summary-total">{totalCount}</span>
        <span class="hero-summary-label">전체 상담 세션</span>
      </div>
    </div>

    <!-- 최근 중요 알림 목록 -->
    {#if urgentSessions.length > 0}
      <section class="urgent-section">
        <h3 class="section-title">최근 중요 알림</h3>
        <div class="urgent-list">
          {#each urgentSessions as session (session.id)}
            <button type="button" class="urgent-row" onclick={() => openSession(session.id)}>
              <span class="urgent-dot" aria-hidden="true"></span>
              <span class="urgent-name">{displayName(session)}</span>
              <span class="urgent-msg">{session.last_message_content ?? ''}</span>
              <span class="urgent-time">{relativeTime(session.updated_at)}</span>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    <!-- 주간 자동응답(빠른답변) 최다사용 TOP 10 -->
    {#if topCannedResponses.length > 0}
      <section class="ranking-section">
        <h3 class="section-title">자주 요청된 자동응답</h3>
        <div class="ranking-list">
          {#each topCannedResponses as item, i (item.canned_response_id)}
            <div class="ranking-row">
              <span class="rank-num" class:rank-top3={i < 3}>{i + 1}</span>
              <span class="rank-title">{item.title}</span>
              <span class="rank-category">{CATEGORY_LABEL[item.category ?? ''] ?? item.category ?? ''}</span>
              <span class="rank-count">{item.reply_count}회</span>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- 전체 상담 목록 — 직렬(세로) 목록형 -->
    <section class="stats-section">
      <h3 class="section-title">전체 상담 목록</h3>
      <div class="consult-list">
        {#each sessions as session (session.id)}
          <button
            type="button"
            class="consult-row"
            class:urgent={session.is_urgent}
            onclick={() => openSession(session.id)}
          >
            <span class="consult-name">{displayName(session)}</span>
            <span class="badge badge-status badge-{session.status}">
              {STATUS_LABEL[session.status] ?? session.status}
            </span>
            {#if session.unread_count && session.unread_count > 0}
              <span class="badge badge-unread">{session.unread_count}</span>
            {/if}
            <span class="consult-msg">{session.last_message_content ?? ''}</span>
            <span class="consult-time">{relativeTime(session.updated_at)}</span>
          </button>
        {/each}
      </div>
    </section>
  </div>
{/if}

<style>
  .empty-state {
    padding: 40px;
    text-align: center;
    color: var(--cs-text-mid);
    font: var(--text-pc-body-14);
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
  }

  .consult-wrap {
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  /* ── 히어로: 원형 그래프 (cms-uiux.md §7-17 표준) ── */
  .hero-stats {
    display: flex;
    align-items: center;
    gap: 24px;
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    padding: 28px 32px;
  }

  .hero-rings {
    display: flex;
    gap: 24px;
    flex: 0 0 auto;
    padding-right: 24px;
    border-right: 1px solid var(--cs-surface-gray);
  }

  .hero-ring {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .hero-summary {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }

  .hero-summary-total {
    font: var(--text-pc-htitle-25);
    color: var(--cs-text);
    font-variant-numeric: tabular-nums;
  }

  .hero-summary-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  /* ── 최근 중요 알림 목록 ── */
  .urgent-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .urgent-list {
    display: flex;
    flex-direction: column;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    overflow: hidden;
  }

  .urgent-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: none;
    border: none;
    border-bottom: 1px solid var(--cs-lilac);
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
  }

  .urgent-row:last-child {
    border-bottom: none;
  }

  .urgent-row:hover {
    background: rgba(255, 53, 53, 0.04);
  }

  .urgent-dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--cs-red-badge);
  }

  .urgent-name {
    flex-shrink: 0;
    font: var(--text-pc-body-14);
    font-weight: 600;
    color: var(--cs-text);
    max-width: 120px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .urgent-msg {
    flex: 1;
    min-width: 0;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .urgent-time {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--cs-text-light);
  }

  /* ── 주간 자동응답 TOP 10 ── */
  .ranking-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .ranking-list {
    display: flex;
    flex-direction: column;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    overflow: hidden;
  }

  .ranking-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--cs-lilac);
  }

  .ranking-row:last-child {
    border-bottom: none;
  }

  .rank-num {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--cs-lilac);
    color: var(--cs-text-mid);
    font-size: 11px;
    font-weight: 700;
  }

  .rank-num.rank-top3 {
    background: var(--cs-purple);
    color: var(--cs-white);
  }

  .rank-title {
    flex: 1;
    min-width: 0;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rank-category {
    flex-shrink: 0;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    background: var(--cs-surface-gray);
    padding: 2px 8px;
    border-radius: var(--radius-full);
  }

  .rank-count {
    flex-shrink: 0;
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-purple);
    min-width: 40px;
    text-align: right;
  }

  .stats-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-title {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    margin: 0;
  }

  /* ── 전체 상담 목록 — 직렬(세로) 목록형 ── */
  .consult-list {
    display: flex;
    flex-direction: column;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    overflow: hidden;
  }

  .consult-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: none;
    border: none;
    border-bottom: 1px solid var(--cs-lilac);
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
  }

  .consult-row:last-child {
    border-bottom: none;
  }

  .consult-row:hover {
    background: var(--cs-surface-gray);
  }

  .consult-row.urgent {
    background: rgba(255, 53, 53, 0.03);
  }

  .consult-row.urgent:hover {
    background: rgba(255, 53, 53, 0.06);
  }

  .consult-name {
    flex-shrink: 0;
    width: 100px;
    font: var(--text-pc-body-14);
    font-weight: 600;
    color: var(--cs-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .consult-msg {
    flex: 1;
    min-width: 0;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .consult-time {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--cs-text-light);
  }

  .badge {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: var(--radius-full);
    line-height: 1.4;
  }

  .badge-unread {
    background: var(--cs-red-badge);
    color: var(--cs-white);
    min-width: 18px;
    text-align: center;
  }

  .badge-open {
    background: rgba(59, 47, 138, 0.10);
    color: var(--cs-purple);
  }

  .badge-pending {
    background: rgba(245, 158, 11, 0.12);
    color: var(--cs-warning);
  }

  .badge-closed {
    background: rgba(102, 102, 102, 0.10);
    color: var(--cs-text-mid);
  }

  @media (max-width: 1100px) {
    .hero-stats {
      flex-direction: column;
    }
    .hero-rings {
      border-right: none;
      border-bottom: 1px solid var(--cs-surface-gray);
      padding-right: 0;
      padding-bottom: 20px;
      flex-wrap: wrap;
      justify-content: center;
    }
  }
</style>
