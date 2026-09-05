<script lang="ts">
  import SubGnb from '$lib/components/common/SubGnb.svelte'
  import BottomTabBar from '$lib/components/common/BottomTabBar.svelte'
  import RentalJourneyStepper from '$lib/components/common/RentalJourneyStepper.svelte'
  import { goto } from '$app/navigation'
  import { browser } from '$app/environment'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const METHOD_LABEL: Record<string, string> = {
    visit:      '방문',
    delivery:   '택배',
    quick:      '퀵배송',
    locker:     '무인보관함',
    crazy:      '크레이지배송',
  }

  const STATUS_LABEL: Record<string, string> = {
    hold:             '신청대기',
    confirmed:        '계약완료',
    shipped:          '반출중',
    in_use:           '대여중',
    return_requested: '반납중',
    returned:         '반납완료',
    completed:        '완료',
    cancelled:        '취소됨',
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

  function formatTime(t: string | null): string {
    if (!t) return ''
    return ` ${t.slice(0, 5)}`
  }

  function formatAmount(n: number): string {
    return n.toLocaleString('ko-KR') + '원'
  }

  const res = $derived(data.reservation)
  const st = $derived(STATUS_STYLE[res.status] ?? STATUS_STYLE['hold'])

  function goBack(): void {
    if (browser && window.history.length > 1) {
      window.history.back()
    } else {
      goto('/account/rental')
    }
  }
</script>

<div class="page-wrap">
  <SubGnb title="예약 상세" mobileOnly />

  <div class="content">

    <!-- 뒤로가기 버튼 — SubGnb에 backHref가 없어 인라인 처리 -->
    <button type="button" class="btn-back" onclick={goBack}>
      <svg width="8" height="14" viewBox="0 0 8 14" fill="none" aria-hidden="true">
        <path d="M7 1L1 7L7 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      대여 목록
    </button>

    <!-- 예약 코드 + 상태 헤더 -->
    <div class="section-card">
      <div class="card-head">
        <span class="code">{res.reservation_code}</span>
        <span class="status-chip" style="background:{st.bg};color:{st.color}">
          {STATUS_LABEL[res.status] ?? res.status}
        </span>
      </div>

      {#if res.product_name}
        <div class="product-row">
          <span class="product-name">{res.product_name}</span>
          {#if res.product_category}
            <span class="product-cat">{res.product_category}</span>
          {/if}
        </div>
      {/if}

      <div class="stepper-wrap">
        <RentalJourneyStepper status={res.status} />
      </div>
    </div>

    <!-- 대여 기간 + 수령/반납 방식 -->
    <div class="section-card">
      <h2 class="section-title">대여 정보</h2>
      <div class="info-rows">
        <div class="info-row">
          <span class="info-label">대여기간</span>
          <span class="info-value">{formatDate(res.start_date)} ~ {formatDate(res.end_date)}</span>
        </div>
        {#if res.pickup_method}
          <div class="info-row">
            <span class="info-label">수령 방식</span>
            <span class="info-value">
              {METHOD_LABEL[res.pickup_method] ?? res.pickup_method}{formatTime(res.pickup_time)}
            </span>
          </div>
        {/if}
        {#if res.return_method}
          <div class="info-row">
            <span class="info-label">반납 방식</span>
            <span class="info-value">
              {METHOD_LABEL[res.return_method] ?? res.return_method}{formatTime(res.return_time)}
            </span>
          </div>
        {/if}
      </div>
    </div>

    <!-- 옵션상품 (있을 때만) -->
    {#if data.options.length > 0}
      <div class="section-card">
        <h2 class="section-title">옵션상품</h2>
        <div class="info-rows">
          {#each data.options as opt (opt.id)}
            <div class="info-row">
              <span class="info-label">{opt.option_name}</span>
              <span class="info-value">
                {opt.qty}개
                {#if opt.unit_price > 0}
                  · {formatAmount(opt.unit_price * opt.qty)}
                {/if}
              </span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- 금액 -->
    {#if data.amount}
      <div class="section-card amount-card">
        <h2 class="section-title">요금 내역</h2>
        <div class="info-rows">
          <div class="info-row">
            <span class="info-label">대여료</span>
            <span class="info-value">{formatAmount(data.amount.rental_fee)}</span>
          </div>
          {#if data.amount.options_fee > 0}
            <div class="info-row">
              <span class="info-label">옵션료</span>
              <span class="info-value">{formatAmount(data.amount.options_fee)}</span>
            </div>
          {/if}
          {#if data.amount.deposit > 0}
            <div class="info-row">
              <span class="info-label">보증금</span>
              <span class="info-value">{formatAmount(data.amount.deposit)}</span>
            </div>
          {/if}
        </div>
        <div class="total-row">
          <span class="total-label">합계</span>
          <span class="total-value">
            {formatAmount(data.amount.rental_fee + data.amount.options_fee + data.amount.deposit)}
          </span>
        </div>
      </div>
    {/if}

    <!-- 예약신청수정 버튼 — 계약 서명 전(hold 상태) 카드 수정 가능 -->
    {#if !res.has_signed_contract && res.status === 'hold'}
      <button
        type="button"
        class="action-btn"
        onclick={() => goto('/cart')}
      >
        예약신청 수정하기
      </button>
      <p class="action-hint">장바구니에서 날짜·방식을 수정한 뒤 다시 신청할 수 있어요.</p>
    {/if}

  </div>

  <BottomTabBar />
</div>

<style>
  .page-wrap {
    min-height: 100dvh;
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

  /* 뒤로가기 버튼 */
  .btn-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    padding: 0;
    margin-bottom: 4px;
    cursor: pointer;
    color: var(--cs-text-mid);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    font-weight: 700;
    min-height: 44px;
    min-width: 44px;
  }
  .btn-back:hover { color: var(--cs-purple); }

  /* 섹션 카드 */
  .section-card {
    background: var(--cs-white);
    border-radius: var(--radius-2xl);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  @media (max-width: 640px) {
    .section-card { border-radius: 30px; }
  }

  .section-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-text-mid);
    margin: 0;
  }

  /* 카드 헤더 */
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
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

  /* 상품 */
  .product-row { display: flex; flex-direction: column; gap: 2px; }
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

  .stepper-wrap { margin-top: 4px; }

  /* 정보 행 */
  .info-rows { display: flex; flex-direction: column; gap: 10px; }
  .info-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .info-label {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-text-mid);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .info-value {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    color: var(--cs-text);
    text-align: right;
  }

  /* 금액 합계 */
  .amount-card { gap: 14px; }
  .total-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 10px;
    border-top: 1px solid var(--cs-lilac);
  }
  .total-label {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-text);
  }
  .total-value {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: var(--cs-purple);
  }

  /* 수정 버튼 */
  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 52px;
    min-height: 52px;
    border-radius: var(--radius-xl);
    background: var(--cs-purple);
    border: none;
    color: #fff;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
    width: 100%;
  }
  .action-btn:hover  { background: #2d2470; }
  .action-btn:active { background: #1f1a55; }

  .action-hint {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    color: var(--cs-text-mid);
    text-align: center;
    margin: 0;
    line-height: 1.5;
  }

  @media (min-width: 768px) {
    .content {
      padding: 100px 40px 60px;
      max-width: 720px;
    }
  }
</style>
