<script lang="ts">
  import SubGnb from '$lib/components/common/SubGnb.svelte'
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

<svelte:head>
  <title>취소·반품 — CRAZYSHOT</title>
</svelte:head>

<div class="page-wrap">

  <SubGnb title="취소" mobileOnly />

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

    <div class="list-header">
      <span class="list-header-title">전체 취소 목록</span>
      <span class="list-header-count">{data.cancels.length}건</span>
    </div>

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

  /* 모바일 상단 여백 35px(2026-09-17, 기존 70px에서 축소) — 반응형 토큰 범위 규칙에
     따라 모바일 전용 적용, PC(768px 이상)는 아래 별도 min-width 규칙 그대로 유지.
     기준값 767px — /account/rental과 동일 768px 경계로 통일(2026-09-17, sp3-qa-agent
     GATE E M-1: 기존 640px 기준이면 641~767px 구간에서 .btn-back과 함께 동작이
     갈리던 결함 수정) */
  @media (max-width: 767px) {
    .content { padding-top: 35px; }
  }

  /* 뒤로가기 — /account/rental/+page.svelte와 동일 스펙(SubGnb mobileOnly라
     PC에서는 이 버튼이 유일한 이동 수단). 모바일에서는 최상단 SubGnb 자체 뒤로가기
     버튼(.back-btn, SubGnb.svelte)과 기능이 중복돼 불필요 — 모바일에서만 숨김
     (2026-09-17), PC는 SubGnb가 mobileOnly라 여전히 이 버튼이 유일한 수단이라 유지. */
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
  /* 기준값 767px — /account/rental과 동일 768px 경계로 통일(2026-09-17, GATE E M-1 수정) */
  @media (max-width: 767px) {
    .btn-back { display: none; }
  }

  /* 리스트 타이틀 행 — 좌측 타이틀 / 우측 수량(2026-09-17, 중앙정렬 시도 후 원복).
     타이틀은 PC 표준(--text-pc-title-18) 유지, 모바일만 두 단계 작은 토큰
     (--text-m-htitle-24B → --text-m-body-16B)으로 축소. */
  .list-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  .list-header-title {
    font: var(--text-pc-title-18);
    color: var(--cs-text);
  }
  .list-header-count {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
  }
  @media (max-width: 640px) {
    .list-header-title { font: var(--text-m-body-16B); }
    .list-header-count { font: var(--text-m-script-14B); }
    /* 타이틀행과 카드 목록 사이 여백 25px(2026-09-17, /account/rental과 동일 값) */
    .list-header { margin-bottom: 25px; }
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
  /* 카드 간 여백 100% 증가(2026-09-17, 모바일 전용 요청) — 기존 12px의 2배 */
  @media (max-width: 640px) {
    .list-wrap { gap: 24px; }
  }

  .cancel-card {
    position: relative;
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
    /* status-chip이 absolute로 빠지면서 code 텍스트가 그 자리까지 넓게 차지할 수
       있어, 겹침 방지용으로 칩 폭만큼 우측 여백 확보(2026-09-17, GATE E L-1: 여유폭
       부족 지적으로 64px→72px 확대) */
    padding-right: 72px;
  }
  .code {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 15px;
    font-weight: 700;
    color: var(--cs-text);
    letter-spacing: -0.3px;
  }
  /* 카드 bg 전체 높이 기준 수직 중앙정렬(2026-09-17) — card-head 행 높이가 아니라
     카드 전체를 기준으로 위치 고정. right 값은 .cancel-card padding(20px)과 동일해
     기존 헤더 행 정렬 시 보이던 우측 위치와 동일하게 유지 */
  .status-chip {
    position: absolute;
    top: 50%;
    right: 20px;
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

  @media (min-width: 768px) {
    .content {
      padding: 100px 40px 60px;
      max-width: 720px;
    }
  }
</style>
