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
    goto('/members')
  }
</script>

<svelte:head>
  <title>구독 신청 결과 — CrazyShot</title>
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
      <span class="gnb-title">구독신청 결과</span>
      <button class="gnb-ham" aria-label="더보기 메뉴" onclick={() => moreMenuOpen = true}>
        <svg width="20" height="17" viewBox="0 0 20 17" fill="none" aria-hidden="true">
          <path d="M18.5 6.75C19.3284 6.75 20 7.42157 20 8.25C20 9.07843 19.3284 9.75 18.5 9.75H1.5C0.671573 9.75 0 9.07843 0 8.25C0 7.42157 0.671573 6.75 1.5 6.75H18.5Z" fill="#CF0000"/>
          <path d="M18.5 14C19.1904 14 19.75 14.5596 19.75 15.25C19.75 15.9404 19.1904 16.5 18.5 16.5H1.5C0.809644 16.5 0.25 15.9404 0.25 15.25C0.25 14.5596 0.809644 14 1.5 14H18.5ZM18.5 0C19.1904 0 19.75 0.559644 19.75 1.25C19.75 1.94036 19.1904 2.5 18.5 2.5H1.5C0.809644 2.5 0.25 1.94036 0.25 1.25C0.25 0.559644 0.809644 0 1.5 0H18.5Z" fill="#201857"/>
        </svg>
      </button>
    </div>
  </div>

  {#if data.success}
    <!-- 타이틀 영역 -->
    <div class="title-bar">
      <div class="icon-box icon-box--success" aria-hidden="true">
        <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
          <path d="M1 7L7 13L19 1" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      {#if 'chargeWarning' in data && data.chargeWarning}
        <p class="title-text">카드 등록 완료! 최초 결제는 다음 청구일에 재시도돼요.</p>
      {:else}
        <p class="title-text">정기구독이 시작됐어요!</p>
      {/if}
    </div>

    <!-- 구독 상세 카드 -->
    <div class="body">
      <div class="order-card">

        <!-- 상품명 섹션 -->
        <div class="order-product">
          <p class="product-name">{'planName' in data ? data.planName : ''}</p>
          <div class="product-order-row">
            <span class="product-order-label">구독 유형</span>
            <span class="product-code">정기구독 (매월 자동결제)</span>
          </div>
        </div>

        <!-- 상세 정보 섹션 -->
        <div class="order-detail">
          {#if 'monthlyPrice' in data && data.monthlyPrice}
            <div class="detail-row">
              <span class="detail-label">월 구독료</span>
              <span class="detail-value">
                {formatAmount(data.monthlyPrice)}
                <span class="detail-unit">원</span>
              </span>
            </div>
          {/if}
          {#if 'billingCycleDay' in data && data.billingCycleDay}
            <div class="detail-row">
              <span class="detail-label">결제일</span>
              <span class="detail-value">매월 {data.billingCycleDay}일</span>
            </div>
          {/if}
          {#if 'confirmedAt' in data && data.confirmedAt}
            <div class="detail-row">
              <span class="detail-label">등록일시</span>
              <span class="detail-value">{data.confirmedAt}</span>
            </div>
          {/if}
          {#if 'paymentMethod' in data && data.paymentMethod}
            <div class="detail-row">
              <span class="detail-label">결제수단</span>
              <span class="detail-value">{data.paymentMethod}</span>
            </div>
          {/if}
        </div>

      </div>

      {#if 'chargeWarning' in data && data.chargeWarning}
        <p class="charge-warning" role="alert">{data.chargeWarning}</p>
      {/if}

      <!-- 확인 버튼 -->
      <button class="confirm-btn" onclick={handleConfirm}>
        <svg width="15" height="10" viewBox="0 0 15 10" fill="none" aria-hidden="true">
          <path d="M14 5H1M1 5L5.5 1M1 5L5.5 9" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>멤버십 홈으로</span>
      </button>
    </div>
  {:else}
    <!-- 실패 화면 -->
    <div class="title-bar">
      <div class="icon-box icon-box--error" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 2L14 14M14 2L2 14" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
      </div>
      <p class="title-text">구독 신청에 실패했어요</p>
    </div>
    <div class="body">
      <p class="fail-desc">{data.error}</p>
      <button class="confirm-btn" onclick={() => goto('/members')}>
        <span>다시 시도하기</span>
      </button>
    </div>
  {/if}

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
  .icon-box--success { background: var(--cs-purple); }
  .icon-box--error { background: var(--cs-red-badge); }
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
    gap: 20px;
    align-items: flex-start;
    width: 100%;
    padding: 0 25px 50px;
  }

  .fail-desc {
    font: var(--text-m-body-16L);
    color: var(--cs-text-mid);
    margin: 0;
  }

  /* 구독 카드 — 비대칭 radius: TL-10 TR-50 BR-10 BL-50 */
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
  .detail-unit {
    font: var(--text-m-script-14B);
    line-height: 2;
  }

  .charge-warning {
    width: 100%;
    font: var(--text-m-script-14);
    color: var(--cs-red-badge);
    background: rgba(255, 53, 53, 0.08);
    padding: 12px 16px;
    border-radius: var(--radius-sm);
    margin: 0;
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
      padding-bottom: 50px;
    }
    .confirm-btn { max-width: 480px; margin-left: auto; margin-right: auto; }
  }
</style>

<MobileMoreMenu open={moreMenuOpen} onclose={() => moreMenuOpen = false} />
