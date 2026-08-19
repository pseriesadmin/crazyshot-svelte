<script lang="ts">
  // PRD.1.7.5 — ActionCard: 6종 액션 카드 렌더링
  // Figma node: 2497:8761 (product card with CTA), 2497:8702

  import type { ActionPayload } from '$lib/types/chat'

  interface Props {
    payload: ActionPayload
    onaction?: (payload: ActionPayload) => void
    /** 서버측 만료 재검증용 메시지 ID (MessageBubble에서 전달, 선택적) */
    messageId?: string
    /** 관리자 뷰 여부 — true 시 pending 쿠폰카드에 승인/거절 버튼 표시 */
    isAdmin?: boolean
    /** COUPON_GIFT_CARD 승인/거절 콜백 — AdminChatPanel에서 주입 */
    oncouponapprove?: (messageId: string, reject: boolean) => void
  }

  let { payload, onaction, messageId, isAdmin = false, oncouponapprove }: Props = $props()

  // COUPON_GIFT_CARD 승인 대기 처리
  let approvalStatus = $derived(
    payload.type === 'COUPON_GIFT_CARD' ? (payload.approval_status ?? null) : null
  )
  let isCouponPending   = $derived(approvalStatus === 'pending')
  let isCouponRejected  = $derived(approvalStatus === 'rejected')

  let isApproving = $state(false)

  async function handleCouponApprove(reject: boolean): Promise<void> {
    if (!messageId || isApproving) return
    isApproving = true
    try {
      oncouponapprove?.(messageId, reject)
    } finally {
      isApproving = false
    }
  }

  // CS-A2: 서버측 재검증 실패 시 에러 메시지 표시
  let serverExpiredError = $state(false)

  // 상품 이미지 URL — product_image는 Cloudinary public_id 또는 Supabase Storage 전체 URL
  // 둘 다 올 수 있음(products.image_urls 저장 형식이 실제로 Storage 전체 URL이라 ProductHero.svelte와
  // 동일하게 방어 분기 필요 — L1 QA 재검수에서 발견된 회귀 수정, chatActionEnrich.ts:113-115 참고)
  let imageUrl = $derived(
    payload.product_image
      ? payload.product_image.startsWith('http')
        ? payload.product_image
        : `https://res.cloudinary.com/crazyshot/image/upload/w_128,h_128,c_fill,f_auto,q_auto/${payload.product_image}.jpg`
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
      case 'reservation_hold':        return { label: '예약 신청 확인', color: 'purple' }
      case 'reservation_approval':   return { label: '예약 승인 확인', color: 'purple' }
      case 'shipment_notify':        return { label: '배송 추적', color: 'green' }
      case 'rental_confirm':         return { label: '대여 정보 확인', color: 'purple' }
      case 'return_remind':          return { label: '반납 등록하기', color: 'orange' }
      case 'coupon_issued':          return { label: '쿠폰 적용하기', color: 'purple' }
      case 'contract_link':          return { label: '전자계약 보기', color: 'purple' }
      case 'contract_signed':        return { label: '전자계약 확인', color: 'purple' }
      case 'INQUIRY_REPLY_CARD':     return { label: '답변 확인하기', color: 'purple' }
      // GSD-17: 제품 링크 카드 (관리자 @ 멘션으로 삽입)
      case 'product_link':           return { label: '상품 상세 보기', color: 'purple' }
      // GSD-20: CTA가 있는 자동응답 카드
      case 'canned_cta':             return { label: payload.button_label ?? '확인하기', color: 'purple' }
      default:                       return { label: '확인하기', color: 'purple' }
    }
  }

  // Stephen 확정(2026-08-15): return_remind CTA는 예약의 "현재" 상태에 따라 동작이 갈림 —
  // 예정(in_use·return_requested)=등록화면 / 지난(returned·completed)=목록화면(둘 다 같은
  // /account/rental/[id]/history 라우트, 그 페이지 안에서 status로 모드 분기) / 취소·이상
  // (cancelled·damage_claimed)=버튼 자체를 비활성화. 발송 시점이 아니라 "지금" 상태를 봐야 하므로
  // 매 렌더 시 가볍게 조회한다(실패 시 fail-open — 목적지 페이지에도 동일한 서버측 가드가 있음).
  let returnRemindBlocked = $state(false)

  $effect(() => {
    if (payload.type !== 'return_remind' || !ctaUrl) { returnRemindBlocked = false; return }
    const match = ctaUrl.match(/\/account\/rental\/(\d+)\/history/)
    if (!match) { returnRemindBlocked = false; return }
    let cancelled = false
    fetch(`/api/chat/reservation-status/${match[1]}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { status: string } | null) => {
        if (cancelled) return
        returnRemindBlocked = data ? ['cancelled', 'damage_claimed'].includes(data.status) : false
      })
      .catch(() => { if (!cancelled) returnRemindBlocked = false })
    return () => { cancelled = true }
  })

  // CS-A2: 서버측 만료 재검증 후 CTA 실행
  async function handleCta(): Promise<void> {
    if (ctaDisabled) return
    serverExpiredError = false

    // 팝업 차단 방지(products.md QR-AUTO-1과 동일 패턴): await fetch 이후 window.open을
    // 호출하면 사용자 제스처 유효기간이 끝나 브라우저가 조용히 차단한다 — 클릭 직후(await 이전)
    // 빈 창을 먼저 열어 제스처를 소비해두고, 검증이 끝나면 그 창의 위치만 바꾼다.
    // ctaUrl은 항상 자사 내부 경로라 noopener 없이 열어도 탭내빙 위험이 없음.
    let pendingWindow: Window | null = null
    if (ctaUrl) {
      pendingWindow = window.open('', '_blank')
    }

    // messageId가 있으면 서버에 만료 여부 재확인 (클라이언트 시계 신뢰 X)
    if (messageId) {
      try {
        const res = await fetch(`/api/chat/messages/${messageId}/execute-action`, {
          method: 'POST',
        })
        if (res.status === 410) {
          // 서버가 만료 확인 → 로컬 상태 갱신 후 중단
          serverExpiredError = true
          pendingWindow?.close()
          return
        }
        if (!res.ok) {
          // 네트워크 ��류 등 — 진행 불가로 처리
          serverExpiredError = true
          pendingWindow?.close()
          return
        }
      } catch {
        // fetch 자체 ���패 — 진행 불가
        serverExpiredError = true
        pendingWindow?.close()
        return
      }
    }

    if (onaction) onaction(payload)
    if (ctaUrl) {
      if (pendingWindow) pendingWindow.location.href = ctaUrl
      else window.open(ctaUrl, '_blank')
    }
  }

  // 만료 여부 (PAYMENT_REQUEST_CARD: expires_at 체크)
  let isExpired = $derived(
    payload.is_expired === true ||
    (payload.expires_at ? new Date(payload.expires_at) < new Date() : false)
  )

  // pending 상태: 고객 화면에선 CTA 비활성 / 관리자 화면엔 승인·거절 버튼으로 대체
  let ctaDisabled = $derived(isExpired || serverExpiredError || returnRemindBlocked || isCouponPending || isCouponRejected)
</script>

<div class="action-card" class:expired={isExpired || serverExpiredError}>
  <!-- GSD-17: product_link 전용 렌더링 (썸네일+상품명+가격+상세보기 링크) -->
  {#if payload.type === 'product_link'}
    <div class="product-link-card">
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
        <p class="product-link-badge">상품 안내</p>
        {#if payload.product_name}
          <p class="product-name">{payload.product_name}</p>
        {/if}
        {#if payload.product_price}
          <p class="product-link-price">{payload.product_price.toLocaleString()}원/일</p>
        {/if}
        {#if payload.product_slug}
          <a
            class="product-link-btn"
            href="/products/{payload.product_slug}"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="{payload.product_name ?? '상품'} 상세 보기"
          >상세 보기 →</a>
        {:else if payload.product_id}
          <a
            class="product-link-btn"
            href="/products/{payload.product_id}"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="{payload.product_name ?? '상품'} 상세 보기"
          >상세 보기 →</a>
        {:else if ctaUrl}
          <a
            class="product-link-btn"
            href={ctaUrl}
            target="_blank"
            rel="noopener noreferrer"
          >{ctaLabel}</a>
        {/if}
      </div>
    </div>

  <!-- 상품 정보 행 (이미지 + 메타) -->
  {:else if payload.product_name || imageUrl}
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
        <!-- 통합 예약승인 카드(Migration 275) — 체크아웃 배치로 2건 이상 동시 승인된 경우
             상품별 개별 카드 대신 하나의 카드 안에 항목 목록으로 표시 -->
        {#if payload.items && payload.items.length > 1}
          <ul class="items-list">
            {#each payload.items as it (it.reservation_no)}
              <li class="items-list-row">
                <span class="items-list-name">{it.product_name}</span>
                <span class="items-list-no">{it.reservation_no}</span>
              </li>
            {/each}
          </ul>
        {:else}
          {#if payload.reservation_no}
            <p class="reservation-no">예약번호: {payload.reservation_no}</p>
          {/if}
          {#if payload.product_name}
            <p class="product-name">{payload.product_name}</p>
          {/if}
          {#if payload.rental_period}
            <p class="rental-period">{payload.rental_period}</p>
          {/if}
        {/if}
        {#if payload.product_price}
          <p class="product-price">{payload.product_price.toLocaleString()}원/일</p>
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
        <!-- 연체료 카드 전용 (PAYMENT_REQUEST_CARD + late_fee_id) -->
        {#if payload.fee_amount !== undefined && payload.hours_late !== undefined}
          <p class="late-fee-info">연체 {payload.hours_late}시간 · {payload.fee_amount.toLocaleString()}원</p>
        {/if}

        <!-- CTA 버튼 — Figma node 2497:8767 -->
        <button
          class="cta-btn cta-btn--{ctaColor}"
          onclick={handleCta}
          disabled={ctaDisabled}
          aria-label={isExpired || serverExpiredError ? '기한 만료된 액션' : ctaLabel}
        >
          {isExpired || serverExpiredError ? '기한 만료' : ctaLabel}
        </button>
      </div>
    </div>
  {:else}
    <!-- 상품 이미지 없는 단순 카드 (쿠폰 코드 / 연체료 등) -->
    <div class="simple-content">
      {#if payload.fee_amount !== undefined && payload.hours_late !== undefined}
        <!-- 연체료 결제 요청 카드 -->
        <p class="late-fee-title">연체료 결제 요청</p>
        <p class="late-fee-amount">{payload.fee_amount.toLocaleString()}원</p>
        <p class="late-fee-sub">연체 {payload.hours_late}시간 기준</p>
      {:else if payload.discount_label}
        <p class="discount-label-lg">{payload.discount_label}</p>
      {/if}
      {#if payload.coupon_code}
        <p class="coupon-code">{payload.coupon_code}</p>
      {/if}

      {#if isCouponPending && isAdmin}
        <!-- 관리자 화면: pending 상태 → 승인·거절 버튼 -->
        <div class="coupon-approve-row">
          <button
            class="cta-btn cta-btn--purple coupon-approve-btn"
            onclick={() => handleCouponApprove(false)}
            disabled={isApproving}
            aria-label="쿠폰 승인"
          >
            {isApproving ? '처리 중...' : '승인'}
          </button>
          <button
            class="cta-btn cta-btn--reject coupon-reject-btn"
            onclick={() => handleCouponApprove(true)}
            disabled={isApproving}
            aria-label="쿠폰 거절"
          >
            거절
          </button>
        </div>
      {:else if isCouponPending && !isAdmin}
        <!-- 고객 화면: pending 상태 → 비활성 안내 버튼 -->
        <button
          class="cta-btn cta-btn--pending cta-btn--full"
          disabled
          aria-label="쿠폰 확인 중"
        >
          쿠폰 확인 중입니다
        </button>
      {:else if isCouponRejected}
        <!-- 거절된 쿠폰 — 만료 처리 (isExpired와 동일 시각) -->
        <button class="cta-btn cta-btn--purple cta-btn--full" disabled>
          발급 취소됨
        </button>
      {:else}
        <button
          class="cta-btn cta-btn--{ctaColor} cta-btn--full"
          onclick={handleCta}
          disabled={ctaDisabled}
        >
          {isExpired || serverExpiredError ? '기한 만료' : ctaLabel}
        </button>
      {/if}
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

  .rental-period {
    font: 400 12px/1.6 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #777);
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

  /* 통합 예약승인 카드(Migration 275) — 항목 목록 */
  .items-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0 0 2px;
    padding: 0;
    list-style: none;
  }
  .items-list-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .items-list-name {
    font: 700 14px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    letter-spacing: -0.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .items-list-no {
    font: 400 11px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-text-light, #aaaaaa);
    flex-shrink: 0;
  }

  .product-price,
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

  /* 연체료 카드 전용 (PAYMENT_REQUEST_CARD + late_fee_id) */
  .late-fee-info {
    font: 400 12px/1.5 'Noto Sans KR', sans-serif;
    color: var(--cs-orange, #FF4500);
    margin: 0;
  }

  .late-fee-title {
    font: 700 13px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #777);
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .late-fee-amount {
    font: 700 22px/1.2 'Noto Sans KR', sans-serif;
    color: var(--cs-red-badge, #FF3535);
    margin: 4px 0 0;
  }

  .late-fee-sub {
    font: 400 12px/1.5 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #777);
    margin: 0;
  }

  /* GSD-17: product_link 카드 */
  .product-link-card {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    width: 100%;
  }

  .product-link-badge {
    font: 700 10px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-purple);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0 0 4px;
  }

  .product-link-price {
    font: 400 12px/1.5 'Noto Sans KR', sans-serif;
    color: var(--cs-text-dark);
    margin: 0;
  }

  .product-link-btn {
    display: inline-block;
    margin-top: 6px;
    padding: 5px 12px;
    background: var(--cs-purple);
    color: #fff;
    font: 700 12px/1 'Noto Sans KR', sans-serif;
    border-radius: 20px;
    text-decoration: none;
    transition: filter 0.15s;
  }

  .product-link-btn:hover {
    filter: brightness(0.9);
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

  /* 쿠폰 승인·거절 버튼 행 (관리자 전용) */
  .coupon-approve-row {
    display: flex;
    gap: 8px;
    width: 100%;
  }
  .coupon-approve-btn,
  .coupon-reject-btn {
    flex: 1;
    min-height: 36px;
    padding: 5px 8px;
    font-size: 14px;
  }
  .cta-btn--reject {
    background: var(--cs-text-light, #aaaaaa);
  }
  .cta-btn--reject:hover:not(:disabled) {
    filter: brightness(0.88);
  }

  /* pending 상태 안내 버튼 (고객용) */
  .cta-btn--pending {
    background: var(--cs-text-light, #aaaaaa);
    cursor: not-allowed;
  }
</style>
