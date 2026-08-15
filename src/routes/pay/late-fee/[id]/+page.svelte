<script lang="ts">
  /**
   * /pay/late-fee/[id] — 연체료 결제 랜딩 페이지
   * window.open(_blank)으로 열리는 별도 창
   * 헤더 패턴: /account/rental/[id]/history 동일 구조 (최소 GNB — 닫기+타이틀)
   * Svelte 5 Runes 전용
   */
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  let isPaying = $state(false)
  let isPaid   = $state(false)
  let error    = $state<string | null>(null)

  $effect(() => {
    isPaid = data.lateFee.is_paid
  })

  function formatDate(d: string | null): string {
    if (!d) return '-'
    return d.slice(0, 10)
  }

  async function handlePay(): Promise<void> {
    if (isPaying || isPaid) return
    isPaying = true
    error    = null
    try {
      const res = await fetch(`/api/checkout/late-fee/${data.lateFee.id}/pay-mock`, {
        method: 'POST',
      })
      const json = await res.json() as { success: boolean; error?: string }
      if (!res.ok || !json.success) {
        error = json.error ?? '결제 처리 중 오류가 발생했습니다.'
        return
      }
      isPaid = true
    } catch {
      error = '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'
    } finally {
      isPaying = false
    }
  }
</script>

<svelte:head>
  <title>연체료 결제 — 크레이지샷</title>
</svelte:head>

<div class="page-wrap">
  <!-- 최소 헤더 — Q3 확정: 별도 창이므로 GNB/BottomTabBar 없음 -->
  <header class="page-header">
    <button
      type="button"
      class="back-btn"
      onclick={() => window.close()}
      aria-label="창 닫기"
    >‹</button>
    <span class="page-title">연체료 결제</span>
  </header>

  <div class="content">
    <!-- 예약 정보 카드 -->
    <div class="info-card">
      {#if data.lateFee.reservation_code}
        <p class="reservation-code">{data.lateFee.reservation_code}</p>
      {/if}
      <div class="row">
        <span class="label">반납 예정일</span>
        <span class="value">{formatDate(data.lateFee.end_date)}</span>
      </div>
      <div class="row">
        <span class="label">연체 시간</span>
        <span class="value highlight">{data.lateFee.hours_late}시간</span>
      </div>
      <div class="row amount-row">
        <span class="label">연체료</span>
        <span class="value amount">{data.lateFee.fee_amount.toLocaleString()}원</span>
      </div>
    </div>

    {#if isPaid}
      <!-- 결제 완료 상태 -->
      <div class="status-banner status-banner--done" role="status">
        결제가 완료됐습니다. 감사합니다.
      </div>
      <button class="close-btn" onclick={() => window.close()}>
        창 닫기
      </button>
    {:else}
      {#if error}
        <div class="error-msg" role="alert">{error}</div>
      {/if}
      <button
        class="pay-btn"
        onclick={handlePay}
        disabled={isPaying}
        aria-label="연체료 결제하기"
      >
        {isPaying ? '처리 중...' : `${data.lateFee.fee_amount.toLocaleString()}원 결제하기`}
      </button>
      <p class="notice">결제 후 취소는 불가합니다. 결제 전 금액을 확인해 주세요.</p>
    {/if}
  </div>
</div>

<style>
  .page-wrap {
    min-height: 100dvh;
    background: var(--cs-lilac);
    display: flex;
    flex-direction: column;
  }

  /* 최소 헤더 — /account/rental/[id]/history 동일 패턴 */
  .page-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    background: #fff;
    border-bottom: 1px solid var(--cs-lilac);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .back-btn {
    background: none;
    border: none;
    font-size: 24px;
    color: var(--cs-text);
    cursor: pointer;
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    line-height: 1;
  }

  .page-title {
    font: 700 16px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
  }

  .content {
    flex: 1;
    padding: 24px 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 480px;
    width: 100%;
    margin: 0 auto;
  }

  /* 연체료 정보 카드 */
  .info-card {
    background: #fff;
    border-radius: var(--radius-lg);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .reservation-code {
    font: 400 13px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    margin: 0;
  }

  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .label {
    font: 400 14px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-dark);
  }

  .value {
    font: 700 14px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
  }

  .value.highlight {
    color: var(--cs-orange);
  }

  .amount-row {
    border-top: 1px solid var(--cs-lilac);
    padding-top: 12px;
    margin-top: 4px;
  }

  .value.amount {
    font-size: 20px;
    color: var(--cs-red-badge, #FF3535);
  }

  /* 결제 버튼 */
  .pay-btn {
    width: 100%;
    min-height: 52px;
    background: var(--cs-purple);
    color: #fff;
    border: none;
    border-radius: var(--radius-xl);
    font: 700 17px/1 'Noto Sans KR', sans-serif;
    cursor: pointer;
    transition: filter 0.15s;
  }

  .pay-btn:hover:not(:disabled) {
    filter: brightness(0.92);
  }

  .pay-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .notice {
    font: 400 12px/1.6 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    text-align: center;
    margin: 0;
  }

  /* 완료 상태 */
  .status-banner--done {
    background: #e8f5e9;
    color: #2e7d32;
    border-radius: var(--radius-md);
    padding: 16px 20px;
    font: 700 15px/1.4 'Noto Sans KR', sans-serif;
    text-align: center;
  }

  .close-btn {
    width: 100%;
    min-height: 44px;
    background: var(--cs-lilac);
    color: var(--cs-text);
    border: none;
    border-radius: var(--radius-xl);
    font: 700 15px/1 'Noto Sans KR', sans-serif;
    cursor: pointer;
    transition: filter 0.15s;
  }

  .close-btn:hover {
    filter: brightness(0.95);
  }

  /* 에러 메시지 */
  .error-msg {
    background: #fff3f3;
    color: var(--cs-red-badge, #FF3535);
    border-radius: var(--radius-md);
    padding: 12px 16px;
    font: 400 14px/1.5 'Noto Sans KR', sans-serif;
    text-align: center;
  }
</style>
