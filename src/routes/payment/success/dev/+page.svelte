<script lang="ts">
  import { goto } from '$app/navigation'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  function fmt(n: number): string {
    return n.toLocaleString('ko-KR')
  }

  function handleConfirm() {
    goto('/')
  }
</script>

<svelte:head>
  <title>[DEV] 예약신청완료 미리보기 — 크레이지샷</title>
</svelte:head>

<div class="page-root">

  <!-- GNB pill (모바일 전용 — PC는 아래 sub-gnb-b(sub-gnb_navi_b 표준)로 대체, 2026-09-06 지적) -->
  <div class="gnb-wrap">
    <div class="gnb-pill">
      <button class="gnb-back" onclick={() => goto('/cart')} aria-label="체크아웃으로">
        <svg width="15" height="10" viewBox="0 0 15 10" fill="none" aria-hidden="true">
          <path d="M14 5H1M1 5L5.5 1M1 5L5.5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <span class="gnb-title">예약신청완료</span>
      <button class="gnb-ham" aria-label="더보기 메뉴" onclick={() => {}}>
        <svg width="20" height="17" viewBox="0 0 20 17" fill="none" aria-hidden="true">
          <path d="M18.5 6.75C19.3284 6.75 20 7.42157 20 8.25C20 9.07843 19.3284 9.75 18.5 9.75H1.5C0.671573 9.75 0 9.07843 0 8.25C0 7.42157 0.671573 6.75 1.5 6.75H18.5Z" fill="#CF0000"/>
          <path d="M18.5 14C19.1904 14 19.75 14.5596 19.75 15.25C19.75 15.9404 19.1904 16.5 18.5 16.5H1.5C0.809644 16.5 0.25 15.9404 0.25 15.25C0.25 14.5596 0.809644 14 1.5 14H18.5ZM18.5 0C19.1904 0 19.75 0.559644 19.75 1.25C19.75 1.94036 19.1904 2.5 18.5 2.5H1.5C0.809644 2.5 0.25 1.94036 0.25 1.25C0.25 0.559644 0.809644 0 1.5 0H18.5Z" fill="#201857"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- PC 전용 서브 GNB(sub-gnb_navi_b 표준, front-uiux.md §13-2 — Back Pill 단독) -->
  <header class="sub-gnb-b">
    <div class="sub-gnb-b-inner">
      <button type="button" class="sub-gnb-b-pill" onclick={() => goto('/cart')} aria-label="뒤로 가기, 예약신청완료">
        <div class="sub-gnb-b-pill-left">
          <svg class="sub-gnb-b-arrow" viewBox="0 0 21.3844 17.1421" fill="none" aria-hidden="true">
            <path d="M19.8844 8.5707L1.5 8.57107M8.57107 1.5L1.5 8.57107L8.57107 15.6421" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/>
          </svg>
          <span class="sub-gnb-b-back">Back</span>
        </div>
        <span class="sub-gnb-b-title">예약신청완료</span>
      </button>
    </div>
  </header>

  <!-- 타이틀 영역 -->
  <!-- 2026-08-21(TASK.md "예약 결제·계약서명 순서 재설계" Phase B): 결제(mock) 트리거가
       cart 체크아웃(1단계)에서 계약서명 완료 시점(3단계)으로 이동하면서, 이 화면은 더 이상
       "결제완료"가 아니라 "예약신청 완료"만 안내한다 — 결제·계약서명 둘 다 아직 이 시점엔
       발생하지 않은 상태다(항상 hold, payment_confirmed_at NULL). 과거의 pendingContract
       조건분기(결제완료·서명대기)는 이 시점에 더는 성립하지 않아 제거 — 단일 문구로 통일. -->
  <div class="title-bar">
    <div class="icon-box icon-box--success" aria-hidden="true">
      <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
        <path d="M1 7L7 13L19 1" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <p class="title-text">예약 신청이 완료됐어요! 계약서 서명·결제까지 마치면 예약이 확정돼요.</p>
  </div>

  <div class="body">

    <!-- ── 상품 목록 (1개 이상) ── -->
    {#each data.items as item, i (item.code || i)}
      <div class="order-card">

        <!-- 상품 헤더 -->
        <div class="order-product">
          <p class="product-name">{item.name}</p>
          {#if item.code}
            <p class="product-code">{item.code}</p>
          {/if}
        </div>

        <!-- 대여 상세 -->
        <div class="order-detail">
          {#if item.startDate && item.endDate}
            <div class="detail-row">
              <span class="detail-label">대여일정</span>
              <span class="detail-value">{item.startDate} — {item.endDate}</span>
            </div>
          {/if}

          {#if item.pickupMethod}
            <div class="detail-row">
              <span class="detail-label">수령방식</span>
              <span class="detail-value">{item.pickupMethod}</span>
            </div>
          {/if}

          {#if item.returnMethod}
            <div class="detail-row">
              <span class="detail-label">반납방식</span>
              <span class="detail-value">{item.returnMethod}</span>
            </div>
          {/if}

          {#if item.price > 0}
            <div class="detail-row">
              <span class="detail-label">대여요금</span>
              <span class="detail-value">{fmt(item.price)} 원</span>
            </div>
          {/if}
        </div>

      </div>

      <!-- 옵션상품 — 본상품 카드와 완전히 동일한 구조(order-product 헤더 + order-detail
           행)로 렌더링(2026-09-09). "수량"·"대여요금" 각각 본상품의 detail-row와 동일한
           라벨-값 형식·무게로 독립된 행에 표시 — 한 행에 합쳐 표기하지 않음. -->
      {#if item.options && item.options.length > 0}
        {#each item.options as opt (opt.name)}
          <div class="order-card">
            <div class="order-product">
              <p class="product-name">{opt.name} <span class="option-tag">(옵션)</span></p>
            </div>
            <div class="order-detail">
              <div class="detail-row">
                <span class="detail-label">수량</span>
                <span class="detail-value">{opt.qty}개</span>
              </div>
              {#if opt.price}
                <div class="detail-row">
                  <span class="detail-label">대여요금</span>
                  <span class="detail-value">{fmt(opt.price)} 원</span>
                </div>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    {/each}

    <!-- ── 예약 요금 분해 카드 ── -->
    <!-- 2026-08-21(Phase B): "결제 내역"→"예약 내역"으로 개명 — 이 시점엔 아직 결제가
         발생하지 않았다(실제 소진은 3단계/계약서명). 단 쿠폰/포인트 "선택"은 2026-08-24
         장바구니 UI 복원 이후 amount(결제 예정 금액)에 이미 반영돼 있으므로, 그 근거를
         이 카드에서도 cart Order Total 섹션과 동일한 항목·순서·표기로 함께 보여준다
         (2026-09-09 — 항목 누락으로 "대여요금+배송료≠결제예정금액"이 설명 없이 보이던
         결함 수정). -->
    <div class="order-card">
      <div class="order-product">
        <p class="product-name">예약 내역</p>
      </div>
      <div class="order-detail">

        {#if data.subtotal > 0}
          <div class="detail-row">
            <span class="detail-label">대여요금</span>
            <span class="detail-value">{fmt(data.subtotal)} 원</span>
          </div>
        {/if}

        {#if data.membershipDiscount > 0}
          <div class="detail-row">
            <span class="detail-label">멤버십 할인</span>
            <span class="detail-value detail-value--discount">−{fmt(data.membershipDiscount)} 원</span>
          </div>
        {/if}

        {#if data.couponDiscount > 0}
          <div class="detail-row">
            <span class="detail-label">쿠폰 할인</span>
            <span class="detail-value detail-value--discount">−{fmt(data.couponDiscount)} 원</span>
          </div>
        {/if}

        {#if data.deliveryFee > 0}
          <div class="detail-row">
            <span class="detail-label">배송요금</span>
            <span class="detail-value">{fmt(data.deliveryFee)} 원</span>
          </div>
        {:else}
          <div class="detail-row">
            <span class="detail-label">배송요금</span>
            <span class="detail-value detail-value--free">무료</span>
          </div>
        {/if}

        {#if data.vat > 0}
          <!-- cart Order Total 섹션(src/routes/cart/+page.svelte)과 동일한 "포함가 역산"
               표기 — 별도 가산 항목이 아니라 위 대여요금에 이미 포함된 금액이므로 괄호로
               표시(합산에 포함되지 않음을 명시). "18,182 원" 형태로만 단독 노출되면
               "더해야 할 금액"으로 오인될 수 있어 2026-09-09 수정. -->
          <div class="detail-row">
            <span class="detail-label">부가세 (10%, 포함)</span>
            <span class="detail-value">({fmt(data.vat)}원)</span>
          </div>
        {/if}

        <div class="detail-row">
          <span class="detail-label">포인트 사용</span>
          <span
            class="detail-value"
            class:detail-value--points-off={data.pointsUsed === 0}
            class:detail-value--points-on={data.pointsUsed > 0}
          >{fmt(data.pointsUsed)} point</span>
        </div>

        <div class="price-divider"></div>

        <div class="detail-row detail-row--total">
          <span class="detail-label detail-label--total">결제 예정 금액</span>
          <span class="detail-value detail-value--total">{fmt(data.amount)} 원</span>
        </div>

        <div class="detail-row">
          <span class="detail-label">신청일시</span>
          <span class="detail-value">{data.confirmedAt}</span>
        </div>

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
    /* 모바일: 0 — 이전엔 여기 28px + .gnb-wrap 40px가 이중으로 쌓여 있어(둘 다 예전엔
       숨겨진 전역 GNB를 위한 여백), .gnb-wrap만 16px로 고쳐도 이 28px이 남아 표준
       서브GNB 페이지(top:0)보다 여전히 더 벌어져 있었다(2026-09-06 재지적으로 발견).
       PC는 기존 28px 그대로 유지(@media min-width:768px 참고, 이번 지적 범위 밖). */
    padding-top: 0;
    padding-bottom: 60px;
  }

  /* GNB */
  .gnb-wrap {
    width: 100%;
    /* 표준 모바일 서브GNB 공백값(SubGnb.svelte .sub-gnb-mobile: padding:16px 25px 0)과
       동일하게 맞춤 — 기존 40px는 이제 숨겨진 전역 GNB를 위해 남겨뒀던 여백이라
       불필요한 공백이었음(2026-09-06 지적) */
    padding: 16px 25px 0;
  }
  /* 2026-09-07 — 전역 GNB(GNB.svelte)를 CSS !important로 숨기는 대신, root
     +layout.svelte의 GNB 제외 경로 목록에 '/payment'를 추가해 이 화면에서 애초에
     전역 GNB가 렌더링되지 않도록 구조적으로 해결(:global() !important 오버라이드는
     +page.svelte 언마운트 후에도 컴파일된 CSS 청크가 SPA 네비게이션 중 제거되지 않아,
     이 화면을 거친 뒤 다른 GNB 노출 화면으로 이동해도 GNB가 계속 숨겨진 채로 남는
     실제 회귀 버그로 이어졌음 — 라이브 검증으로 확인·근본 수정). */
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
  .gnb-back, .gnb-ham {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    background: none;
    border: none;
    color: var(--cs-text);
    cursor: pointer;
    padding: 0;
  }
  .gnb-ham { margin-right: -8px; }
  .gnb-title {
    font: var(--text-m-body-16B);
    color: var(--cs-text);
    letter-spacing: -0.5px;
  }

  /* ━━━ PC 전용 서브 GNB(sub-gnb_navi_b, front-uiux.md §13-2 표준 그대로) ━━━ */
  .sub-gnb-b {
    /* 표준 스펙(cart/+page.svelte)의 부모는 align-items 기본값(stretch)이라 폭 지정이
       불필요하지만, 이 페이지의 .page-root는 align-items:center라 stretch가 되지 않는다
       — width:100% 누락 시 알약이 콘텐츠 크기로 쪼그라들며 화면 중앙에 떠 보이는 결함
       발생(2026-09-06 지적). 이 페이지의 다른 최상위 자식(.gnb-wrap·.title-bar·.body)도
       전부 동일한 이유로 width:100%를 명시하고 있음 — 그 관례를 그대로 따름. */
    width: 100%;
    position: sticky;
    top: 0;
    z-index: 50;
    background: transparent;
    border-bottom: none;
    display: none;                        /* 모바일 숨김 */
  }
  @media (min-width: 641px) {
    .sub-gnb-b { display: block; }        /* PC에서만 표시 */
    /* 이 화면 자체의 모바일 스타일 GNB 알약(.gnb-wrap)은 sub-gnb_navi_b와 같은 641px
       분기점에서 대체 — 그 사이 구간에도 두 GNB가 동시에 뜨지 않도록 함(2026-09-06 지적) */
    .gnb-wrap { display: none; }
  }
  .sub-gnb-b-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 30px;
    width: 100%;
    max-width: var(--layout-pc-max);
    margin: 0 auto;
    padding: 20px var(--layout-pc-pad);
    flex-wrap: nowrap;
    box-sizing: border-box;
  }
  .sub-gnb-b-pill {
    /* Stephen 지시(2026-09-06): PC반응형 가로폭 100% — front-uiux.md §13-2 문서상
       기본값(max-width:460px)은 cart/+page.svelte 실제 코드의 넓은 화면(>1024px) 케이스
       기준이고, 좁은 PC~태블릿 구간(≤1024px)에서는 그 소스 정본 자체가 이미
       max-width:none; flex:1 1 auto로 폭을 100%까지 풀어둔다 — 이 화면은 항상 그 넓힌
       쪽 값을 쓴다. */
    background: rgba(225, 222, 243, 0.4);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 40px;
    border-radius: 25px;
    width: 100%;
    max-width: none;
    min-width: 0;
    min-height: 62px;
    flex: 1 1 auto;
    box-sizing: border-box;
    color: var(--cs-text);
    transition: background 0.2s;
  }
  .sub-gnb-b-pill:hover { background: rgba(225, 222, 243, 0.85); }
  .sub-gnb-b-pill-left {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .sub-gnb-b-arrow {
    width: 22px;
    height: 18px;
    flex-shrink: 0;
  }
  .sub-gnb-b-back {
    font: var(--text-pc-title-16);
    color: var(--cs-text);
    white-space: nowrap;
  }
  .sub-gnb-b-title {
    font: var(--text-pc-menu-en-20);
    color: var(--cs-text);
    flex-shrink: 0;
    white-space: nowrap;
  }

  /* 타이틀 */
  .title-bar {
    display: flex;
    flex-direction: column;
    gap: 20px;
    align-items: flex-start;
    width: 100%;
    max-width: 1240px;
    min-width: 340px;
    padding: 50px 40px;
  }
  .icon-box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    /* --radius-icon-box(25px)는 PC 70px 박스 기준 고정값이라, 모바일 48px 박스에 그대로
       쓰면 반경이 박스 절반을 넘어 사각 라운드가 아니라 완전한 원으로 보였다(2026-09-06
       지적). PC와 동일한 반경 비율(25/70)로 스케일링해 48px에서도 같은 사각 라운드
       형태를 유지 — 절대값이 아니라 비율을 맞추는 것이 핵심이라 계산식을 그대로 둠. */
    border-radius: calc(var(--radius-icon-box) * 48 / 70);
    flex-shrink: 0;
  }
  .icon-box--success { background: var(--cs-purple); }
  .title-text {
    /* 모바일 반응형: 아이콘·폰트를 htitle(24L) 대비 두 단계 작은 body(16L) 티어로
       축소(2026-09-06 지적) — PC는 아래 @media (min-width:768px)에서 원래 크기로 복원 */
    font: var(--text-m-body-16L);
    color: var(--cs-purple-dark);
    letter-spacing: -0.5px;
    margin: 0;
  }

  /* body */
  .body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: stretch;
    width: 100%;
    padding: 0 25px;
  }

  /* 주문 카드 */
  .order-card {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
    border-radius: var(--radius-asym-card);
    overflow: hidden;
  }

  /* 상품 헤더 */
  .order-product {
    display: flex;
    flex-direction: column;
    gap: 5px;
    background: var(--cs-surface-gray);
    padding: 20px 30px;
  }
  .product-name {
    font: var(--text-m-title-18B);
    color: var(--cs-text-dark);
    letter-spacing: -0.3px;
    margin: 0;
  }
  .product-code {
    font: var(--text-m-script-14B);
    color: var(--cs-text-mid);
    letter-spacing: -0.5px;
    line-height: 2;
    margin: 0;
  }
  /* 옵션상품 카드 헤더 — 본상품과 동일한 product-name 안에서 이름 우측에 구분용 태그만
     추가(2026-09-09). 카드 구조·굵기는 본상품과 동일하게 유지, 이 태그만 옅게 처리. */
  .option-tag {
    font: var(--text-m-script-14B);
    color: var(--cs-text-light);
    font-weight: 400;
  }

  /* 상세 */
  .order-detail {
    display: flex;
    flex-direction: column;
    gap: 5px;
    background: var(--cs-surface-gray);
    padding: 20px 30px 30px;
  }
  .detail-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-height: 32px;
  }
  .detail-row--total {
    padding-top: 4px;
  }
  .detail-label {
    font: var(--text-m-script-14B);
    color: var(--cs-text-light);
    letter-spacing: -0.5px;
    line-height: 2;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .detail-label--total {
    font: var(--text-m-body-16B);
    color: var(--cs-text-dark);
  }
  .detail-value {
    font: var(--text-m-body-16B);
    color: var(--cs-text-mid);
    letter-spacing: -0.5px;
    line-height: 2;
    text-align: right;
  }
  .detail-value--discount { color: var(--cs-error, #e53e3e); }
  .detail-value--free     { color: var(--cs-purple); font: var(--text-m-script-14B); line-height: 2; }
  /* 포인트 사용 — 미사용(0)은 옅은 회색, 사용(N)은 짙은 회색으로 상태 구분(2026-09-09) */
  .detail-value--points-off { color: var(--cs-text-light); }
  .detail-value--points-on  { color: var(--cs-text-dark); }
  .detail-value--total    {
    font: var(--text-m-title-18B);
    color: var(--cs-purple-dark);
    letter-spacing: -0.3px;
  }
  .price-divider {
    width: 100%;
    height: 1px;
    background: var(--cs-lilac);
    margin: 8px 0;
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
    align-self: center;
    margin-top: 18px;
  }
  .confirm-btn:hover { opacity: 0.85; }

  /* PC 반응형 */
  @media (min-width: 768px) {
    .page-root { padding-top: 28px; }
    .title-bar {
      max-width: 900px;
      margin-left: auto;
      margin-right: auto;
    }
    /* 모바일에서만 두 단계 축소(위 base 스타일) — PC는 원래 크기(htitle-24L/70px) 유지 */
    .icon-box {
      width: 70px;
      height: 70px;
      border-radius: var(--radius-icon-box);
    }
    .title-text {
      font: var(--text-m-htitle-24L);
    }
    .body {
      max-width: 900px;
      margin-left: auto;
      margin-right: auto;
      padding-left: clamp(24px, 4vw, 48px);
      padding-right: clamp(24px, 4vw, 48px);
    }
    .confirm-btn {
      max-width: 480px;
    }
  }
</style>
