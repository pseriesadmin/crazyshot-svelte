<script lang="ts">
  import { goto } from '$app/navigation'
  import type { PageData } from './$types'
  import MobileMoreMenu from '$lib/components/common/MobileMoreMenu.svelte'

  let moreMenuOpen = $state(false)

  let { data }: { data: PageData } = $props()

  function formatAmount(amount: number): string {
    return amount.toLocaleString('ko-KR')
  }

  function handleConfirm() {
    goto('/mypage/reservations')
  }
</script>

<svelte:head>
  <title>결제완료 — 크레이지샷</title>
</svelte:head>

<div class="page-root">

  <!-- GNB pill -->
  <div class="gnb-wrap">
    <div class="gnb-pill">
      <button class="gnb-back" onclick={() => goto('/')} aria-label="홈으로">
        <svg width="15" height="10" viewBox="0 0 15 10" fill="none" aria-hidden="true">
          <path d="M14 5H1M1 5L5.5 1M1 5L5.5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <span class="gnb-title">결제완료</span>
      <button class="gnb-ham" aria-label="더보기 메뉴" onclick={() => moreMenuOpen = true}>
        <svg width="20" height="17" viewBox="0 0 20 17" fill="none" aria-hidden="true">
          <path d="M18.5 6.75C19.3284 6.75 20 7.42157 20 8.25C20 9.07843 19.3284 9.75 18.5 9.75H1.5C0.671573 9.75 0 9.07843 0 8.25C0 7.42157 0.671573 6.75 1.5 6.75H18.5Z" fill="#CF0000"/>
          <path d="M18.5 14C19.1904 14 19.75 14.5596 19.75 15.25C19.75 15.9404 19.1904 16.5 18.5 16.5H1.5C0.809644 16.5 0.25 15.9404 0.25 15.25C0.25 14.5596 0.809644 14 1.5 14H18.5ZM18.5 0C19.1904 0 19.75 0.559644 19.75 1.25C19.75 1.94036 19.1904 2.5 18.5 2.5H1.5C0.809644 2.5 0.25 1.94036 0.25 1.25C0.25 0.559644 0.809644 0 1.5 0H18.5Z" fill="#201857"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- 타이틀 영역 -->
  <!-- 2026-08-19: 계약서명 대기 중(pendingContract)이면 확정으로 오해할 수 있는 단정적
       성공 문구 대신, 결제는 완료됐으나 계약서명이 남았음을 명시 -->
  <div class="title-bar">
    <div class="icon-box icon-box--success" aria-hidden="true">
      <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
        <path d="M1 7L7 13L19 1" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    {#if data.pendingContract}
      <p class="title-text">결제 완료! 계약서 서명 후 예약이 확정돼요.</p>
    {:else}
      <p class="title-text">대여 결제 성공적!</p>
    {/if}
  </div>

  <!-- 주문 상세 카드 -->
  <div class="body">
    <div class="order-card">

      <!-- 상품명 섹션 -->
      <div class="order-product">
        <p class="product-name">{data.productName}</p>
        <div class="product-order-row">
          <span class="product-order-label">주문번호</span>
          <span class="product-code">{data.orderNumber}</span>
        </div>
      </div>

      <!-- 상세 정보 섹션 -->
      <div class="order-detail">
        <div class="detail-row">
          <span class="detail-label">대여일정</span>
          <span class="detail-value">
            {data.startDate}
            <span class="detail-dash"> - </span>
            {data.endDate}
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">결제요금</span>
          <span class="detail-value">
            {formatAmount(data.amount)}
            <span class="detail-unit">원</span>
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">결제일시</span>
          <span class="detail-value">{data.confirmedAt}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">결제수단</span>
          <span class="detail-value">{data.paymentMethod}</span>
        </div>
        {#if data.specialRequests}
          <div class="detail-row">
            <span class="detail-label">요청사항</span>
            <span class="detail-value detail-value--medium">{data.specialRequests}</span>
          </div>
        {/if}
      </div>

    </div>

    <!-- 확인 버튼 -->
    <button class="confirm-btn" onclick={handleConfirm}>
      <svg width="15" height="10" viewBox="0 0 15 10" fill="none" aria-hidden="true">
        <path d="M14 5H1M1 5L5.5 1M1 5L5.5 9" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>확인</span>
      <svg width="15" height="10" viewBox="0 0 15 10" fill="none" aria-hidden="true">
        <path d="M1 5H14M14 5L9.5 1M14 5L9.5 9" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>

</div>

<style>
  .page-root {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 100vh;
    background: var(--cs-lilac);
  }

  /* GNB */
  .gnb-wrap {
    width: 100%;
    padding: 40px 25px 0;
  }
  .gnb-pill {
    display: flex;
    align-items: center;
    justify-content: space-between;
    max-width: 1240px;
    min-width: 340px;
    margin: 0 auto;
    background: var(--cs-purple-op10);
    border-radius: var(--radius-lg);
    padding: 5px 20px;
    min-height: 60px;
  }
  .gnb-back {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border: none;
    background: transparent;
    color: var(--cs-text);
    cursor: pointer;
  }
  .gnb-title {
    font: var(--text-m-body-16B);
    color: var(--cs-text);
    letter-spacing: -0.5px;
  }
  .gnb-ham {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    margin-right: -8px;
  }

  /* 타이틀 */
  .title-bar {
    display: flex;
    flex-direction: column;
    gap: 20px;
    align-items: flex-start;
    justify-content: center;
    width: 100%;
    max-width: 1240px;
    min-width: 340px;
    padding: 50px 40px;
  }
  .icon-box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 70px;
    height: 70px;
    border-radius: var(--radius-icon-box);
    flex-shrink: 0;
  }
  .icon-box--success {
    background: var(--cs-purple);
  }
  .title-text {
    font: var(--text-m-htitle-24L);
    color: var(--cs-purple-dark);
    letter-spacing: -0.5px;
    margin: 0;
  }

  /* body */
  .body {
    display: flex;
    flex-direction: column;
    gap: 50px;
    align-items: flex-start;
    width: 100%;
    padding: 0 25px;
  }

  /* 주문 카드 — 비대칭 radius: TL-10 TR-50 BR-10 BL-50 */
  .order-card {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
    border-radius: var(--radius-asym-card);
    overflow: hidden;
  }

  /* 상품명 섹션 */
  .order-product {
    display: flex;
    flex-direction: column;
    gap: 5px;
    background: var(--cs-surface-gray);
    padding: 20px 30px;
    width: 100%;
  }
  .product-name {
    font: var(--text-m-title-18B);
    color: var(--cs-text-dark);
    letter-spacing: -0.3px;
    margin: 0;
  }
  .product-order-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .product-order-label {
    font: var(--text-m-script-14B);
    color: var(--cs-text-light);
    letter-spacing: -0.5px;
    white-space: nowrap;
  }
  .product-code {
    font: var(--text-m-script-14B);
    color: var(--cs-text-mid);
    letter-spacing: -0.5px;
    line-height: 2;
    margin: 0;
  }

  /* 상세 정보 섹션 */
  .order-detail {
    display: flex;
    flex-direction: column;
    gap: 5px;
    background: var(--cs-surface-gray);
    padding: 30px;
    width: 100%;
  }
  .detail-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }
  .detail-label {
    font: var(--text-m-script-14B);
    color: var(--cs-text-light);
    letter-spacing: -0.5px;
    line-height: 2;
    white-space: nowrap;
  }
  .detail-value {
    font: var(--text-m-body-16B);
    color: var(--cs-text-mid);
    letter-spacing: -0.5px;
    line-height: 1.6;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .detail-value--medium {
    font: var(--text-m-script-14);
    font-size: 14px;
  }
  .detail-dash {
    font: var(--text-m-body-16B);
    line-height: 2;
  }
  .detail-unit {
    font: var(--text-m-script-14B);
    line-height: 2;
  }

  /* 확인 버튼 */
  .confirm-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 15px;
    width: 100%;
    max-width: 340px;
    padding: 15px 20px;
    background: var(--cs-text-dark);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    font: var(--text-m-body-16B);
    letter-spacing: -0.5px;
    cursor: pointer;
    min-height: 44px;
    transition: opacity 0.15s;
  }
  .confirm-btn:hover { opacity: 0.85; }

  /* PC 반응형 */
  @media (min-width: 768px) {
    .gnb-wrap { display: none; }
    .title-bar {
      max-width: 900px;
      margin-left: auto;
      margin-right: auto;
    }
    .body {
      max-width: 900px;
      margin-left: auto;
      margin-right: auto;
      padding-left: clamp(24px, 4vw, 48px);
      padding-right: clamp(24px, 4vw, 48px);
    }
    .confirm-btn { max-width: 480px; margin-left: auto; margin-right: auto; }
  }
</style>

<MobileMoreMenu open={moreMenuOpen} onclose={() => moreMenuOpen = false} />
