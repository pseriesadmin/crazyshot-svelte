<script lang="ts">
  import type { SubscriptionPlanRow } from '$lib/types/subscription'

  interface Props {
    plans: SubscriptionPlanRow[]
    selectedPlanId: number | null
    onselect: (id: number) => void
  }

  let { plans, selectedPlanId, onselect }: Props = $props()

  // CMS 이미지 탭은 image_urls에 저장 — 레거시 단일 image_url(시드된 /members/plan-*.png)은 폴백으로만 사용
  function planImage(plan: SubscriptionPlanRow): string | null {
    return plan.image_urls?.[0] || plan.image_url || null
  }

  let pressedId = $state<number | null>(null)
</script>

<!-- ── PC 플랜 카드 (≥1024px) ──────────────────────────────────── -->
<section class="pricing-pc" aria-label="멤버십 플랜">
  <!-- TitleBar -->
  <div class="price-title-bar">
    <p class="price-title-text">
      <span>최적 </span><span class="price-title-red">구독플랜</span><span> 제안</span>
    </p>
    <div class="price-title-bar-grad"></div>
    <p class="price-title-sub">자신의 스타일과 스케일에 맞는 플랜을 선택하세요.</p>
  </div>
  <!-- Cards -->
  <div class="pricing-pc-inner">
    {#each plans as plan (plan.id)}
      <div
        class="plan-card-pc"
        class:selected={selectedPlanId === plan.id}
        data-name="plan"
        onclick={() => onselect(plan.id)}
        role="button"
        tabindex="0"
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onselect(plan.id) } }}
      >
        <!-- 순수 배경 div — 자식 없음 (이미지가 없을 때의 기본 배경) -->
        <div class="plan-title-block" data-name="title"></div>
        {#if planImage(plan)}
          <!-- 카드 전체를 덮는 BG 이미지 -->
          <div class="plan-img-wrap">
            <img src={planImage(plan)} alt="" class="plan-img" />
          </div>
        {/if}
        {#if plan.tagline}
          <div class="plan-tagline">{plan.tagline}</div>
        {/if}
        <div class="plan-name-pc">{plan.name}</div>
        <div class="plan-price-pc">{plan.monthly_price.toLocaleString()}</div>
        <div class="plan-unit-sub">per user / month</div>
        {#if plan.description}
          <div class="plan-pc-desc">{plan.description}</div>
        {/if}
        <a
          href="/subscribe/{plan.id}"
          class="plan-subscribe-btn"
          onclick={(e) => e.stopPropagation()}
        >
          구독신청하기
        </a>
      </div>
    {/each}
  </div>
</section>

<!-- ── Mobile 플랜 카드 (<1024px) ────────────────────────────── -->
<section class="pricing-mobile" aria-label="멤버십 플랜">
  <div class="pricing-m-inner">
    {#each plans as plan (plan.id)}
      <div
        class="plan-card-m"
        class:pressed={pressedId === plan.id}
        class:selected={selectedPlanId === plan.id}
        class:has-bg={!!planImage(plan)}
        onpointerdown={() => { pressedId = plan.id }}
        onpointerup={() => { pressedId = null }}
        onpointerleave={() => { pressedId = null }}
        onclick={() => onselect(plan.id)}
        role="button"
        tabindex="0"
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onselect(plan.id) } }}
      >
        {#if planImage(plan)}
          <!-- 카드 전체를 덮는 BG 이미지 -->
          <img src={planImage(plan)} alt="{plan.name} 카메라 장비" class="plan-m-bg" />
        {/if}
        <!-- 타이틀 영역 -->
        <div class="plan-m-title" class:active={pressedId === plan.id || selectedPlanId === plan.id}>
          <div class="plan-m-name-row">
            <span class="plan-m-name">{plan.name}</span>
          </div>
          <div class="plan-m-price-row">
            <span class="plan-m-price">{plan.monthly_price.toLocaleString()}</span>
            <span class="plan-m-won">원</span>
          </div>
          <span class="plan-m-sub">1인 계정 / 월</span>
        </div>

        <!-- 본문 영역 -->
        <div class="plan-m-body">
          {#if plan.tagline}
            <span class="plan-m-tagline">{plan.tagline}</span>
          {/if}
          {#if plan.description}
            <p class="plan-m-desc">{plan.description}</p>
          {/if}
          <a
            href="/subscribe/{plan.id}"
            class="plan-m-subscribe-btn"
            onclick={(e) => e.stopPropagation()}
          >
            구독신청하기
          </a>
        </div>
      </div>
    {/each}
  </div>
</section>

<style>
  /* ── PC ── */
  .pricing-pc {
    display: none;
  }
  @media (min-width: 1024px) {
    .pricing-pc {
      display: block;
      width: 1240px;
    }
  }

  /* ─ TitleBar ─ */
  .price-title-bar {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: center;
    margin-bottom: 50px;
  }

  .price-title-text {
    font-family: 'SB AggroOTF', sans-serif;
    font-size: 35px;
    font-weight: 700;
    color: var(--cs-purple);
    margin: 0;
  }

  .price-title-red {
    color: var(--cs-red-badge);
  }

  .price-title-bar-grad {
    background: linear-gradient(to right, var(--cs-red-badge), var(--cs-purple));
    height: 8px;
    width: 80px;
    border-radius: 20px;
  }

  .price-title-sub {
    font-family: var(--font-kr);
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-text-mid);
    letter-spacing: -0.5px;
    line-height: 2;
    margin: 0;
  }

  /* ─ Container ─ */
  .pricing-pc-inner {
    display: flex;
    justify-content: space-between;
  }

  /* ─ Card hover/selected ─ */
  .plan-card-pc {
    transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
                box-shadow 0.35s ease;
    cursor: pointer;
    will-change: transform;
    border: none;
    padding: 0;
    text-align: left;
  }

  .plan-card-pc:hover,
  .plan-card-pc.selected {
    transform: translateY(-16px) scale(1.025);
    box-shadow: 0 32px 64px rgba(16, 11, 50, 0.28),
                0 8px 24px rgba(255, 53, 53, 0.18);
  }

  .plan-card-pc:hover :global([data-name="title"]),
  .plan-card-pc.selected :global([data-name="title"]) {
    transition: width 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
    width: 100% !important;
  }

  /* ─ Card ─ */
  .plan-card-pc {
    width: 400px;
    height: 470px;
    border-radius: 50px;
    background: var(--cs-dark);
    overflow: hidden;
    position: relative;
    flex-shrink: 0;
    cursor: pointer;
  }

  /* ─ Title block (순수 bg div) ─ */
  .plan-title-block {
    position: absolute;
    top: 0;
    left: 0;
    width: 400px;
    height: 240px;
    background: var(--cs-purple);
  }

  /* ─ Plan name — 텍스트 길이에 무관하게 중앙정렬 ─ */
  .plan-name-pc {
    position: absolute;
    top: 56.5px;
    left: 50%;
    transform: translate(-50%, -50%);
    font-family: var(--font-en-display);
    font-size: 35px;
    font-weight: 400;
    color: var(--cs-white);
    white-space: nowrap;
    z-index: 1;
  }

  /* ─ Price ─ */
  .plan-price-pc {
    position: absolute;
    top: 118px;
    left: 50%;
    transform: translate(-50%, -50%);
    font-family: var(--font-en-display);
    font-size: 70px;
    font-weight: 400;
    color: var(--cs-white);
    white-space: nowrap;
    line-height: normal;
    z-index: 1;
  }

  /* ─ per user / month ─ */
  .plan-unit-sub {
    position: absolute;
    left: 50%;
    top: 174px;
    transform: translate(-50%, -50%);
    font-family: var(--font-kr);
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-white);
    text-align: center;
    line-height: 2;
    z-index: 1;
  }

  /* ─ Image (카드 전체 BG, 통이미지) ─ */
  .plan-img-wrap { position: absolute; inset: 0; overflow: hidden; }
  .plan-img { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* 흰 글자 가독성용 오버레이 */
  .plan-img-wrap::after { content: ''; position: absolute; inset: 0; background: rgba(16, 11, 50, 0.35); }

  /* ─ Tagline ─ */
  .plan-tagline {
    position: absolute;
    top: 212px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--cs-red-badge);
    color: var(--cs-white);
    font-family: var(--font-kr);
    font-size: 22px;
    font-weight: 900;
    border-radius: 20px;
    padding: 10px 20px;
    text-align: center;
    white-space: nowrap;
    z-index: 1;
  }

  /* ─ PC 설명 ─ */
  .plan-pc-desc {
    position: absolute;
    left: 50%;
    top: 327px;
    transform: translate(-50%, -50%);
    width: 320px;
    text-align: center;
    white-space: pre-wrap;
    font-family: var(--font-kr);
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-white);
    letter-spacing: -0.5px;
    line-height: 1.6;
    z-index: 1;
  }

  /* ─ 카드별 구독신청 버튼 ─ */
  .plan-subscribe-btn {
    position: absolute;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    z-index: 2;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 44px;
    padding: 0 28px;
    background: var(--cs-red-badge);
    color: var(--cs-white);
    border-radius: var(--radius-xl);
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 700;
    text-decoration: none;
    white-space: nowrap;
    transition: background 0.2s, transform 0.2s;
  }
  .plan-subscribe-btn:hover {
    background: #E02020;
    transform: translateX(-50%) scale(1.05);
  }

  /* ── Mobile ── */
  .pricing-mobile {
    display: block;
    width: 100%;
  }
  @media (min-width: 1024px) {
    .pricing-mobile { display: none; }
  }

  .pricing-m-inner {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 40px 20px;
  }

  .plan-card-m {
    width: 100%;
    max-width: 340px;
    margin: 0 auto;
    border-radius: 30px;
    background: var(--cs-dark);
    overflow: hidden;
    position: relative;
    box-shadow: 0 2px 8px rgba(16, 11, 50, 0.15);
    transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
                box-shadow 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    cursor: pointer;
  }

  .plan-card-m.pressed {
    transform: scale(0.97);
    box-shadow: 0 8px 24px rgba(16, 11, 50, 0.45);
  }

  .plan-card-m.selected {
    box-shadow: 0 0 0 3px var(--cs-red-badge), 0 8px 24px rgba(16, 11, 50, 0.45);
  }

  .plan-m-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    z-index: 0;
  }
  /* PC와 동일: 상단 보라 / 하단 다크 기본 BG 위에 이미지 → 오버레이 → 텍스트 순으로 쌓는다 */
  .plan-card-m.has-bg::after {
    content: '';
    position: absolute;
    inset: 0;
    background: rgba(16, 11, 50, 0.35);
    z-index: 1;
    pointer-events: none;
  }
  .plan-card-m.has-bg .plan-m-body { background: var(--cs-dark); }
  .plan-card-m.has-bg .plan-m-title > *,
  .plan-card-m.has-bg .plan-m-body > * { position: relative; z-index: 2; }

  .plan-m-title {
    background: var(--cs-purple);
    padding: 30px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 15px;
    transition: background 0.2s;
  }

  .plan-m-name-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }

  .plan-m-name {
    font-family: var(--font-kr);
    font-size: 24px;
    font-weight: 900;
    color: var(--cs-white);
  }

  .plan-m-price-row {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 6px;
  }

  .plan-m-price {
    font-family: 'SB AggroOTF', sans-serif;
    font-size: 40px;
    font-weight: 700;
    color: var(--cs-white);
    line-height: 1;
  }

  .plan-m-won {
    font-family: var(--font-kr);
    font-size: 18px;
    font-weight: 700;
    color: var(--cs-white);
  }

  .plan-m-sub {
    font-family: var(--font-kr);
    font-size: 18px;
    font-weight: 700;
    color: var(--cs-white);
    opacity: 0.7;
  }

  .plan-m-body {
    padding: 40px 30px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    align-items: center;
    background: linear-gradient(
      to bottom,
      rgba(16, 11, 50, 0),
      rgba(16, 11, 50, 0.6),
      var(--cs-dark)
    );
  }

  .plan-m-tagline {
    background: var(--cs-red-badge);
    color: var(--cs-white);
    font-family: var(--font-kr);
    font-size: 18px;
    font-weight: 700;
    border-radius: 30px;
    padding: 10px 20px;
    text-align: center;
    width: 100%;
  }

  /* 모바일 구독신청 CTA — front-uiux §5 모바일 primary(44px · red-badge · 30px · hover BG만) */
  .plan-m-subscribe-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 0 20px;
    background: var(--cs-red-badge);
    color: var(--cs-white);
    border-radius: var(--radius-xl);
    font: var(--text-m-body-16B);
    text-decoration: none;
    white-space: nowrap;
    transition: background 0.15s;
  }
  .plan-m-subscribe-btn:hover { background: var(--cs-red); }

  .plan-m-desc {
    font-family: var(--font-kr);
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-white);
    line-height: 1.6;
    letter-spacing: -0.5px;
    margin: 0;
    text-align: center;
  }
</style>
