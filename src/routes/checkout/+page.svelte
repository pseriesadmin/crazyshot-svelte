<script lang="ts">
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import type { PageData } from './$types';
  import type { Product } from '$lib/types/database';
  import SubGnb from '$lib/components/common/SubGnb.svelte';
  import CalendarGrid from '$lib/components/common/CalendarGrid.svelte';
  import { sampleSubItems, priceConfig } from '$lib/fixtures/cartFixtures';

  function readInputValue(event: { currentTarget: { value: string } }): string {
    return event.currentTarget.value;
  }

  interface Props { data: PageData }
  let { data }: Props = $props();

  // ── Types
  type DeliveryType = 'visit' | 'delivery';
  type VisitLocation = 'main' | 'branch1' | 'branch2' | 'none';
  type DeliveryService = 'crazy' | 'quick';

  interface CardOptions {
    rentalDelivery: DeliveryType;
    rentalVisit: VisitLocation;
    rentalService: DeliveryService;
    returnDelivery: DeliveryType;
    returnVisit: VisitLocation;
    returnService: DeliveryService;
    copyToReturn: boolean;
    couponWelcome: boolean;
    couponMembership: boolean;
  }

  interface CardAccordion {
    rental: boolean;
    return_: boolean;
    fee: boolean;
  }

  interface FormState {
    name: string;
    email: string;
    phone: string;
    authCode: string;
    addr: string;
    addrDetail: string;
    notes: string;
    memberCheck: boolean;
    memberCheck2: boolean;
  }

  function defaultOptions(type: 1 | 2): CardOptions {
    if (type === 1) return {
      rentalDelivery: 'delivery', rentalVisit: 'branch1', rentalService: 'crazy',
      returnDelivery: 'visit', returnVisit: 'main', returnService: 'quick',
      copyToReturn: false, couponWelcome: false, couponMembership: false
    };
    return {
      rentalDelivery: 'visit', rentalVisit: 'branch1', rentalService: 'quick',
      returnDelivery: 'delivery', returnVisit: 'branch1', returnService: 'quick',
      copyToReturn: false, couponWelcome: false, couponMembership: false
    };
  }

  function defaultForm(): FormState {
    return { name: '', email: '', phone: '', authCode: '', addr: '', addrDetail: '', notes: '', memberCheck: false, memberCheck2: false };
  }

  // ── Pending reservation from product detail (예약담기 → 카트 연동)
  interface PendingReservation {
    productId: string;
    productName: string;
    imageUrl: string;
    startDate: string;
    endDate: string;
    startHour: number;
    endHour: number;
    qty: number;
    dailyPrice: number;
    halfDayPrice: number;
  }
  let pendingReservation = $state<PendingReservation | null>(null);

  // ── Card 1 state
  let c1Checked = $state(false);
  let c1Deleted = $state(false);
  let c1Qty = $state(1);
  let c1Acc = $state<CardAccordion>({ rental: false, return_: false, fee: false });
  let c1Opts = $state<CardOptions>(defaultOptions(1));
  let c1RentalForm = $state<FormState>(defaultForm());
  let c1ReturnForm = $state<FormState>(defaultForm());

  // ── Card 2 state
  let c2Checked = $state(false);
  let c2Deleted = $state(false);
  let c2Qtys = $state([1, 1, 1]);
  let c2Acc = $state<CardAccordion>({ rental: false, return_: false, fee: false });
  let c2Opts = $state<CardOptions>(defaultOptions(2));
  let c2RentalForm = $state<FormState>(defaultForm());
  let c2ReturnForm = $state<FormState>(defaultForm());

  // ── Rental Options Panel
  let rpRentalDelivery = $state<DeliveryType>('delivery');
  let rpRentalVisit = $state<VisitLocation>('branch1');
  let rpRentalService = $state<DeliveryService>('quick');
  let rpRentalOpen = $state(false);
  let rpRentalForm = $state<FormState>(defaultForm());

  let rpReturnDelivery = $state<DeliveryType>('delivery');
  let rpReturnVisit = $state<VisitLocation>('branch1');
  let rpReturnService = $state<DeliveryService>('quick');
  let rpReturnOpen = $state(false);
  let rpReturnForm = $state<FormState>(defaultForm());
  let rpCopyToReturn = $state(false);

  // ── Order Total
  let otCouponWelcome = $state(false);
  let otCouponMembership = $state(false);

  // ── Calendar & Time
  let openCalId = $state<string | null>(null);
  let openTimeId = $state<string | null>(null);
  // Per-form date/time selections
  let c1RentalDate = $state('');   let c1RentalTime = $state('');
  let c1ReturnDate = $state('');   let c1ReturnTime = $state('');
  let c2RentalDate = $state('');   let c2RentalTime = $state('');
  let c2ReturnDate = $state('');   let c2ReturnTime = $state('');
  let rpRentalDateVal = $state(''); let rpRentalTimeVal2 = $state('');
  let rpReturnDateVal = $state(''); let rpReturnTimeVal2 = $state('');

  function openCal(id: string, _currentDate: string) {
    openCalId = openCalId === id ? null : id;
    openTimeId = null;
  }

  function openTime(id: string) {
    openTimeId = openTimeId === id ? null : id;
    openCalId = null;
  }

  function fmtTime(h: number): string {
    return `${String(h).padStart(2, '0')}:00`;
  }

  // ── Copy-to-return sync handlers
  function c1HandleDelivery(v: DeliveryType) { c1Opts = { ...c1Opts, rentalDelivery: v, ...(c1Opts.copyToReturn ? { returnDelivery: v } : {}) }; }
  function c1HandleVisit(v: VisitLocation) { c1Opts = { ...c1Opts, rentalVisit: v, ...(c1Opts.copyToReturn ? { returnVisit: v } : {}) }; }
  function c1HandleService(v: DeliveryService) { c1Opts = { ...c1Opts, rentalService: v, ...(c1Opts.copyToReturn ? { returnService: v } : {}) }; }
  function c1HandleRentalForm(f: FormState) { c1RentalForm = f; if (c1Opts.copyToReturn) c1ReturnForm = { ...f }; }
  function c1HandleRentalDate(d: string) { c1RentalDate = d; if (c1Opts.copyToReturn) c1ReturnDate = d; }
  function c1HandleRentalTime(t: string) { c1RentalTime = t; if (c1Opts.copyToReturn) c1ReturnTime = t; }
  function c1HandleCopy(v: boolean) {
    if (v) {
      c1Opts = { ...c1Opts, copyToReturn: true, returnDelivery: c1Opts.rentalDelivery, returnVisit: c1Opts.rentalVisit, returnService: c1Opts.rentalService };
      c1ReturnForm = { ...c1RentalForm };
      c1ReturnDate = c1RentalDate;
      c1ReturnTime = c1RentalTime;
    } else {
      c1Opts = { ...c1Opts, copyToReturn: false };
    }
  }

  function c2HandleDelivery(v: DeliveryType) { c2Opts = { ...c2Opts, rentalDelivery: v, ...(c2Opts.copyToReturn ? { returnDelivery: v } : {}) }; }
  function c2HandleVisit(v: VisitLocation) { c2Opts = { ...c2Opts, rentalVisit: v, ...(c2Opts.copyToReturn ? { returnVisit: v } : {}) }; }
  function c2HandleService(v: DeliveryService) { c2Opts = { ...c2Opts, rentalService: v, ...(c2Opts.copyToReturn ? { returnService: v } : {}) }; }
  function c2HandleRentalForm(f: FormState) { c2RentalForm = f; if (c2Opts.copyToReturn) c2ReturnForm = { ...f }; }
  function c2HandleRentalDate(d: string) { c2RentalDate = d; if (c2Opts.copyToReturn) c2ReturnDate = d; }
  function c2HandleRentalTime(t: string) { c2RentalTime = t; if (c2Opts.copyToReturn) c2ReturnTime = t; }
  function c2HandleCopy(v: boolean) {
    if (v) {
      c2Opts = { ...c2Opts, copyToReturn: true, returnDelivery: c2Opts.rentalDelivery, returnVisit: c2Opts.rentalVisit, returnService: c2Opts.rentalService };
      c2ReturnForm = { ...c2RentalForm };
      c2ReturnDate = c2RentalDate;
      c2ReturnTime = c2RentalTime;
    } else {
      c2Opts = { ...c2Opts, copyToReturn: false };
    }
  }

  function rpHandleDelivery(v: DeliveryType) { rpRentalDelivery = v; if (rpCopyToReturn) rpReturnDelivery = v; }
  function rpHandleVisit(v: VisitLocation) { rpRentalVisit = v; if (rpCopyToReturn) rpReturnVisit = v; }
  function rpHandleService(v: DeliveryService) { rpRentalService = v; if (rpCopyToReturn) rpReturnService = v; }
  function rpHandleRentalForm(f: FormState) { rpRentalForm = f; if (rpCopyToReturn) rpReturnForm = { ...f }; }
  function rpHandleRentalDate(d: string) { rpRentalDateVal = d; if (rpCopyToReturn) rpReturnDateVal = d; }
  function rpHandleRentalTime(t: string) { rpRentalTimeVal2 = t; if (rpCopyToReturn) rpReturnTimeVal2 = t; }
  function rpHandleCopy(v: boolean) {
    rpCopyToReturn = v;
    if (v) {
      rpReturnDelivery = rpRentalDelivery;
      rpReturnVisit = rpRentalVisit;
      rpReturnService = rpRentalService;
      rpReturnForm = { ...rpRentalForm };
      rpReturnDateVal = rpRentalDateVal;
      rpReturnTimeVal2 = rpRentalTimeVal2;
    }
  }

  function displayDate(iso: string): string {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${y}.${m}.${d}`;
  }

  // ── Footer
  let agreed = $state(false);
  let footerVisible = $state(false);

  onMount(() => {
    // pendingReservation 처리 (상품 상세 → 예약담기 → 카트)
    const raw = typeof window !== 'undefined' ? sessionStorage.getItem('pendingReservation') : null;
    if (raw) {
      try {
        pendingReservation = JSON.parse(raw) as PendingReservation;
        sessionStorage.removeItem('pendingReservation');
        // 수령일/반납일 자동 세팅 (카드 1 기준)
        if (pendingReservation.startDate) c1RentalDate = pendingReservation.startDate;
        if (pendingReservation.endDate) c1ReturnDate = pendingReservation.endDate;
        if (pendingReservation.startHour != null) c1RentalTime = `${String(pendingReservation.startHour).padStart(2,'0')}:00`;
        if (pendingReservation.endHour != null) c1ReturnTime = `${String(pendingReservation.endHour).padStart(2,'0')}:00`;
        if (pendingReservation.qty) c1Qty = pendingReservation.qty;
        // 수령 아코디언 자동 오픈
        c1Acc = { ...c1Acc, rental: true };
      } catch {
        // ignore malformed data
      }
    }

    let lastY = window.scrollY;
    function onScroll() {
      const y = window.scrollY;
      if (y > lastY) {
        footerVisible = true;   // 아래로 스크롤 → 팝업
      } else if (y < lastY) {
        footerVisible = false;  // 위로 스크롤 → 다운
      }
      lastY = y;
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  });

  // ── Helpers
  function optionLabel(delivery: DeliveryType, visit: VisitLocation, service: DeliveryService): string {
    if (delivery === 'visit') {
      return visit === 'main' ? '본점' : visit === 'branch1' ? '지점1' : '지점2';
    }
    return service === 'crazy' ? '크레이지샷배송' : '당일 퀵배송';
  }

  function toggleAcc(acc: CardAccordion, key: keyof CardAccordion): CardAccordion {
    if (key === 'rental') return { ...acc, rental: !acc.rental };
    if (key === 'return_') return { ...acc, return_: !acc.return_ };
    return { ...acc, fee: !acc.fee };
  }

  // ── Product data helpers
  const p1 = $derived(data.products.find((p: Product) => p.id === data.cartItems[0]?.product_id));
  const p2 = $derived(data.products.find((p: Product) => p.id === data.cartItems[1]?.product_id));
  const p1Rate = $derived(priceConfig[data.cartItems[0]?.product_id as keyof typeof priceConfig]?.daily_rate ?? 150000);
  const p2Rate = $derived(priceConfig[data.cartItems[1]?.product_id as keyof typeof priceConfig]?.daily_rate ?? 80000);
  const subItems = $derived(sampleSubItems.filter(s => s.parent_cart_id === data.cartItems[0]?.id));
</script>

<!-- ══ 공통 Sub GNB (PC + 모바일) ══ -->
<SubGnb title="Cart" mobileOnly />

<!-- ═══════════════════════ MAIN ═══════════════════════ -->
<div class="cart-root">
  <!-- 기존 PC 헤더 제거 — SubGnb로 통합 -->
  <header class="cart-header">
    <div class="cart-header-inner">
      <!-- Back + Cart pill -->
      <button type="button" class="header-pill" onclick={() => history.back()} aria-label="뒤로 가기, 장바구니">
        <div class="header-pill-left">
          <svg class="header-pill-arrow" viewBox="0 0 21.3844 17.1421" fill="none" aria-hidden="true">
            <path d="M19.8844 8.5707L1.5 8.57107M8.57107 1.5L1.5 8.57107L8.57107 15.6421" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/>
          </svg>
          <span class="header-back-text">Back</span>
        </div>
        <span class="header-cart-text">Cart</span>
      </button>
      <!-- Category icons -->
      <div class="cat-icons">
        <!-- 카메라 -->
        <button class="cat-icon-btn" title="카메라">
          <svg viewBox="0 0 31.5078 33.5626" fill="none" style="width:28px;height:28px">
            <path d="M0.68501 24.2755C0.68501 25.836 2.35608 26.827 3.72543 26.0786L14.7683 20.0424C15.3825 19.7067 16.1253 19.7067 16.7395 20.0424L27.7824 26.0786C29.1517 26.8271 30.8228 25.836 30.8228 24.2755V11.1677C30.8228 10.4164 30.4128 9.72499 29.7535 9.36464L16.7395 2.25109C16.1253 1.91538 15.3825 1.91538 14.7683 2.25109L1.75429 9.36464C1.09504 9.72499 0.68501 10.4164 0.68501 11.1677V24.2755Z" fill="#FF3535"/>
            <path d="M28.8434 11.1306C28.8434 10.16 28.3173 9.26548 27.4702 8.79494L17.0454 3.00442C16.2421 2.55823 15.2658 2.55832 14.4624 3.00442L4.03699 8.79494C3.18993 9.2655 2.66446 10.16 2.66446 11.1306V22.432C2.66446 23.4026 3.18989 24.2971 4.03699 24.7676L14.4624 30.5575C15.2658 31.0037 16.242 31.0038 17.0454 30.5575L27.4702 24.7676C28.3173 24.2971 28.8434 23.4026 28.8434 22.432V11.1306ZM31.5078 22.432C31.5078 24.3732 30.4562 26.1615 28.762 27.1026L18.3373 32.8931C16.7303 33.7857 14.7775 33.7857 13.1705 32.8931L2.74577 27.1026C1.05147 26.1615 6.00964e-05 24.3732 6.00964e-05 22.432V11.1306C6.00964e-05 9.18934 1.05147 7.40103 2.74577 6.45996L13.1705 0.669437C14.7775 -0.223146 16.7303 -0.223146 18.3373 0.669437L28.762 6.45996C30.4562 7.40106 31.5078 9.18942 31.5078 11.1306V22.432Z" fill="#3B2F8A"/>
            <path d="M0.68501 12.5932C0.68501 10.3148 3.12471 8.868 5.1239 9.96077L14.315 14.9847C15.2117 15.4748 16.2961 15.4748 17.1928 14.9847L26.3839 9.96077C28.3831 8.868 30.8228 10.3148 30.8228 12.5932V23.5467C30.8228 24.6436 30.2242 25.653 29.2617 26.1791L17.1928 32.776C16.2961 33.2662 15.2117 33.2662 14.315 32.776L2.24612 26.1791C1.28364 25.653 0.68501 24.6436 0.68501 23.5467V12.5932Z" fill="#3B2F8A"/>
          </svg>
        </button>
        <!-- 렌즈 -->
        <button class="cat-icon-btn" title="렌즈">
          <svg viewBox="0 0 32 27.1304" fill="none" style="width:28px;height:24px">
            <path d="M32 18.6487V12.0642C32 9.09528 32 7.61084 31.4311 6.47687C30.2661 4.1549 28.1659 3.58242 25.7391 3.58242C25.0736 3.58242 24.5623 3.0188 24.2933 2.41001C23.5455 0.717442 21.2087 0 19.4783 0H13.2174C11.3836 0 8.6128 0.805645 7.96747 2.72357C7.81367 3.18068 7.43881 3.58242 6.95652 3.58242C4.17243 3.58242 1.97727 3.66983 0.56893 6.47687C0 7.61084 0 9.09528 0 12.0642V18.6487C0 21.6176 0 23.102 0.56893 24.236C1.06938 25.2335 1.86791 26.0444 2.85009 26.5527C3.96668 27.1304 5.42838 27.1304 8.35177 27.1304H23.6482C26.5716 27.1304 28.0333 27.1304 29.1499 26.5527C30.1321 26.0444 30.9306 25.2335 31.4311 24.236C32 23.102 32 21.6176 32 18.6487Z" fill="#3B2F8A"/>
            <path d="M22.2609 14.6087C22.2609 11.343 19.6135 8.69565 16.3478 8.69565C13.0821 8.69565 10.4348 11.343 10.4348 14.6087C10.4348 17.8744 13.0821 20.5217 16.3478 20.5217C19.6135 20.5217 22.2609 17.8744 22.2609 14.6087ZM25.0435 14.6087C25.0435 19.4112 21.1503 23.3043 16.3478 23.3043C11.5454 23.3043 7.65217 19.4112 7.65217 14.6087C7.65217 9.80622 11.5454 5.91304 16.3478 5.91304C21.1503 5.91304 25.0435 9.80622 25.0435 14.6087Z" fill="#FF3535"/>
            <path d="M16.3478 20.5217C19.6135 20.5217 22.2609 17.8744 22.2609 14.6087C22.2609 11.343 19.6135 8.69565 16.3478 8.69565C13.0821 8.69565 10.4348 11.343 10.4348 14.6087C10.4348 17.8744 13.0821 20.5217 16.3478 20.5217Z" fill="#E1DEF3"/>
          </svg>
        </button>
        <!-- 드론 -->
        <button class="cat-icon-btn" title="드론">
          <svg viewBox="0 0 32.8777 32.8777" fill="none" style="width:28px;height:28px">
            <path d="M16.439 2.7398C24.0047 2.73992 30.1382 8.87334 30.1382 16.439C30.1381 24.0046 24.0046 30.1381 16.439 30.1382C8.87334 30.1382 2.73992 24.0047 2.7398 16.439C2.7398 8.87327 8.87327 2.7398 16.439 2.7398Z" fill="#FF3535"/>
            <path d="M30.1378 16.4388C30.1378 8.87305 24.0045 2.7398 16.4388 2.7398C8.87305 2.7398 2.7398 8.87305 2.7398 16.4388C2.7398 24.0045 8.87305 30.1378 16.4388 30.1378C24.0045 30.1378 30.1378 24.0045 30.1378 16.4388ZM32.8776 16.4388C32.8776 25.5177 25.5177 32.8776 16.4388 32.8776C7.3599 32.8776 0 25.5177 0 16.4388C1.76525e-07 7.3599 7.3599 2.24761e-06 16.4388 0C25.5177 0 32.8776 7.3599 32.8776 16.4388Z" fill="#3B2F8A"/>
            <path d="M27.398 16.4388C27.398 22.4914 22.4914 27.398 16.4388 27.398C10.3862 27.398 5.4796 22.4914 5.4796 16.4388C5.4796 10.3862 10.3862 5.4796 16.4388 5.4796C22.4914 5.4796 27.398 10.3862 27.398 16.4388Z" fill="#3B2F8A"/>
            <path d="M16.4388 21.2334C19.0868 21.2334 21.2334 19.0868 21.2334 16.4388C21.2334 13.7908 19.0868 11.6441 16.4388 11.6441C13.7908 11.6441 11.6441 13.7908 11.6441 16.4388C11.6441 19.0868 13.7908 21.2334 16.4388 21.2334Z" fill="#E1DEF3"/>
          </svg>
        </button>
        <!-- 폰 -->
        <button class="cat-icon-btn" title="폰">
          <svg viewBox="0 0 32 29" fill="none" style="width:28px;height:26px">
            <path d="M24.3607 0C28.1868 0.000100914 31.4716 3.30714 31.4716 7.15929C31.4716 8.59163 31.4699 11.5467 31.4688 14.1431C31.4682 15.4412 31.4678 16.6498 31.4674 17.534C31.4672 17.9761 31.4668 18.3371 31.4667 18.5876V18.9777C31.4662 19.9661 30.67 20.7672 29.6883 20.7668C28.7066 20.7663 27.9109 19.9647 27.9113 18.9763V18.5855C27.9114 18.3351 27.9118 17.9744 27.912 17.5326C27.9124 16.6484 27.9128 15.4392 27.9134 14.141C27.9145 11.5445 27.9161 8.59061 27.9161 7.15929C27.9161 5.28412 26.2232 3.57975 24.3607 3.57964C22.939 3.57964 19.3377 3.5806 15.7361 3.58174C12.1351 3.58288 8.53335 3.58454 7.1108 3.58454C5.24828 3.58454 3.5554 5.28896 3.5554 7.16418C3.5554 8.59646 3.55523 13.6078 3.5554 18.2611C3.55549 20.5878 3.55603 22.8251 3.5561 24.4807V27.2102C3.5561 28.1986 2.76014 28.9999 1.7784 29C0.858025 29 0.100835 28.2958 0.0097218 27.3934L0.000694414 27.2102V18.2611C0.000520826 13.6079 2.82461e-08 8.59655 0 7.16418C2.91092e-07 3.31197 3.28468 0.00419489 7.1108 0.00419489C8.53265 0.00419486 12.1339 0.00323361 15.7354 0.00209745C19.3365 0.000961433 22.9383 0 24.3607 0ZM29.5112 23.6305C30.8857 23.6305 32 24.7524 32 26.1363C32 27.5202 30.8857 28.642 29.5112 28.642C28.1367 28.642 27.0224 27.5202 27.0224 26.1363C27.0224 24.7524 28.1367 23.6305 29.5112 23.6305ZM11.7335 6.62514C14.8753 6.62514 17.4222 9.18939 17.4222 12.3526V20.2271C17.4222 23.3903 14.8753 25.9552 11.7335 25.9552C8.59177 25.9552 6.04488 23.3903 6.04488 20.2271V12.3526C6.04488 9.18939 8.59177 6.62514 11.7335 6.62514ZM11.7335 17.3641C10.1626 17.3641 8.8892 18.6462 8.8892 20.2278C8.88939 21.8092 10.1628 23.0915 11.7335 23.0915C13.3043 23.0915 14.5777 21.8092 14.5778 20.2278C14.5778 18.6462 13.3044 17.3641 11.7335 17.3641Z" fill="#3B2F8A"/>
            <path d="M14.5778 12.3522C14.5778 13.9338 13.3044 15.2159 11.7335 15.2159C10.1626 15.2159 8.8892 13.9338 8.8892 12.3522C8.8892 10.7706 10.1626 9.4885 11.7335 9.4885C13.3044 9.4885 14.5778 10.7706 14.5778 12.3522Z" fill="#FF3535"/>
          </svg>
        </button>
        <!-- 영상 -->
        <button class="cat-icon-btn" title="영상">
          <svg viewBox="0 0 32 20.9674" fill="none" style="width:28px;height:20px">
            <path d="M0 14.6413C0 12.7203 1.55727 11.163 3.47826 11.163H6.26087C8.18186 11.163 9.73913 12.7203 9.73913 14.6413V17.4239C9.73913 19.3449 8.18186 20.9022 6.26087 20.9022H3.47826C1.55727 20.9022 0 19.3449 0 17.4239V14.6413Z" fill="#3B2F8A"/>
            <path d="M22.2609 14.7065C22.2609 12.7855 23.8181 11.2283 25.7391 11.2283H28.5217C30.4427 11.2283 32 12.7855 32 14.7065V17.4891C32 19.4101 30.4427 20.9674 28.5217 20.9674H25.7391C23.8181 20.9674 22.2609 19.4101 22.2609 17.4891V14.7065Z" fill="#3B2F8A"/>
            <path d="M11.1304 14.6413C11.1304 12.7203 12.6877 11.163 14.6087 11.163H17.3913C19.3123 11.163 20.8696 12.7203 20.8696 14.6413V17.4239C20.8696 19.3449 19.3123 20.9022 17.3913 20.9022H14.6087C12.6877 20.9022 11.1304 19.3449 11.1304 17.4239V14.6413Z" fill="#FF3535"/>
            <path d="M0 3.47826C0 1.55727 1.55727 0 3.47826 0H6.26087C8.18186 0 9.73913 1.55727 9.73913 3.47826V6.26087C9.73913 8.18186 8.18186 9.73913 6.26087 9.73913H3.47826C1.55727 9.73913 0 8.18186 0 6.26087V3.47826Z" fill="#3B2F8A"/>
            <path d="M11.1304 3.47826C11.1304 1.55727 12.6877 0 14.6087 0H17.3913C19.3123 0 20.8696 1.55727 20.8696 3.47826V6.26087C20.8696 8.18186 19.3123 9.73913 17.3913 9.73913H14.6087C12.6877 9.73913 11.1304 8.18186 11.1304 6.26087V3.47826Z" fill="#FF3535"/>
            <path d="M22.2609 3.54348C22.2609 1.62249 23.8181 0.0652174 25.7391 0.0652174H28.5217C30.4427 0.0652174 32 1.62249 32 3.54348V6.32609C32 8.24708 30.4427 9.80435 28.5217 9.80435H25.7391C23.8181 9.80435 22.2609 8.24708 22.2609 6.32609V3.54348Z" fill="#3B2F8A"/>
          </svg>
        </button>
        <!-- 악세서리 -->
        <button class="cat-icon-btn" title="악세서리">
          <svg viewBox="0 0 30 30" fill="none" style="width:26px;height:26px">
            <path d="M24 28.6667C26.5773 28.6667 28.6667 26.5773 28.6667 24C28.6667 21.4227 26.5773 19.3333 24 19.3333C21.4227 19.3333 19.3333 21.4227 19.3333 24C19.3333 26.5773 21.4227 28.6667 24 28.6667Z" fill="#FF3535"/>
            <path d="M6 10.6667C8.57733 10.6667 10.6667 8.57733 10.6667 6C10.6667 3.42267 8.57733 1.33333 6 1.33333C3.42267 1.33333 1.33333 3.42267 1.33333 6C1.33333 8.57733 3.42267 10.6667 6 10.6667Z" fill="#FF3535"/>
            <path d="M27.3333 24C27.3333 22.1591 25.8409 20.6667 24 20.6667C22.1591 20.6667 20.6667 22.1591 20.6667 24C20.6667 25.8409 22.1591 27.3333 24 27.3333C25.8409 27.3333 27.3333 25.841 27.3333 24ZM30 24C30 27.3137 27.3137 30 24 30C20.6863 30 18 27.3137 18 24C18 20.6863 20.6863 18 24 18C27.3137 18 30 20.6863 30 24Z" fill="#3B2F8A"/>
            <path d="M9.33333 24C9.33333 22.1591 7.84095 20.6667 6 20.6667C4.15905 20.6667 2.66667 22.1591 2.66667 24C2.66667 25.8409 4.15905 27.3333 6 27.3333C7.84095 27.3333 9.33333 25.841 9.33333 24ZM12 24C12 27.3137 9.31371 30 6 30C2.68629 30 0 27.3137 0 24C0 20.6863 2.68629 18 6 18C9.31371 18 12 20.6863 12 24Z" fill="#3B2F8A"/>
            <path d="M27.3333 6C27.3333 4.15905 25.8409 2.66667 24 2.66667C22.1591 2.66667 20.6667 4.15905 20.6667 6C20.6667 7.84095 22.1591 9.33333 24 9.33333C25.8409 9.33333 27.3333 7.84095 27.3333 6ZM30 6C30 9.31371 27.3137 12 24 12C20.6863 12 18 9.31371 18 6C18 2.68629 20.6863 6.5213e-07 24 0C27.3137 0 30 2.68629 30 6Z" fill="#3B2F8A"/>
            <path d="M9.33333 6C9.33333 4.15905 7.84095 2.66667 6 2.66667C4.15905 2.66667 2.66667 4.15905 2.66667 6C2.66667 7.84095 4.15905 9.33333 6 9.33333C7.84095 9.33333 9.33333 7.84095 9.33333 6ZM12 6C12 9.31371 9.31371 12 6 12C2.68629 12 0 9.31371 0 6C0 2.68629 2.68629 6.87206e-07 6 0C9.31371 0 12 2.68629 12 6Z" fill="#3B2F8A"/>
            <path d="M10.9408 13.5912C10.7885 12.093 12.0936 10.7861 13.5922 10.9345C14.5654 11.0308 15.4855 11.0278 16.4718 10.9246C17.9541 10.7694 19.2505 12.0504 19.1059 13.5338C19.0073 14.5453 19.0089 15.493 19.1106 16.5067C19.2584 17.9798 17.9805 19.2557 16.5078 19.1042C15.5032 19.0008 14.5662 18.9964 13.5704 19.092C12.0776 19.2352 10.7863 17.9273 10.9395 16.4355C11.0389 15.4678 11.0391 14.558 10.9408 13.5912Z" fill="#3B2F8A"/>
            <path d="M19.714 16.8856C20.4951 17.6667 20.4951 18.933 19.714 19.714C18.933 20.4951 17.6667 20.4951 16.8856 19.714L10.286 13.1144C9.50491 12.3333 9.50491 11.067 10.286 10.286C11.067 9.50491 12.3333 9.50491 13.1144 10.286L19.714 16.8856Z" fill="#3B2F8A"/>
            <path d="M13.1144 19.714C12.3333 20.4951 11.067 20.4951 10.286 19.714C9.50491 18.933 9.50491 17.6667 10.286 16.8856L16.8856 10.286C17.6667 9.50491 18.933 9.50491 19.714 10.286C20.4951 11.067 20.4951 12.3333 19.714 13.1144L13.1144 19.714Z" fill="#3B2F8A"/>
          </svg>
        </button>
        <!-- 항공 -->
        <button class="cat-icon-btn" title="항공">
          <svg viewBox="0 0 32 26" fill="none" style="width:28px;height:24px">
            <path d="M19.9111 0C18.5419 4.75329e-05 17.302 0.561862 16.4021 1.47054H12.0889C11.1071 1.47064 10.3111 2.27899 10.3111 3.2761C10.3112 4.27312 11.1072 5.08156 12.0889 5.08165H14.9333V12.2778C14.9333 15.0698 17.162 17.3332 19.9111 17.3333H26.8889V19.1389C26.8889 21.0306 25.5515 22.3889 23.6889 22.3889H6.75556C4.89304 22.3888 3.55556 21.0305 3.55556 19.1389V9.38889L3.54653 9.2041C3.45539 8.29374 2.69818 7.58333 1.77778 7.58333C0.857442 7.58342 0.100144 8.29378 0.00902778 9.2041L0 9.38889V19.1389C0 23.0249 2.92936 25.9999 6.75556 26H23.6889C27.5152 26 30.4444 23.0249 30.4444 19.1389V15.9474C31.402 15.026 32 13.7232 32 12.2778V5.05556C32 2.26345 29.7714 0 27.0222 0H19.9111ZM5.38333 0.722222C4.00884 0.722317 2.89444 1.85401 2.89444 3.25C2.89444 4.64599 4.00884 5.77768 5.38333 5.77778C6.75791 5.77778 7.87222 4.64605 7.87222 3.25C7.87222 1.85395 6.75791 0.722222 5.38333 0.722222Z" fill="#3B2F8A"/>
            <path d="M19.2002 8.66667C19.2002 11.2593 21.2696 13.3611 23.8224 13.3611C26.3752 13.3611 28.4446 11.2593 28.4446 8.66667C28.4446 6.074 26.3752 3.97222 23.8224 3.97222C21.2696 3.97222 19.2002 6.074 19.2002 8.66667Z" fill="#FF3535"/>
          </svg>
        </button>
        <!-- 기타 -->
        <button class="cat-icon-btn" title="기타">
          <svg viewBox="0 0 28 32" fill="none" style="width:26px;height:30px">
            <path d="M0 6.8495C0 3.06663 3.09606 0 6.91525 0H13.8305C17.6497 0 20.7457 3.06663 20.7457 6.8495V19.1786C20.7457 22.9615 17.6497 26.0281 13.8305 26.0281H6.91525C3.09606 26.0281 0 22.9615 0 19.1786V6.8495Z" fill="#3B2F8A"/>
            <path d="M17.2814 28.5753C21.2955 28.5753 24.3467 25.7235 24.5336 22.3953L24.5424 22.0716V12.404C24.5424 11.4583 25.3164 10.6916 26.2712 10.6916C27.226 10.6916 28 11.4583 28 12.404V22.0716L27.9966 22.3338C27.8458 27.816 22.9771 32 17.2814 32C11.4952 32 6.56274 27.682 6.56273 22.0716V17.9632C6.56291 17.0176 7.33686 16.2508 8.29154 16.2508C9.24623 16.2508 10.0202 17.0176 10.0204 17.9632L10.0204 22.0716C10.0204 25.5364 13.1376 28.5752 17.2814 28.5753Z" fill="#3B2F8A"/>
            <path d="M9.32208 7.5893C9.7151 6.94081 10.5642 6.73069 11.219 7.11973C11.874 7.50899 12.0868 8.35057 11.6938 8.99933L10.046 11.7191H12.4441C12.9423 11.7191 13.402 11.9846 13.6475 12.414C13.893 12.8435 13.8863 13.3708 13.6299 13.794L10.7254 18.5886C10.3324 19.2371 9.48329 19.4472 8.82842 19.0582C8.17344 18.6689 7.96068 17.8274 8.35367 17.1786L10.0014 14.4589H7.6034C7.10513 14.4589 6.64548 14.1933 6.39998 13.7639C6.15448 13.3344 6.16118 12.8072 6.41754 12.3839L9.32208 7.5893Z" fill="#FF3535"/>
          </svg>
        </button>
      </div>
    </div>
  </header>

  <!-- ═══════════════════════ MAIN SCROLL ═══════════════════════ -->
  <main class="cart-main">
    <div class="cart-content">

      <!-- ── PENDING RESERVATION BANNER ── -->
      {#if pendingReservation}
        <div class="pending-banner">
          <div class="pending-banner-left">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="9" fill="var(--cs-purple)" opacity="0.15"/>
              <path d="M10 6v4l3 2" stroke="var(--cs-purple)" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <div>
              <p class="pending-name">{pendingReservation.productName}</p>
              <p class="pending-dates">
                {pendingReservation.startDate} {String(pendingReservation.startHour).padStart(2,'0')}:00
                → {pendingReservation.endDate} {String(pendingReservation.endHour).padStart(2,'0')}:00
              </p>
            </div>
          </div>
          <button class="pending-close" onclick={() => pendingReservation = null} aria-label="닫기">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1L13 13M13 1L1 13" stroke="var(--cs-text-light)" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      {/if}

      <!-- ── ORDER ITEMS ── -->
      <section class="cs-section">
        <div class="sec-header">
          <span class="sec-title">Order items</span>
          <div class="sec-icon">
            <svg viewBox="0 0 16 16" fill="none" class="sec-icon-svg">
              <path d="M14.4996 0C15.3281 1.64973e-05 15.9996 0.671583 15.9996 1.5V11.5C15.9992 12.328 15.3278 13 14.4996 13C13.6717 12.9998 13.0001 12.3279 12.9996 11.5V5.12109L10.5602 7.56055L2.5602 15.5596C1.97438 16.1449 1.02473 16.1451 0.439102 15.5596C-0.146507 14.9739 -0.146228 14.0243 0.439102 13.4385L10.8776 3H4.49965C3.67171 2.99979 3.00014 2.32788 2.99965 1.5C2.99965 0.671704 3.6714 0.000212116 4.49965 0H14.4996Z" fill="#100B32"/>
            </svg>
          </div>
        </div>

        <!-- Card 1: Simple -->
        {#if !c1Deleted}
          <div class="order-card">
            <div class="order-card-inner">
              <!-- Check & Delete -->
              <div class="card-top-row">
                <button class="checkbox-btn" onclick={() => c1Checked = !c1Checked} aria-label="선택">
                  <svg viewBox="0 0 20 20" fill="none" class="checkbox-svg">
                    {#if c1Checked}
                      <rect fill="#3B2F8A" height="18" rx="4" width="18" x="1" y="1"/>
                      <path d="M5 10L8.5 13.5L15 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    {:else}
                      <rect fill="white" height="18" rx="4" width="18" x="1" y="1"/>
                      <rect height="18" rx="4" stroke="#AAAAAA" stroke-width="2" width="18" x="1" y="1"/>
                    {/if}
                  </svg>
                </button>
                <button class="delete-btn" onclick={() => c1Deleted = true} aria-label="삭제">
                  <svg width="14" height="14" viewBox="0 0 17 17" fill="none">
                    <path d="M15.5 1.5L8.5 8.5M8.5 8.5L1.5 15.5M8.5 8.5L15.5 15.5M8.5 8.5L1.5 1.5" stroke="#AAAAAA" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"/>
                  </svg>
                </button>
              </div>

              <!-- Product Row -->
              <div class="product-row">
                <div class="product-img">
                  <img src="https://picsum.photos/seed/{p1?.slug ?? 'cam'}/150/150" alt={p1?.name ?? 'Sony FX6'} width="150" height="150"/>
                </div>
                <div class="product-meta">
                  <p class="product-name">{p1?.name ?? 'Sony FX6'}</p>
                  <p class="product-price">day {p1Rate.toLocaleString()} 원 &nbsp;|&nbsp; 12H {Math.round(p1Rate * 0.6).toLocaleString()} 원</p>
                  <div class="product-badges">
                    <div class="badge-mem">
                      <svg viewBox="0 0 40 40" fill="none" class="badge-svg">
                        <path d="M20 0L23.9714 3.03625L28.9008 1.98062L31.1277 6.39613L36.0388 7.5302L36.08 12.4504L40 15.5496L37.8475 20L40 24.4504L36.08 27.5496L36.0388 32.4698L31.1277 33.6039L28.9008 38.0194L23.9714 36.9637L20 40L16.0286 36.9637L11.0992 38.0194L8.87228 33.6039L3.96124 32.4698L3.91998 27.5496L0 24.4504L2.15253 20L0 15.5496L3.91998 12.4504L3.96124 7.5302L8.87228 6.39613L11.0992 1.98062L16.0286 3.03625L20 0Z" fill="#FF3535"/>
                        <path d="M23.0742 19.2136C23.0742 20.9516 21.6979 22.3606 20.0001 22.3606C18.3022 22.3606 16.9259 20.9516 16.9259 19.2136C16.9259 17.4755 18.3022 16.0665 20.0001 16.0665C21.6979 16.0665 23.0742 17.4755 23.0742 19.2136Z" fill="white"/>
                      </svg>
                    </div>
                    <div class="badge-deal">
                      <svg viewBox="0 0 40 40" fill="none" class="badge-svg">
                        <path d="M20 0L23.9714 3.03625L28.9008 1.98062L31.1277 6.39613L36.0388 7.5302L36.08 12.4504L40 15.5496L37.8475 20L40 24.4504L36.08 27.5496L36.0388 32.4698L31.1277 33.6039L28.9008 38.0194L23.9714 36.9637L20 40L16.0286 36.9637L11.0992 38.0194L8.87228 33.6039L3.96124 32.4698L3.91998 27.5496L0 24.4504L2.15253 20L0 15.5496L3.91998 12.4504L3.96124 7.5302L8.87228 6.39613L11.0992 1.98062L16.0286 3.03625L20 0Z" fill="#553FE0"/>
                        <path d="M25 14L22 20L25 26H15L18 20L15 14H25Z" fill="white"/>
                      </svg>
                    </div>
                  </div>
                </div>
                <div class="qty-wrap">
                  <span class="qty-label">수량</span>
                  <div class="qty-ctrl">
                    <button class="qty-arrow" onclick={() => c1Qty = Math.max(1, c1Qty - 1)}>
                      <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M7 1L1 7L7 13" stroke="#444444" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
                    </button>
                    <div class="qty-num">{c1Qty}</div>
                    <button class="qty-arrow" onclick={() => c1Qty = c1Qty + 1}>
                      <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M1 1L7 7L1 13" stroke="#444444" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Accordions -->
              <div class="accordions">
                <!-- 대여 방법 -->
                <div class="acc-item">
                  <button class="acc-head" onclick={() => c1Acc = toggleAcc(c1Acc, 'rental')}>
                    <span class="acc-label">대여 방법</span>
                    <div class="acc-head-right">
                      <span class="acc-value">{optionLabel(c1Opts.rentalDelivery, c1Opts.rentalVisit, c1Opts.rentalService)}</span>
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" style="transition:transform 0.3s;transform:{c1Acc.rental ? 'rotate(180deg)' : 'none'}">
                        <path d="M1 1L6 7L11 1" stroke="#444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </div>
                  </button>
                  {#if c1Acc.rental}
                    <div transition:slide={{ duration: 300 }} class="acc-body">
                      {@render RentalForm({ type: 'rental', calId: 'c1-rental', selectedDate: c1RentalDate, onDateChange: c1HandleRentalDate, timeId: 'c1-rental-t', selectedTime: c1RentalTime, onTimeChange: c1HandleRentalTime, delivery: c1Opts.rentalDelivery, visitLoc: c1Opts.rentalVisit, service: c1Opts.rentalService, form: c1RentalForm, copyToReturn: c1Opts.copyToReturn, onDeliveryChange: c1HandleDelivery, onVisitChange: c1HandleVisit, onServiceChange: c1HandleService, onFormChange: c1HandleRentalForm, onCopyChange: c1HandleCopy })}
                    </div>
                  {/if}
                </div>
                <!-- 반납 방법 -->
                <div class="acc-item">
                  <button class="acc-head" onclick={() => c1Acc = toggleAcc(c1Acc, 'return_')}>
                    <span class="acc-label">반납 방법</span>
                    <div class="acc-head-right">
                      <span class="acc-value">{optionLabel(c1Opts.returnDelivery, c1Opts.returnVisit, c1Opts.returnService)}</span>
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" style="transition:transform 0.3s;transform:{c1Acc.return_ ? 'rotate(180deg)' : 'none'}">
                        <path d="M1 1L6 7L11 1" stroke="#444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </div>
                  </button>
                  {#if c1Acc.return_}
                    <div transition:slide={{ duration: 300 }} class="acc-body">
                      {@render RentalForm({ type: 'return', calId: 'c1-return', selectedDate: c1ReturnDate, onDateChange: (d) => c1ReturnDate = d, timeId: 'c1-return-t', selectedTime: c1ReturnTime, onTimeChange: (t) => c1ReturnTime = t, delivery: c1Opts.returnDelivery, visitLoc: c1Opts.returnVisit, service: c1Opts.returnService, form: c1ReturnForm, onDeliveryChange: (v) => c1Opts = { ...c1Opts, returnDelivery: v }, onVisitChange: (v) => c1Opts = { ...c1Opts, returnVisit: v }, onServiceChange: (v) => c1Opts = { ...c1Opts, returnService: v }, onFormChange: (f) => c1ReturnForm = f })}
                    </div>
                  {/if}
                </div>
                <!-- 약정 요금 -->
                <div class="acc-item">
                  <button class="acc-head" onclick={() => c1Acc = toggleAcc(c1Acc, 'fee')}>
                    <span class="acc-label">약정 요금</span>
                    <div class="acc-head-right">
                      <span class="acc-value">153,000 원</span>
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" style="transition:transform 0.3s;transform:{c1Acc.fee ? 'rotate(180deg)' : 'none'}">
                        <path d="M1 1L6 7L11 1" stroke="#444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </div>
                  </button>
                  {#if c1Acc.fee}
                    <div transition:slide={{ duration: 300 }} class="acc-body">
                      {@render FeeContent({ couponWelcome: c1Opts.couponWelcome, couponMembership: c1Opts.couponMembership, onCouponWelcome: () => c1Opts = { ...c1Opts, couponWelcome: !c1Opts.couponWelcome }, onCouponMembership: () => c1Opts = { ...c1Opts, couponMembership: !c1Opts.couponMembership } })}
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          </div>
        {/if}

        <!-- Card 2: Complex with sub-items -->
        {#if !c2Deleted}
          <div class="order-card">
            <div class="order-card-inner">
              <!-- Check & Delete -->
              <div class="card-top-row">
                <button class="checkbox-btn" onclick={() => c2Checked = !c2Checked} aria-label="선택">
                  <svg viewBox="0 0 20 20" fill="none" class="checkbox-svg">
                    {#if c2Checked}
                      <rect fill="#3B2F8A" height="18" rx="4" width="18" x="1" y="1"/>
                      <path d="M5 10L8.5 13.5L15 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    {:else}
                      <rect fill="white" height="18" rx="4" width="18" x="1" y="1"/>
                      <rect height="18" rx="4" stroke="#AAAAAA" stroke-width="2" width="18" x="1" y="1"/>
                    {/if}
                  </svg>
                </button>
                <button class="delete-btn" onclick={() => c2Deleted = true} aria-label="삭제">
                  <svg width="14" height="14" viewBox="0 0 17 17" fill="none">
                    <path d="M15.5 1.5L8.5 8.5M8.5 8.5L1.5 15.5M8.5 8.5L15.5 15.5M8.5 8.5L1.5 1.5" stroke="#AAAAAA" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"/>
                  </svg>
                </button>
              </div>

              <!-- Main product -->
              <div class="product-row">
                <div class="product-img">
                  <img src="https://picsum.photos/seed/{p2?.slug ?? 'gimbal'}/150/150" alt={p2?.name ?? 'DJI RS4 Pro'} width="150" height="150"/>
                </div>
                <div class="product-meta">
                  <p class="product-name">{p2?.name ?? 'DJI RS4 Pro'}</p>
                  <p class="product-price">day {p2Rate.toLocaleString()} 원 &nbsp;|&nbsp; 12H {Math.round(p2Rate * 0.6).toLocaleString()} 원</p>
                  <div class="product-badges">
                    <div class="badge-mem">
                      <svg viewBox="0 0 40 40" fill="none" class="badge-svg">
                        <path d="M20 0L23.9714 3.03625L28.9008 1.98062L31.1277 6.39613L36.0388 7.5302L36.08 12.4504L40 15.5496L37.8475 20L40 24.4504L36.08 27.5496L36.0388 32.4698L31.1277 33.6039L28.9008 38.0194L23.9714 36.9637L20 40L16.0286 36.9637L11.0992 38.0194L8.87228 33.6039L3.96124 32.4698L3.91998 27.5496L0 24.4504L2.15253 20L0 15.5496L3.91998 12.4504L3.96124 7.5302L8.87228 6.39613L11.0992 1.98062L16.0286 3.03625L20 0Z" fill="#FF3535"/>
                        <path d="M23.0742 19.2136C23.0742 20.9516 21.6979 22.3606 20.0001 22.3606C18.3022 22.3606 16.9259 20.9516 16.9259 19.2136C16.9259 17.4755 18.3022 16.0665 20.0001 16.0665C21.6979 16.0665 23.0742 17.4755 23.0742 19.2136Z" fill="white"/>
                      </svg>
                    </div>
                    <div class="badge-deal">
                      <svg viewBox="0 0 40 40" fill="none" class="badge-svg">
                        <path d="M20 0L23.9714 3.03625L28.9008 1.98062L31.1277 6.39613L36.0388 7.5302L36.08 12.4504L40 15.5496L37.8475 20L40 24.4504L36.08 27.5496L36.0388 32.4698L31.1277 33.6039L28.9008 38.0194L23.9714 36.9637L20 40L16.0286 36.9637L11.0992 38.0194L8.87228 33.6039L3.96124 32.4698L3.91998 27.5496L0 24.4504L2.15253 20L0 15.5496L3.91998 12.4504L3.96124 7.5302L8.87228 6.39613L11.0992 1.98062L16.0286 3.03625L20 0Z" fill="#553FE0"/>
                        <path d="M25 14L22 20L25 26H15L18 20L15 14H25Z" fill="white"/>
                      </svg>
                    </div>
                  </div>
                </div>
                <div class="qty-wrap">
                  <span class="qty-label">수량</span>
                  <div class="qty-ctrl">
                    <button class="qty-arrow" onclick={() => c2Qtys = c2Qtys.map((q, i) => i === 0 ? Math.max(1, q - 1) : q)}>
                      <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M7 1L1 7L7 13" stroke="#444444" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
                    </button>
                    <div class="qty-num">{c2Qtys[0]}</div>
                    <button class="qty-arrow" onclick={() => c2Qtys = c2Qtys.map((q, i) => i === 0 ? q + 1 : q)}>
                      <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M1 1L7 7L1 13" stroke="#444444" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Sub items -->
              {#each subItems as sub, i (sub.id)}
                <div class="sub-row">
                  <div class="sub-arrow">
                    <svg width="82" height="25" viewBox="0 0 82 25" fill="none">
                      <path d="M30.004 1.5C30.004 1.5 29.993 5.60062 30.0074 12.8098C30.0217 20.0189 35.5 23.5 40 23.5C44.5 23.5 52 23.5 52 23.5" stroke="#AAAAAA" stroke-linecap="round" stroke-width="3"/>
                    </svg>
                  </div>
                  <div class="sub-content">
                    <div class="product-row">
                      <div class="product-img sub-img">
                        <img src="https://picsum.photos/seed/{sub.slug}/150/150" alt={sub.name} width="150" height="150"/>
                      </div>
                      <div class="product-meta">
                        <p class="product-name">{sub.name}</p>
                        <p class="product-price">day {sub.daily_rate.toLocaleString()} 원 &nbsp;|&nbsp; 12H {Math.round(sub.daily_rate * 0.6).toLocaleString()} 원</p>
                        <div class="product-badges">
                          <div class="badge-mem">
                            <svg viewBox="0 0 40 40" fill="none" class="badge-svg">
                              <path d="M20 0L23.9714 3.03625L28.9008 1.98062L31.1277 6.39613L36.0388 7.5302L36.08 12.4504L40 15.5496L37.8475 20L40 24.4504L36.08 27.5496L36.0388 32.4698L31.1277 33.6039L28.9008 38.0194L23.9714 36.9637L20 40L16.0286 36.9637L11.0992 38.0194L8.87228 33.6039L3.96124 32.4698L3.91998 27.5496L0 24.4504L2.15253 20L0 15.5496L3.91998 12.4504L3.96124 7.5302L8.87228 6.39613L11.0992 1.98062L16.0286 3.03625L20 0Z" fill="#FF3535"/>
                              <path d="M23.0742 19.2136C23.0742 20.9516 21.6979 22.3606 20.0001 22.3606C18.3022 22.3606 16.9259 20.9516 16.9259 19.2136C16.9259 17.4755 18.3022 16.0665 20.0001 16.0665C21.6979 16.0665 23.0742 17.4755 23.0742 19.2136Z" fill="white"/>
                            </svg>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="qty-wrap">
                      <span class="qty-label">수량</span>
                      <div class="qty-ctrl">
                        <button class="qty-arrow" onclick={() => { const idx = i + 1; c2Qtys = c2Qtys.map((q, j) => j === idx ? Math.max(1, q - 1) : q); }}>
                          <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M7 1L1 7L7 13" stroke="#444444" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
                        </button>
                        <div class="qty-num">{c2Qtys[i + 1]}</div>
                        <button class="qty-arrow" onclick={() => { const idx = i + 1; c2Qtys = c2Qtys.map((q, j) => j === idx ? q + 1 : q); }}>
                          <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M1 1L7 7L1 13" stroke="#444444" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              {/each}

              <!-- Accordions -->
              <div class="accordions">
                <div class="acc-item">
                  <button class="acc-head" onclick={() => c2Acc = toggleAcc(c2Acc, 'rental')}>
                    <span class="acc-label">대여 방법</span>
                    <div class="acc-head-right">
                      <span class="acc-value">{optionLabel(c2Opts.rentalDelivery, c2Opts.rentalVisit, c2Opts.rentalService)}</span>
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" style="transition:transform 0.3s;transform:{c2Acc.rental ? 'rotate(180deg)' : 'none'}">
                        <path d="M1 1L6 7L11 1" stroke="#444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </div>
                  </button>
                  {#if c2Acc.rental}
                    <div transition:slide={{ duration: 300 }} class="acc-body">
                      {@render RentalForm({ type: 'rental', calId: 'c2-rental', selectedDate: c2RentalDate, onDateChange: c2HandleRentalDate, timeId: 'c2-rental-t', selectedTime: c2RentalTime, onTimeChange: c2HandleRentalTime, delivery: c2Opts.rentalDelivery, visitLoc: c2Opts.rentalVisit, service: c2Opts.rentalService, form: c2RentalForm, copyToReturn: c2Opts.copyToReturn, onDeliveryChange: c2HandleDelivery, onVisitChange: c2HandleVisit, onServiceChange: c2HandleService, onFormChange: c2HandleRentalForm, onCopyChange: c2HandleCopy })}
                    </div>
                  {/if}
                </div>
                <div class="acc-item">
                  <button class="acc-head" onclick={() => c2Acc = toggleAcc(c2Acc, 'return_')}>
                    <span class="acc-label">반납 방법</span>
                    <div class="acc-head-right">
                      <span class="acc-value">{optionLabel(c2Opts.returnDelivery, c2Opts.returnVisit, c2Opts.returnService)}</span>
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" style="transition:transform 0.3s;transform:{c2Acc.return_ ? 'rotate(180deg)' : 'none'}">
                        <path d="M1 1L6 7L11 1" stroke="#444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </div>
                  </button>
                  {#if c2Acc.return_}
                    <div transition:slide={{ duration: 300 }} class="acc-body">
                      {@render RentalForm({ type: 'return', calId: 'c2-return', selectedDate: c2ReturnDate, onDateChange: (d) => c2ReturnDate = d, timeId: 'c2-return-t', selectedTime: c2ReturnTime, onTimeChange: (t) => c2ReturnTime = t, delivery: c2Opts.returnDelivery, visitLoc: c2Opts.returnVisit, service: c2Opts.returnService, form: c2ReturnForm, onDeliveryChange: (v) => c2Opts = { ...c2Opts, returnDelivery: v }, onVisitChange: (v) => c2Opts = { ...c2Opts, returnVisit: v }, onServiceChange: (v) => c2Opts = { ...c2Opts, returnService: v }, onFormChange: (f) => c2ReturnForm = f })}
                    </div>
                  {/if}
                </div>
                <div class="acc-item">
                  <button class="acc-head" onclick={() => c2Acc = toggleAcc(c2Acc, 'fee')}>
                    <span class="acc-label">약정 요금</span>
                    <div class="acc-head-right">
                      <span class="acc-value">154,000 원</span>
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" style="transition:transform 0.3s;transform:{c2Acc.fee ? 'rotate(180deg)' : 'none'}">
                        <path d="M1 1L6 7L11 1" stroke="#444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </div>
                  </button>
                  {#if c2Acc.fee}
                    <div transition:slide={{ duration: 300 }} class="acc-body">
                      {@render FeeContent({ couponWelcome: c2Opts.couponWelcome, couponMembership: c2Opts.couponMembership, onCouponWelcome: () => c2Opts = { ...c2Opts, couponWelcome: !c2Opts.couponWelcome }, onCouponMembership: () => c2Opts = { ...c2Opts, couponMembership: !c2Opts.couponMembership } })}
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          </div>
        {/if}

        {#if c1Deleted && c2Deleted}
          <div class="order-card empty-card">
            <p class="empty-text">장바구니가 비어 있습니다.</p>
          </div>
        {/if}
      </section>

      <!-- ── RENTAL OPTIONS ── -->
      <section class="cs-section">
        <div class="sec-header">
          <span class="sec-title">Rental Options</span>
        </div>
        <div class="order-card">
          <div class="order-card-inner no-gap-top">
            <!-- 대여 방법 -->
            <div class="acc-item">
              <button class="acc-head" onclick={() => rpRentalOpen = !rpRentalOpen}>
                <span class="acc-label">대여 방법</span>
                <div class="acc-head-right">
                  <span class="acc-value">{optionLabel(rpRentalDelivery, rpRentalVisit, rpRentalService)}</span>
                  <svg width="12" height="8" viewBox="0 0 12 8" fill="none" style="transition:transform 0.3s;transform:{rpRentalOpen ? 'rotate(180deg)' : 'none'}">
                    <path d="M1 1L6 7L11 1" stroke="#444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </button>
              {#if rpRentalOpen}
                <div transition:slide={{ duration: 300 }} class="acc-body">
                  {@render RentalForm({ type: 'rental', calId: 'rp-rental', selectedDate: rpRentalDateVal, onDateChange: rpHandleRentalDate, timeId: 'rp-rental-t', selectedTime: rpRentalTimeVal2, onTimeChange: rpHandleRentalTime, delivery: rpRentalDelivery, visitLoc: rpRentalVisit, service: rpRentalService, form: rpRentalForm, copyToReturn: rpCopyToReturn, onDeliveryChange: rpHandleDelivery, onVisitChange: rpHandleVisit, onServiceChange: rpHandleService, onFormChange: rpHandleRentalForm, onCopyChange: rpHandleCopy })}
                </div>
              {/if}
            </div>
            <!-- 반납 방법 -->
            <div class="acc-item">
              <button class="acc-head" onclick={() => rpReturnOpen = !rpReturnOpen}>
                <span class="acc-label">반납 방법</span>
                <div class="acc-head-right">
                  <span class="acc-value">{optionLabel(rpReturnDelivery, rpReturnVisit, rpReturnService)}</span>
                  <svg width="12" height="8" viewBox="0 0 12 8" fill="none" style="transition:transform 0.3s;transform:{rpReturnOpen ? 'rotate(180deg)' : 'none'}">
                    <path d="M1 1L6 7L11 1" stroke="#444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </button>
              {#if rpReturnOpen}
                <div transition:slide={{ duration: 300 }} class="acc-body">
                  {@render RentalForm({ type: 'return', calId: 'rp-return', selectedDate: rpReturnDateVal, onDateChange: (d) => rpReturnDateVal = d, timeId: 'rp-return-t', selectedTime: rpReturnTimeVal2, onTimeChange: (t) => rpReturnTimeVal2 = t, delivery: rpReturnDelivery, visitLoc: rpReturnVisit, service: rpReturnService, form: rpReturnForm, onDeliveryChange: (v) => rpReturnDelivery = v, onVisitChange: (v) => rpReturnVisit = v, onServiceChange: (v) => rpReturnService = v, onFormChange: (f) => rpReturnForm = f })}
                </div>
              {/if}
            </div>
          </div>
        </div>
      </section>

      <!-- ── ORDER TOTAL ── -->
      <section class="cs-section">
        <div class="sec-header">
          <span class="sec-title">Order Total</span>
        </div>

        <!-- Coupon + Fee detail box -->
        <div class="total-details-box">
          <!-- 쿠폰 섹션 (white bg) -->
          <div class="total-white-section">
            <span class="section-sub-label">사용 가능한 쿠폰</span>
            <div class="coupon-list">
              {@render CouponRow({ label: '월컴쿠폰 10%', days: 52, checked: otCouponWelcome, onToggle: () => otCouponWelcome = !otCouponWelcome })}
              {@render CouponRow({ label: '멤버십 할인 쿠폰 10%', days: 250, checked: otCouponMembership, onToggle: () => otCouponMembership = !otCouponMembership })}
            </div>
            <p class="hint-text">선택 불가능한 쿠폰은 본 결제 시 중복 적용이 불가능합니다.</p>
          </div>

          <!-- 약정요금 섹션 (gray bg) -->
          <div class="total-gray-section">
            <span class="section-sub-label">약정 요금</span>
            <div class="price-detail-list">
              <div class="price-period-row">
                <span class="price-period-label">총 대여일정</span>
                <div class="price-period-values">
                  <div class="period-val"><span class="period-num">3</span><span class="period-unit">일</span></div>
                  <div class="period-val"><span class="period-num">12:00</span><span class="period-unit">시간</span></div>
                </div>
              </div>
              {@render PriceRow({ label: '대여요금', value: '150,000' })}
              {@render PriceRow({ label: '할인요금', value: '-110,000' })}
              {@render PriceRow({ label: '배송요금', value: '7,000' })}
              {@render PriceRow({ label: '부가세(10%)', value: '7,000' })}
              <div class="price-divider"></div>
              {@render PriceRow({ label: '합계요금', value: '154,000', large: true })}
              <div class="points-row">
                <span class="points-label">적립포인트</span>
                <div class="points-value"><span class="points-num">7,000</span><span class="points-unit">p</span></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Total dark box -->
        <div class="total-dark-box">
          <div class="total-dark-row">
            <span class="total-label">총 약정요금</span>
            <div class="total-amount">
              <span class="total-num">254,000</span>
              <span class="total-unit">원</span>
            </div>
          </div>
          <div class="total-dark-row total-points-row">
            <span class="total-points-label">적립포인트</span>
            <div class="total-points-val">
              <span>7,000</span>
              <span>p</span>
            </div>
          </div>
        </div>
      </section>

      <div style="height: 100px;"></div>
    </div>
  </main>

  <!-- ═══════════════════════ FOOTER ═══════════════════════ -->
  <footer class="cart-footer" class:footer-visible={footerVisible}>
    <div class="footer-inner">
      <label class="footer-terms">
        <button class="checkbox-btn" onclick={() => agreed = !agreed} aria-label="동의">
          <svg viewBox="0 0 20 20" fill="none" class="checkbox-svg">
            {#if agreed}
              <rect fill="#3B2F8A" height="18" rx="4" width="18" x="1" y="1"/>
              <path d="M5 10L8.5 13.5L15 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            {:else}
              <rect fill="white" height="18" rx="4" width="18" x="1" y="1"/>
              <rect height="18" rx="4" stroke="#AAAAAA" stroke-width="2" width="18" x="1" y="1"/>
            {/if}
          </svg>
        </button>
        <span class="footer-terms-text">등록한 대여 조건에 모두 동의합니다.</span>
      </label>
      <button
        class="footer-cta"
        class:footer-cta-active={agreed}
        class:footer-cta-disabled={!agreed}
        disabled={!agreed}
        onclick={() => { if (agreed) alert('결제 시뮬레이션 — 실제 TossPayments 연동은 M3에서 구현됩니다.'); }}
      >
        가입하고 지금 예약하세요
      </button>
    </div>
  </footer>

</div>

<!-- ═══════════════════════ SNIPPET COMPONENTS ═══════════════════════ -->

{#snippet RentalForm(props: {
  type: 'rental' | 'return';
  delivery: DeliveryType;
  visitLoc: VisitLocation;
  service: DeliveryService;
  form: FormState;
  calId: string;
  selectedDate: string;
  onDateChange: (d: string) => void;
  timeId: string;
  selectedTime: string;
  onTimeChange: (t: string) => void;
  copyToReturn?: boolean;
  onDeliveryChange: (v: DeliveryType) => void;
  onVisitChange: (v: VisitLocation) => void;
  onServiceChange: (v: DeliveryService) => void;
  onFormChange: (f: FormState) => void;
  onCopyChange?: (v: boolean) => void;
})}
  {@const methodLabel = props.type === 'rental' ? '수령 방식' : '반납 방식'}
  {@const dateLabel = props.type === 'rental' ? '수령일' : '반납일'}
  {@const timeLabel = props.type === 'rental' ? '수령시간' : '반납시간'}
  {@const addrLabel = props.type === 'rental' ? '배송지 정보' : '반납위치 지정정보'}
  {@const addrNote = props.type === 'rental'
    ? '배송 선택 시 대여 시작일은 상품 예약승인 및 배송일을 고려해 최소 2일 전까지 가능합니다.'
    : '반납 방식이 대여 방식과 다를 경우 배송료 추가가 발생할 수 있습니다.'}
  {@const isCalOpen = openCalId === props.calId}
  {@const isTimeOpen = openTimeId === props.timeId}

  <div class="rental-form">
    <!-- 수령/반납 방식 -->
    <div class="form-section">
      <span class="form-section-label">{methodLabel}</span>
      <div class="form-section-body">
        <!-- Location selector -->
        <div class="location-selector">
          <div class="location-group">
            <span class="location-cat-label">방문</span>
            <div class="location-options">
              {#each [{ v: 'main' as VisitLocation, l: '본점' }, { v: 'branch1' as VisitLocation, l: '지점1' }, { v: 'branch2' as VisitLocation, l: '지점2' }] as opt}
                <button
                  class="loc-badge"
                  class:loc-badge-active={props.delivery === 'visit' && props.visitLoc === opt.v}
                  onclick={() => { props.onDeliveryChange('visit'); props.onVisitChange(opt.v); }}
                >{opt.l}</button>
              {/each}
            </div>
          </div>
          <div class="location-group">
            <span class="location-cat-label">배송</span>
            <div class="location-options">
              {#each [{ v: 'crazy' as DeliveryService, l: '크레이지샷배송' }, { v: 'quick' as DeliveryService, l: '당일 퀵배송' }] as opt}
                <button
                  class="loc-badge"
                  class:loc-badge-active={props.delivery === 'delivery' && props.service === opt.v}
                  onclick={() => { props.onDeliveryChange('delivery'); props.onServiceChange(opt.v); }}
                >{opt.l}</button>
              {/each}
            </div>
          </div>
        </div>
        <!-- Date/Time buttons + Calendar -->
        <div class="datetime-wrap">
          <div class="datetime-btns">
            <button class="datetime-btn datetime-btn-dark" onclick={() => openCal(props.calId, props.selectedDate)}>
              <div class="datetime-btn-left">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <rect fill="rgba(255,255,255,0.3)" height="20" rx="5.5" width="22" y="2"/>
                  <path d="M3 3C3 1.27 4.27 0 5.97 0C7.47 0 8.69 1.27 8.69 2.84C8.69 4.42 7.47 5.69 5.97 5.69H5.72C4.22 5.69 3 4.42 3 2.84" fill="rgba(255,255,255,0.6)"/>
                  <path d="M13.28 2.84C13.28 1.27 14.5 0 16 0C17.75 0 18.97 1.27 18.97 2.84C18.97 4.42 17.75 5.69 16.25 5.69H16C14.5 5.69 13.28 4.42 13.28 2.84" fill="rgba(255,255,255,0.6)"/>
                  <path d="M3 7C3 5.89 3.72 5 4.6 5L17.4 5C18.28 5 19 5.9 19 7C19 8.1 18.28 9 17.4 9L4.6 9C3.72 9 3 8.1 3 7Z" fill="white"/>
                  <path d="M3 13C3 11.9 3.76 11 4.7 11L9.3 11C10.24 11 11 11.9 11 13V15C11 16.1 10.24 17 9.3 17H4.7C3.76 17 3 16.1 3 15V13Z" fill="white"/>
                </svg>
                <span class="datetime-btn-label">{props.selectedDate ? displayDate(props.selectedDate) : dateLabel}</span>
              </div>
              <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M1 1L7 7L1 13" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
            </button>
            <button class="datetime-btn datetime-btn-mid" onclick={() => openTime(props.timeId)}>
              <div class="datetime-btn-left">
                <svg width="23" height="23" viewBox="0 0 22.5 22.5" fill="none">
                  <path d="M11.25 0C13.69 0 15.95 0.78 17.8 2.1L19 0.5C19.41 -0.05 20.2 -0.16 20.75 0.25C21.3 0.66 21.41 1.45 21 2L19.66 3.78C21.43 5.77 22.5 8.38 22.5 11.25C22.5 17.46 17.46 22.5 11.25 22.5C5.04 22.5 0 17.46 0 11.25C0 8.33 1.11 5.68 2.93 3.68L1.55 2.06C1.1 1.54 1.16 0.75 1.69 0.3C2.21 -0.15 3 -0.09 3.45 0.44L4.81 2.03C6.63 0.75 8.85 0 11.25 0ZM11 5C10.31 5 9.75 5.56 9.75 6.25V12.17C9.75 12.64 10.01 13.07 10.42 13.28L14.42 15.36C15.04 15.68 15.79 15.44 16.11 14.83C16.43 14.21 16.19 13.46 15.58 13.14L12.25 11.41V6.25C12.25 5.56 11.69 5 11 5Z" fill="rgba(255,255,255,0.8)"/>
                </svg>
                <span class="datetime-btn-label">{props.selectedTime || timeLabel}</span>
              </div>
              <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M1 1L7 7L1 13" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
            </button>
          </div>

          <!-- 달력 레이어 -->
          {#if isCalOpen}
            <div class="cal-layer" transition:slide={{ duration: 200 }}>
              <CalendarGrid
                value={props.selectedDate}
                onselect={(iso) => { props.onDateChange(iso); openCalId = null; }}
              />
            </div>
          {/if}

          <!-- 시간 선택 레이어 -->
          {#if isTimeOpen}
            <div class="time-layer" transition:slide={{ duration: 200 }}>
              <div class="time-grid">
                {#each Array.from({length: 24}, (_, i) => i) as h}
                  {@const t = fmtTime(h)}
                  {@const isSel = props.selectedTime === t}
                  <button
                    class="time-cell"
                    class:time-cell-sel={isSel}
                    onclick={() => { props.onTimeChange(t); openTimeId = null; }}
                  >{t}</button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
        <p class="form-note">{addrNote}</p>
      </div>
    </div>

    <!-- 고객 정보 -->
    <div class="form-section">
      <div class="form-section-header">
        <span class="form-section-label">고객 정보</span>
        <label class="form-check-label">
          <button class="checkbox-btn small" onclick={() => props.onFormChange({ ...props.form, memberCheck: !props.form.memberCheck })} aria-label="회원정보 반영">
            <svg viewBox="0 0 20 20" fill="none" class="checkbox-svg">
              {#if props.form.memberCheck}
                <rect fill="#3B2F8A" height="18" rx="4" width="18" x="1" y="1"/>
                <path d="M5 10L8.5 13.5L15 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              {:else}
                <rect fill="white" height="18" rx="4" width="18" x="1" y="1"/>
                <rect height="18" rx="4" stroke="#AAAAAA" stroke-width="2" width="18" x="1" y="1"/>
              {/if}
            </svg>
          </button>
          <span>회원정보 반영</span>
        </label>
      </div>
      <div class="form-fields">
        <input class="f-input" placeholder="이름 입력" value={props.form.name} oninput={(e) => props.onFormChange({ ...props.form, name: readInputValue(e) })}/>
        <input class="f-input" placeholder="전자메일주소 입력" value={props.form.email} oninput={(e) => props.onFormChange({ ...props.form, email: readInputValue(e) })}/>
        <div class="f-row">
          <input class="f-input f-grow" placeholder="휴대번호를 '-' 없이 입력" value={props.form.phone} oninput={(e) => props.onFormChange({ ...props.form, phone: readInputValue(e) })}/>
          <button class="f-action-btn">인증실행</button>
        </div>
        <div class="f-row">
          <input class="f-input f-grow" placeholder="6자리 인증번호를 입력" value={props.form.authCode} oninput={(e) => props.onFormChange({ ...props.form, authCode: readInputValue(e) })}/>
          <button class="f-action-btn">인증확인</button>
        </div>
      </div>
    </div>

    <!-- 배송지/반납위치 정보 -->
    <div class="form-section">
      <div class="form-section-header">
        <span class="form-section-label">{addrLabel}</span>
        {#if props.type === 'rental'}
          <label class="form-check-label">
            <button class="checkbox-btn small" onclick={() => props.onFormChange({ ...props.form, memberCheck2: !props.form.memberCheck2 })} aria-label="회원정보 반영">
              <svg viewBox="0 0 20 20" fill="none" class="checkbox-svg">
                {#if props.form.memberCheck2}
                  <rect fill="#3B2F8A" height="18" rx="4" width="18" x="1" y="1"/>
                  <path d="M5 10L8.5 13.5L15 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                {:else}
                  <rect fill="white" height="18" rx="4" width="18" x="1" y="1"/>
                  <rect height="18" rx="4" stroke="#AAAAAA" stroke-width="2" width="18" x="1" y="1"/>
                {/if}
              </svg>
            </button>
            <span>회원정보 반영</span>
          </label>
        {/if}
      </div>
      <div class="form-fields">
        <input class="f-input" placeholder="기본주소 입력" value={props.form.addr} oninput={(e) => props.onFormChange({ ...props.form, addr: readInputValue(e) })}/>
        <input class="f-input" placeholder="상세주소 입력" value={props.form.addrDetail} oninput={(e) => props.onFormChange({ ...props.form, addrDetail: readInputValue(e) })}/>
      </div>
      <p class="form-note-sm">-직접 {props.type === 'rental' ? '수령' : '반납'}(공항, 고객센터) 선택 시 자동 노출 스크립트</p>
      {#if props.visitLoc !== 'none'}
        <div class="visit-info">
          <p>인천공항 제1터미널 도착홀 D, 5번 게이트 대면 수령</p>
          <p>가양동 사옥 1층 고객센터 방문 수령</p>
        </div>
      {/if}
    </div>

    <!-- 요청 사항 -->
    <div class="form-section">
      <span class="form-section-label">요청 사항</span>
      <input class="f-input" placeholder="알아보기 쉽게 입력 필수" value={props.form.notes} oninput={(e) => props.onFormChange({ ...props.form, notes: readInputValue(e) })}/>
      <p class="form-note-sm">공동현관 출입번호 / 경비실 호출 / 세대호출 / 자유 출입가능 등</p>
    </div>

    <!-- Copy to return checkbox -->
    {#if props.type === 'rental' && props.onCopyChange}
      <label class="copy-label">
        <button class="checkbox-btn small" onclick={() => props.onCopyChange?.(!props.copyToReturn)} aria-label="반납에 동일 적용">
          <svg viewBox="0 0 20 20" fill="none" class="checkbox-svg">
            {#if props.copyToReturn}
              <rect fill="#3B2F8A" height="18" rx="4" width="18" x="1" y="1"/>
              <path d="M5 10L8.5 13.5L15 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            {:else}
              <rect fill="white" height="18" rx="4" width="18" x="1" y="1"/>
              <rect height="18" rx="4" stroke="#AAAAAA" stroke-width="2" width="18" x="1" y="1"/>
            {/if}
          </svg>
        </button>
        <span>선택된 수령 옵션을 상품 반납 방법에 동일하게 적용합니다.</span>
      </label>
    {/if}
  </div>
{/snippet}

{#snippet FeeContent(props: {
  couponWelcome: boolean;
  couponMembership: boolean;
  onCouponWelcome: () => void;
  onCouponMembership: () => void;
})}
  <div class="fee-content">
    <div class="form-section">
      <span class="form-section-label">사용 가능한 쿠폰</span>
      <div class="coupon-list">
        {@render CouponRow({ label: '월컴쿠폰 10%', days: 52, checked: props.couponWelcome, onToggle: props.onCouponWelcome })}
        {@render CouponRow({ label: '멤버십 할인 쿠폰 10%', days: 250, checked: props.couponMembership, onToggle: props.onCouponMembership })}
      </div>
      <p class="hint-text">선택 불가능한 쿠폰은 본 결제 시 중복 적용이 불가능합니다.</p>
    </div>
    <div class="form-section">
      <span class="form-section-label">약정 요금</span>
      <div class="price-detail-list">
        <div class="price-period-row">
          <span class="price-period-label">총 대여일정</span>
          <div class="price-period-values">
            <div class="period-val"><span class="period-num">3</span><span class="period-unit">일</span></div>
            <div class="period-val"><span class="period-num">12:00</span><span class="period-unit">시간</span></div>
          </div>
        </div>
        {@render PriceRow({ label: '기본요금', value: '150,000' })}
        {@render PriceRow({ label: '할인요금', value: '-110,000' })}
        {@render PriceRow({ label: '배송요금', value: '7,000' })}
        {@render PriceRow({ label: '부가세(10%)', value: '7,000' })}
        <div class="price-divider"></div>
        {@render PriceRow({ label: '합계요금', value: '154,000', large: true })}
        <div class="points-row">
          <span class="points-label">적립포인트</span>
          <div class="points-value"><span class="points-num">7,000</span><span class="points-unit">p</span></div>
        </div>
      </div>
    </div>
  </div>
{/snippet}

{#snippet CouponRow(props: { label: string; days: number; checked: boolean; onToggle: () => void })}
  <div class="coupon-row">
    <label class="coupon-row-left">
      <button class="checkbox-btn small" onclick={props.onToggle} aria-label={props.label}>
        <svg viewBox="0 0 20 20" fill="none" class="checkbox-svg">
          {#if props.checked}
            <rect fill="#3B2F8A" height="18" rx="4" width="18" x="1" y="1"/>
            <path d="M5 10L8.5 13.5L15 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          {:else}
            <rect fill="white" height="18" rx="4" width="18" x="1" y="1"/>
            <rect height="18" rx="4" stroke="#AAAAAA" stroke-width="2" width="18" x="1" y="1"/>
          {/if}
        </svg>
      </button>
      <span class="coupon-label">{props.label}</span>
    </label>
    <div class="coupon-expiry">
      <span class="coupon-days">{props.days}</span>
      <span>일 뒤 소멸</span>
    </div>
  </div>
{/snippet}

{#snippet PriceRow(props: { label: string; value: string; large?: boolean })}
  <div class="price-row">
    <span class="price-row-label" class:price-row-large={props.large}>{props.label}</span>
    <div class="price-row-right">
      <span class="price-row-val" class:price-row-val-large={props.large}>{props.value}</span>
      <span class="price-row-unit">원</span>
    </div>
  </div>
{/snippet}

<style>
  /* ══ Reset & Root ══ */
  :global(body) {
    margin: 0;
    font-family: var(--font-kr);
    background: #ECEBF4;
  }

  .cart-root {
    min-height: 100vh;
    background: #ECEBF4;
    display: flex;
    flex-direction: column;
    font-family: var(--font-kr);
  }

  /* ══ Header ══ */
  .cart-header {
    position: sticky;
    top: 0;
    z-index: 50;
    background: #ECEBF4;
    border-bottom: 1px solid rgba(0,0,0,0.1);
    /* 모바일: SubGnb가 대체 — 헤더 숨김 */
    display: none;
  }
  @media (min-width: 641px) {
    .cart-header { display: block; }
  }
  .cart-header-inner {
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
  .header-pill {
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
    max-width: 460px;
    min-width: 0;
    min-height: 62px;
    flex: 0 1 460px;
    box-sizing: border-box;
    color: var(--cs-text);
    transition: background 0.2s;
  }
  .header-pill:hover { background: rgba(225, 222, 243, 0.85); }
  .header-pill-left {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .header-pill-arrow {
    width: 22px;
    height: 18px;
    flex-shrink: 0;
  }
  .header-back-text {
    font: var(--text-pc-title-16);
    color: var(--cs-text);
    white-space: nowrap;
  }
  .header-cart-text {
    font: var(--text-pc-menu-en-20);
    color: var(--cs-text);
    flex-shrink: 0;
    white-space: nowrap;
  }

  /* Category icons */
  .cat-icons {
    display: flex;
    flex-wrap: nowrap;
    gap: 30px;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
  }
  .cat-icon-btn {
    background: #E1DEF3;
    border: none;
    outline: none;
    cursor: pointer;
    border-radius: 30px;
    width: 60px;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.2s;
  }
  .cat-icon-btn:hover { background: #D0CCEB; }
  .cat-icon-svg { width: 28px; height: 28px; }

  /* ══ Main ══ */
  .cart-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 50px 0;
  }
  .cart-content {
    width: 100%;
    max-width: 1240px;
    padding: 0 20px;
    display: flex;
    flex-direction: column;
    gap: 50px;
    box-sizing: border-box;
  }

  /* ══ Section ══ */
  .cs-section {
    display: flex;
    flex-direction: column;
    gap: 30px;
  }
  .sec-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 40px;
  }
  .sec-title {
    font-family: var(--font-en-display);
    font-size: 20px;
    color: #100B32;
    line-height: 1.6;
  }
  .sec-icon { width: 16px; height: 16px; position: relative; }
  .sec-icon-svg { width: 16px; height: 16px; }

  /* ══ Order Card ══ */
  .order-card {
    background: white;
    border-radius: 50px;
    width: 100%;
    box-sizing: border-box;
  }
  .order-card-inner {
    display: flex;
    flex-direction: column;
    gap: 50px;
    padding: 40px;
  }
  .no-gap-top { gap: 10px; padding: 20px 40px; }
  .empty-card { padding: 40px; text-align: center; }
  .empty-text { color: #AAAAAA; font-size: 16px; font-weight: 500; }

  /* Card top row */
  .card-top-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .checkbox-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
  }
  .checkbox-btn.small { }
  .checkbox-svg { width: 20px; height: 20px; display: block; }
  .delete-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 8px;
    opacity: 1;
    transition: opacity 0.2s;
  }
  .delete-btn:hover { opacity: 0.6; }

  /* ══ Product Row ══ */
  .product-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 20px;
  }
  .product-img {
    width: 150px;
    height: 150px;
    border-radius: 30px;
    overflow: hidden;
    background: #F2F2F8;
    flex-shrink: 0;
  }
  .product-img img { width: 100%; height: 100%; object-fit: cover; }
  .sub-img { width: 100px; height: 100px; border-radius: 20px; }
  .product-meta {
    flex: 1;
    min-width: 0;
    padding: 0 20px;
  }
  .product-name {
    font-size: 18px;
    font-weight: 700;
    color: #100B32;
    line-height: 1.6;
    letter-spacing: -0.3px;
    margin: 0 0 5px;
    word-break: break-word;
  }
  .product-price {
    font-size: 14px;
    font-weight: 700;
    color: #444444;
    line-height: 2;
    letter-spacing: -0.5px;
    margin: 0 0 5px;
  }
  .product-badges { display: flex; gap: 15px; align-items: center; }
  .badge-mem, .badge-deal { width: 40px; height: 40px; flex-shrink: 0; }
  .badge-svg { width: 40px; height: 40px; }

  /* ══ Quantity Control ══ */
  .qty-wrap {
    display: flex;
    align-items: center;
    gap: 15px;
    flex-shrink: 0;
  }
  .qty-label {
    font-size: 16px;
    font-weight: 700;
    color: #444444;
    letter-spacing: -0.5px;
  }
  .qty-ctrl {
    display: flex;
    align-items: center;
    gap: 30px;
    padding: 0 10px;
  }
  .qty-arrow {
    background: none;
    border: none;
    cursor: pointer;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  }
  .qty-arrow:hover { background: #F0F0F0; }
  .qty-num {
    background: #ECEBF4;
    border-radius: 10px;
    padding: 10px 20px;
    font-size: 14px;
    font-weight: 700;
    color: #100B32;
    letter-spacing: -0.5px;
    line-height: 2;
    min-width: 44px;
    text-align: center;
  }

  /* ══ Sub items ══ */
  .sub-row {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    align-items: center;
  }
  .sub-arrow {
    width: 82px;
    height: 25px;
    flex-shrink: 0;
    display: flex;
    align-items: flex-end;
  }
  .sub-content {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 20px;
  }

  /* ══ Accordions ══ */
  .accordions {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .acc-item { display: flex; flex-direction: column; }
  .acc-head {
    background: #ECEBF4;
    border: none;
    cursor: pointer;
    border-radius: 30px;
    padding: 30px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    text-align: left;
    transition: background 0.2s;
  }
  .acc-head:hover { background: #D9D6F0; }
  .acc-label {
    font-size: 18px;
    font-weight: 500;
    color: #444444;
    letter-spacing: -0.3px;
    line-height: 1.6;
  }
  .acc-head-right {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .acc-value {
    font-size: 18px;
    font-weight: 700;
    color: #444;
  }
  .acc-body {
    padding-top: 30px;
    overflow: hidden;
  }
  .rotate-180 { transform: rotate(180deg); }

  /* ══ Rental Form ══ */
  .rental-form {
    display: flex;
    flex-direction: column;
    gap: 40px;
    padding-bottom: 30px;
  }
  .form-section {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .form-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .form-section-label {
    font-size: 16px;
    font-weight: 500;
    color: #444444;
    letter-spacing: -0.5px;
    line-height: 1.6;
  }
  .form-section-body {
    display: flex;
    flex-direction: column;
    gap: 30px;
  }
  .form-check-label {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 700;
    color: #444;
    white-space: nowrap;
  }
  .form-fields { display: flex; flex-direction: column; gap: 15px; }
  .form-note {
    font-size: 14px;
    font-weight: 700;
    color: #AAAAAA;
    letter-spacing: -0.5px;
    line-height: 2;
    margin: 0;
  }
  .form-note-sm {
    font-size: 12px;
    font-weight: 500;
    color: #AAAAAA;
    letter-spacing: -0.5px;
    line-height: 1.6;
    margin: 0;
  }
  .visit-info {
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-red);
    line-height: 2;
  }
  .visit-info p { margin: 0; }
  .copy-label {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 700;
    color: #444;
    justify-content: center;
  }

  /* Location selector */
  .location-selector {
    background: #F6F6F6;
    border-radius: 20px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    padding: 15px 20px;
    gap: 100px;
  }
  .location-group {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .location-cat-label {
    font-size: 14px;
    font-weight: 500;
    color: #AAAAAA;
    letter-spacing: -0.5px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .location-options {
    display: flex;
    gap: 30px;
    align-items: center;
    flex-wrap: wrap;
  }
  .loc-badge {
    background: none;
    border: none;
    cursor: pointer;
    padding: 5px 20px;
    border-radius: 30px;
    font-size: 14px;
    font-weight: 700;
    color: #444;
    transition: all 0.2s;
  }
  .loc-badge:hover { background: #F0F0F0; }
  .loc-badge-active {
    background: #666;
    color: white;
  }

  /* Datetime buttons */
  .datetime-btns {
    display: flex;
    width: 100%;
    border-radius: 20px;
    overflow: hidden;
  }
  .datetime-btn {
    flex: 1;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 15px 20px;
    transition: filter 0.2s;
  }
  .datetime-btn:hover { filter: brightness(1.1); }
  .datetime-btn-dark { background: #444; }
  .datetime-btn-mid { background: #666; }
  .datetime-btn-left {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .datetime-btn-label {
    color: white;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.5px;
    white-space: nowrap;
  }

  /* ══ Calendar + Time Layer ══ */
  .datetime-wrap { position: relative; display: flex; flex-direction: column; gap: 0; }
  .cal-layer {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    z-index: 100;
    background: white;
    border-radius: 20px;
    padding: 20px;
    box-shadow: 0 8px 30px rgba(16,11,50,0.15);
    width: 50%;
    box-sizing: border-box;
  }

  /* ══ Time Layer ══ */
  .time-layer {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 100;
    background: white;
    border-radius: 20px;
    padding: 16px;
    box-shadow: 0 8px 30px rgba(16,11,50,0.15);
    width: 50%;
    box-sizing: border-box;
  }
  .time-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 4px;
  }
  .time-cell {
    background: #f6f6f6;
    border: none;
    border-radius: 10px;
    padding: 8px 4px;
    font-family: var(--font-kr);
    font-size: 12px;
    font-weight: 500;
    color: #444;
    cursor: pointer;
    transition: background 0.15s;
    text-align: center;
  }
  .time-cell:hover { background: #ECEBF4; }
  .time-cell-sel { background: #3B2F8A !important; color: white !important; font-weight: 700; }

  /* Form inputs */
  .f-input {
    background: #F6F6F6;
    border: none;
    border-radius: 15px;
    padding: 10px 20px;
    width: 100%;
    font-size: 14px;
    font-weight: 500;
    color: #444;
    font-family: var(--font-kr);
    outline: none;
    box-sizing: border-box;
    min-height: 44px;
  }
  .f-input::placeholder { color: #B6B6B6; }
  .f-input:focus { outline: 2px solid #3B2F8A; outline-offset: -2px; }
  .f-row { display: flex; gap: 16px; align-items: center; }
  .f-grow { flex: 1; min-width: 0; width: auto; }
  .f-action-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    font-weight: 700;
    color: #444;
    white-space: nowrap;
    padding: 0;
    transition: color 0.2s;
  }
  .f-action-btn:hover { color: #3B2F8A; }

  /* ══ Fee Content ══ */
  .fee-content {
    display: flex;
    flex-direction: column;
    gap: 40px;
    padding-bottom: 30px;
  }

  /* ══ Coupon Row ══ */
  .coupon-list { display: flex; flex-direction: column; gap: 15px; }
  .coupon-row {
    background: #F6F6F6;
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 15px 20px;
    min-height: 52px;
  }
  .coupon-row-left { display: flex; align-items: center; gap: 20px; cursor: pointer; }
  .coupon-label { font-size: 14px; font-weight: 700; color: #444; }
  .coupon-expiry { font-size: 14px; font-weight: 700; color: #444; display: flex; align-items: center; gap: 10px; }
  .coupon-days { color: var(--cs-red-badge); }
  .hint-text { font-size: 12px; font-weight: 500; color: #AAAAAA; letter-spacing: -0.5px; line-height: 1.6; margin: 0; }

  /* ══ Price Detail ══ */
  .price-detail-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0 20px;
  }
  .price-period-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .price-period-label {
    font-size: 16px;
    font-weight: 700;
    color: #AAAAAA;
    letter-spacing: -0.5px;
    line-height: 1.6;
  }
  .price-period-values {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .period-val { display: flex; align-items: center; gap: 10px; }
  .period-num { font-size: 18px; font-weight: 700; color: #444; letter-spacing: -0.3px; }
  .period-unit { font-size: 16px; font-weight: 700; color: #AAAAAA; letter-spacing: -0.5px; }
  .price-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .price-row-label {
    font-size: 14px;
    font-weight: 700;
    color: #AAAAAA;
    letter-spacing: -0.5px;
    line-height: 2;
  }
  .price-row-large { font-size: 16px; }
  .price-row-right { display: flex; align-items: center; gap: 15px; }
  .price-row-val { font-size: 16px; font-weight: 700; color: #444; line-height: 1.6; }
  .price-row-val-large { }
  .price-row-unit { font-size: 14px; font-weight: 700; color: #AAAAAA; line-height: 2; }
  .price-divider { background: #AAAAAA; height: 1px; width: 100%; margin: 5px 0; }
  .points-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #553FE0;
  }
  .points-label { font-size: 14px; font-weight: 700; line-height: 2; }
  .points-value { display: flex; align-items: center; gap: 15px; padding: 0 20px; }
  .points-num { font-size: 16px; font-weight: 700; line-height: 1.6; }
  .points-unit { font-size: 14px; font-weight: 700; line-height: 2; }

  /* ══ Order Total ══ */
  .total-details-box {
    border-radius: 30px;
    overflow: hidden;
    width: 100%;
  }
  .total-white-section {
    background: white;
    padding: 40px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .total-gray-section {
    background: #F6F6F6;
    padding: 40px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .section-sub-label {
    font-size: 16px;
    font-weight: 500;
    color: #444;
    letter-spacing: -0.5px;
  }

  .total-dark-box {
    background: #100B32;
    border-radius: 30px;
    padding: 20px 40px;
    display: flex;
    flex-direction: column;
    gap: 15px;
    margin-top: 0;
  }
  .total-dark-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .total-label {
    font-size: 16px;
    font-weight: 500;
    color: white;
    letter-spacing: -0.5px;
    line-height: 1.6;
    font-family: var(--font-kr);
  }
  .total-amount {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
  }
  .total-num { font-size: 18px; color: white; letter-spacing: -0.3px; }
  .total-unit { font-size: 14px; color: white; line-height: 2; }
  .total-points-row { }
  .total-points-label { font-size: 14px; font-weight: 700; color: #C1BBEC; line-height: 2; }
  .total-points-val {
    display: flex;
    align-items: center;
    gap: 15px;
    padding: 0 20px;
    font-size: 16px;
    font-weight: 700;
    color: #C1BBEC;
    line-height: 1.6;
  }

  /* ══ Footer ══ */
  .cart-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 50;
    background: white;
    border-top: 1px solid rgba(0,0,0,0.06);
    box-shadow: 0 -4px 20px rgba(16,11,50,0.1);
    padding-bottom: env(safe-area-inset-bottom);
    transform: translateY(100%);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .cart-footer.footer-visible {
    transform: translateY(0);
  }
  .footer-inner {
    max-width: 1240px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 50px;
    padding: 20px 40px;
  }
  .footer-terms {
    display: flex;
    align-items: center;
    gap: 15px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .footer-terms-text {
    font-size: 16px;
    font-weight: 700;
    color: #444;
    line-height: 2;
    white-space: nowrap;
  }
  .footer-cta {
    flex: 1;
    height: 60px;
    border: none;
    border-radius: 30px;
    font-size: 16px;
    font-weight: 700;
    font-family: var(--font-kr);
    cursor: pointer;
    transition: all 0.3s;
    color: white;
  }
  .footer-cta-active {
    background: #3B2F8A;
    box-shadow: 0 4px 15px rgba(59,47,138,0.3);
  }
  .footer-cta-active:hover { background: #4A3BA8; }
  .footer-cta-active:active { transform: scale(0.98); }
  .footer-cta-disabled {
    background: #CCCCCC;
    cursor: not-allowed;
  }

  /* ══ Responsive ══ */
  @media (max-width: 1024px) {
    .cart-content { padding: 0 var(--layout-tab-pad); }
    .cart-header-inner {
      padding: 16px var(--layout-tab-pad);
      gap: 20px;
      justify-content: space-between;
    }
    .header-pill {
      flex: 1 1 auto;
      max-width: min(460px, 100%);
      padding: 14px 28px;
      min-height: 56px;
    }
    .footer-inner { padding: 20px 32px; gap: 30px; }
    .cat-icons { gap: 16px; padding: 0 10px; }
    .cat-icon-btn { width: 50px; height: 50px; }
  }

  @media (max-width: 640px) {
    .cart-header-inner {
      padding: 12px var(--layout-mob-pad);
      gap: 12px;
      flex-direction: column;
      align-items: stretch;
    }
    .header-pill {
      flex: 1 1 auto;
      max-width: none;
      width: 100%;
      padding: 12px var(--layout-mob-pad);
      min-height: 48px;
      border-radius: var(--radius-lg);
    }
    .header-pill-left { gap: 6px; }
    .header-pill-arrow { width: 18px; height: 15px; }
    .header-back-text { font: var(--text-m-body-16B); }
    .header-cart-text { font: var(--text-m-title-18B); font-family: var(--font-en-display); font-weight: 400; }
    .cat-icons { display: none; }
    .cart-main { padding: 30px 0; }
    .cart-content { padding: 0 12px; gap: 30px; }
    .sec-header { padding: 16px 20px; }
    .sec-title { font-size: 18px; }
    .order-card { border-radius: 40px; }
    .order-card-inner { padding: 20px; gap: 30px; }
    .no-gap-top { padding: 16px 20px; gap: 8px; }
    .product-img { width: 80px; height: 80px; border-radius: 16px; }
    .sub-img { width: 70px; height: 70px; border-radius: 14px; }
    .product-name { font-size: 14px; }
    .product-price { font-size: 12px; }
    .badge-mem, .badge-deal, .badge-svg { width: 30px; height: 30px; }
    .qty-label { font-size: 14px; }
    .qty-ctrl { gap: 16px; }
    .qty-num { padding: 6px 14px; font-size: 13px; }
    .sub-arrow { width: 40px; }
    .sub-arrow svg { width: 40px; }
    .acc-head { padding: 16px 20px; border-radius: 20px; }
    .acc-label { font-size: 15px; }
    .acc-value { font-size: 14px; }
    .acc-body { padding-top: 20px; }
    .location-selector { gap: 20px; padding: 12px 16px; flex-direction: column; align-items: flex-start; }
    .location-options { gap: 16px; }
    .datetime-btn { padding: 12px 16px; }
    .datetime-btn-label { font-size: 14px; }
    .total-white-section, .total-gray-section { padding: 20px; }
    .total-dark-box { padding: 16px 20px; border-radius: 20px; }
    .total-label { font-size: 14px; }
    .total-num { font-size: 18px; }
    .cart-footer { padding-bottom: max(14px, env(safe-area-inset-bottom)); }
    .footer-inner { padding: 16px 16px 14px; gap: 16px; flex-direction: column; align-items: stretch; }
    .footer-terms { flex-shrink: 1; }
    .footer-terms-text { font-size: 13px; white-space: normal; }
    .footer-cta { flex: none; width: 100%; height: 56px; font-size: 15px; }
    .price-detail-list { padding: 0 10px; }
    /* 모바일 letter-spacing (m-body_com_16b: -0.5px, m-titie_com_18b: -0.3px) */
    .product-name { letter-spacing: -0.3px; }
    .form-section-label { letter-spacing: -0.5px; }
    .form-check-label { letter-spacing: -0.5px; }
    .coupon-label { letter-spacing: -0.5px; }
    .coupon-expiry { letter-spacing: -0.5px; }
    .price-row-label { letter-spacing: -0.5px; }
    .price-row-val { letter-spacing: -0.5px; }
    .location-cat-label { letter-spacing: -0.5px; }
    .f-input { letter-spacing: -0.5px; }
    .copy-label { letter-spacing: -0.5px; }
    .acc-label { letter-spacing: -0.3px; }
    .header-pill { padding: 12px 20px; border-radius: 18px; min-height: 44px; }
  }

  /* ── Pending reservation banner */
  .pending-banner {
    background: var(--cs-white);
    border: 1.5px solid var(--cs-purple);
    border-radius: var(--radius-lg);
    padding: 14px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }
  .pending-banner-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .pending-name {
    font: var(--text-m-script-14B);
    color: var(--cs-text);
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pending-dates {
    font: var(--text-m-script-12);
    color: var(--cs-text-dark);
    margin: 3px 0 0;
  }
  .pending-close {
    min-width: 44px;
    min-height: 44px;
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
</style>
