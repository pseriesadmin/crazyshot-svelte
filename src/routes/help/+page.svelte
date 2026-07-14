<script lang="ts">
  type TabId = 'all' | 'howto' | 'members' | 'etc'

  interface FaqItem {
    id: number
    tab: Exclude<TabId, 'all'>
    question: string
    answer: string
  }

  const FAQ_ITEMS: FaqItem[] = [
    { id: 1, tab: 'howto', question: 'Can I extend my rental?', answer: 'Yes! You can extend your rental through your account dashboard up to 24 hours before the original return date. Simply go to My Orders, select the active rental, and choose \'Extend Rental.\' Additional rental fees will be charged to your registered payment method.' },
    { id: 2, tab: 'howto', question: 'Why do I pay more total for extending a 7-day rental into a 14-day rental than I would for a single 14-day rental?', answer: 'Our pricing structure rewards longer commitments made upfront. When you book 14 days from the start, the per-day rate is lower. Extensions are processed as a new short-term rental appended to your current one, which is priced at the standard short-term rate. We recommend booking the full duration you need from the beginning to maximize savings.' },
    { id: 3, tab: 'howto', question: 'What if I am late with my return?', answer: 'Late returns incur a daily late fee equal to 1.5× your daily rental rate. We will automatically charge the registered payment method on file. If you know you\'ll be late, please contact us in advance — in some cases we can accommodate short extensions without a penalty.' },
    { id: 4, tab: 'howto', question: 'Oh no! I forgot to return an item!', answer: 'Don\'t panic. Contact our customer support team immediately at 1588-0033 or via the in-app chat. We\'ll arrange an emergency pickup or guide you through dropping it off at the nearest partner location. Prolonged unreturned items may result in replacement charges.' },
    { id: 5, tab: 'howto', question: 'How are late fees calculated?', answer: 'Late fees are calculated at 1.5× the daily rental rate per day overdue, prorated by the hour after the first 24 hours. For example, if your daily rate is ₩10,000, the late fee is ₩15,000 per day. Fees are capped at 30 days, after which the item is considered unreturned and full replacement cost is charged.' },
    { id: 6, tab: 'howto', question: 'How do I reserve equipment?', answer: 'Browse our catalog, select your desired gear, choose your rental dates, and click Reserve. You\'ll need a verified CrazyShot account and a registered payment method. A confirmation email and SMS will be sent instantly.' },
    { id: 7, tab: 'howto', question: 'What is included in the rental kit?', answer: 'Each rental kit includes the primary equipment plus standard accessories listed on the product page (batteries, cables, cases). Specialty accessories may be added for an extra fee during checkout.' },
    { id: 8, tab: 'howto', question: 'Can I cancel my reservation?', answer: 'Cancellations made more than 48 hours before delivery are fully refunded. Cancellations within 48 hours incur a 30% fee. Same-day cancellations are non-refundable.' },
    { id: 9, tab: 'howto', question: 'What happens if equipment is damaged during my rental?', answer: 'Report damage immediately via the app or by calling 1588-0033. Minor wear is covered under normal use. Accidental damage may be covered by our optional Damage Protection Plan (DPP) purchased at checkout. Intentional or gross negligence damage is billed at full replacement cost.' },
    { id: 10, tab: 'howto', question: 'How does delivery work?', answer: 'We offer next-day delivery nationwide via our courier partners. Orders placed before 2 PM are dispatched the same business day. You can track your delivery in real time from the My Orders page.' },
    { id: 11, tab: 'howto', question: 'What are the delivery time windows?', answer: 'Standard delivery windows are 09:00–13:00 (morning) and 14:00–18:00 (afternoon). Premium same-day slots are available in select metropolitan areas for an additional fee.' },
    { id: 12, tab: 'howto', question: 'Can I pick up the equipment myself?', answer: 'Yes. Our flagship store in Gangseo, Seoul is open Monday–Saturday 10:00–19:00. Select \'Self Pick-Up\' at checkout to waive the delivery fee.' },
    { id: 13, tab: 'howto', question: 'How do I return equipment?', answer: 'Pack the equipment securely in the original packaging. A prepaid return label is included in every shipment. Drop it off at any CJ Logistics drop-off point or schedule a free home pickup via the app.' },
    { id: 14, tab: 'howto', question: 'Do I need to clean the equipment before returning?', answer: 'Please return equipment in the same condition as received. Lenses should be free of fingerprints, bodies should be dust-free, and accessories should be bagged and labeled. Excessive cleaning fees may apply.' },
    { id: 15, tab: 'howto', question: 'What if the equipment is faulty on arrival?', answer: 'Test all equipment within 2 hours of receipt. If you find a defect, report it immediately via the app. We will arrange a free replacement or full refund at your choice.' },
    { id: 16, tab: 'howto', question: 'Can I rent to a business address?', answer: 'Absolutely. During checkout, enter your business address as the delivery address. A tax invoice (세금계산서) is available on request — contact billing@crazyshot.co.kr.' },
    { id: 17, tab: 'howto', question: 'Is there a minimum rental period?', answer: 'The minimum rental period is 1 day (24 hours from delivery). Some premium items have a minimum of 3 days; this is noted on the product page.' },
    { id: 18, tab: 'howto', question: 'Can I rent multiple items at once?', answer: 'Yes. Add as many items as you need to your cart. All items in a single order share the same rental window and are shipped together where possible.' },
    { id: 19, tab: 'members', question: 'How do I sign up for a CrazyShot account?', answer: 'Click \'Sign In\' in the top navigation and select \'Create Account.\' You\'ll need a mobile number for OTP verification and a valid ID for first-time equipment rental.' },
    { id: 20, tab: 'members', question: 'What membership tiers are available?', answer: 'We offer three tiers: Basic (free), Pro (₩9,900/mo), and Studio (₩29,900/mo). Higher tiers unlock priority booking, exclusive discounts, and extended rental durations.' },
    { id: 21, tab: 'members', question: 'How do I upgrade my membership?', answer: 'Go to My Account → Membership and select your desired tier. Upgrades take effect immediately; billing is prorated for the current month.' },
    { id: 22, tab: 'members', question: 'What payment methods are accepted?', answer: 'We accept all major Korean credit and debit cards, KakaoPay, NaverPay, Toss, and bank transfer (무통장입금). International cards (Visa, Mastercard) are supported for foreign customers.' },
    { id: 23, tab: 'members', question: 'How do I change my registered payment method?', answer: 'Go to My Account → Payment Methods. You can add, remove, or set a default card at any time. Changes take effect on your next billing cycle.' },
    { id: 24, tab: 'members', question: 'Is my payment information secure?', answer: 'Yes. We use PCI DSS-compliant payment processing. Card details are tokenized and never stored on our servers. All transactions are secured with TLS 1.3.' },
    { id: 25, tab: 'members', question: 'How do I cancel my membership?', answer: 'Go to My Account → Membership → Cancel Subscription. Your membership benefits remain active until the end of the current billing period. No further charges will be made.' },
    { id: 26, tab: 'members', question: 'Can I share my account with others?', answer: 'Accounts are for individual use only. Studio-tier members may add up to 3 sub-accounts at no extra charge for team-based production workflows.' },
    { id: 27, tab: 'members', question: 'Are there student or nonprofit discounts?', answer: 'Yes. Verified students and registered nonprofits receive 20% off all rental rates. Apply via My Account → Discounts with proof of eligibility.' },
    { id: 28, tab: 'members', question: 'How do I earn and redeem reward points?', answer: 'Earn 1 point per ₩100 spent. Points can be redeemed at checkout at a rate of 100 points = ₩100. Points expire 1 year after issuance.' },
    { id: 29, tab: 'members', question: 'I forgot my password. How do I reset it?', answer: 'On the Sign In page, click \'Forgot Password?\' Enter your registered email or mobile number and follow the OTP verification steps to set a new password.' },
    { id: 30, tab: 'members', question: 'How do I delete my account?', answer: 'Go to My Account → Settings → Delete Account. Deletion is permanent and removes all your data in compliance with Korea\'s Personal Information Protection Act (PIPA). Any outstanding balances must be settled first.' },
    { id: 31, tab: 'members', question: 'Can I get an invoice for my rental?', answer: 'Receipts are automatically emailed after each transaction. For official tax invoices, contact billing@crazyshot.co.kr with your business registration number.' },
    { id: 32, tab: 'etc', question: 'What is CrazyShot\'s refund policy?', answer: 'Refunds for cancelled orders are processed within 3–5 business days to the original payment method. For disputes, contact support@crazyshot.co.kr.' },
    { id: 33, tab: 'etc', question: 'Does CrazyShot offer insurance for rented equipment?', answer: 'We offer an optional Damage Protection Plan (DPP) at checkout, covering accidental damage up to ₩500,000 per incident. DPP does not cover theft or intentional damage.' },
    { id: 34, tab: 'etc', question: 'How do I report a missing accessory from my kit?', answer: 'Contact support within 2 hours of receiving your order. Provide your order number and a photo of the contents received. We\'ll ship the missing item the next business day.' },
    { id: 35, tab: 'etc', question: 'Can I suggest equipment for the catalog?', answer: 'Absolutely! Use the \'Request Equipment\' form in the Help Center or email catalog@crazyshot.co.kr. We review all requests monthly.' },
    { id: 36, tab: 'etc', question: 'Is CrazyShot available outside Korea?', answer: 'Currently, we ship within South Korea only. International service is on our 2025 roadmap — sign up for our newsletter to be notified when it launches.' },
    { id: 37, tab: 'etc', question: 'How do I contact customer support?', answer: 'Call 1588-0033 (weekdays & holidays 09:00–22:00), use the in-app chat, or email support@crazyshot.co.kr. Response times are under 2 hours during business hours.' },
    { id: 38, tab: 'etc', question: 'Where can I find CrazyShot on social media?', answer: 'Follow us on YouTube and Instagram @crazyshot.kr for tutorials, new gear announcements, and member-exclusive promotions.' },
    { id: 39, tab: 'etc', question: 'Does CrazyShot offer a referral program?', answer: 'Yes! Share your unique referral link from My Account → Referrals. Both you and your friend get ₩5,000 credit after their first completed rental.' },
    { id: 40, tab: 'etc', question: 'How do I report a bug or issue with the website?', answer: 'Use the feedback button (bottom-right corner of any page) or email dev@crazyshot.co.kr. Screenshots and steps to reproduce are very helpful.' },
    { id: 41, tab: 'etc', question: 'Where is the CrazyShot office?', answer: 'Our flagship studio and fulfillment center is located at 418 Yangcheon-ro, Gangseo-gu, Seoul (floors 1–2). Subway: Balsan Station (Line 5), Exit 4.' },
    { id: 42, tab: 'etc', question: 'Does CrazyShot have a mobile app?', answer: 'Our Progressive Web App (PWA) works on all devices. Add it to your home screen for an app-like experience. Native iOS and Android apps are in development.' },
    { id: 43, tab: 'etc', question: 'How do I opt out of marketing emails?', answer: 'Click \'Unsubscribe\' at the bottom of any marketing email, or go to My Account → Notifications and toggle off \'Marketing Communications.\'' },
    { id: 44, tab: 'etc', question: 'What is CrazyShot\'s privacy policy?', answer: 'Our full Privacy Policy is available at crazyshot.co.kr/privacy. In short, we never sell your data and collect only what is necessary to provide the service.' },
  ]

  const TABS: { id: TabId; label: string }[] = [
    { id: 'all',     label: '전체' },
    { id: 'howto',   label: 'How to' },
    { id: 'members', label: 'Members & Payment' },
    { id: 'etc',     label: 'Etc help' },
  ]

  const MOBILE_FAQ_ITEMS = [
    { id: 1, question: '호텔이나 에어비앤비로도 배송 받을 수 있나요?', answer: '네, 가능합니다. 체크아웃 시 배송지를 호텔·에어비앤비 주소로 입력하시면 됩니다. 프런트에 맡겨달라는 요청사항을 추가하시면 더욱 편리합니다.' },
    { id: 2, question: '메모리 카드도 같이 받을 수 있나요?', answer: '필요한 경우 체크아웃 시 추가하실 수 있습니다. 직접 가져오실 땐 호환 여부(CFexpress Type B, V90 SD 등)를 꼭 확인해주세요.' },
    { id: 3, question: '현장에서 장비에 이상이 생겼어요. 어떻게 해야 하나요?', answer: '즉시 고객센터(1588-0033)로 연락 주세요. 상황에 따라 긴급 대체 장비 발송 또는 환불 처리가 가능합니다. 임의 수리 시 보상이 어려울 수 있으니 주의해주세요.' },
    { id: 4, question: '갑작스러운 고장 시 바로 교환 가능한가요?', answer: '재고 상황에 따라 당일 또는 익일 교환이 가능합니다. 고객센터에 먼저 연락 주시면 가장 빠른 방법을 안내해드립니다.' },
    { id: 5, question: '대여 기간을 연장하고 싶으면 어떻게 하나요?', answer: '반납일 24시간 전까지 마이페이지 > 진행 중인 주문에서 연장 신청이 가능합니다. 연장 요금은 등록된 결제 수단으로 자동 청구됩니다.' },
  ]

  const CATEGORIES = [
    { img: '/help/cat-rental.png',   label: '렌탈 방법',   tab: 'howto'   as TabId, iconType: 'camera'  },
    { img: '/help/cat-delivery.png', label: '배송 안내',   tab: 'howto'   as TabId, iconType: 'truck'   },
    { img: '/help/cat-gear.png',     label: '장비 관리',   tab: 'howto'   as TabId, iconType: 'gear'    },
    { img: '/help/cat-members.png',  label: '멤버십 혜택', tab: 'members' as TabId, iconType: 'star'    },
    { img: '/help/cat-return.png',   label: '반납 가이드', tab: 'etc'     as TabId, iconType: 'check'   },
  ]

  function tabCount(tab: TabId): number {
    if (tab === 'all') return FAQ_ITEMS.length
    return FAQ_ITEMS.filter(f => f.tab === tab).length
  }

  let activeTab = $state<TabId>('all')
  let openFaqIds = $state<Set<number>>(new Set())
  let openMobileIds = $state<Set<number>>(new Set())

  let filteredFaq = $derived(
    activeTab === 'all' ? FAQ_ITEMS : FAQ_ITEMS.filter(f => f.tab === activeTab)
  )

  function handleCategoryClick(tab: TabId) {
    activeTab = tab
    document.getElementById('faq-section')?.scrollIntoView({ behavior: 'smooth' })
  }

  function toggleFaq(id: number) {
    const next = new Set(openFaqIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    openFaqIds = next
  }

  function toggleMobile(id: number) {
    const next = new Set(openMobileIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    openMobileIds = next
  }
</script>

<svelte:head>
  <title>Help Center | CRAZYSHOT</title>
  <meta name="description" content="크레이지샷 렌탈 FAQ — 예약, 배송, 장비 관리, 멤버십 자주 묻는 질문" />
</svelte:head>

<!-- ── Page Root ─────────────────────────────────────────────────── -->
<div class="help-root">

  <!-- ── Main Content ───────────────────────────────────────────── -->
  <main class="help-main">

    <!-- ── Hero Section ────────────────────────────────────────── -->
    <section class="hero-section">
      <img src="/help/hero-bg.png" alt="Hero background" class="hero-bg" />
      <div class="hero-gradient"></div>

      <div class="hero-content">
        <div class="hero-heading">
          <h1 class="hero-title">
            다양한 영상장비<br />
            쉽고 빠른 렌탈마법가이드
          </h1>
          <p class="hero-sub">
            크레이지샷만의 빠른 예약, 장비 수령, 반납까지<br />
            자주 묻는 질문을 바로 확인하세요.
          </p>
        </div>

        <!-- Category Cards -->
        <div class="cat-list">
          {#each CATEGORIES as cat}
            <button class="cat-card" onclick={() => handleCategoryClick(cat.tab)} aria-label="{cat.label} FAQ 보기">
              <div class="cat-card-bg"></div>
              <img src={cat.img} alt="" class="cat-card-img" />
              <div class="cat-card-hover"></div>
              <div class="cat-card-content">
                <!-- Icon -->
                {#if cat.iconType === 'camera'}
                  <svg class="cat-icon" fill="none" viewBox="0 0 40 40" aria-hidden="true">
                    <path d="M6 15a3 3 0 0 1 3-3h2l2-3h6l2 3h2a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V15z" stroke="white" stroke-linecap="round" stroke-width="2"/>
                    <circle cx="20" cy="20" r="4" stroke="white" stroke-width="2"/>
                  </svg>
                {:else if cat.iconType === 'truck'}
                  <svg class="cat-icon" fill="none" viewBox="0 0 40 40" aria-hidden="true">
                    <path d="M5 12h20v12H5zM25 16h5l4 4v6h-9V16z" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>
                    <circle cx="10" cy="28" r="2" stroke="white" stroke-width="2"/>
                    <circle cx="30" cy="28" r="2" stroke="white" stroke-width="2"/>
                  </svg>
                {:else if cat.iconType === 'gear'}
                  <svg class="cat-icon" fill="none" viewBox="0 0 40 40" aria-hidden="true">
                    <circle cx="20" cy="20" r="4" stroke="white" stroke-width="2"/>
                    <path d="M20 8v3M20 29v3M8 20H5M35 20h-3M10.7 10.7l2 2M27.3 27.3l2 2M10.7 29.3l2-2M27.3 12.7l2-2" stroke="white" stroke-linecap="round" stroke-width="2"/>
                  </svg>
                {:else if cat.iconType === 'star'}
                  <svg class="cat-icon" fill="none" viewBox="0 0 40 40" aria-hidden="true">
                    <path d="M20 5l3.5 8h8.5l-7 5.5 2.7 8.5L20 22l-7.7 5 2.7-8.5L8 13h8.5z" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>
                  </svg>
                {:else}
                  <svg class="cat-icon" fill="none" viewBox="0 0 40 40" aria-hidden="true">
                    <circle cx="20" cy="20" r="12" stroke="white" stroke-width="2"/>
                    <path d="M14 20l4 4 8-8" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>
                  </svg>
                {/if}
                <span class="cat-label">{cat.label}</span>
              </div>
            </button>
          {/each}
        </div>
      </div>
    </section>

    <!-- ── Mobile FAQ Guide (< 768px) ──────────────────────────── -->
    <section class="mobile-guide">
      <div class="mobile-guide-header">
        <p class="mobile-guide-title">FAQ ·자주 묻는 질문</p>
        <div class="order-badge" aria-hidden="true">
          <svg fill="none" viewBox="0 0 22 22" width="22" height="22">
            <rect fill="#E1DEF3" height="22" rx="7" width="22"/>
            <path d="M5.5 9.5C6.32843 9.5 7 10.1716 7 11C7 11.8284 6.32843 12.5 5.5 12.5C4.67157 12.5 4 11.8284 4 11C4 10.1716 4.67157 9.5 5.5 9.5ZM11 9.5C11.8284 9.5 12.5 10.1716 12.5 11C12.5 11.8284 11.8284 12.5 11 12.5C10.1716 12.5 9.5 11.8284 9.5 11C9.5 10.1716 10.1716 9.5 11 9.5ZM16.5 9.5C17.3284 9.5 18 10.1716 18 11C18 11.8284 17.3284 12.5 16.5 12.5C15.6716 12.5 15 11.8284 15 11C15 10.1716 15.6716 9.5 16.5 9.5Z" fill="#553FE0"/>
          </svg>
        </div>
      </div>

      <div class="mobile-guide-list">
        {#each MOBILE_FAQ_ITEMS as item}
          {@const open = openMobileIds.has(item.id)}
          <div class="mobile-faq-item">
            <button
              class="mobile-faq-q"
              class:mobile-faq-q-open={open}
              onclick={() => toggleMobile(item.id)}
              aria-expanded={open}
            >
              <span class="mobile-faq-q-text" class:mobile-faq-q-text-open={open}>{item.question}</span>
              <span class="plus-icon-wrap" style:transform={open ? 'rotate(45deg)' : 'none'} aria-hidden="true">
                <svg fill="none" viewBox="0 0 14 14" width="14" height="14">
                  <path d="M1 7H13M7 1V13" stroke={open ? '#201857' : '#C1BBEC'} stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>
                </svg>
              </span>
            </button>
            {#if open}
              <div class="mobile-faq-a">
                <p class="mobile-faq-a-text">{item.answer}</p>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </section>

    <!-- ── FAQ Section ──────────────────────────────────────────── -->
    <section class="faq-section" id="faq-section">

      <!-- Section header -->
      <div class="faq-header">
        <span class="faq-header-label">Order Faq</span>
        <div class="order-badge" aria-hidden="true">
          <svg fill="none" viewBox="0 0 22 22" width="22" height="22">
            <rect fill="#E1DEF3" height="22" rx="7" width="22"/>
            <path d="M5.5 9.5C6.32843 9.5 7 10.1716 7 11C7 11.8284 6.32843 12.5 5.5 12.5C4.67157 12.5 4 11.8284 4 11C4 10.1716 4.67157 9.5 5.5 9.5ZM11 9.5C11.8284 9.5 12.5 10.1716 12.5 11C12.5 11.8284 11.8284 12.5 11 12.5C10.1716 12.5 9.5 11.8284 9.5 11C9.5 10.1716 10.1716 9.5 11 9.5ZM16.5 9.5C17.3284 9.5 18 10.1716 18 11C18 11.8284 17.3284 12.5 16.5 12.5C15.6716 12.5 15 11.8284 15 11C15 10.1716 15.6716 9.5 16.5 9.5Z" fill="#553FE0"/>
          </svg>
        </div>
      </div>

      <!-- Tab bar -->
      <div class="tab-bar">
        {#each TABS as tab}
          <button
            class="tab-btn"
            class:tab-btn-active={activeTab === tab.id}
            onclick={() => (activeTab = tab.id)}
          >
            <span class="tab-label">{tab.label}</span>
            <span class="tab-count">{tabCount(tab.id)}</span>
          </button>
        {/each}
      </div>

      <!-- FAQ accordion list -->
      <div class="faq-list">
        {#each filteredFaq as item (item.id)}
          {@const open = openFaqIds.has(item.id)}
          <div class="faq-item">
            <button
              class="faq-q"
              onclick={() => toggleFaq(item.id)}
              aria-expanded={open}
            >
              <span class="faq-q-text">{item.question}</span>
              <span class="plus-icon-wrap" style:transform={open ? 'rotate(45deg)' : 'none'} aria-hidden="true">
                <svg fill="none" viewBox="0 0 14 14" width="12" height="12">
                  <path d="M1 7H13M7 1V13" stroke="#553FE0" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>
                </svg>
              </span>
            </button>
            {#if open}
              <div class="faq-a">
                <p class="faq-a-text">{item.answer}</p>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </section>

  </main>

</div>

<style>
/* ── Root ───────────────────────────────────────────────────────── */
.help-root {
  min-height: 100vh;
  background: var(--cs-lilac);
  display: flex;
  flex-direction: column;
}

/* ── Main ───────────────────────────────────────────────────────── */
.help-main {
  flex: 1;
  width: 100%;
  max-width: 1240px;
  margin: 0 auto;
  padding: 95px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ── Hero ───────────────────────────────────────────────────────── */
.hero-section {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: 30px;
  min-height: 600px;
}

.hero-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hero-gradient {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, transparent 0%, rgba(16,11,50,0.4) 50%, rgba(16,11,50,0.85) 100%);
}

.hero-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 24px;
  padding: 96px 20px 24px;
  min-height: 600px;
}

.hero-heading {
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: white;
}

.hero-title {
  font-family: 'SB AggroOTF', 'Black Han Sans', sans-serif;
  font-weight: 700;
  font-size: 28px;
  line-height: 1.2;
  margin: 0;
}

.hero-sub {
  font-family: 'Noto Sans KR', sans-serif;
  font-weight: 900;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(255,255,255,0.9);
  margin: 0;
}

/* ── Category cards ─────────────────────────────────────────────── */
.cat-list {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 4px;
  scroll-snap-type: x mandatory;
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.cat-list::-webkit-scrollbar { display: none; }

.cat-card {
  scroll-snap-align: start;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px;
  border-radius: 20px;
  width: 120px;
  height: 110px;
  position: relative;
  overflow: hidden;
  border: none;
  cursor: pointer;
  transition: transform 0.3s;
}
.cat-card:hover { transform: scale(1.05); }

.cat-card-bg {
  position: absolute;
  inset: 0;
  background: #242c48;
  border-radius: 20px;
}

.cat-card-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 20px;
  opacity: 0.3;
  transition: transform 0.5s, opacity 0.3s;
}
.cat-card:hover .cat-card-img { transform: scale(1.1); opacity: 0.5; }

.cat-card-hover {
  position: absolute;
  inset: 0;
  border-radius: 20px;
  background: rgba(255,255,255,0);
  transition: background 0.3s;
}
.cat-card:hover .cat-card-hover { background: rgba(255,255,255,0.1); }

.cat-card-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  transition: transform 0.3s;
}
.cat-card:hover .cat-card-content { transform: translateY(-8px); }

.cat-icon {
  width: 36px;
  height: 36px;
}

.cat-label {
  font-family: 'Noto Sans KR', sans-serif;
  font-weight: 700;
  font-size: 11px;
  color: white;
  letter-spacing: -0.5px;
  white-space: nowrap;
}

/* ── Mobile FAQ Guide ───────────────────────────────────────────── */
.mobile-guide {
  background: var(--cs-purple-dark);
  border-radius: 0 50px 0 50px;
  overflow: hidden;
  margin: 0 -16px;
  width: calc(100% + 32px);
}

.mobile-guide-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 40px 25px;
}

.mobile-guide-title {
  font-family: 'Noto Sans KR', sans-serif;
  font-weight: 900;
  font-size: 24px;
  color: white;
  line-height: 1.6;
  letter-spacing: -0.5px;
  white-space: nowrap;
  margin: 0;
}

.mobile-guide-list {
  display: flex;
  flex-direction: column;
  gap: 30px;
  padding: 0 25px 100px;
}

.mobile-faq-item { width: 100%; display: flex; flex-direction: column; }

.mobile-faq-q {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 20px 25px;
  border-radius: 20px;
  border: none;
  cursor: pointer;
  background: var(--cs-purple);
  text-align: left;
  transition: background 0.15s;
}
.mobile-faq-q-open { background: var(--cs-purple-pale); }
.mobile-faq-q:not(.mobile-faq-q-open):hover { background: #4e3fa8; }

.mobile-faq-q-text {
  flex: 1;
  font-family: 'Noto Sans KR', sans-serif;
  font-weight: 700;
  font-size: 16px;
  line-height: 1.6;
  letter-spacing: -0.5px;
  color: white;
}
.mobile-faq-q-text-open { color: var(--cs-purple); }

.mobile-faq-a { padding: 15px 25px; }
.mobile-faq-a-text {
  font-family: 'Noto Sans KR', sans-serif;
  font-weight: 700;
  font-size: 14px;
  color: white;
  line-height: 2;
  letter-spacing: -0.5px;
  margin: 0;
}

/* ── FAQ Section (PC) ───────────────────────────────────────────── */
.faq-section {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-top: 56px;
}

@media (min-width: 768px) {
  .faq-section { margin-top: 32px; }
}

.faq-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.faq-header-label {
  font-family: 'Tilt Warp', sans-serif;
  font-size: 16px;
  color: var(--cs-text);
  letter-spacing: -0.5px;
}

.order-badge { display: flex; align-items: center; }

.tab-bar {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.tab-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-radius: 16px;
  border: none;
  background: var(--cs-purple);
  color: white;
  cursor: pointer;
  width: 100%;
  transition: background 0.15s;
  font-family: 'Tilt Warp', sans-serif;
  font-size: 14px;
  letter-spacing: -0.5px;
}
.tab-btn:hover:not(.tab-btn-active) { background: #4e3fa8; }
.tab-btn-active { background: var(--cs-red); }

.tab-label { white-space: nowrap; }

.tab-count {
  font-family: 'Noto Sans KR', sans-serif;
  font-weight: 700;
  font-size: 12px;
  line-height: 1;
}

.faq-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.faq-item { width: 100%; }

.faq-q {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 24px;
  background: var(--cs-purple-op10);
  border-radius: 20px;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
}
.faq-q:hover { background: #d5d0ef; }

.faq-q-text {
  flex: 1;
  font-family: 'Noto Sans KR', sans-serif;
  font-weight: 700;
  font-size: 14px;
  color: var(--cs-text);
  letter-spacing: -0.5px;
  line-height: 1.6;
}

.plus-icon-wrap {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s;
}

.faq-a {
  margin-top: 8px;
  padding: 20px 24px;
  background: rgba(255,255,255,0.7);
  border-radius: 20px;
  border: 1px solid var(--cs-purple-op10);
}

.faq-a-text {
  font-family: 'Noto Sans KR', sans-serif;
  font-size: 13px;
  color: var(--cs-purple);
  line-height: 1.7;
  letter-spacing: -0.3px;
  margin: 0;
}


/* ── Responsive: 768px+ ─────────────────────────────────────────── */
@media (min-width: 768px) {
  .help-main {
    padding: 160px 24px 32px;
    gap: 32px;
  }

  .hero-section {
    border-radius: 50px;
    min-height: 500px;
  }

  .hero-content {
    padding: 240px 40px 40px;
    gap: 40px;
  }

  .hero-heading { gap: 20px; }

  .hero-title { font-size: 48px; }
  .hero-sub { font-size: 18px; }

  .cat-list { gap: 20px; }

  .cat-card {
    border-radius: 30px;
    width: 160px;
    height: 130px;
    padding: 16px;
  }
  .cat-card-bg { border-radius: 30px; }
  .cat-card-img { border-radius: 30px; }
  .cat-card-hover { border-radius: 30px; }
  .cat-icon { width: 40px; height: 40px; }
  .cat-label { font-size: 13px; }

  .mobile-guide { display: none; }

  .faq-section { gap: 32px; }

  .faq-header-label { font-size: 20px; }

  .tab-bar {
    grid-template-columns: repeat(4, 1fr);
  }

  .tab-btn {
    padding: 16px 32px;
    border-radius: 24px;
    font-size: 16px;
  }
  .tab-count { font-size: 14px; }

  .faq-list { gap: 20px; }

  .faq-q {
    padding: 24px 40px;
    border-radius: 30px;
  }
  .faq-q-text { font-size: 16px; }
  .faq-a { padding: 20px 40px; border-radius: 24px; }
  .faq-a-text { font-size: 15px; }

}

/* ── Responsive: 1024px+ ────────────────────────────────────────── */
@media (min-width: 1024px) {
  .help-main {
    padding: 160px 20px 40px;
    gap: 40px;
  }

  .hero-title { font-size: 60px; }
  .hero-sub { font-size: 22px; }
  .hero-content { padding: 300px 50px 50px; }

  .cat-card { width: 200px; height: 150px; padding: 20px; }
  .cat-label { font-size: 14px; }

  .tab-btn {
    padding: 20px 40px;
    border-radius: 30px;
    font-size: 18px;
  }
  .faq-section { gap: 40px; margin-top: 40px; }
  .faq-list { gap: 32px; }

}
</style>
