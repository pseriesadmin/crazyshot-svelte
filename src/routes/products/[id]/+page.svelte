<script lang="ts">
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/services/supabase';
  import ProductHero from '$lib/components/products/ProductHero.svelte';
  import CalendarTimePicker from '$lib/components/products/CalendarTimePicker.svelte';
  import type { Tables } from '$lib/types/database';
  import FloatingBar from '$lib/components/common/FloatingBar.svelte';

  /** 실서비스 DB products 행 (가격·status 등 런타임 컬럼 포함) */
  type ProductRow = Tables<'products'> & {
    base_price_daily: number;
    base_price_weekly?: number;
    base_price_monthly?: number;
    status?: string;
    image_url?: string;
  };

  interface Props {
    data: {
      product: ProductRow;
      productId: string;
    };
  }
  let { data }: Props = $props();

  const product = $derived(data.product);

  // ── Product info state
  let qty = $state(1);
  let optionItems = $state([
    { label: '[옵션] 대포렌즈 100mm F2.8 L IS USM', price: 150000, qty: 0 },
    { label: '[옵션] 대포렌즈 100mm F2.8 L IS USM', price: 150000, qty: 0 },
    { label: '[옵션] 대포렌즈 100mm F2.8 L IS USM', price: 150000, qty: 0 },
  ]);
  let optionsOpen = $state(true);

  // ── Toast
  let toastMsg = $state('');
  let toastVisible = $state(false);
  function showToast(msg: string) {
    toastMsg = msg;
    toastVisible = true;
    setTimeout(() => { toastVisible = false; }, 2800);
  }

  // ── Quick Inquiry
  let qaText = $state('');
  let qaSubmitting = $state(false);
  async function handleQaSubmit() {
    if (!qaText.trim() || qaSubmitting) return;
    qaSubmitting = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).rpc('submit_product_inquiry', {
        p_product_id: data.productId,
        p_content: qaText.trim(),
      });
    } catch {
      // RPC 미구현 시 무시 — 토스트는 항상 노출
    } finally {
      qaText = '';
      qaSubmitting = false;
      showToast('문의가 등록되었습니다.');
    }
  }

  // ── Calendar/time (passed to CalendarTimePicker via bindable)
  let startDate = $state('');
  let endDate = $state('');
  let startHour = $state(12);
  let endHour = $state(13);

  // ── Tab
  let activeTab = $state<'spec' | 'info' | 'review' | 'qa'>('info');

  function scrollToSection(key: 'info' | 'review' | 'qa'): void {
    const selector =
      key === 'info' ? '.shotlog-section'
      : key === 'review' ? '.review-section'
      : '.qa-section';
    document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleTabClick(key: 'spec' | 'info' | 'review' | 'qa') {
    activeTab = key;
    if (key === 'info' || key === 'review' || key === 'qa') {
      scrollToSection(key);
    }
  }

  // ── Mock data (외부 퍼블리싱 코드 텍스트 기준)
  const MOCK_SHOTLOGS = [
    { title: '[사용기] SONY FE 24-105  가볍게 고퀄 영상을 바로 만들어주다', meta: '1시간 전·by 홍기동', image: '/sample/shotlog-1.png' },
    { title: '액션캠의 왕좌를 되찾으러 돌아왔다.', meta: '2시간 전·by 유말자', image: '/sample/shotlog-2.png' },
    { title: '휴대용 디자인으로 이동 중에도 미디어 카드에 쉽게 접근 가능', meta: '3시간 전·by 홍기동', image: '/sample/shotlog-3.png' },
    { title: 'onn. 52인치 삼각대, 컴팩트 카메라, 스마트폰 및 GoPro 액션 카메라용 스', meta: '4시간 전·by 유말자', image: '/sample/shotlog-4.png' },
    { title: 'K-트레일로그를 남기는 멋진 일은 우리들에게 즐거움의 폭증이다!!', meta: '5시간 전·by 홍기동', image: '/sample/shotlog-1.png' },
  ];

  const MOCK_REVIEWS = [
    { title: '가성비 최고예요!', bydate: 'Tawny /  Apr 26, 2025', body: '정말 훌륭한 제품입니다. 함께 제공된 매뉴얼은 조금 모호하지만, 사용하는 데 큰 어려움은 없었습니다. 설치와 사용을 돕는 온라인 영상도 많이 있습니다.' },
    { title: '잘 작동해요, 설명서는 혼란스럽습니다.', bydate: 'Tawny /  Apr 26, 2025', body: '안정화 기능이 정말 좋아서 영상이 매끄럽게 나오네요. 설명서를 이해하기 어렵다 보니 제가 제대로 사용하고 있는 건지는 확신이 없지만, 필요한 용도로는 잘 쓰이고 있습니다.' },
    { title: 'light weight!', bydate: 'Samantha /  Jul 17, 2025', body: 'Its a great product! Was fairly easy to setup and use! It works great and lasts a long while before having to recharge it!' },
  ];

  function fmt(n: number): string {
    return n.toLocaleString('ko-KR');
  }

  function handleReserve(e: { startDate: string; endDate: string; startHour: number; endHour: number }) {
    if (!product) return;
    sessionStorage.setItem('pendingReservation', JSON.stringify({
      productId: product.id,
      productName: product.name,
      imageUrl: (product as unknown as Record<string, unknown>).image_url ?? '',
      startDate: e.startDate,
      endDate: e.endDate,
      startHour: e.startHour,
      endHour: e.endHour,
      qty,
      dailyPrice: product.base_price_daily,
      halfDayPrice: Math.round(product.base_price_daily * 0.7),
    }));
    goto('/checkout');
  }

  function handleCalChange(e: { startDate: string; endDate: string; startHour: number; endHour: number }) {
    startDate = e.startDate;
    endDate = e.endDate;
    startHour = e.startHour;
    endHour = e.endHour;
  }

  let optionsTotal = $derived(
    optionItems.reduce((sum, opt) => sum + opt.price * opt.qty, 0)
  );

  const SAMPLE_IMAGES = [
    '/sample/product-main.png',
    '/sample/product-main.png',
    '/sample/product-main.png',
    '/sample/product-main.png',
  ];
  let imageUrls = $derived(
    (product.image_urls?.length ? product.image_urls : SAMPLE_IMAGES)
  );

</script>

<!-- ① Hero (PC sub-GNB는 ProductHero 내부에서 hero overlay 배치) -->
<ProductHero imageUrls={imageUrls} category={product.category ?? 'camera'} productName={product.name} />

<!-- ② ProductInfo Section -->
<section class="info-section">
  <div class="info-inner">

    <!-- Left column -->
    <div class="info-left">

      <!-- TitleInfo card -->
      <div class="title-card">
        <div class="title-block">
          <h1 class="product-name">{product.name}</h1>
          {#if product.description}
            <p class="product-sub">{product.description.split('\n')[0]}</p>
          {/if}
        </div>

        <!-- Price -->
        <div class="price-row">
          <div class="price-unit">
            <span class="price-period-label">Day</span>
            <span class="price-amount">{fmt(product.base_price_daily)}</span>
            <span class="price-currency">원</span>
          </div>
          <span class="price-sep">/</span>
          <div class="price-unit">
            <span class="price-period-label">12H</span>
            <span class="price-amount">{fmt(Math.round(product.base_price_daily * 0.7))}</span>
            <span class="price-currency">원</span>
          </div>
        </div>

        <!-- Delivery info -->
        <div class="delivery-block">
          <p class="delivery-text">1일 대여 기준 크레이지샷배송 가능 · 12시간 대여 기준 퀵배송 가능</p>
          <div class="delivery-icons">
            <!-- 빨간 이벤트 배지 -->
            <div class="delivery-icon" aria-label="이벤트 배지">
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
                <path d="M20 0L23.9714 3.03625L28.9008 1.98062L31.1277 6.39613L36.0388 7.5302L36.08 12.4504L40 15.5496L37.8475 20L40 24.4504L36.08 27.5496L36.0388 32.4698L31.1277 33.6039L28.9008 38.0194L23.9714 36.9637L20 40L16.0286 36.9637L11.0992 38.0194L8.87228 33.6039L3.96124 32.4698L3.91998 27.5496L0 24.4504L2.15253 20L0 15.5496L3.91998 12.4504L3.96124 7.5302L8.87228 6.39613L11.0992 1.98062L16.0286 3.03625L20 0Z" fill="#FF3535"/>
                <path d="M19.4403 10.1182C19.7518 9.98059 20.1022 9.96301 20.4234 10.0661L20.5596 10.1182L20.6714 10.1749C20.9194 10.3175 21.0707 10.522 21.1556 10.6483C21.2556 10.7971 21.358 10.9873 21.4518 11.1599L22.4739 13.0405L24.7589 12.3318C24.9706 12.266 25.1867 12.1981 25.3667 12.1588C25.5101 12.1274 25.7621 12.0806 26.0409 12.1458L26.1617 12.1811L26.2998 12.2378C26.6159 12.3887 26.881 12.6629 27.0076 13.0284C27.1369 13.4022 27.0471 13.7447 27.0003 13.9036C26.9478 14.0816 26.863 14.2909 26.7859 14.483L26.1054 16.1776L28.4231 17.1523C28.8982 17.3522 29.1251 17.9085 28.93 18.3949C28.7469 18.851 28.2582 19.0838 27.8062 18.9465L27.7162 18.9139L25.155 17.8369C25.0597 17.7968 24.9401 17.7466 24.8389 17.6946C24.73 17.6387 24.572 17.5463 24.4291 17.3858C24.2415 17.1751 24.1177 16.9046 24.0884 16.6083C24.0658 16.3784 24.1114 16.1876 24.1493 16.0642C24.1837 15.9522 24.2334 15.8299 24.2692 15.7405L24.8489 14.2942L22.8801 14.9053C22.789 14.9335 22.6752 14.9696 22.5721 14.9936C22.4581 15.0202 22.2988 15.0477 22.1123 15.029C21.8672 15.0044 21.6273 14.914 21.4218 14.7602C21.263 14.6411 21.1601 14.5046 21.093 14.4012C21.0336 14.3099 20.9765 14.2023 20.934 14.124L20 12.4062L19.0669 14.124C19.0243 14.2024 18.9664 14.3098 18.907 14.4012C18.8398 14.5045 18.7378 14.6412 18.579 14.7602C18.3735 14.9143 18.133 15.0044 17.8876 15.029C17.7013 15.0476 17.5428 15.0202 17.4288 14.9936C17.3255 14.9696 17.2111 14.9336 17.1199 14.9053L15.1502 14.2933L15.7308 15.7405C15.7666 15.8299 15.8163 15.9522 15.8507 16.0642C15.8886 16.1876 15.9342 16.3784 15.9115 16.6083C15.8823 16.9046 15.7584 17.1751 15.5708 17.3858C15.4282 17.546 15.2708 17.6386 15.162 17.6946C15.0609 17.7465 14.9412 17.7968 14.8458 17.8369L12.2837 18.9139C11.8085 19.1138 11.2652 18.8814 11.0699 18.3949C10.8749 17.9085 11.1018 17.3522 11.5769 17.1523L13.8937 16.1776L13.2141 14.483C13.137 14.2909 13.0522 14.0816 12.9997 13.9036C12.9529 13.7447 12.8631 13.4022 12.9924 13.0284L13.0551 12.8777C13.2194 12.539 13.5096 12.2962 13.8383 12.1811L13.96 12.1458C14.2388 12.0808 14.4909 12.1275 14.6341 12.1588C14.8141 12.1981 15.0295 12.2661 15.241 12.3318L17.5251 13.0405L18.5481 11.1599C18.6419 10.9873 18.7444 10.7971 18.8443 10.6483C18.9413 10.5041 19.125 10.2576 19.4403 10.1182Z" fill="white"/>
                <path d="M13.3056 26.1913C13.3058 24.5807 14.5747 23.2961 16.0976 22.6589L16.1875 22.6264C16.6398 22.4898 17.1282 22.7242 17.3105 23.1807C17.5047 23.6675 17.2773 24.2234 16.8017 24.4223L16.59 24.5172C15.5707 25.0085 15.1664 25.7127 15.1663 26.1913L15.1809 26.3299C15.2487 26.6667 15.5758 27.0817 16.4673 27.4637C17.4273 27.875 18.7383 28.0952 19.9998 28.0952C21.2614 28.0952 22.5731 27.875 23.5331 27.4637C24.5513 27.0273 24.834 26.5479 24.8341 26.1913C24.8341 25.6809 24.3736 24.9141 23.1978 24.4223C22.7223 24.2234 22.4948 23.6675 22.689 23.1807C22.8834 22.6938 23.4263 22.46 23.9019 22.6589C25.4253 23.2961 26.6947 24.5805 26.6948 26.1913C26.6947 27.7629 25.4416 28.7117 24.2517 29.2215C23.0031 29.7565 21.4318 30 19.9998 30C18.5678 30 16.9972 29.7565 15.7487 29.2215C14.5958 28.7276 13.3838 27.8217 13.3093 26.3364L13.3056 26.1913Z" fill="white"/>
                <path d="M23.0742 19.2136C23.0742 20.9516 21.6979 22.3606 20.0001 22.3606C18.3022 22.3606 16.9259 20.9516 16.9259 19.2136C16.9259 17.4755 18.3022 16.0665 20.0001 16.0665C21.6979 16.0665 23.0742 17.4755 23.0742 19.2136Z" fill="white"/>
              </svg>
            </div>
            <!-- 파란 이벤트 배지 -->
            <div class="delivery-icon" aria-label="멤버십 배지">
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
                <path d="M20 0L23.9714 3.03625L28.9008 1.98062L31.1277 6.39613L36.0388 7.5302L36.08 12.4504L40 15.5496L37.8475 20L40 24.4504L36.08 27.5496L36.0388 32.4698L31.1277 33.6039L28.9008 38.0194L23.9714 36.9637L20 40L16.0286 36.9637L11.0992 38.0194L8.87228 33.6039L3.96124 32.4698L3.91998 27.5496L0 24.4504L2.15253 20L0 15.5496L3.91998 12.4504L3.96124 7.5302L8.87228 6.39613L11.0992 1.98062L16.0286 3.03625L20 0Z" fill="#553FE0"/>
                <path d="M19.6856 10.0798C19.9888 9.97331 20.318 9.97348 20.6212 10.0798L20.771 10.1414L20.8851 10.2046C21.1378 10.3634 21.2933 10.592 21.3898 10.7495C21.5066 10.9401 21.6293 11.19 21.7588 11.4512L23.0171 13.989C23.0322 14.0195 23.046 14.0468 23.0584 14.0716C23.0831 14.0633 23.1103 14.0549 23.1404 14.0446L25.887 13.1093C26.1736 13.0116 26.4444 12.9182 26.6671 12.8647C26.8482 12.8213 27.1287 12.7684 27.4282 12.8445L27.5581 12.885L27.7087 12.9533C28.0004 13.1056 28.2318 13.3545 28.3664 13.6575L28.4259 13.8135L28.459 13.946C28.5195 14.2512 28.4579 14.5322 28.4086 14.716C28.348 14.9417 28.2471 15.2158 28.1405 15.5071L26.931 18.8132C26.7674 19.2598 26.2797 19.4867 25.8415 19.3201C25.4033 19.1534 25.1801 18.6561 25.3434 18.2093L26.5529 14.9041C26.5837 14.8199 26.6098 14.7443 26.634 14.6772C26.5712 14.6983 26.5015 14.7216 26.4239 14.748L23.6773 15.6834C23.5518 15.7261 23.4129 15.774 23.2893 15.8056C23.1551 15.84 22.9798 15.8717 22.7772 15.8495C22.5023 15.8194 22.2422 15.7094 22.0276 15.5332C21.8699 15.4037 21.7681 15.2555 21.6967 15.1351C21.6307 15.0238 21.565 14.8889 21.5048 14.7674L20.2465 12.2296C20.2126 12.1613 20.1815 12.1003 20.1538 12.0449C20.1262 12.1003 20.095 12.1613 20.0612 12.2296L18.8029 14.7674C18.7426 14.8889 18.6769 15.0238 18.6109 15.1351C18.5396 15.2555 18.4378 15.4037 18.28 15.5332C18.0654 15.7095 17.8053 15.8194 17.5305 15.8495C17.3278 15.8717 17.1525 15.84 17.0184 15.8056C16.8948 15.774 16.7558 15.7261 16.6304 15.6834L13.8838 14.748C13.8054 14.7213 13.7352 14.6976 13.672 14.6763C13.6963 14.7438 13.7237 14.8194 13.7547 14.9041L14.6482 17.3457C14.6991 17.4848 14.7546 17.636 14.7921 17.7699C14.8325 17.9139 14.8715 18.1033 14.8517 18.3232C14.8249 18.6196 14.7109 18.9021 14.5241 19.132C14.3853 19.3027 14.2259 19.4087 14.0972 19.4812C13.9778 19.5485 13.8333 19.6145 13.7018 19.6752L11.2761 20.7944C11.1894 20.8344 11.1124 20.8702 11.0437 20.9023C11.1125 20.9344 11.1892 20.971 11.2761 21.0111L13.7018 22.1303C13.8333 22.191 13.9778 22.257 14.0972 22.3243C14.1938 22.3787 14.3079 22.4518 14.4174 22.5571L14.5241 22.6743L14.5911 22.7629C14.7173 22.9446 14.8014 23.1528 14.8376 23.3718L14.8517 23.4823L14.8567 23.6408C14.8522 23.7938 14.8224 23.9274 14.7921 24.0355C14.7546 24.1694 14.6991 24.3206 14.6482 24.4598L13.7547 26.9014C13.7239 26.9857 13.6963 27.061 13.672 27.1283C13.7351 27.1071 13.8056 27.0849 13.8838 27.0583L17.4064 25.8581L17.4899 25.8345C17.9089 25.7382 18.3394 25.9789 18.4786 26.403C18.6268 26.8554 18.387 27.3449 17.9433 27.496L14.4207 28.6962C14.134 28.7938 13.8633 28.8873 13.6405 28.9408C13.4336 28.9904 13.0963 29.053 12.7495 28.9205C12.3351 28.762 12.0167 28.4184 11.8817 27.9919C11.7694 27.6369 11.8427 27.2995 11.8991 27.0895C11.9597 26.8637 12.0605 26.5898 12.1671 26.2984L13.0606 23.8559C13.0752 23.816 13.0872 23.7805 13.0987 23.7488C13.07 23.7354 13.0384 23.7206 13.0027 23.7041L10.5779 22.5849C10.2858 22.4501 10.0122 22.3249 9.80521 22.2054C9.61574 22.096 9.31573 21.9031 9.14834 21.5551C8.95057 21.1438 8.95053 20.6616 9.14834 20.2504L9.21701 20.1272C9.38913 19.8556 9.6394 19.6959 9.80521 19.6001C10.0122 19.4806 10.2858 19.3554 10.5779 19.2206L13.0027 18.1014C13.0384 18.0849 13.07 18.07 13.0987 18.0567C13.0872 18.0249 13.0752 17.9894 13.0606 17.9496L12.1671 15.5071C12.0606 15.2158 11.9597 14.9417 11.8991 14.716C11.8427 14.5059 11.7694 14.1685 11.8817 13.8135L11.9413 13.6575C12.0983 13.304 12.3869 13.0236 12.7495 12.885C13.0963 12.7524 13.4336 12.815 13.6405 12.8647C13.8632 12.9182 14.134 13.0117 14.4207 13.1093L17.1673 14.0446C17.197 14.0548 17.2239 14.0633 17.2484 14.0716C17.2608 14.0467 17.2753 14.0197 17.2906 13.989L18.5489 11.4512C18.6783 11.19 18.801 10.9401 18.9178 10.7495C19.0281 10.5695 19.2156 10.2969 19.5367 10.1414L19.6856 10.0798Z" fill="white"/>
                <path d="M20.8933 22.0948C21.6768 21.3308 22.9468 21.331 23.7304 22.0948L25.2906 23.6163L25.3467 23.5626C26.4927 22.4451 27.066 21.8865 27.5579 21.8487C27.9846 21.816 28.4015 21.9845 28.6795 22.3018C29 22.6677 29 23.4579 29 25.0381V27.9131C29 28.6436 29.0005 29.0091 28.8548 29.2881C28.7265 29.5335 28.5216 29.7333 28.2699 29.8584C27.9838 30.0005 27.609 30 26.8599 30H23.9117C22.2912 30 21.4808 30 21.1056 29.6875C20.7802 29.4164 20.6074 29.0099 20.6409 28.5938C20.6797 28.114 21.2525 27.555 22.3985 26.4375L22.4536 26.3828L20.8933 24.8614C20.11 24.0973 20.1098 22.8588 20.8933 22.0948Z" fill="white"/>
              </svg>
            </div>
          </div>
        </div>

        <!-- Quantity control -->
        <div class="qty-row">
          <span class="qty-label">대여수량</span>
          <div class="qty-control">
            <button onclick={() => qty = Math.max(1, qty - 1)} class="qty-btn" aria-label="수량 감소">
              <svg width="14" height="2" viewBox="0 0 14 2" fill="none">
                <path d="M1 1H13" stroke="var(--cs-text-dark)" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
            <div class="qty-val-wrap">
              <input
                type="number"
                bind:value={qty}
                min="1"
                class="qty-input"
                aria-label="수량"
              />
            </div>
            <button onclick={() => qty = qty + 1} class="qty-btn" aria-label="수량 증가">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 7H13M7 1V13" stroke="var(--cs-text-dark)" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Options -->
      <div class="options-section">
        <div
          class="options-header"
          onclick={() => optionsOpen = !optionsOpen}
          role="button"
          tabindex="0"
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') optionsOpen = !optionsOpen; }}
          aria-expanded={optionsOpen}
        >
          <span class="options-title">옵션 상품</span>
          <div class="options-more-btn">
            <span class="options-more-text">더보기</span>
            <svg
              class="options-chevron"
              class:open={optionsOpen}
              width="8" height="14" viewBox="0 0 8 14" fill="none"
            >
              <path d="M1 1L7 7L1 13" stroke="var(--cs-text-dark)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>
        {#if optionsOpen}
        <div class="options-list">
          {#each optionItems as opt}
            <div class="option-item">
              <p class="option-label">{opt.label}</p>
              <div class="option-bottom-row">
                <div class="option-price-wrap">
                  <span class="option-price-num">{fmt(opt.price)}</span>
                  <span class="option-price-unit">원</span>
                </div>
                <div class="qty-control small">
                  <button onclick={() => { opt.qty = Math.max(0, opt.qty - 1); }} class="qty-btn" aria-label="옵션 수량 감소">
                    <svg width="12" height="2" viewBox="0 0 14 2" fill="none">
                      <path d="M1 1H13" stroke="var(--cs-text-dark)" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                  </button>
                  <div class="qty-val-wrap">
                    <input type="number" bind:value={opt.qty} min="0" class="qty-input" aria-label="옵션 수량"/>
                  </div>
                  <button onclick={() => { opt.qty += 1; }} class="qty-btn" aria-label="옵션 수량 증가">
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                      <path d="M1 7H13M7 1V13" stroke="var(--cs-text-dark)" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          {/each}
        </div>
        {/if}
      </div>

      <!-- Mobile: CalendarTimePicker (stacked below options on mobile) -->
      <div class="cal-mobile">
        <CalendarTimePicker
          bind:startDate
          bind:endDate
          bind:startHour
          bind:endHour
          dailyPrice={product.base_price_daily * qty}
          halfDayPrice={Math.round(product.base_price_daily * 0.7 * qty)}
          {optionsTotal}
          mode="product"
          onreserve={handleReserve}
          onchange={handleCalChange}
          chatCallback={() => showToast('준비중입니다.')}
        />
      </div>
    </div>

    <!-- Right column: PC only -->
    <div class="info-right">
      <CalendarTimePicker
        bind:startDate
        bind:endDate
        bind:startHour
        bind:endHour
        dailyPrice={product.base_price_daily * qty}
        halfDayPrice={Math.round(product.base_price_daily * 0.7 * qty)}
        {optionsTotal}
        mode="product"
        onreserve={handleReserve}
        onchange={handleCalChange}
        chatCallback={() => showToast('준비중입니다.')}
      />
    </div>

  </div>
</section>

<!-- ③ Product Detail Tabs -->
<section class="tabs-section">
  <div class="tabs-inner">
    <div class="tab-nav" role="tablist">
      {#each [['spec','사양'],['info','정보'],['review','후기'],['qa','문의']] as [key, label]}
        <button
          role="tab"
          aria-selected={activeTab === key}
          class="tab-btn"
          class:active={activeTab === key}
          onclick={() => handleTabClick(key as typeof activeTab)}
        >
          {label}
        </button>
      {/each}
    </div>

    <div class="tab-content" role="tabpanel">
      {#if activeTab === 'info'}
        <div class="tab-pane">
          <h2 class="tab-heading">About this item</h2>
          <div class="product-desc">{product.description ?? ''}</div>
        </div>
      {:else if activeTab === 'spec'}
        <div class="tab-pane">
          <h2 class="tab-heading">사양</h2>
          <p class="tab-empty">사양 정보가 준비 중입니다.</p>
        </div>
      {:else if activeTab === 'review'}
        <div class="tab-pane">
          <h2 class="tab-heading">후기</h2>
          <p class="tab-empty">등록된 후기가 없습니다.</p>
        </div>
      {:else}
        <div class="tab-pane">
          <h2 class="tab-heading">문의</h2>
          <p class="tab-empty">1:1 문의는 채팅으로 남겨주세요.</p>
        </div>
      {/if}
    </div>
    <!-- PC 그라디언트 구분선 -->
    <div class="gradient-bar" aria-hidden="true"></div>
  </div>
</section>

<!-- ④ Shotlog -->
<section class="shotlog-section">
  <div class="shotlog-inner">
    <div class="shotlog-header">
      <span class="shotlog-title">Shotlog</span>
      <div class="shotlog-icon-wrap" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <rect width="22" height="22" rx="7" fill="var(--cs-lilac)"/>
          <path d="M5.5 9.5C6.32843 9.5 7 10.1716 7 11C7 11.8284 6.32843 12.5 5.5 12.5C4.67157 12.5 4 11.8284 4 11C4 10.1716 4.67157 9.5 5.5 9.5ZM11 9.5C11.8284 9.5 12.5 10.1716 12.5 11C12.5 11.8284 11.8284 12.5 11 12.5C10.1716 12.5 9.5 11.8284 9.5 11C9.5 10.1716 10.1716 9.5 11 9.5ZM16.5 9.5C17.3284 9.5 18 10.1716 18 11C18 11.8284 17.3284 12.5 16.5 12.5C15.6716 12.5 15 11.8284 15 11C15 10.1716 15.6716 9.5 16.5 9.5Z" fill="var(--cs-purple-light)"/>
        </svg>
      </div>
    </div>
    <div class="shotlog-list">
      {#each MOCK_SHOTLOGS as post}
        <div class="shotlog-card">
          <!-- 모바일: 이미지 상단 -->
          <div class="shotlog-img-mobile" aria-hidden="true">
            {#if post.image}
              <img src={post.image} alt="" class="shotlog-img-tag" />
            {/if}
          </div>
          <!-- PC: 좌측 보라 바 -->
          <div class="shotlog-purple-bar" aria-hidden="true"></div>
          <!-- 텍스트 (공통) -->
          <div class="shotlog-writing">
            <p class="shotlog-post-title">{post.title}</p>
            <p class="shotlog-post-meta">{post.meta}</p>
          </div>
          <!-- PC: 우측 이미지 -->
          <div class="shotlog-img-pc" aria-hidden="true">
            {#if post.image}
              <img src={post.image} alt="" class="shotlog-img-tag" />
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>
</section>

<!-- ⑤ Reviews -->
<section class="review-section">
  <div class="review-inner">
    <div class="review-header">
      <span class="review-title">Review</span>
      <span class="review-count">03</span>
    </div>
    <div class="review-list">
      {#each MOCK_REVIEWS as review}
        <article class="review-card">
          <div class="review-top">
            <p class="review-card-title">{review.title}</p>
            <p class="review-meta-text">{review.bydate}</p>
          </div>
          <div class="review-bottom">
            <p class="review-body">{review.body}</p>
          </div>
        </article>
      {/each}
    </div>
    <div class="review-form">
      <input type="text" placeholder="후기 입력..." class="review-input" readonly onclick={() => showToast('로그인 후 등록해주세요.')} />
      <button class="review-send-btn" aria-label="후기 등록" onclick={() => showToast('로그인 후 등록해주세요.')}>
        <svg width="15" height="10" viewBox="0 0 17 12" fill="none">
          <path d="M1 6H16M16 6L11 1M16 6L11 11" stroke="var(--cs-text)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>
</section>

<!-- ⑥ Popular items -->
<section class="popular-section">
  <div class="popular-inner">
    <div class="popular-head">
      <!-- Popular items in this category -->
      <p class="popular-title">많이 본 상품</p>
      <!-- Best selling items that customers love/추후 영문 메뉴명으로 재활용 -->
      <p class="popular-sub">Best selling items that customers love</p>
    </div>
    <div class="popular-scroll">
      {#each Array(5) as _}
        <div class="popular-card">
          <div class="popular-card-img" aria-hidden="true">
            <img src="/sample/product-main.png" alt="" class="popular-card-img-tag" />
          </div>
          <div class="popular-card-info">
            <p class="popular-card-price">Day 35,000 / 12H 25,000</p>
            <p class="popular-card-name">SONY FE 24-105 F4 G OSS</p>
          </div>
        </div>
      {/each}
    </div>
  </div>
</section>

<!-- ⑦ Q&A -->
<section class="qa-section">
  <div class="qa-inner">
    <div class="qa-head">
      <div class="qa-title-wrap">
        <h2 class="qa-title">빠른 문의</h2>
        <p class="qa-sub">예약·결제·배송질문에 신속 답변 약속!</p>
      </div>
      <div class="qa-icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="26" height="27" viewBox="0 0 26 27" fill="none">
          <path d="M23.0288 22.998C24.1333 22.9982 25.0288 23.8936 25.0288 24.998C25.0288 26.1025 24.1332 26.9979 23.0288 26.998C21.9243 26.998 21.0288 26.1026 21.0288 24.998C21.0288 23.8935 21.9242 22.998 23.0288 22.998ZM11.0288 22.9863C12.1333 22.9865 13.0288 23.8818 13.0288 24.9863C13.0288 26.0908 12.1332 26.9862 11.0288 26.9863C9.92426 26.9863 9.02885 26.0909 9.02881 24.9863C9.02881 23.8818 9.92424 22.9863 11.0288 22.9863ZM17.0288 22.9863C18.1333 22.9865 19.0288 23.8818 19.0288 24.9863C19.0288 26.0908 18.1332 26.9862 17.0288 26.9863C15.9243 26.9863 15.0288 26.0909 15.0288 24.9863C15.0288 23.8818 15.9242 22.9863 17.0288 22.9863ZM16.2222 0.0644531C16.6408 -0.0359252 17.0802 -0.0186705 17.4917 0.115234C17.8327 0.226224 18.092 0.412493 18.2915 0.582031C18.4808 0.742957 18.6885 0.952295 18.897 1.16113L20.8481 3.11621C21.0567 3.32513 21.2648 3.53236 21.4253 3.72168C21.5737 3.89682 21.7329 4.11474 21.8433 4.39062L21.8882 4.5127L21.937 4.6875C22.0352 5.09793 22.0191 5.52891 21.8882 5.93262C21.7795 6.26738 21.595 6.5234 21.4253 6.72363C21.2648 6.91296 21.0567 7.12017 20.8481 7.3291L9.05225 19.1445C8.50965 19.688 8.13941 20.0647 7.70654 20.3672C7.33973 20.6234 6.94299 20.8361 6.52588 21C6.03289 21.1936 5.51253 21.2936 4.76025 21.4443L2.59912 21.877C2.4012 21.9166 2.17145 21.9641 1.97314 21.9854C1.77187 22.0069 1.43263 22.0251 1.07275 21.876C0.636931 21.6953 0.295751 21.3502 0.119629 20.9238C-0.0245625 20.5743 -0.00697505 20.2458 0.0141602 20.0479C0.0350912 19.8521 0.0817965 19.6241 0.121582 19.4248L0.553223 17.2607C0.703981 16.5057 0.803954 15.9885 0.995605 15.499C1.15806 15.0842 1.36763 14.6884 1.62256 14.3223C1.92377 13.8897 2.29999 13.5197 2.84326 12.9756L14.6392 1.16113C14.8477 0.952295 15.0544 0.742958 15.2437 0.582031C15.4431 0.412488 15.7025 0.226307 16.0435 0.115234L16.2222 0.0644531ZM4.55811 14.6426C3.95749 15.2442 3.76131 15.4477 3.60791 15.668C3.45932 15.8814 3.33489 16.1125 3.23975 16.3555C3.1414 16.6069 3.08097 16.8853 2.91455 17.7188L2.56689 19.46L4.28174 19.1162C5.1158 18.9491 5.38945 18.8909 5.63623 18.7939C5.87574 18.6998 6.10419 18.5776 6.31592 18.4297C6.53468 18.2768 6.73706 18.0798 7.33838 17.4775L16.2017 8.59766L13.397 5.78809L4.55811 14.6426ZM16.354 2.82715L15.0864 4.09668L17.8911 6.90625L19.1333 5.66211C19.3521 5.44292 19.4761 5.31666 19.5591 5.22168C19.4761 5.1268 19.3515 5.00175 19.1333 4.7832L17.1812 2.82715C16.9818 2.62752 16.8596 2.50739 16.7681 2.4248C16.6764 2.50743 16.5535 2.62729 16.354 2.82715Z" fill="white"/>
        </svg>
      </div>
    </div>
    <div class="qa-form">
      <input type="text" class="qa-input" placeholder="문의입력..." bind:value={qaText} onkeydown={(e) => { if (e.key === 'Enter') handleQaSubmit(); }} />
      <button class="qa-send-btn" aria-label="전송" onclick={handleQaSubmit} disabled={qaSubmitting}>
        <svg width="15" height="10" viewBox="0 0 17 12" fill="none">
          <path d="M1 6H16M16 6L11 1M16 6L11 11" stroke="var(--cs-text)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>
</section>

<!-- Toast -->
{#if toastVisible}
  <div class="toast-msg" role="status" aria-live="polite">{toastMsg}</div>
{/if}

<FloatingBar />

<style>
  /* ── Loading / Error */
  .loading-wrap {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .skeleton-hero {
    height: 800px;
    background: var(--cs-lilac);
    animation: pulse 1.5s ease-in-out infinite;
  }
  .skeleton-content {
    height: 400px;
    background: var(--cs-surface-gray);
    margin: 20px;
    border-radius: var(--radius-2xl);
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .error-wrap {
    min-height: 60vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    font: var(--text-m-body-16L);
    color: var(--cs-text-dark);
  }
  .error-wrap a {
    color: var(--cs-purple);
    text-decoration: none;
    font: var(--text-m-script-14B);
  }

  /* ── ProductInfo Section */
  .info-section {
    background: var(--cs-lilac);
    padding: var(--layout-section-gap) var(--layout-mob-pad);
  }
  @media (min-width: 641px) {
    .info-section { padding: var(--layout-section-gap) var(--layout-pc-pad); }
  }

  .info-inner {
    max-width: var(--layout-pc-max);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  @media (min-width: 641px) {
    .info-inner {
      flex-direction: row;
      align-items: flex-start;
      gap: 30px;
    }
  }

  .info-left {
    display: flex;
    flex-direction: column;
    gap: 50px;
    width: 100%;
  }
  @media (min-width: 641px) {
    .info-left { flex: 1; min-width: 0; }
  }

  .info-right {
    display: none;
  }
  @media (min-width: 641px) {
    .info-right {
      display: block;
      flex: 1;
      min-width: 0;
      position: sticky;
      top: 80px; /* 실제 레이아웃 헤더 64px + 16px gap */
      align-self: flex-start;
    }
  }

  /* Mobile cal: show only on mobile */
  .cal-mobile {
    display: block;
  }
  @media (min-width: 641px) {
    .cal-mobile { display: none; }
  }

  /* TitleInfo card */
  .title-card {
    background: var(--cs-white);
    border-radius: var(--radius-xl);
    padding: 25px 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  @media (min-width: 641px) {
    .title-card {
      border-radius: var(--radius-2xl);
      padding: 40px;
    }
  }

  .title-block { display: flex; flex-direction: column; gap: 10px; }
  .product-name {
    font: var(--text-m-htitle-24B);
    color: var(--cs-text);
    margin: 0;
  }
  @media (min-width: 641px) {
    .product-name { font: var(--text-pc-ad-kr-35); }
  }

  .product-sub {
    font: var(--text-m-title-18L);
    color: var(--cs-text-mid);
    margin: 0;
  }
  @media (min-width: 641px) {
    .product-sub { font: var(--text-pc-hsub-22); }
  }

  /* Price */
  .price-row {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--cs-red-badge);
    flex-wrap: wrap;
  }
  .price-unit { display: flex; align-items: baseline; gap: 4px; }
  .price-period-label { font: var(--text-m-script-12); }
  @media (min-width: 641px) {
    .price-period-label { font: var(--text-pc-ad-kr-22); }
  }
  .price-amount {
    font-family: var(--font-kr-heading);
    font-weight: 700;
    font-size: 24px;
  }
  @media (min-width: 641px) { .price-amount { font-size: 35px; } }
  .price-currency { font: var(--text-m-script-12); }
  @media (min-width: 641px) { .price-currency { font: var(--text-pc-ad-kr-22); } }
  .price-sep { font: var(--text-m-script-14); color: var(--cs-red-badge); }

  /* Delivery */
  .delivery-block { display: flex; flex-direction: column; gap: 10px; }
  .delivery-text {
    font: var(--text-m-script-14B);
    color: var(--cs-text-dark);
    margin: 0;
  }
  .delivery-icons { display: flex; gap: 16px; }
  .delivery-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  /* Qty control */
  .qty-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .qty-label {
    font: var(--text-m-script-14B);
    color: var(--cs-text-dark);
  }
  .qty-control {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .qty-btn {
    min-width: 44px;
    min-height: 44px;
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .qty-val-wrap {
    background: var(--cs-lilac);
    border-radius: var(--radius-md);
    padding: 5px 20px;
  }
  .qty-input {
    background: transparent;
    border: none;
    outline: none;
    font: var(--text-m-body-16B);
    color: var(--cs-text);
    width: 40px;
    text-align: center;
    -moz-appearance: textfield;
  }
  .qty-input::-webkit-inner-spin-button,
  .qty-input::-webkit-outer-spin-button { -webkit-appearance: none; }

  /* Options */
  .options-section {
    display: flex;
    flex-direction: column;
    gap: 30px;
  }
  .options-title {
    font: var(--text-m-body-16B);
    color: var(--cs-text-dark);
    margin: 0;
  }
  .options-list {
    display: flex;
    flex-direction: column;
    gap: 30px;
  }
  .option-item {
    background: var(--cs-surface-gray);
    border-radius: 20px;
    padding: 15px 30px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .option-label {
    font: var(--text-m-script-14B);
    color: var(--cs-text);
    margin: 0;
    line-height: 1;
  }
  @media (min-width: 641px) {
    .option-label { font: var(--text-pc-title-16); }
  }
  .option-bottom-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .option-price-wrap {
    display: flex;
    align-items: baseline;
    gap: 2px;
  }
  .option-price-num {
    font: var(--text-m-script-14B);
    color: var(--cs-text-dark);
  }
  .option-price-unit {
    font: var(--text-m-script-12);
    color: var(--cs-text-dark);
  }
  .qty-control.small { gap: 12px; }

  /* ── Tabs */
  .tabs-section {
    background: var(--cs-lilac);
    padding: var(--layout-section-gap) var(--layout-mob-pad) 0;
  }
  @media (min-width: 641px) {
    .tabs-section { padding: var(--layout-section-gap) var(--layout-pc-pad) 0; }
  }
  .tabs-inner {
    max-width: var(--layout-pc-max);
    margin: 0 auto;
  }
  .tab-nav {
    display: flex;
    gap: 4px;
    background: #e1def3;
    border-radius: 20px;
    padding: 5px 10px;
  }
  .tab-btn {
    font: var(--text-m-script-14B);
    color: var(--cs-text-mid);
    background: none;
    border: none;
    padding: 0 16px;
    cursor: pointer;
    min-height: 46px;
    border-radius: 15px;
    transition: background 0.15s, color 0.15s;
    flex: 1;
  }
  .tab-btn.active {
    background: var(--cs-lilac);
    color: var(--cs-purple);
  }
  .tab-content {
    padding: 30px 0 var(--layout-section-gap);
    background: var(--cs-lilac);
  }
  .tab-heading {
    font: var(--text-m-title-21);
    color: var(--cs-text);
    margin: 0 0 16px;
  }
  .product-desc {
    font: var(--text-m-body-16L);
    color: var(--cs-text-dark);
    white-space: pre-line;
    line-height: 1.8;
  }
  .tab-empty {
    font: var(--text-m-script-14);
    color: var(--cs-text-light);
    margin: 0;
  }

  /* ── Shotlog */
  .shotlog-section {
    padding: var(--layout-section-gap) 0;
    background: #e1def3;
    border-radius: 0 50px 0 0;
  }
  @media (min-width: 641px) {
    .shotlog-section { background: transparent; border-radius: 0; }
  }
  .shotlog-inner {
    max-width: var(--layout-pc-max);
    margin: 0 auto;
    padding: 0 var(--layout-mob-pad);
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  @media (min-width: 641px) {
    .shotlog-inner { padding: 0 var(--layout-pc-pad); gap: 30px; }
  }
  .shotlog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 0;
  }
  .shotlog-title {
    font: var(--text-m-menu-en-24);
    color: var(--cs-text);
  }
  @media (min-width: 641px) {
    .shotlog-title { font: var(--text-pc-menu-en-20); }
  }
  .shotlog-icon-wrap {
    display: flex;
    align-items: center;
  }
  .shotlog-list {
    display: flex;
    flex-direction: column;
    gap: 30px;
  }
  .shotlog-card {
    background: var(--cs-white);
    border-radius: 30px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  @media (min-width: 641px) {
    .shotlog-card { flex-direction: row; align-items: stretch; }
  }
  /* 모바일 이미지 (상단) */
  .shotlog-img-mobile {
    height: 150px;
    background: var(--cs-surface-gray);
    width: 100%;
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
  }
  @media (min-width: 641px) {
    .shotlog-img-mobile { display: none; }
  }
  /* PC 좌측 보라 바 */
  .shotlog-purple-bar {
    display: none;
    width: 15px;
    background: var(--cs-purple);
    flex-shrink: 0;
    align-self: stretch;
  }
  @media (min-width: 641px) {
    .shotlog-purple-bar { display: block; }
  }
  /* PC 우측 이미지 */
  .shotlog-img-pc {
    display: none;
    height: 150px;
    width: 300px;
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
    border-radius: 0 30px 30px 0;
  }
  @media (min-width: 641px) {
    .shotlog-img-pc { display: block; }
  }
  .shotlog-img-tag {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .shotlog-writing {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 0;
    justify-content: center;
  }
  @media (min-width: 641px) {
    .shotlog-writing { padding: 20px 30px; }
  }
  .shotlog-post-title {
    font-size: 18px;
    font-weight: 700;
    font-family: var(--font-kr);
    color: var(--cs-text-dark);
    margin: 0;
    line-height: 1.6;
  }
  .shotlog-post-meta {
    font: var(--text-m-script-12);
    color: var(--cs-text-mid);
    margin: 0;
  }

  /* ── Gradient bar (PC only) */
  .gradient-bar {
    display: none;
  }
  @media (min-width: 641px) {
    .gradient-bar {
      display: block;
      height: 10px;
      border-radius: 10px;
      background: linear-gradient(to right, #ff3535, #3b2f8a 41%);
      margin-top: var(--layout-section-gap);
      width: 100%;
    }
  }

  /* ── Popular items */
  .popular-section {
    padding: 50px 0 100px;
    background: var(--cs-lilac);
  }
  .popular-inner {
    max-width: var(--layout-pc-max);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .popular-head {
    padding: 20px var(--layout-mob-pad);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  @media (min-width: 641px) {
    .popular-head { padding: 20px var(--layout-pc-pad); }
  }
  .popular-title {
    font: var(--text-pc-menu-en-20);
    color: var(--cs-text);
    margin: 0;
  }
  .popular-sub {
    font: var(--text-m-script-14);
    color: var(--cs-text-dark);
    margin: 0;
  }
  .popular-scroll {
    display: flex;
    gap: 20px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0 var(--layout-mob-pad) 10px;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .popular-scroll::-webkit-scrollbar { display: none; }
  @media (min-width: 641px) {
    .popular-scroll { padding: 0 var(--layout-pc-pad) 10px; }
  }
  .popular-card {
    flex-shrink: 0;
    width: 200px;
    height: 280px;
    border-radius: 40px;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  @media (min-width: 641px) {
    .popular-card { width: 290px; height: 410px; border-radius: 50px; }
  }
  .popular-card-img {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .popular-card-img-tag {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .popular-card-info {
    position: relative;
    background: var(--cs-lilac);
    padding: 10px 20px 15px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  @media (min-width: 641px) {
    .popular-card-info { padding: 15px 30px 25px; }
  }
  .popular-card-price {
    font: var(--text-m-title-21);
    color: var(--cs-text);
    margin: 0;
    font-size: 18px;
    white-space: nowrap;
  }
  @media (min-width: 641px) {
    .popular-card-price { font-size: 25px; }
  }
  .popular-card-name {
    font: var(--text-m-script-14B);
    color: var(--cs-text-dark);
    margin: 0;
    white-space: nowrap;
  }

  /* ── Reviews */
  .review-section {
    padding: var(--layout-section-gap) var(--layout-mob-pad);
  }
  @media (min-width: 641px) {
    .review-section { padding: var(--layout-section-gap) var(--layout-pc-pad); }
  }
  .review-inner {
    max-width: var(--layout-pc-max);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .review-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 0 40px;
  }
  .review-title {
    font: var(--text-m-menu-en-24);
    color: var(--cs-text);
  }
  @media (min-width: 641px) { .review-title { font: var(--text-pc-menu-en-20); } }
  .review-count {
    font: var(--text-m-script-14B);
    color: var(--cs-text-light);
  }
  .review-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .review-card {
    border-radius: 30px;
    overflow: hidden;
    background: var(--cs-white);
  }
  .review-top {
    background: #e1def3;
    padding: 14px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .review-card-title {
    font-size: 16px;
    font-weight: 500;
    font-family: var(--font-kr);
    color: var(--cs-text);
    margin: 0;
  }
  .review-meta-text {
    font: var(--text-m-script-12);
    color: var(--cs-text-light);
    margin: 0;
    flex-shrink: 0;
  }
  .review-bottom {
    padding: 14px 20px;
    background: var(--cs-white);
    border-radius: 0 0 30px 30px;
  }
  .review-body {
    font: var(--text-m-script-14);
    color: var(--cs-text-dark);
    margin: 0;
    line-height: 1.7;
  }
  .review-form {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--cs-white);
    height: 70px;
    border-radius: 25px;
    padding: 0 16px 0 24px;
    margin-top: 8px;
  }
  .review-placeholder {
    font: var(--text-m-script-14);
    color: var(--cs-text-placeholder);
    margin: 0;
  }
  .review-send-btn {
    width: 35px;
    height: 35px;
    border-radius: 30px;
    background: var(--cs-lilac);
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }

  /* ── Options accordion */
  .options-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    padding: 4px 0;
    user-select: none;
  }
  .options-header:focus-visible { outline: 2px solid var(--cs-purple); outline-offset: 2px; border-radius: 4px; }
  .options-more-btn {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .options-more-text {
    font: var(--text-m-script-12);
    color: var(--cs-text-mid);
  }
  .options-chevron {
    transform: rotate(90deg);
    transition: transform 0.2s ease;
  }
  .options-chevron.open {
    transform: rotate(-90deg);
  }

  /* ── Q&A */
  .qa-section {
    background: #ffeae2;
    border-radius: 30px 30px 0 0;
    padding: 50px var(--layout-mob-pad) 100px;
  }
  @media (min-width: 641px) {
    .qa-section {
      border-radius: 0;
      padding: 80px var(--layout-pc-pad);
    }
  }
  .qa-inner {
    max-width: var(--layout-pc-max);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .qa-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .qa-title-wrap { display: flex; flex-direction: column; gap: 4px; }
  .qa-title {
    font: var(--text-m-title-21);
    color: var(--cs-text);
    margin: 0;
  }
  .qa-sub {
    font: var(--text-m-script-12);
    color: var(--cs-text-mid);
    margin: 0;
  }
  .qa-icon {
    width: 70px;
    height: 70px;
    border-radius: 25px;
    background: var(--cs-red-badge);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .qa-form {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--cs-white);
    height: 70px;
    border-radius: 25px;
    padding: 0 16px 0 24px;
  }
  .review-input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    font: var(--text-m-script-14);
    color: var(--cs-text-placeholder);
    cursor: pointer;
    caret-color: transparent;
  }
  .review-input::placeholder {
    color: var(--cs-text-placeholder);
    opacity: 0.6;
  }

  .qa-input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    font: var(--text-m-script-14);
    color: var(--cs-text);
    cursor: text;
  }
  .qa-input::placeholder {
    color: var(--cs-text-placeholder);
    opacity: 0.6;
  }
  .qa-send-btn {
    width: 35px;
    height: 35px;
    border-radius: 30px;
    background: var(--cs-lilac);
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }

  /* ── Toast */
  .toast-msg {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: #553FE0;
    color: white;
    padding: 14px 28px;
    border-radius: 30px;
    z-index: 9999;
    font: var(--text-m-script-14B);
    white-space: nowrap;
    pointer-events: none;
  }
</style>
