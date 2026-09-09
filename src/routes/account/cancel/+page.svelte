<script lang="ts">
  import SubGnb from '$lib/components/common/SubGnb.svelte'
  import BottomTabBar from '$lib/components/common/BottomTabBar.svelte'
  import { goto } from '$app/navigation'
  import type { PageData } from './$types'
  import type { MyCancel } from './+page.server'

  interface Props { data: PageData }
  let { data }: Props = $props()

  function formatDate(dt: string | null): string {
    if (!dt) return '-'
    return dt.slice(0, 10)
  }
</script>

<div class="page-wrap">

  <SubGnb title="취소·반품" mobileOnly />

  <div class="content">

    <!-- 뒤로가기 — SubGnb가 PC에서는 렌더링되지 않아(mobileOnly) 채팅 대화카드 등으로
         이 화면에 새 탭/직접 진입 시 PC에서 이동 수단이 전혀 없던 문제 방지
         (/account/rental/+page.svelte와 동일 수정, 2026-09-09) -->
    <button type="button" class="btn-back" onclick={() => goto('/account')}>
      <svg width="8" height="14" viewBox="0 0 8 14" fill="none" aria-hidden="true">
        <path d="M7 1L1 7L7 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      마이페이지
    </button>

    {#if data.cancels.length === 0}
      <div class="empty-state">
        <p class="empty-msg">취소·반품 내역이 없습니다.</p>
        <p class="empty-sub">취소된 예약이 없어요.</p>
      </div>
    {:else}
      <div class="list-wrap">
        {#each data.cancels as item (item.id)}
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

  <BottomTabBar />
</div>

<style>
  .page-wrap {
    min-height: 100vh;
    background: var(--cs-lilac);
    display: flex;
    flex-direction: column;
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 70px 20px 100px;
    max-width: 600px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }

  /* 뒤로가기 — /account/rental/+page.svelte와 동일 스펙(SubGnb mobileOnly라
     PC에서는 이 버튼이 유일한 이동 수단) */
  .btn-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--cs-text-mid);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    font-weight: 700;
    min-height: 44px;
    min-width: 44px;
  }
  .btn-back:hover { color: var(--cs-purple); }

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
    border-radius: var(--radius-2xl);   /* PC: 50px */
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* front-uiux.md §4 카드 반경 대/중 2단 체계 — 대(large) Mobile 30px(하드코딩, 전용 변수 없음) */
  @media (max-width: 640px) {
    .cancel-card { border-radius: 30px; }
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

  @media (min-width: 768px) {
    .content {
      padding: 100px 40px 60px;
      max-width: 720px;
    }
  }
</style>
