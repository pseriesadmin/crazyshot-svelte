<script lang="ts">
  import type { SubscriptionPolicyItem } from '$lib/types/database'
  import type { ServiceInfoSettings } from '$lib/services/serviceInfoSettings'
  import { resolveBenefitsPhoto, type BenefitsPhotosSetting } from '$lib/utils/membersBenefitsPhotos'

  const EMPTY_SERVICE_INFO: ServiceInfoSettings = {
    company_name: '', ceo_name: '', biz_address: '', biz_reg_no: '', mail_order_biz_no: '',
    privacy_officer: '', ceo_email: '', cs_phone: '', business_hours: '',
  }

  interface Props {
    policyItems?: SubscriptionPolicyItem[]
    /** '서비스 기본 정보'(Migration #566) — PC 공통푸터와 동일한 단일 소스. 미전달 시 빈 값. */
    serviceInfo?: ServiceInfoSettings
    /** 배경 사진 2장(상단·하단) 교체·초점 설정(cms_settings.members_benefits_photos) — 없으면 기본 사진·기본 초점 */
    photos?: BenefitsPhotosSetting
    /** CMS 관리자일 때만 PC 영역에 '배경 사진 관리' 버튼을 보인다(모바일에는 버튼·모달 없음) */
    isCms?: boolean
    onEditPhotos?: () => void
  }

  let {
    policyItems = [],
    serviceInfo = EMPTY_SERVICE_INFO,
    photos = { top: null, bottom: null },
    isCms = false,
    onEditPhotos,
  }: Props = $props()

  // 상단·하단 사진과 초점 — PC·모바일이 같은 값을 쓰고, 보이는 비율은 각 영역의 CSS(object-fit: cover)가 맞춘다
  const photoTop = $derived(resolveBenefitsPhoto(photos, 'top'))
  const photoBottom = $derived(resolveBenefitsPhoto(photos, 'bottom'))

  let openSNS = $state(false)
  let openLegal = $state(false)
</script>

<!-- ── PC 공통 혜택 (≥1024px) ───────────────────────────────── -->
<section class="benefits-pc" aria-label="K-트레일 혜택">
  <div class="benefits-pc-inner">
    <!-- 배경 이미지 레이어: 위 절반(상단 사진)·아래 절반(하단 사진) — 사진은 cover 로 채우고 초점(%)만 설정값을 따른다 -->
    <img
      src={photoTop.src}
      alt=""
      class="bg-photo bg-photo1"
      aria-hidden="true"
      style:object-position={`${photoTop.x}% ${photoTop.y}%`}
    />
    <img
      src={photoBottom.src}
      alt=""
      class="bg-photo bg-photo2"
      aria-hidden="true"
      style:object-position={`${photoBottom.x}% ${photoBottom.y}%`}
    />

    <!-- 관리 버튼: 이 PC 블록(≥1024px)에서만 렌더링되므로 모바일에는 노출되지 않는다 -->
    {#if isCms}
      <button class="photos-edit-btn" onclick={onEditPhotos} aria-label="이용안내 배경 사진 관리">
        ⚙ 배경 사진 관리
      </button>
    {/if}

    <!-- Writing 블록 -->
    <div class="writing-block">
      <div class="writing-left">
        <p class="writing-head">정기구독<br />이용안내</p>
      </div>
      <div class="writing-right">
        {#if policyItems.length > 0}
          <ul class="wr-policy-list">
            {#each policyItems as item, i (item.id)}
              <li class="wr-policy-item">
                <span class="wr-policy-num">{i + 1}</span>
                <span class="wr-policy-text">{item.content}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
</section>

<!-- ── Mobile 공통 혜택 + Footer (<1024px) ─────────────────── -->
<section class="benefits-mobile" aria-label="K-트레일 혜택 모바일">
  <!-- 상단 사진 -->
  <div class="m-photo-top-wrap">
    <img
      src={photoTop.src}
      alt="카메라와 렌즈를 들고 웃는 크리에이터"
      class="m-photo-top"
      style:object-position={`${photoTop.x}% ${photoTop.y}%`}
    />
  </div>

  <!-- 이용안내 영역 -->
  <div class="m-red-block">
    <p class="m-red-head">정기구독 이용안내</p>
    {#if policyItems.length > 0}
      <ul class="m-policy-list">
        {#each policyItems as item, i (item.id)}
          <li class="m-policy-item">
            <span class="m-policy-num">{i + 1}</span>
            <span class="m-policy-text">{item.content}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <!-- 하단 사진 -->
  <div class="m-photo-bot-wrap">
    <img
      src={photoBottom.src}
      alt="촬영 장비 모음"
      class="m-photo-bot"
      style:object-position={`${photoBottom.x}% ${photoBottom.y}%`}
    />
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
      <p class="m-legal-company">{serviceInfo.company_name}</p>
      <p class="m-legal-detail">
        대표자 : {serviceInfo.ceo_name}  |  {serviceInfo.biz_address}  |
        사업자 등록번호 : {serviceInfo.biz_reg_no}
        통신판매업신고 : {serviceInfo.mail_order_biz_no}  |  개인정보관리책임자 : {serviceInfo.privacy_officer}  |
        Email : {serviceInfo.ceo_email}
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
    /* 고정 height 800px → min-height: 이용안내 항목이 많아도(최대 20개) 붉은 박스가 잘리지 않고 영역이 함께 늘어난다.
       위아래 100px는 항목이 많아 박스가 800px 이상이 돼도 배경 사진이 가려지지 않도록 남기는 여백(항목이 적을 땐 기존과 동일). */
    min-height: 800px;
    padding: 100px 0;
    border-radius: var(--radius-2xl);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 50px;
  }

  /* 배경 사진 2장: 영역의 위 절반·아래 절반을 cover 로 채우고, 보이는 지점은 인라인 object-position(관리모달 초점 %)이 정한다.
     영역 높이가 항목 수에 따라 늘어나도 사진은 같은 방식으로 비율에 맞춰 채워진다(이전의 높이 % 확대·이동 방식은 폐기). */
  .bg-photo {
    position: absolute;
    left: 0;
    width: 100%;
    height: 50%;
    object-fit: cover;
    pointer-events: none;
  }

  .bg-photo1 { top: 0; }
  .bg-photo2 { bottom: 0; }

  /* CMS 관리자용 '배경 사진 관리' 버튼 — front 관리모달 버튼 표준(front-uiux.md §9-1-B): 200×50·BG 알파 40%·반경 20px·호버는 BG만.
     이 버튼은 PC 블록(.benefits-pc, ≥1024px) 안에만 있어 모바일에는 노출되지 않는다. */
  .photos-edit-btn {
    position: absolute;
    top: 20px;
    right: 40px;
    z-index: 5;
    width: 200px;
    height: 50px;
    padding: 0 20px;
    border: none;
    border-radius: var(--radius-lg);
    background: rgba(16, 11, 50, 0.4);
    color: var(--cs-white);
    font: var(--text-pc-body-14);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .photos-edit-btn:hover { background: rgba(16, 11, 50, 0.6); }

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

  .wr-policy-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .wr-policy-item {
    display: flex;
    align-items: flex-start;
    gap: 14px;
  }

  .wr-policy-num {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.25);
    color: var(--cs-white);
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 1px;
  }

  .wr-policy-text {
    font-family: var(--font-kr);
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-white);
    line-height: 1.6;
  }

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

  /* 2026-10-15: PC 반응형과 같은 사진·같은 초점 설정을 쓴다. 영역(폭 100%×높이 200px)을 cover 로 채우고, 보이는 지점은
     인라인 object-position(관리모달 초점 %)이 정한다(이전 한복 관광 사진용 확대·이동 값은 제거). */
  .m-photo-top {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* 이용안내 영역 */
  .m-red-block {
    background: var(--cs-red);
    padding: 50px 25px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .m-red-head {
    font-family: 'SB AggroOTF', sans-serif;
    font-size: 24px;
    font-weight: 700;
    color: var(--cs-white);
    text-shadow: 3px 3px 0px rgba(0, 0, 0, 0.3);
    margin: 0;
    line-height: 1.3;
  }

  .m-policy-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .m-policy-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .m-policy-num {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.25);
    color: var(--cs-white);
    font-family: var(--font-kr);
    font-size: 12px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 1px;
  }

  .m-policy-text {
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.88);
    line-height: 1.6;
    word-break: keep-all;
  }

  /* 하단 사진 */
  .m-photo-bot-wrap {
    width: 100%;
    height: 200px;
    position: relative;
    overflow: hidden;
  }

  .m-photo-bot {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* ── 모바일 Footer ── */
  /* 2026-10-09(Stephen 지시): 모바일 반응형에서는 홈을 제외한 서브 화면에 푸터를 노출하지 않는다 — 전역 푸터(+layout.svelte)는 ≤640px에서
     이미 숨겨져 있고(홈만 예외), 이 /members 전용 모바일 푸터만 남아 있어 숨긴다. 마크업·상태는 그대로 두어 복원은 display만 되돌리면 된다. */
  .m-footer {
    background: var(--cs-dark);
    padding: 50px 25px;
    display: none;
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
