<script lang="ts">
  // PRD.1.7.5 — ActionCard: 6종 액션 카드 렌더링
  // Figma node: 2497:8761 (product card with CTA), 2497:8702

  import type { ActionPayload } from '$lib/types/chat'

  interface Props {
    payload: ActionPayload
    onaction?: (payload: ActionPayload) => void
  }

  let { payload, onaction }: Props = $props()

  // 상품 이미지 URL (Cloudinary)
  let imageUrl = $derived(
    payload.product_image
      ? `https://res.cloudinary.com/crazyshot/image/upload/w_128,h_128,c_fill,f_auto,q_auto/${payload.product_image}.jpg`
      : null
  )

  // CTA 버튼 레이블 + 색상 결정
  let ctaLabel = $derived(payload.button_label ?? ctaDefaults(payload.type).label)
  let ctaColor = $derived(payload.button_color ?? ctaDefaults(payload.type).color)
  let ctaUrl = $derived(payload.action_url ?? null)

  function ctaDefaults(type: string): { label: string; color: 'purple' | 'red' | 'green' | 'orange' } {
    switch (type) {
      case 'PAYMENT_REQUEST_CARD':   return { label: '대여 계약 결제하기', color: 'purple' }
      case 'RESERVATION_STATUS_CARD': return { label: '예약 상세 보기', color: 'purple' }
      case 'RETURN_REGISTRATION_CARD': return { label: '반납 방법 선택', color: 'orange' }
      case 'SHIPMENT_TRACKING_CARD': return { label: '배송 추적', color: 'green' }
      case 'COUPON_GIFT_CARD':       return { label: '쿠폰 적용하기', color: 'purple' }
      case 'PRODUCT_CARD':           return { label: '바로 예약하기', color: 'purple' }
      // 관리자 발행 액션 타입
      case 'payment_request':        return { label: '대여 계약 결제하기', color: 'purple' }
      case 'reservation_approval':   return { label: '예약 승인 확인', color: 'purple' }
      case 'shipment_notify':        return { label: '배송 추적', color: 'green' }
      case 'return_remind':          return { label: '반납 등록하기', color: 'orange' }
      case 'coupon_issued':          return { label: '쿠폰 적용하기', color: 'purple' }
      default:                       return { label: '확인하기', color: 'purple' }
    }
  }

  function handleCta() {
    if (payload.is_expired) return
    if (onaction) onaction(payload)
    if (ctaUrl) window.location.href = ctaUrl
  }

  // 만료 여부 (PAYMENT_REQUEST_CARD: expires_at 체크)
  let isExpired = $derived(
    payload.is_expired === true ||
    (payload.expires_at ? new Date(payload.expires_at) < new Date() : false)
  )
</script>

<div class="action-card" class:expired={isExpired}>
  <!-- 상품 정보 행 (이미지 + 메타) -->
  {#if payload.product_name || imageUrl}
    <div class="product-row">
      {#if imageUrl}
        <img
          class="product-img"
          src={imageUrl}
          alt="{payload.product_name ?? '상품'} 이미지"
          width="64"
          height="64"
          loading="lazy"
        />
      {:else}
        <div class="product-img product-img--placeholder" aria-hidden="true"></div>
      {/if}
      <div class="product-meta">
        {#if payload.reservation_no}
          <p class="reservation-no">예약번호: {payload.reservation_no}</p>
        {/if}
        {#if payload.product_name}
          <p class="product-name">{payload.product_name}</p>
        {/if}
        <!-- 쿠폰 카드 전용 -->
        {#if payload.discount_label}
          <p class="discount-label">{payload.discount_label}</p>
        {/if}
        <!-- 배송 카드 전용 -->
        {#if payload.tracking_number}
          <p class="tracking-info">{payload.carrier} · {payload.tracking_number}</p>
        {/if}
        <!-- 반납 카드 전용 -->
        {#if payload.return_deadline}
          <p class="return-deadline">반납기한: {payload.return_deadline}</p>
        {/if}

        <!-- CTA 버튼 — Figma node 2497:8767 -->
        <button
          class="cta-btn cta-btn--{ctaColor}"
          onclick={handleCta}
          disabled={isExpired}
          aria-label={isExpired ? '기한 만료된 액션' : ctaLabel}
        >
          {isExpired ? '기한 만료' : ctaLabel}
        </button>
      </div>
    </div>
  {:else}
    <!-- 상품 이미지 없는 단순 카드 (쿠폰 코드 등) -->
    <div class="simple-content">
      {#if payload.discount_label}
        <p class="discount-label-lg">{payload.discount_label}</p>
      {/if}
      {#if payload.coupon_code}
        <p class="coupon-code">{payload.coupon_code}</p>
      {/if}
      <button
        class="cta-btn cta-btn--{ctaColor} cta-btn--full"
        onclick={handleCta}
        disabled={isExpired}
      >
        {isExpired ? '기한 만료' : ctaLabel}
      </button>
    </div>
  {/if}

  <!-- 만료 오버레이 -->
  {#if isExpired}
    <div class="expired-overlay" aria-hidden="true">기한 만료</div>
  {/if}
</div>

<style>
  .action-card {
    position: relative;
    width: 100%;
  }

  .action-card.expired {
    opacity: 0.55;
    pointer-events: none;
  }

  /* 상품 행 — Figma node 2497:8702 */
  .product-row {
    display: flex;
    gap: 20px;
    align-items: center;
    width: 100%;
  }

  /* 64px 상품 이미지 — Figma node 2497:8703 */
  .product-img {
    width: 64px;
    height: 64px;
    border-radius: 10px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .product-img--placeholder {
    background: var(--cs-lilac);
    border-radius: 10px;
  }

  .product-meta {
    display: flex;
    flex-direction: column;
    gap: 5px;
    flex: 1;
    min-width: 0;
  }

  /* Noto Sans KR Regular 12px — Figma node 2497:8706 */
  .reservation-no {
    font: 400 12px/2 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    margin: 0;
  }

  /* Noto Sans KR Bold 14px — Figma node 2497:8707 */
  .product-name {
    font: 700 14px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    letter-spacing: -0.5px;
    margin: 0;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .discount-label,
  .tracking-info,
  .return-deadline {
    font: 400 12px/1.5 'Noto Sans KR', sans-serif;
    color: var(--cs-text-dark);
    margin: 0;
  }

  /* CTA 버튼 — Figma node 2497:8767, 2497:8782 */
  .cta-btn {
    border: none;
    border-radius: 10px;
    padding: 5px 10px;
    width: 100%;
    min-height: 44px;
    font: 700 16px/2 'Noto Sans KR', sans-serif;
    color: var(--cs-white);
    cursor: pointer;
    transition: filter 0.15s;
    margin-top: 5px;
  }

  .cta-btn:hover:not(:disabled) {
    filter: brightness(0.92);
  }

  .cta-btn:disabled {
    cursor: not-allowed;
  }

  /* 색상 variants */
  .cta-btn--purple { background: var(--cs-purple); }
  .cta-btn--red    { background: var(--cs-red-badge); }
  .cta-btn--green  { background: #2ecc71; }
  .cta-btn--orange { background: var(--cs-orange); }

  .cta-btn--full { width: 100%; }

  /* 단순 카드 */
  .simple-content {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }

  .discount-label-lg {
    font: 700 18px/1.2 'Noto Sans KR', sans-serif;
    color: var(--cs-purple);
    margin: 0;
  }

  .coupon-code {
    font: 400 13px/1 'Courier New', monospace;
    color: var(--cs-text-dark);
    background: var(--cs-surface-gray);
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    letter-spacing: 1px;
    margin: 0;
  }

  /* 만료 오버레이 */
  .expired-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(236, 235, 244, 0.6);
    border-radius: 10px;
    font: 700 14px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #777777);
    backdrop-filter: blur(2px);
  }
</style>
