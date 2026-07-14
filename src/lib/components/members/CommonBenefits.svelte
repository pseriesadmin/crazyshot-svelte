<script lang="ts">
  let openSNS = $state(false)
  let openLegal = $state(false)
</script>

<!-- ── PC 공통 혜택 (≥1024px) ───────────────────────────────── -->
<section class="benefits-pc" aria-label="K-트레일 혜택">
  <div class="benefits-pc-inner">
    <!-- 배경 이미지 레이어 -->
    <img src="/members/benefits-photo1.png" alt="" class="bg-photo bg-photo1" aria-hidden="true" />
    <img src="/members/benefits-photo2.png" alt="" class="bg-photo bg-photo2" aria-hidden="true" />

    <!-- Writing 블록 -->
    <div class="writing-block">
      <div class="writing-left">
        <p class="writing-head">K-트레일 로그,<br />지금부터 시작하세요</p>
      </div>
      <div class="writing-right">
        <p class="wr-p wr-pale">한국 여행은 단순한 관광을 넘어, 사랑하는 K-컬처의 일원이 되는 특별한 경험입니다. CRAZY SHOT은 그 여정의 든든한 파트너입니다.</p>
        <p class="wr-p wr-white">멤버십에 가입하면, 주요 공항과 공연장 근처의 편리한 픽업 및 반납 지점을 통해 엄선된 전문가용 카메라와 장비를 자유롭게 이용할 수 있습니다.</p>
        <p class="wr-p wr-white">글로벌 팬과 크리에이터 모두, 고퀄리티 K-POP 팬캠부터 생동감 넘치는 여행 브이로그까지 모든 순간을 세련되게 기록할 수 있습니다.</p>
        <p class="wr-p wr-pale">지금 CRAZY SHOT과 함께 K-Trail 로그를 시작하고, 당신의 열정을 잊지 못할 콘텐츠로 만들어보세요.</p>
      </div>
    </div>
  </div>
</section>

<!-- ── Mobile 공통 혜택 + Footer (<1024px) ─────────────────── -->
<section class="benefits-mobile" aria-label="K-트레일 혜택 모바일">
  <!-- 상단 사진 -->
  <div class="m-photo-top-wrap">
    <img src="/members/mobile-cta1.png" alt="K-Trail 크리에이터 촬영" class="m-photo-top" />
  </div>

  <!-- 빨간 텍스트 영역 -->
  <div class="m-red-block">
    <p class="m-red-head">K-트레일 로그,<br />지금부터 시작하세요</p>
    <p class="m-rp m-pale">한국 여행은 단순한 관광을 넘어, 사랑하는 K-컬처의 일원이 되는 특별한 경험입니다. CRAZY SHOT은 그 여정의 든든한 파트너입니다.</p>
    <p class="m-rp m-white">멤버십에 가입하면, 주요 공항과 공연장 근처의 편리한 픽업 및 반납 지점을 통해 엄선된 전문가용 카메라와 장비를 자유롭게 이용할 수 있습니다.</p>
    <p class="m-rp m-white">글로벌 팬과 크리에이터 모두, 고퀄리티 K-POP 팬캠부터 생동감 넘치는 여행 브이로그까지 모든 순간을 세련되게 기록할 수 있습니다.</p>
    <p class="m-rp m-pale">지금 CRAZY SHOT과 함께 K-Trail 로그를 시작하고, 당신의 열정을 잊지 못할 콘텐츠로 만들어보세요.</p>
  </div>

  <!-- 하단 사진 -->
  <div class="m-photo-bot-wrap">
    <img src="/members/benefits-photo2.png" alt="K-Trail 여행 촬영" class="m-photo-bot" />
  </div>

  <!-- 모바일 Footer -->
  <footer class="m-footer">
    <!-- 로고 -->
    <a href="/" aria-label="CRAZYSHOT 홈" class="m-footer-logo">
      <svg width="128" height="76" viewBox="0 0 178 110" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <image href="/logo-bi2.svg" width="178" height="110" />
      </svg>
    </a>

    <p class="m-footer-company">CRAZYMEDIA Inc</p>
    <p class="m-footer-tagline">장비는 사지 말고 구독하는 습관</p>

    <!-- 고객센터 -->
    <div class="m-cs-row">
      <div class="m-cs-left">
        <p class="m-cs-label">고객센터</p>
        <p class="m-cs-number">1588-0033</p>
      </div>
      <div class="m-cs-right">
        <p class="m-cs-label">운영시간</p>
        <p class="m-cs-time">평일 09:00~22:00</p>
        <p class="m-cs-time">휴일 09:00~22:00</p>
      </div>
    </div>

    <!-- SNS 아코디언 -->
    <div class="m-accordion">
      <button class="m-acc-header" onclick={() => { openSNS = !openSNS }} aria-expanded={openSNS}>
        <span>SNS 채널</span>
        <svg class="acc-arrow" class:rotated={openSNS} width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M4 6L8 10L12 6" stroke="#C1BBEC" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      {#if openSNS}
        <div class="m-acc-body">
          <a href="https://www.youtube.com/@crazyshot" class="m-acc-link" target="_blank" rel="noopener">YouTube</a>
          <a href="https://blog.naver.com/crazyshot" class="m-acc-link" target="_blank" rel="noopener">Blog</a>
        </div>
      {/if}
    </div>

    <!-- 법적 고지 아코디언 -->
    <div class="m-accordion">
      <button class="m-acc-header" onclick={() => { openLegal = !openLegal }} aria-expanded={openLegal}>
        <span>법적 고지</span>
        <svg class="acc-arrow" class:rotated={openLegal} width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M4 6L8 10L12 6" stroke="#C1BBEC" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      {#if openLegal}
        <div class="m-acc-body">
          <a href="/legal/privacy" class="m-acc-link">개인정보처리 방침</a>
          <a href="/legal/terms" class="m-acc-link">서비스 이용약관</a>
          <a href="/legal/refund" class="m-acc-link">환불정책</a>
        </div>
      {/if}
    </div>

    <!-- 법인 정보 -->
    <div class="m-legal-info">
      <p class="m-legal-company">(주)크레이지샷</p>
      <p class="m-legal-detail">
        대표자 : 한광익  |  서울특별시 강서구 양천로 418 1,2층 101,201호(등촌동)  |
        사업자 등록번호 : 107-88-22133
        통신판매업신고 : 2023-서울강서-1755  |  개인정보관리책임자 : 이용희  |
        Email : crazymedia@hanmail.net
      </p>
      <p class="m-legal-copy">Copyrightⓒ crazymedia 2025. All right reserved.</p>
    </div>
  </footer>
</section>

<style>
  /* ── PC ── */
  .benefits-pc {
    display: none;
  }
  @media (min-width: 1024px) {
    .benefits-pc {
      display: block;
      width: 1240px;
    }
  }

  .benefits-pc-inner {
    position: relative;
    width: 1240px;
    height: 800px;
    border-radius: var(--radius-2xl);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 50px;
  }

  .bg-photo {
    position: absolute;
    pointer-events: none;
  }

  .bg-photo1 {
    height: 160.17%;
    left: -2.1%;
    top: -71.92%;
    width: auto;
  }

  .bg-photo2 {
    height: 170.07%;
    left: -5.84%;
    top: 47.89%;
    width: auto;
  }

  .writing-block {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: row;
    gap: 60px;
    background: var(--cs-red);
    padding: 50px;
    width: 100%;
  }

  .writing-left {
    width: 320px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .writing-head {
    font-family: 'SB AggroOTF', sans-serif;
    font-size: 35px;
    font-weight: 700;
    color: var(--cs-white);
    margin: 0;
    line-height: 1.4;
  }

  .writing-right {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
    justify-content: center;
  }

  .wr-p {
    font-family: var(--font-kr);
    font-size: 16px;
    font-weight: 700;
    line-height: 1.6;
    margin: 0;
  }

  .wr-white { color: var(--cs-white); }
  .wr-pale  { color: var(--cs-purple-op10); }

  /* ── Mobile ── */
  .benefits-mobile {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
  @media (min-width: 1024px) {
    .benefits-mobile { display: none; }
  }

  /* 상단 사진 */
  .m-photo-top-wrap {
    width: 100%;
    height: 200px;
    position: relative;
    overflow: hidden;
    border-top-right-radius: 50px;
  }

  .m-photo-top {
    position: absolute;
    width: 158%;
    height: 309%;
    top: -86%;
    left: -31%;
    object-fit: cover;
  }

  /* 빨간 텍스트 영역 */
  .m-red-block {
    background: var(--cs-red);
    padding: 50px 25px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .m-red-head {
    font-family: 'SB AggroOTF', sans-serif;
    font-size: 30px;
    font-weight: 700;
    color: var(--cs-white);
    text-shadow: 5px 5px 0px var(--cs-dark);
    margin: 0;
    line-height: 1.3;
  }

  .m-rp {
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 700;
    line-height: 1.6;
    margin: 0;
  }

  .m-white { color: var(--cs-white); }
  .m-pale  { color: var(--cs-purple-op10); }

  /* 하단 사진 */
  .m-photo-bot-wrap {
    width: 100%;
    height: 200px;
    position: relative;
    overflow: hidden;
  }

  .m-photo-bot {
    position: absolute;
    width: 161%;
    height: 314%;
    top: -195%;
    left: -14%;
    object-fit: cover;
  }

  /* ── 모바일 Footer ── */
  .m-footer {
    background: var(--cs-dark);
    padding: 50px 25px;
    display: flex;
    flex-direction: column;
    gap: 30px;
  }

  .m-footer-logo {
    display: block;
    line-height: 0;
    text-decoration: none;
  }

  .m-footer-company {
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-white);
    margin: 0;
  }

  .m-footer-tagline {
    font-family: var(--font-kr);
    font-size: 12px;
    font-weight: 500;
    color: var(--cs-purple-pale);
    margin: 0;
  }

  /* 고객센터 */
  .m-cs-row {
    display: flex;
    gap: 0;
  }

  .m-cs-left {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .m-cs-right {
    flex: 1;
    border-left: 1px solid var(--cs-purple-dark);
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .m-cs-label {
    font-family: var(--font-kr);
    font-size: 12px;
    font-weight: 700;
    color: var(--cs-purple-pale);
    margin: 0;
  }

  .m-cs-number {
    font-family: var(--font-kr);
    font-size: 18px;
    font-weight: 700;
    color: var(--cs-white);
    margin: 0;
  }

  .m-cs-time {
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 500;
    color: var(--cs-white);
    margin: 0;
  }

  /* 아코디언 */
  .m-accordion {
    border-top: 1px solid var(--cs-purple-dark);
    padding-top: 20px;
  }

  .m-acc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    font-family: var(--font-kr);
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-purple-pale);
    min-height: 44px;
  }

  .acc-arrow {
    transition: transform 0.2s ease;
    flex-shrink: 0;
  }

  .acc-arrow.rotated {
    transform: rotate(180deg);
  }

  .m-acc-body {
    display: flex;
    flex-direction: column;
    gap: 15px;
    margin-top: 15px;
    padding-left: 8px;
  }

  .m-acc-link {
    font-family: var(--font-kr);
    font-size: 18px;
    font-weight: 500;
    color: var(--cs-white);
    text-decoration: none;
    min-height: 44px;
    display: flex;
    align-items: center;
  }

  .m-acc-link:active { opacity: 0.7; }

  /* 법인 정보 */
  .m-legal-info {
    border-top: 1px solid var(--cs-purple-dark);
    padding-top: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .m-legal-company {
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-white);
    margin: 0;
  }

  .m-legal-detail {
    font-family: var(--font-kr);
    font-size: 12px;
    font-weight: 400;
    color: var(--cs-purple-pale);
    margin: 0;
    line-height: 1.6;
    word-break: keep-all;
  }

  .m-legal-copy {
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 500;
    color: var(--cs-purple-pale);
    margin: 0;
  }
</style>
