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
    <span class="panel-title">취소</span>
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

  /* 좌우 끝 들여쓰기 느낌(2026-09-17, 약간의 여백 추가) */
  .panel-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 4px;
    padding: 0 6px;
  }
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

  /* 카드 — 카드 간 여백 25px(2026-09-17) */
  .list-wrap { display: flex; flex-direction: column; gap: 25px; }

  .cancel-card {
    position: relative;
    background: var(--cs-white);
    /* front-uiux.md §4 카드 반경 대/중 2단 체계 — 730px 폭 좁은 패널 안 리스트 카드라
       "중(medium)" 등급(PC 30px)으로 축소, "대(large)"(50px)는 최상위 컨테이너 전용 */
    border-radius: var(--radius-xl);
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    /* status-chip이 absolute로 빠지면서 code 텍스트와 겹치지 않도록 우측 여백 확보
       (2026-09-17, GATE E L-1: 여유폭 부족 지적으로 70px→78px 확대) */
    padding-right: 78px;
  }
  .code {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 15px;
    font-weight: 700;
    color: var(--cs-text);
    letter-spacing: -0.3px;
  }
  /* 카드 bg 전체 높이 기준 수직 중앙정렬(2026-09-17) — card-head 행이 아니라 카드
     전체(padding 20px 24px)를 기준으로 위치 고정 */
  .status-chip {
    position: absolute;
    top: 50%;
    right: 24px;
    transform: translateY(-50%);
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
