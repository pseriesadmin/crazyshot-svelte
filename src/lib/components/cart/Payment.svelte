<script lang="ts">
  interface Props {
    totalAmount: number;
    isLoading?: boolean;
    onPaymentMethodChange?: (method: string) => void;
    onPayment?: (method: string) => void;
    selectedMethod?: string;
  }

  let {
    totalAmount,
    isLoading = false,
    onPaymentMethodChange,
    onPayment,
    selectedMethod = 'card'
  }: Props = $props();

  const paymentMethods = [
    { id: 'card', label: '신용/체크카드', icon: '💳' },
    { id: 'transfer', label: '계좌이체', icon: '🏦' },
    { id: 'mobile', label: '휴대폰결제', icon: '📱' },
    { id: 'naver', label: '네이버페이', icon: '🟢' },
    { id: 'kakao', label: '카카오페이', icon: '🟡' }
  ];

  function handleMethodSelect(method: string): void {
    if (isLoading) return;
    onPaymentMethodChange?.(method);
  }

  function handlePayment(): void {
    if (isLoading) return;
    onPayment?.(selectedMethod);
  }
</script>

<div class="payment-zone">
  <h3 class="section-title">결제 방식 선택</h3>

  <div class="payment-methods">
    {#each paymentMethods as method (method.id)}
      <button
        class="method-btn"
        class:active={selectedMethod === method.id}
        disabled={isLoading}
        onclick={() => handleMethodSelect(method.id)}
        aria-label={method.label}
      >
        <span class="icon">{method.icon}</span>
        <span class="label">{method.label}</span>
      </button>
    {/each}
  </div>

  <div class="payment-info">
    <div class="info-row">
      <span class="info-label">결제 예정액</span>
      <span class="info-amount">₩{totalAmount.toLocaleString()}</span>
    </div>
    <div class="info-note">
      결제 후 예약이 확정됩니다. 취소 시 환불 규정을 참고해주세요.
    </div>
  </div>

  <button
    class="btn-payment"
    disabled={isLoading}
    onclick={handlePayment}
  >
    {#if isLoading}
      <span class="spinner"></span>
      결제 처리 중...
    {:else}
      ₩{totalAmount.toLocaleString()} 결제하기
    {/if}
  </button>
</div>

<style>
  .payment-zone {
    padding: var(--spacing-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
  }

  .section-title {
    margin: 0 0 var(--spacing-4) 0;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .payment-methods {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
    gap: var(--spacing-3);
    margin-bottom: var(--spacing-4);
  }

  .method-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 80px;
    padding: var(--spacing-2);
    border: 2px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .method-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .method-btn:not(:disabled):hover {
    border-color: var(--color-primary);
    background: var(--color-surface-alt);
  }

  .method-btn.active {
    border-color: var(--color-primary);
    background: rgba(255, 69, 0, 0.05);
  }

  .icon {
    font-size: 1.5rem;
    margin-bottom: var(--spacing-1);
  }

  .label {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text);
    text-align: center;
    line-height: 1.2;
  }

  .payment-info {
    padding: var(--spacing-3);
    background: var(--color-surface-alt);
    border-radius: var(--radius-md);
    margin-bottom: var(--spacing-4);
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-2);
  }

  .info-label {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .info-amount {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--color-primary);
  }

  .info-note {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    line-height: 1.4;
    margin-top: var(--spacing-2);
    padding-top: var(--spacing-2);
    border-top: 1px solid var(--color-border);
  }

  .btn-payment {
    width: 100%;
    min-height: 48px;
    padding: var(--spacing-3) var(--spacing-4);
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius-lg);
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-2);
  }

  .btn-payment:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-payment:not(:disabled):hover {
    background: var(--color-primary-hover);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(255, 69, 0, 0.3);
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
