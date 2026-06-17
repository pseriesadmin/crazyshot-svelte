<script lang="ts">
  interface PriceBreakdown {
    basePrice: number;
    membershipDiscount: number;
    couponDiscount: number;
    pointsUsed: number;
    depositAmount: number;
    shippingCost: number;
    vatAmount: number;
    totalPrice: number;
    finalPrice: number;
  }

  interface Props {
    breakdown: PriceBreakdown;
    membershipGrade?: string;
    crazyScore?: number;
  }

  let { breakdown, membershipGrade = 'pro', crazyScore = 72 }: Props = $props();

  function getDepositRatio(score: number): string {
    if (score >= 85) return '0%';
    if (score >= 70) return '30%';
    if (score >= 50) return '50%';
    return '100%';
  }
</script>

<div class="pricing-section">
  <h3 class="section-title">가격 브레이크다운</h3>

  <div class="price-breakdown">
    <div class="breakdown-item">
      <span class="label">기본 렌탈료</span>
      <span class="value">₩{breakdown.basePrice.toLocaleString()}</span>
    </div>

    {#if breakdown.membershipDiscount > 0}
      <div class="breakdown-item discount">
        <span class="label">멤버십 할인 ({membershipGrade?.toUpperCase()})</span>
        <span class="value">-₩{breakdown.membershipDiscount.toLocaleString()}</span>
      </div>
    {/if}

    {#if breakdown.couponDiscount > 0}
      <div class="breakdown-item discount">
        <span class="label">쿠폰 할인</span>
        <span class="value">-₩{breakdown.couponDiscount.toLocaleString()}</span>
      </div>
    {/if}

    {#if breakdown.pointsUsed > 0}
      <div class="breakdown-item discount">
        <span class="label">포인트 사용</span>
        <span class="value">-₩{breakdown.pointsUsed.toLocaleString()}</span>
      </div>
    {/if}

    {#if breakdown.shippingCost > 0}
      <div class="breakdown-item">
        <span class="label">배송비</span>
        <span class="value">+₩{breakdown.shippingCost.toLocaleString()}</span>
      </div>
    {:else}
      <div class="breakdown-item discount">
        <span class="label">배송비 (무료)</span>
        <span class="value">-₩0</span>
      </div>
    {/if}

    <div class="divider"></div>

    <div class="breakdown-item">
      <span class="label">결제액</span>
      <span class="value amount-primary">₩{breakdown.totalPrice.toLocaleString()}</span>
    </div>

    <div class="deposit-info">
      <span class="label">보증금</span>
      <span class="ratio">{getDepositRatio(crazyScore ?? 72)}</span>
      <span class="amount">₩{breakdown.depositAmount.toLocaleString()}</span>
    </div>
  </div>

  <div class="final-price">
    <span class="label">최종 결제액</span>
    <span class="final-amount">₩{breakdown.finalPrice.toLocaleString()}</span>
  </div>

  <div class="notice">
    <p>
      보증금은 반납 후 환불됩니다. 크레이지스코어({crazyScore})에 따라 보증금 비율이 결정됩니다.
    </p>
  </div>
</div>

<style>
  .pricing-section {
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

  .price-breakdown {
    margin-bottom: var(--spacing-4);
  }

  .breakdown-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-3) 0;
    font-size: 0.95rem;
  }

  .breakdown-item.discount .value {
    color: var(--color-success);
  }

  .label {
    color: var(--color-text-secondary);
  }

  .value {
    font-weight: 500;
    color: var(--color-text);
    text-align: right;
  }

  .value.amount-primary {
    color: var(--color-primary);
    font-weight: 600;
  }

  .divider {
    height: 1px;
    background: var(--color-border);
    margin: var(--spacing-3) 0;
  }

  .deposit-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-3) var(--spacing-3);
    background: var(--color-surface-alt);
    border-radius: var(--radius-md);
    margin-top: var(--spacing-3);
  }

  .deposit-info .label {
    flex: 1;
  }

  .deposit-info .ratio {
    margin: 0 var(--spacing-2);
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .deposit-info .amount {
    font-weight: 600;
    color: var(--color-text);
    text-align: right;
  }

  .final-price {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-4);
    background: var(--color-primary);
    border-radius: var(--radius-lg);
    color: white;
  }

  .final-price .label {
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
  }

  .final-amount {
    font-size: 1.5rem;
    font-weight: 700;
    color: white;
  }

  .notice {
    margin-top: var(--spacing-4);
    padding: var(--spacing-3);
    background: var(--color-surface-alt);
    border-radius: var(--radius-md);
    border-left: 3px solid var(--color-primary);
  }

  .notice p {
    margin: 0;
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    line-height: 1.5;
  }
</style>
