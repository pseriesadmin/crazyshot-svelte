<script lang="ts">
  const PLANS = [
    {
      id: 'plan1',
      name: 'Easy pack',
      price: '9,900',
      tagline: '완벽한 입문자의 선택',
      taglineW: null as number | null,
      nameLeft: 118,
      priceLeft: 106,
      pcDesc: '장비 고민 없이 가볍게 시작하고 싶다면?\n EASY PACK으로 매월 제공되는 쿠폰과 \n그동안 망설였던 창작의 문턱을 낮추세요.',
      desc: '콘텐츠 제작에 막 입문했나요? 부담 없이 시작할 수 있는 입장권입니다. 필수 장비만으로도 충분히 창작의 세계를 경험할 수 있습니다.',
      img: '/members/plan-easy.png',
      popular: false,
    },
    {
      id: 'plan2',
      name: 'Pop pack',
      price: '19,000',
      tagline: '열정 크리에이터의 선택',
      taglineW: null as number | null,
      nameLeft: 124,
      priceLeft: 91,
      pcDesc: '본격적 촬영을 고민해결 플랜! \n매월 제공되는 쿠폰과 혜택으로\n크리에이터가 원하는 콘텐츠를 자유롭게 \n제작할 수 있습니다.',
      desc: '많은 고객이 가장 사랑하는 인기 플랜! 팬영상, 여행 브이로그 등 원하는 콘텐츠를 자유롭게 제작할 수 있습니다.',
      img: '/members/plan-pop.png',
      popular: true,
    },
    {
      id: 'plan3',
      name: 'Crazy pack',
      price: '29,000',
      tagline: '전문가 위한 프리미엄 선택',
      taglineW: 278 as number | null,
      nameLeft: 110,
      priceLeft: 86,
      pcDesc: '장비 대여부터 배송, 안심렌탈케어까지 \n무제한 왕복 크레이지 배송으로\n 오직 창작에만 집중!',
      desc: '콘텐츠 제작이 일상인 전문가라면 이 플랜을 추천합니다. 무제한 장비 옵션과 전담 지원 서비스로 창작에만 집중하세요.',
      img: '/members/plan-crazy.png',
      popular: false,
    },
  ] as const

  let pressedId = $state<string | null>(null)
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
    {#each PLANS as plan}
      <div class="plan-card-pc" data-name={plan.id}>
        <!-- 순수 배경 div — 자식 없음 -->
        <div class="plan-title-block" data-name="title"></div>
        <!-- 이미지: 카드별 클래스 -->
        {#if plan.id === 'plan1'}
          <img src={plan.img} alt="" class="plan-img-1" />
        {:else if plan.id === 'plan2'}
          <div class="plan-img-2-wrap"><img src={plan.img} alt="" class="plan-img-2" /></div>
        {:else}
          <div class="plan-img-3-outer"><img src={plan.img} alt="" class="plan-img-3" /></div>
        {/if}
        <!-- 태그라인: absolute top:212px -->
        <div class="plan-tagline" style={plan.taglineW ? `width:${plan.taglineW}px` : ''}>{plan.tagline}</div>
        <!-- 플랜명: 카드별 left -->
        <div class="plan-name-pc" style="left:{plan.nameLeft}px">{plan.name}</div>
        <!-- 가격: 카드별 left -->
        <div class="plan-price-pc" style="left:{plan.priceLeft}px">{plan.price}</div>
        <!-- per user / month -->
        <div class="plan-unit-sub">per user / month</div>
        <!-- PC 설명: absolute top:327px -->
        <div class="plan-pc-desc">{plan.pcDesc}</div>
      </div>
    {/each}
  </div>
</section>

<!-- ── Mobile 플랜 카드 (<1024px) ────────────────────────────── -->
<section class="pricing-mobile" aria-label="멤버십 플랜">
  <div class="pricing-m-inner">
    {#each PLANS as plan}
      <div
        class="plan-card-m"
        class:pressed={pressedId === plan.id}
        onpointerdown={() => { pressedId = plan.id }}
        onpointerup={() => { pressedId = null }}
        onpointerleave={() => { pressedId = null }}
        role="button"
        tabindex="0"
      >
        <!-- 타이틀 영역 -->
        <div class="plan-m-title" class:active={pressedId === plan.id}>
          <div class="plan-m-name-row">
            <span class="plan-m-name">{plan.name}</span>
            {#if plan.popular}
              <span class="plan-m-popular">인기</span>
            {/if}
          </div>
          <div class="plan-m-price-row">
            <span class="plan-m-price">{plan.price}</span>
            <span class="plan-m-won">원</span>
          </div>
          <span class="plan-m-sub">1인 계정 / 월</span>
        </div>

        <!-- 본문 영역 -->
        <div class="plan-m-body">
          <img src={plan.img} alt="{plan.name} 카메라 장비" class="plan-m-img" />
          <span class="plan-m-tagline">{plan.tagline}</span>
          <p class="plan-m-desc">{plan.desc}</p>
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

  /* ─ Card hover ─ */
  :global([data-name="plan1"]),
  :global([data-name="plan2"]),
  :global([data-name="plan3"]) {
    transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
                box-shadow 0.35s ease;
    cursor: pointer;
    will-change: transform;
  }

  :global([data-name="plan1"]:hover),
  :global([data-name="plan2"]:hover),
  :global([data-name="plan3"]:hover) {
    transform: translateY(-16px) scale(1.025);
    box-shadow: 0 32px 64px rgba(16, 11, 50, 0.28),
                0 8px 24px rgba(255, 53, 53, 0.18);
  }

  :global([data-name="plan1"]:hover [data-name="title"]),
  :global([data-name="plan2"]:hover [data-name="title"]),
  :global([data-name="plan3"]:hover [data-name="title"]) {
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

  /* ─ Plan name ─ */
  .plan-name-pc {
    position: absolute;
    top: 56.5px;
    transform: translateY(-50%);
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
    transform: translateY(-50%);
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
    left: 199px;
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

  /* ─ Image: plan1 ─ */
  .plan-img-1 {
    position: absolute;
    left: -45px;
    top: 85px;
    width: 210px;
    height: 248px;
    object-fit: cover;
  }

  /* ─ Image: plan2 ─ */
  .plan-img-2-wrap {
    position: absolute;
    top: 24.75%;
    right: 57.75%;
    bottom: 27%;
    left: -11.75%;
    overflow: hidden;
  }

  .plan-img-2 {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* ─ Image: plan3 ─ */
  .plan-img-3-outer {
    position: absolute;
    left: 152px;
    top: 114px;
    width: 363px;
    height: 189px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .plan-img-3 {
    width: 363px;
    height: 189px;
    object-fit: cover;
    flex-shrink: 0;
    transform: scaleY(-1) rotate(180deg);
  }

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

  .plan-m-popular {
    background: var(--cs-red);
    color: var(--cs-white);
    font-family: var(--font-kr);
    font-size: 12px;
    font-weight: 700;
    border-radius: 8px;
    padding: 2px 8px;
    white-space: nowrap;
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
