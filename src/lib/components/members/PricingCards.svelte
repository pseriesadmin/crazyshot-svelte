<script lang="ts">
  import type { SubscriptionPlanRow } from '$lib/types/subscription'

  interface Props {
    plans: SubscriptionPlanRow[]
    selectedPlanId: number | null
    onselect: (id: number) => void
  }

  let { plans, selectedPlanId, onselect }: Props = $props()

  // PC 카드는 슬롯별(1/2/3) 이미지 배치·크롭이 각기 다른 비정형 레이아웃 — index 순서로 슬롯 매핑
  function slotClass(index: number): 'slot-1' | 'slot-2' | 'slot-3' {
    if (index === 0) return 'slot-1'
    if (index === 1) return 'slot-2'
    return 'slot-3'
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
    {#each plans as plan, i (plan.id)}
      <button
        type="button"
        class="plan-card-pc {slotClass(i)}"
        class:selected={selectedPlanId === plan.id}
        data-name="plan{i + 1}"
        onclick={() => onselect(plan.id)}
      >
        <!-- 순수 배경 div — 자식 없음 -->
        <div class="plan-title-block" data-name="title"></div>
        {#if (plan.image_url ?? plan.image_urls?.[0])}
          <div class="plan-img-wrap">
            <img src={(plan.image_url ?? plan.image_urls?.[0])} alt="" class="plan-img" />
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
      </button>
    {/each}
  </div>

  {#if selectedPlanId !== null}
    <div class="pc-cta-wrap">
      <a href="/subscribe/{selectedPlanId}" class="pc-cta">구독하기</a>
    </div>
  {/if}
</section>

<!-- ── Mobile 플랜 카드 (<1024px) ────────────────────────────── -->
<section class="pricing-mobile" aria-label="멤버십 플랜">
  <div class="pricing-m-inner">
    {#each plans as plan (plan.id)}
      <div
        class="plan-card-m"
        class:pressed={pressedId === plan.id}
        class:selected={selectedPlanId === plan.id}
        onpointerdown={() => { pressedId = plan.id }}
        onpointerup={() => { pressedId = null }}
        onpointerleave={() => { pressedId = null }}
        onclick={() => onselect(plan.id)}
        role="button"
        tabindex="0"
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onselect(plan.id) } }}
      >
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
          {#if (plan.image_url ?? plan.image_urls?.[0])}
            <img src={(plan.image_url ?? plan.image_urls?.[0])} alt="{plan.name} 카메라 장비" class="plan-m-img" />
          {/if}
          {#if plan.tagline}
            <span class="plan-m-tagline">{plan.tagline}</span>
          {/if}
          {#if plan.description}
            <p class="plan-m-desc">{plan.description}</p>
          {/if}
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

  .pc-cta-wrap { display: flex; justify-content: center; margin-top: 40px; }
  .pc-cta {
    padding: 16px 48px; border-radius: var(--radius-xl); background: var(--cs-red-badge); color: var(--cs-white);
    font-family: var(--font-kr); font-size: 18px; font-weight: 700; text-decoration: none;
    transition: background 0.2s, transform 0.2s, box-shadow 0.2s;
  }
  .pc-cta:hover {
    background: #E02020; transform: scale(1.03); box-shadow: 0 6px 20px rgba(255, 53, 53, 0.45);
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
    height: 400px;
    border-radius: 50px;
    background: var(--cs-dark);
    overflow: hidden;
    position: relative;
    flex-shrink: 0;
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

  /* ─ Image (슬롯별 배치/크롭) ─ */
  .plan-img-wrap { position: absolute; inset: 0; overflow: hidden; }
  .plan-img { width: 100%; height: 100%; object-fit: cover; }

  .slot-1 .plan-img-wrap { left: -45px; top: 85px; width: 210px; height: 248px; right: auto; bottom: auto; }
  .slot-2 .plan-img-wrap { top: 24.75%; right: 57.75%; bottom: 27%; left: -11.75%; }
  .slot-3 .plan-img-wrap { left: 152px; top: 114px; width: 363px; height: 189px; right: auto; bottom: auto; display: flex; align-items: center; justify-content: center; }
  .slot-3 .plan-img { transform: scaleY(-1) rotate(180deg); }

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

  .plan-m-title {
    background: var(--cs-purple);
    padding: 30px;
    display: flex;
    flex-direction: column;
    gap: 15px;
    transition: background 0.2s;
  }

  .plan-m-title.active {
    background: var(--cs-purple-light);
  }

  .plan-m-name-row {
    display: flex;
    align-items: center;
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

  .plan-m-img {
    width: 100%;
    max-height: 150px;
    object-fit: contain;
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

  .plan-m-desc {
    font-family: var(--font-kr);
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-white);
    line-height: 1.6;
    letter-spacing: -0.5px;
    margin: 0;
    text-align: left;
  }
</style>
