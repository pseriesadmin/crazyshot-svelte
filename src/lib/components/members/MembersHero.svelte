<script lang="ts">
</script>

<!-- ── PC Hero (≥1024px) ─────────────────────────────────────────── -->
<section class="hero-pc" aria-label="Members 히어로">
  <div class="hero-pc-inner">
    <!-- Layer 1: 캐릭터 이미지 (전폭 커버) -->
    <img
      src="/members/hero-character.png"
      alt="CrazyShot 멤버십 캐릭터"
      class="hero-char-img"
    />
    <!-- Layer 2: Red 오버레이 (가운데 밴드, 혼합 반경) -->
    <div class="hero-overlay red"></div>
    <!-- Layer 3: Purple 오버레이 (하단 밴드) -->
    <div class="hero-overlay purple"></div>
    <!-- Layer 4: 텍스트 블록 (절대 위치, 수평 중앙 + 195px 아래) -->
    <div class="hero-text-block">
      <p class="hero-head1">첫 달은 무조건 레벨업!</p>
      <p class="hero-head2">'한 달간의 프리미엄' 체험 이벤트</p>
      <p class="hero-body">선착순 50명 한정, 내가 고른 멤버십보다 한 단계 더 높은 혜택을 한 달 동안 누리세요!</p>
      <p class="hero-body">가입 첫 달은 자동으로 등급 UP! / CRAZY PACK은 + 한달 추가 무료 제공</p>
      <a href="#pricing" class="hero-cta">가입하기</a>
    </div>
  </div>
</section>

<!-- ── Mobile Hero (<1024px) ─────────────────────────────────────── -->
<section class="hero-mobile" aria-label="Members 히어로 모바일">
  <div class="hero-mobile-inner">
    <!-- 배경 이미지 레이어 1 (상단) -->
    <img
      src="/members/hero-character.png"
      alt=""
      class="hero-m-char-1"
      aria-hidden="true"
    />
    <!-- 배경 이미지 레이어 2 (하단) -->
    <img
      src="/members/hero-character.png"
      alt=""
      class="hero-m-char-2"
      aria-hidden="true"
    />

    <!-- 텍스트 블록: 빨간 배경, rounded-tr-[50px] -->
    <div class="hero-m-writing">
      <!-- Header 그룹: head1+head2 (원본 gap-[5px]) -->
      <div class="hero-m-header">
        <p class="hero-m-head1">첫 달은 무조건 레벨업!</p>
        <p class="hero-m-head2">'한 달간의 프리미엄' 체험 이벤트</p>
      </div>
      <!-- Scripts 그룹: body 2문장 (원본 별도 <p> 2개) -->
      <div class="hero-m-scripts">
        <p class="hero-m-body">선착순 50명 한정, 내가 고른 멤버십보다 한 단계 더 높은 혜택을 한 달 동안 누리세요!</p>
        <p class="hero-m-body">가입 첫 달은 자동으로 등급 UP! / CRAZY PACK은 + 한달 추가 무료 제공</p>
      </div>
    </div>
  </div>
</section>

<style>
  /* ── PC ── */
  .hero-pc {
    display: none;
  }
  @media (min-width: 1024px) {
    .hero-pc {
      display: block;
      width: 1240px;
    }
  }

  .hero-pc-inner {
    position: relative;
    width: 1240px;
    height: 700px;
    background: var(--cs-purple-op10);
    border-radius: var(--radius-2xl);
    overflow: hidden;
  }

  /* Layer 1: 전폭 이미지 (원본: w-1244px h-774px left-[-4px] top-[-37px]) */
  .hero-char-img {
    position: absolute;
    width: 1244px;
    height: 774px;
    left: -4px;
    top: -37px;
    object-fit: cover;
  }

  /* Layer 2: Red 밴드 (원본: left-203px w-838px top-374px h-199px, 혼합 반경) */
  .hero-overlay.red {
    position: absolute;
    left: 203px;
    top: 374px;
    width: 838px;
    height: 199px;
    background: var(--cs-red);
    opacity: 0.8;
    border-radius: 3px 71px 71px 3px;
    pointer-events: none;
  }

  /* Layer 3: Purple 밴드 (원본: left-203px w-838px top-578px h-122px) */
  .hero-overlay.purple {
    position: absolute;
    left: 203px;
    top: 578px;
    width: 838px;
    height: 122px;
    background: var(--cs-purple-light);
    opacity: 0.9;
    pointer-events: none;
  }

  /* Layer 4: 텍스트 (원본: left-1/2 top-[calc(50%+195px)] translate-(-50%,-50%)) */
  .hero-text-block {
    position: absolute;
    left: 50%;
    top: calc(50% + 195px);
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    gap: 40px;
    align-items: center;
    z-index: 2;
    width: 100%;
    padding: 0 60px;
    box-sizing: border-box;
    text-align: center;
  }

  .hero-head1 {
    font-family: 'SB AggroOTF', sans-serif;
    font-size: 60px;
    font-weight: 700;
    color: var(--cs-white);
    line-height: 1.1;
    margin: 0;
  }

  .hero-head2 {
    font-family: var(--font-en-display);
    font-size: 35px;
    font-weight: 400;
    color: var(--cs-white);
    line-height: 1.2;
    margin: 0;
  }

  .hero-body {
    font-family: var(--font-kr);
    font-size: 22px;
    font-weight: 900;
    color: var(--cs-white);
    line-height: 1.5;
    margin: 0;
    letter-spacing: -0.5px;
  }

  .hero-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 50px;
    padding: 0 40px;
    background: var(--cs-red-badge);
    color: var(--cs-white);
    border-radius: var(--radius-xl);
    font-family: var(--font-kr);
    font-size: 16px;
    font-weight: 700;
    text-decoration: none;
    transition: background 0.15s;
  }
  .hero-cta:hover { background: var(--cs-red); }

  /* ── Mobile ── */
  .hero-mobile {
    display: block;
    width: 100%;
  }
  @media (min-width: 1024px) {
    .hero-mobile { display: none; }
  }

  .hero-mobile-inner {
    position: relative;
    width: 100%;
    height: 880px;
    overflow: hidden;
    border-bottom-left-radius: 50px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }

  /* 이미지 레이어 1 (상단, 원본: h-667px left-[-354px] top-[-109px] w-1072px) */
  .hero-m-char-1 {
    position: absolute;
    height: 667px;
    left: -354px;
    top: -109px;
    width: 1072px;
    object-fit: cover;
    z-index: 0;
  }

  /* 이미지 레이어 2 (하단, 원본: h-770px left-[-835px] top-[452px] w-1238px) */
  .hero-m-char-2 {
    position: absolute;
    height: 770px;
    left: -835px;
    top: 452px;
    width: 1238px;
    object-fit: cover;
    z-index: 0;
  }

  /* Writing 블록: 빨간 배경 (원본: bg-[#cf0000] h-[306px] rounded-tr-[50px] px-[25px] py-[70px] gap-[30px]) */
  .hero-m-writing {
    position: relative;
    z-index: 2;
    background: var(--cs-red);
    border-top-right-radius: 50px;
    padding: 70px 25px;
    height: 306px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 30px;
  }

  /* Header 그룹: head1+head2 (원본 Header 컴포넌트 gap-[5px]) */
  .hero-m-header {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  /* Scripts 그룹: body 2문장 */
  .hero-m-scripts {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* Head1: 35px, white, text-shadow (원본: text-[35px] text-shadow-[5px_5px_0px_#100b32]) */
  .hero-m-head1 {
    font-family: 'SB AggroOTF', sans-serif;
    font-size: 35px;
    font-weight: 700;
    color: var(--cs-white);
    text-shadow: 5px 5px 0px var(--cs-dark);
    margin: 0;
    line-height: 1.2;
  }

  /* Head2: 24px, white, tracking (원본: text-[24px] tracking-[-0.5px], white) */
  .hero-m-head2 {
    font-family: 'SB AggroOTF', sans-serif;
    font-size: 24px;
    font-weight: 700;
    color: var(--cs-white);
    letter-spacing: -0.5px;
    margin: 0;
    line-height: 1.2;
  }

  /* Body: 18px, white, justify (원본: text-[18px] text-justify tracking-[-0.3px] w-[313px] leading-[1.6]) */
  .hero-m-body {
    font-family: var(--font-kr);
    font-size: 18px;
    font-weight: 700;
    color: var(--cs-white);
    line-height: 1.6;
    letter-spacing: -0.3px;
    max-width: 313px;
    text-align: justify;
    margin: 0;
  }
</style>
