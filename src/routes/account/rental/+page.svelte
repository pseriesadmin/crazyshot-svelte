<script lang="ts">
  import SubGnb from '$lib/components/common/SubGnb.svelte'
  import BottomTabBar from '$lib/components/common/BottomTabBar.svelte'
  import RentalJourneyStepper from '$lib/components/common/RentalJourneyStepper.svelte'
  import type { PageData } from './$types'
  import type { MyRental } from './+page.server'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const STATUS_LABEL: Record<string, string> = {
    hold:             '신청대기',
    confirmed:        '승인완료',
    shipped:          '반출중',
    in_use:           '대여중',
    return_requested: '반납중',
    returned:         '반납완료',
    completed:        '완료',
    damage_claimed:   '파손신고',
  }

  const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
    hold:             { bg: 'rgba(102,102,102,0.10)', color: '#666' },
    confirmed:        { bg: 'rgba(16,185,129,0.12)',  color: '#047857' },
    shipped:          { bg: 'rgba(14,165,233,0.12)',  color: '#0369A1' },
    in_use:           { bg: 'rgba(59,47,138,0.12)',   color: '#3B2F8A' },
    return_requested: { bg: 'rgba(255,69,0,0.12)',    color: '#FF4500' },
    returned:         { bg: 'rgba(102,102,102,0.10)', color: '#666' },
    completed:        { bg: 'rgba(102,102,102,0.10)', color: '#666' },
    damage_claimed:   { bg: 'rgba(255,53,53,0.10)',   color: '#CF0000' },
  }

  function formatDate(dt: string | null): string {
    if (!dt) return '-'
    return dt.slice(0, 10)
  }
</script>

<div class="page-wrap">

  <SubGnb title="대여" mobileOnly />

  <div class="content">

    {#if data.rentals.length === 0}
      <div class="empty-state">
        <p class="empty-msg">대여 내역이 없습니다.</p>
        <p class="empty-sub">아직 진행 중인 대여가 없어요.</p>
      </div>
    {:else}
      <div class="list-wrap">
        {#each data.rentals as rental (rental.id)}
          {@const st = STATUS_STYLE[rental.status] ?? STATUS_STYLE['hold']}
          <div class="rental-card">
            <div class="card-head">
              <span class="code">{rental.reservation_code}</span>
              <span class="status-chip" style="background:{st.bg};color:{st.color}">
                {STATUS_LABEL[rental.status] ?? rental.status}
              </span>
            </div>

            {#if rental.product_name}
              <div class="product-row">
                <span class="product-name">{rental.product_name}</span>
                {#if rental.product_category}
                  <span class="product-cat">{rental.product_category}</span>
                {/if}
              </div>
            {/if}

            <div class="card-dates">
              <span class="date-label">대여기간</span>
              <span class="date-value">{formatDate(rental.start_date)} ~ {formatDate(rental.end_date)}</span>
            </div>

            <div class="stepper-wrap">
              <RentalJourneyStepper status={rental.status} />
            </div>
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

  .rental-card {
    background: var(--cs-white);
    border-radius: var(--radius-2xl);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
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
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
  }

  .product-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .product-name {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 15px;
    font-weight: 700;
    color: var(--cs-text);
    line-height: 1.4;
  }
  .product-cat {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    color: var(--cs-text-mid);
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

  .stepper-wrap { margin-top: 4px; }

  @media (min-width: 768px) {
    .content {
      padding: 100px 40px 60px;
      max-width: 720px;
    }
  }
</style>
