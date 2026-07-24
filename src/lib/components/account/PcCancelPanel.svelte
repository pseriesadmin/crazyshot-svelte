<script lang="ts">
  interface CancelItem {
    id: string
    status: string
    reservation_code: string
    start_date: string | null
    end_date: string | null
    created_at: string
  }

  interface Props {
    cancels: CancelItem[]
    onback: () => void
  }

  let { cancels, onback }: Props = $props()

  function formatDate(dt: string | null): string {
    if (!dt) return '-'
    return dt.slice(0, 10)
  }
</script>

<div class="panel">
  <div class="panel-head">
    <button class="btn-back" onclick={onback}>
      <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
        <path d="M7 1L1 7L7 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      돌아가기
    </button>
    <span class="panel-title">취소·반품</span>
  </div>

  {#if cancels.length === 0}
    <div class="empty-state">
      <p class="empty-msg">취소·반품 내역이 없습니다.</p>
      <p class="empty-sub">취소된 예약이 없어요.</p>
    </div>
  {:else}
    <div class="list-wrap">
      {#each cancels as item (item.id)}
        <div class="cancel-card">
          <div class="card-head">
            <span class="code">{item.reservation_code}</span>
            <span class="status-chip">취소</span>
          </div>

          <div class="card-dates">
            <span class="date-label">신청일</span>
            <span class="date-value">{formatDate(item.created_at)}</span>
          </div>

          {#if item.start_date}
            <div class="card-dates">
              <span class="date-label">대여기간</span>
              <span class="date-value">{formatDate(item.start_date)} ~ {formatDate(item.end_date)}</span>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 16px; }

  .panel-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 4px;
  }
  .btn-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    padding: 6px 0;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    font-weight: 500;
    color: var(--cs-text-mid);
    cursor: pointer;
    transition: color 0.15s;
  }
  .btn-back:hover { color: var(--cs-purple); }
  .panel-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: var(--cs-text);
  }

  /* 빈 상태 */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 60px 20px;
    background: var(--cs-white);
    border-radius: var(--radius-2xl);
  }
  .empty-msg {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-text);
    margin: 0;
  }
  .empty-sub {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    color: var(--cs-text-mid);
    margin: 0;
  }

  /* 카드 */
  .list-wrap { display: flex; flex-direction: column; gap: 12px; }

  .cancel-card {
    background: var(--cs-white);
    border-radius: var(--radius-2xl);
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .code {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 15px;
    font-weight: 700;
    color: var(--cs-text);
    letter-spacing: -0.3px;
  }
  .status-chip {
    display: inline-flex;
    align-items: center;
    padding: 3px 12px;
    border-radius: var(--radius-xl);
    background: rgba(102,102,102,0.10);
    color: #666;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
  }
  .card-dates {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .date-label {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    font-weight: 700;
    color: var(--cs-text-mid);
  }
  .date-value {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    color: var(--cs-text);
  }
</style>
