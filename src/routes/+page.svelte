<script lang="ts">
  import { goto } from '$app/navigation'
  import MobileMoreMenu from '$lib/components/common/MobileMoreMenu.svelte'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // DB 배너 (마이그레이션 #45 적용 후 활성화)
  const heroPC     = $derived(data.bannerMap?.['hero_pc']     ?? [])
  const heroMobile = $derived(data.bannerMap?.['hero_mobile'] ?? [])
  // ── 로컬 컬러 (app.css 토큰에 없는 값) ──────────────────────────
  const navy     = '#100b32'
  const navyDeep = '#201857'
  const purple   = '#3b2f8a'
  const purpleLight = '#553fe0'
  const purplePale  = '#e1def3'
  const red      = '#ff3535'
  const redDeep  = '#cf0000'
  const muted    = '#c1bbec'

  // ── 더미 데이터 ──────────────────────────────────────────────────
  const PICKS_DESKTOP = [
    { img: '/home/desktop/571a11c577774467d3b4cfa10fb7ea6ba6f178ba.png', label: 'Idol',     sub: '팬미팅 & 콘서트' },
    { img: '/home/desktop/70f4f86db3e4f9fc6e56a1ae8e18d2ab59ec9752.png', label: 'Traveler', sub: '특별한 일상 기록' },
    { img: '/home/desktop/973fb7223b8765990a797bef0c638107d6c5af2b.png', label: 'Creator',  sub: '내 안에 전문가'  },
  ]
  const PICKS_MOBILE = [
    { img: '/home/mobile/f6fd3c3a5044c145e3ea5b2a0f647359481adf26.png', label: 'Casual log',   sub: '특별한 일상 기록' },
    { img: '/home/mobile/dc04a7c7ecc9c9603875f1d7c09725329e848510.png', label: 'Fandom Ready', sub: '팬미팅 & 콘서트'  },
    { img: '/home/mobile/e97fe344dc2504d05a6105603aea8216682b5b82.png', label: 'Steps to Pro', sub: '내 안에 전문가'   },
  ]

  const HL_CARDS = [
    { img: '/home/desktop/7df82cd938ac023873613b838e2eca6c9c1701b1.png', name: 'SONY CAM 34B', price: '$ 350 / 1w' },
    { img: '/home/desktop/7df82cd938ac023873613b838e2eca6c9c1701b1.png', name: 'SONY CAM 34B', price: '$ 350 / 1w' },
    { img: '/home/desktop/455e92ba5b2dcda7fa62337bc295967c20058311.png', name: 'GOPROHERO11',  price: '$ 350 / 1w' },
    { img: '/home/desktop/455e92ba5b2dcda7fa62337bc295967c20058311.png', name: 'GOPROHERO11',  price: '$ 350 / 1w' },
  ]

  const PRODUCTS = [
    { id:1, name:'GOPRO HERO11',            desc:'Ultra Compact Design Weighs Only', price:'$ 180 / 1w', img:'/home/desktop/0e5cfa4b24ea4086c4f8a27ab299ce413ce61789.png' },
    { id:2, name:'SONY FE 24-105 F4 G OSS', desc:'Ultra Compact Design Weighs Only', price:'$ 320 / 1w', img:'/home/desktop/ea4bb2f23aca10bc9f5708513bf4da8b17b2e37e.png' },
    { id:3, name:'SONY A7S3',               desc:'Ultra Compact Design Weighs Only', price:'$ 350 / 1w', img:'/home/desktop/c81408dc30d1490b2dce2d4082bac0cee137885b.png' },
    { id:4, name:'SONY FE 24-105 F4 G OSS', desc:'Ultra Compact Design Weighs Only', price:'$ 230 / 1w', img:'/home/desktop/66971e04a11bcacd44babb8f2fe82711f8d8d130.png' },
    { id:5, name:'SONY FE 24-105 F4 G OSS', desc:'Ultra Compact Design Weighs Only', price:'$ 320 / 1w', img:'/home/desktop/7f5fc984fb8e13feda5291bb4dce91a2024cb9b0.png' },
    { id:6, name:'SONY A7S3',               desc:'Ultra Compact Design Weighs Only', price:'$ 350 / 1w', img:'/home/desktop/c81408dc30d1490b2dce2d4082bac0cee137885b.png' },
    { id:7, name:'SONY FE 24-105 F4 G OSS', desc:'Ultra Compact Design Weighs Only', price:'$ 230 / 1w', img:'/home/desktop/ea4bb2f23aca10bc9f5708513bf4da8b17b2e37e.png' },
  ]

  const PACKAGES = [
    { img:'/home/mobile/8c932c01a63712857026f826beb90a3293b5f28f.png', cat:'Casual log',  name:'소니 FX3 완전체 패키지',       price:'80,000원 / 1일' },
    { img:'/home/mobile/417c117d76ed4fe8925192eaadd1583287f78d2f.png', cat:'Casual log',  name:'Sony Alpha 7 Pack',             price:'80,000원 / 1일' },
    { img:'/home/mobile/fd32b27c7dfc24baba6f46b438189955d0192da8.png', cat:'Casual log',  name:'CANON 100mm F2.8 L IS USM',     price:'80,000원 / 1일' },
    { img:'/home/mobile/8a3ac2d8f7bcace345136452001ed2288550d883.png', cat:'Starter kit', name:'Sony FDR-AX43A 4K',             price:'$ 350 / 1w'     },
  ]

  const M_PRODUCTS = [
    { img:'/home/desktop/0e5cfa4b24ea4086c4f8a27ab299ce413ce61789.png', name:'코프로 히어로 11', price:'120,000원 / 1일', desc:'초소형 디자인으로 무게감이 훨씬' },
    { img:'/home/desktop/ea4bb2f23aca10bc9f5708513bf4da8b17b2e37e.png', name:'캐논 300DF',       price:'120,000원 / 1일', desc:'초소형 디자인으로 무게감이 훨씬' },
    { img:'/home/desktop/c81408dc30d1490b2dce2d4082bac0cee137885b.png', name:'코프로 히어로 11', price:'120,000원 / 1일', desc:'초소형 디자인으로 무게감이 훨씬' },
    { img:'/home/desktop/66971e04a11bcacd44babb8f2fe82711f8d8d130.png', name:'소니 캠프로 30D',  price:'120,000원 / 1일', desc:'초소형 디자인으로 무게감이 훨씬' },
    { img:'/home/desktop/7f5fc984fb8e13feda5291bb4dce91a2024cb9b0.png', name:'칼자이츠 50F',     price:'120,000원 / 1일', desc:'초소형 디자인으로 무게감이 훨씬' },
  ]

  const BLOG_M = [
    { img:'/home/mobile/88b12b3c2f6cf0d2849cf3a03d88be683d812f33.png', cat:'Flash Deals', catBg:'#201857', title:'다양한 액션캠 대잔치',     desc:'DJI, 오즈모, 인스타 모두 맛봅시다'     },
    { img:'/home/mobile/aa24939721466faff1ac52f258380ff639572a3b.png', cat:'Fan vlog',    catBg:'#cf0000', title:'양양의 기억 담기',          desc:'동해 양양바다의 기억을 담은 브이로그'   },
    { img:'/home/mobile/8943a5c1d6afa794370c42f5424655c311691996.png', cat:'Release',     catBg:'#3b2f8a', title:'DJI Mini2se Aerial Drone',  desc:'드론시장에서 품질은 없다.'               },
    { img:'/home/mobile/e5aeea4d6cf3c1e552f04ceca949e5f81b687c06.png', cat:'Fan Picks',   catBg:'#ff3535', title:'Sony ZV-E10 Mirrorless',    desc:'올어라운드 렌즈의 끝판왕'               },
    { img:'/home/mobile/42b09caf08dc841710ab819baf914713f43e3d7d.png', cat:'Release',     catBg:'#ff3535', title:'DJI Mini2se Aerial Drone',  desc:''                                        },
  ]

  const ARTICLES = [
    { img:'/home/mobile/a041a1560d8516c08629c076091801ef2ef3fe34.png', title:'[사용기] SONY FE 24-105  가볍게 고퀄 영상을 바로 만들어주다',        time:'1시간 전', by:'홍기동' },
    { img:'/home/mobile/455e92ba5b2dcda7fa62337bc295967c20058311.png', title:'액션캠의 왕좌를 되찾으러 돌아왔다. GoPro HERO13 Black',               time:'2시간 전', by:'유말자' },
    { img:'/home/mobile/47137b587edb5eb5ebfc464c2a2f5938298af14e.png', title:'휴대용 디자인으로 이동 중에도 미디어 카드에 쉽게 접근 가능',          time:'2시간 전', by:'유말자' },
    { img:'/home/mobile/c9f1af1a9f27653ad1ae0ba6fbbfd599009ec5ce.png', title:'onn. 52인치 삼각대, 컴팩트 카메라, 스마트폰 및 GoPro 액션 카메라용', time:'2시간 전', by:'유말자' },
    { img:'/home/mobile/a0b11155daf1d451a0b118540da1168c113db2b8.png', title:'K-트레일로그를 남기는 멋진 일은 우리들에게 즐거움의 폭증이다!!',      time:'2시간 전', by:'유말자' },
  ]

  const FAQ_DESKTOP = [
    { id:'d1', q:'Can I extend my rental?',
      a:'렌탈 기간을 연장하시려면 반납 예정일 기준 24시간 전에 고객센터나 앱에서 연장 신청을 해주시면 됩니다. 재고 상황에 따라 불가능할 수 있습니다.' },
    { id:'d2', q:'Why do I pay more total for extending a 7-day rental into a 14-day rental than I would for a single 14-day rental?',
      a:'7일 렌탈을 연장하는 경우 처음부터 14일로 예약하는 것보다 총 비용이 높을 수 있습니다. 처음부터 필요한 기간을 정확히 예약하시는 것을 권장합니다.' },
    { id:'d3', q:'What if I am late with my return?',
      a:'반납이 지연되는 경우 추가 렌탈 요금이 일할 계산되어 부과됩니다. 최대한 빠르게 고객센터에 연락해 주시기 바랍니다.' },
    { id:'d4', q:'Oh no! I forgot to return an item!',
      a:'반납을 잊으신 경우 즉시 고객센터(1588-0033)에 연락해 주세요. 상황에 따라 적절한 조치를 안내해 드리겠습니다.' },
    { id:'d5', q:'How are late fees calculated?',
      a:'연체료는 반납 예정일 다음 날부터 실제 반납일까지 일수에 일일 렌탈 요금을 곱하여 계산됩니다.' },
  ]
  const FAQ_MOBILE = [
    { id:'m1', q:'호텔이나 에어비앤비로도 배송 받을 수 있나요?',
      a:'네, 가능합니다. 배송지 주소를 정확히 입력해 주시면 숙박시설로도 배송 가능합니다. 프론트 데스크에 미리 알려두시는 것을 권장합니다.' },
    { id:'m2', q:'렌탈 기간을 연장하고 싶어요.',
      a:'앱 또는 고객센터를 통해 연장 신청이 가능합니다. 반납 예정일 24시간 전에 신청해 주세요.' },
    { id:'m3', q:'장비가 파손되었을 때 어떻게 해야 하나요?',
      a:'파손 발생 시 즉시 촬영 후 고객센터에 신고해 주세요. 파손 정도에 따라 수리비가 청구될 수 있습니다.' },
    { id:'m4', q:'반납은 어떻게 하나요?',
      a:'지정된 반납 방법(택배/방문)을 선택하시고, 안전하게 포장하여 반납해 주세요.' },
    { id:'m5', q:'결제는 어떤 방법으로 할 수 있나요?',
      a:'신용카드, 체크카드, 계좌이체, 간편결제(카카오페이, 네이버페이 등)가 가능합니다.' },
  ]

  const BRANDS_D = [
    { src: '/home/desktop/afdabe0224a76bddaf34a6ba1df6f2fb289d8214.png', alt: 'Canon' },
    { src: '/home/desktop/68085f48f1a825b8f17e0c88f7958688209f59e9.png', alt: 'Samsung' },
    { src: '/home/desktop/bc2936fc3f0a008369055bc303d4364526f9b3a4.png', alt: 'Nikon' },
    { src: '/home/desktop/f1b4eb241fae7316a6d60c6720300e7c0d2c2038.png', alt: 'GoPro' },
  ]
  const BRAND_SET = [...BRANDS_D, ...BRANDS_D, ...BRANDS_D, ...BRANDS_D]

  const CATEGORY_TABS = [
    { id: 'hype',        label: 'HypePack',    icon: 'package'    },
    { id: 'camera',      label: 'Camera',      icon: 'camera'     },
    { id: 'lens',        label: 'Lens',        icon: 'aperture'   },
    { id: 'phone',       label: 'Phone',       icon: 'phone'      },
    { id: 'lighting',    label: 'Lighting',    icon: 'zap'        },
    { id: 'drone',       label: 'Drone',       icon: 'plane'      },
    { id: 'actcam',      label: 'ActCam',      icon: 'video'      },
    { id: 'accessories', label: 'Accessories', icon: 'wrench'     },
  ]

  // ── 상태 ──────────────────────────────────────────────────────────
  let activeTab = $state('camera')
  let openFaqId = $state<string | null>(null)
  let pkgIdx = $state(0)
  let mpickIdx = $state(0)
  let mActiveTab = $state('Home')
  let poppingTab = $state<string | null>(null)
  let moreMenuOpen = $state(false)
  function triggerPop(id: string) {
    poppingTab = id
    setTimeout(() => { poppingTab = null }, 700)
  }

  let sliderEl: { scrollBy: (opts: { left: number; behavior: 'smooth' | 'instant' | 'auto' }) => void } | undefined
  function scrollSlider(dir: 'left' | 'right') {
    sliderEl?.scrollBy({ left: dir === 'right' ? 330 : -330, behavior: 'smooth' })
  }

  let pkgSliderEl: { scrollLeft: number } | undefined
  function onPkgScroll() {
    if (!pkgSliderEl) return
    pkgIdx = Math.round(pkgSliderEl.scrollLeft / 316)
  }

  let mpickSliderEl: { scrollLeft: number } | undefined
  function onMpickScroll() {
    if (!mpickSliderEl) return
    mpickIdx = Math.round(mpickSliderEl.scrollLeft / 280)
  }

  const MOBILE_TABS = [
    { id: 'More', label: 'More' },
    { id: 'All',  label: 'All'  },
    { id: 'Home', label: 'Home' },
    { id: 'Cart', label: 'Cart' },
    { id: 'My',   label: 'My'   },
  ]
</script>

<!-- ═══════════════════════════════════════════════════════════════
     DESKTOP (md↑)
════════════════════════════════════════════════════════════════ -->
<div class="desktop-wrap">

  <!-- ① Hero -->
  <div class="d-hero">
    {#if heroPC.length > 0}
      {#each heroPC as b (b.id)}
        {#if b.link_url}
          <a href={b.link_url} class="d-hero-banner-link">
            <img src={b.image_url} alt={b.title ?? ''} class="d-hero-banner-img" />
          </a>
        {:else}
          <img src={b.image_url} alt={b.title ?? ''} class="d-hero-banner-img" />
        {/if}
      {/each}
    {:else}
      <img src="/home/desktop/1fbafe64eb226e679021660588c1e5d840401f59.png" alt="" class="d-hero-left" aria-hidden="true"/>
      <img src="/home/desktop/1bbde5f74b1d99829b62da01db4cd68c18c25510.png" alt="" class="d-hero-right" aria-hidden="true"/>
    {/if}
    <div class="d-hero-copy">
      <div class="d-hero-line1">
        <span class="d-hero-saengae">생애</span>
        <span class="d-hero-first">First</span>
      </div>
      <div class="d-hero-rental">렌탈</div>
      <div class="d-hero-badge">
        <span class="d-hero-badge-text">미친할인</span>
      </div>
    </div>
  </div>

  <!-- ② 취향직격 PICK -->
  <div class="d-section d-pick-section">
    <div class="section-head">
      <svg width="34" height="16" viewBox="0 0 34 16" fill="none" aria-hidden="true">
        <path d="M2 8 Q8.5 2 17 8 Q25.5 14 32 8" stroke="#ff3535" stroke-width="3.5" stroke-linecap="round" fill="none"/>
      </svg>
      <span class="section-title" style="color:{redDeep}">취·향·직·격 PICK!</span>
    </div>
    <p class="section-sub">취향에 따라 상황에 맞춘 고민 따위 필요없이<br/>찰떡궁합 촬영 패키지 추천 받으세요.</p>
    <div class="pick-circles">
      {#each PICKS_DESKTOP as p}
        <button class="pick-item">
          <div class="pick-img-wrap pick-img-wrap--lg">
            <img src={p.img} alt={p.label} class="pick-img"/>
          </div>
          <div class="pick-label-wrap">
            <span class="pick-label">{p.label}</span>
            <span class="pick-sub">{p.sub}</span>
            <svg width="20" height="12" viewBox="0 0 20 12" fill="none" style="margin-top:4px" aria-hidden="true">
              <path d="M2 2 L10 10 L18 2" stroke="{purple}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            </svg>
          </div>
        </button>
      {/each}
    </div>
  </div>

  <!-- ③ 하이라이트 카드 4개 -->
  <div class="d-hl-cards">
    {#each HL_CARDS as card}
      <div class="hl-card">
        <img src={card.img} alt={card.name} class="hl-card-img"/>
        <div class="hl-card-overlay" aria-hidden="true"></div>
        <div class="hl-card-info">
          <div class="hl-card-badges">
            <div class="hl-badge" style="background:{red}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="4" stroke="white" stroke-width="2"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>
            </div>
            <div class="hl-badge" style="background:{purpleLight}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2" stroke="white" stroke-width="2"/><path d="M16 7V5a2 2 0 00-8 0v2" stroke="white" stroke-width="2"/></svg>
            </div>
          </div>
          <span class="hl-cat">Starter kit</span>
          <div class="hl-name">{card.name}</div>
          <div class="hl-price" style="color:{red}">{card.price}</div>
        </div>
      </div>
    {/each}
  </div>

  <!-- ④ 카테고리 탭 + 슬라이더 -->
  <div class="d-section d-cat-section">
    <!-- Package 타이틀 바 -->
    <div class="pkg-bar">
      <span class="pkg-bar-label">Package</span>
      <div class="pkg-bar-icon">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M5 2l5 5-5 5" stroke="{purpleLight}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>

    <!-- 카테고리 아이콘 탭 -->
    <div class="cat-tabs">
      {#each CATEGORY_TABS as tab}
        <button class="cat-tab" class:active={activeTab === tab.id} onclick={() => activeTab = tab.id}>
          <div class="cat-tab-icon" style="background:{activeTab === tab.id ? purple : purplePale}">
            {#if tab.icon === 'package'}
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2" stroke={activeTab === tab.id ? red : purple} stroke-width="1.8"/><path d="M16 7V5a2 2 0 00-8 0v2" stroke={activeTab === tab.id ? red : purple} stroke-width="1.8"/></svg>
            {:else if tab.icon === 'camera'}
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke={activeTab === tab.id ? red : purple} stroke-width="1.8"/><circle cx="12" cy="13" r="4" stroke={activeTab === tab.id ? red : purple} stroke-width="1.8"/></svg>
            {:else if tab.icon === 'aperture'}
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke={activeTab === tab.id ? red : purple} stroke-width="1.8"/><line x1="12" y1="3" x2="12" y2="21" stroke={activeTab === tab.id ? red : purple} stroke-width="1.8"/><line x1="3" y1="12" x2="21" y2="12" stroke={activeTab === tab.id ? red : purple} stroke-width="1.8"/></svg>
            {:else if tab.icon === 'phone'}
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2" stroke={activeTab === tab.id ? red : purple} stroke-width="1.8"/><line x1="12" y1="18" x2="12.01" y2="18" stroke={activeTab === tab.id ? red : purple} stroke-width="2" stroke-linecap="round"/></svg>
            {:else if tab.icon === 'zap'}
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke={activeTab === tab.id ? red : purple} stroke-width="1.8" stroke-linejoin="round"/></svg>
            {:else if tab.icon === 'plane'}
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" stroke={activeTab === tab.id ? red : purple} stroke-width="1.8"/></svg>
            {:else if tab.icon === 'video'}
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7" stroke={activeTab === tab.id ? red : purple} stroke-width="1.8" stroke-linejoin="round"/><rect x="1" y="5" width="15" height="14" rx="2" stroke={activeTab === tab.id ? red : purple} stroke-width="1.8"/></svg>
            {:else}
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" stroke={activeTab === tab.id ? red : purple} stroke-width="1.8"/></svg>
            {/if}
          </div>
          <span class="cat-tab-label">{tab.label}</span>
        </button>
      {/each}
    </div>

    <!-- 미칠 PICK 헤딩 -->
    <div class="michil-heading">
      <h2 class="michil-title"><span style="color:{redDeep}">미·칠</span> PICK!</h2>
    </div>

    <!-- 상품 슬라이더 -->
    <div class="prod-slider-wrap">
      <button class="slider-arrow left" onclick={() => scrollSlider('left')} aria-label="이전">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" stroke="{navy}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>

      <div bind:this={sliderEl} class="prod-slider">
        {#each PRODUCTS as p}
          <div class="prod-card">
            <img src={p.img} alt={p.name} class="prod-card-img"/>
            <div class="prod-card-fade" aria-hidden="true"></div>
            <div class="prod-card-info">
              <div class="prod-card-price">{p.price}</div>
              <div class="prod-card-name">{p.name}</div>
              <div class="prod-card-desc">{p.desc}</div>
            </div>
          </div>
        {/each}
      </div>

      <button class="slider-arrow right" onclick={() => scrollSlider('right')} aria-label="다음">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9 18l6-6-6-6" stroke="{navy}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- ⑤ 크레이지로그 -->
  <div class="d-section d-blog-section">
    <div class="section-head">
      <svg width="34" height="16" viewBox="0 0 34 16" fill="none" aria-hidden="true">
        <path d="M2 8 Q8.5 2 17 8 Q25.5 14 32 8" stroke="#ff3535" stroke-width="3.5" stroke-linecap="round" fill="none"/>
      </svg>
      <span class="section-title" style="color:{redDeep}">요즘 크레이지·로그</span>
    </div>
    <p class="section-sub" style="color:{navyDeep}">신상 리뷰도, 내 유튜브채널 홍보도 크레이지로그로!</p>

    <div class="blog-grid">
      <div class="blog-main-card">
        <img src="/home/desktop/936c7f6a59d66e8e0e622b285038411a7c6b2519.png" alt="크레이지로그 메인" class="blog-img"/>
        <div class="blog-main-header" style="background:{navyDeep}">
          <span class="blog-cat-label">Flash Deals</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 18l6-6-6-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="blog-main-footer">
          <p class="blog-main-caption">From Portraits to Panoramas-One Lens to Rule Them All</p>
        </div>
      </div>
      <div class="blog-sub-card top">
        <img src="/home/desktop/0f6bb06ce53ce5862f01e33b020560170e675963.png" alt="크레이지로그 서브" class="blog-img"/>
      </div>
      <div class="blog-sub-card bottom">
        <img src="/home/desktop/3f31095d0b23ea6fa5b0d1bd332db11c12071e05.png" alt="크레이지로그" class="blog-img"/>
        <div class="blog-sub-header" style="background:{purple}">
          <span class="blog-cat-label">요즘 크레이지·로그</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 18l6-6-6-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </div>
    </div>
  </div>

  <!-- ⑥ FAQ -->
  <div class="d-section d-faq-section">
    <div class="faq-brand-box" style="background:{purplePale}">
      <div class="faq-logo">
        <span class="logo-crazy-lg">CRAZY</span>
        <span class="logo-shot-lg">SHOT</span>
      </div>
      <div class="faq-brand-text" style="color:{navy}">다양한 영상장비 쉽고 빠른<br/>렌탈 마법 가이드</div>
    </div>
    <div class="faq-col">
      <p class="faq-intro">크레이샷만의 빠른 예약, 장비 수령, 반납까지 자주 묻는 질문을 바로 확인하세요.</p>
      <div class="faq-list">
        {#each FAQ_DESKTOP as item}
          <div class="faq-item">
            <button
              class="faq-q"
              onclick={() => openFaqId = openFaqId === item.id ? null : item.id}
              aria-expanded={openFaqId === item.id}
            >
              <span class="faq-q-text">{item.q}</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"
                style="transform:{openFaqId === item.id ? 'rotate(180deg)' : 'rotate(0deg)'};transition:transform 0.22s;flex-shrink:0">
                <path d="M6 9l6 6 6-6" stroke="{muted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            {#if openFaqId === item.id}
              <div class="faq-a"><p>{item.a}</p></div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>

  <!-- ⑦ 브랜드 마퀴 -->
  <div class="brand-marquee-wrap">
    <div class="cz-track">
      {#each BRAND_SET as brand}
        <div class="cz-logo">
          <img src={brand.src} alt={brand.alt} class="cz-logo-img"/>
        </div>
      {/each}
    </div>
  </div>

</div><!-- /desktop-wrap -->


<!-- ═══════════════════════════════════════════════════════════════
     MOBILE (md 미만)
════════════════════════════════════════════════════════════════ -->
<div class="mobile-wrap">

  <!-- ① 모바일 히어로 -->
  <div class="m-hero">
    <div class="m-hero-watermark" aria-hidden="true">
      Get Your CRAZYSHOT!<br/>Get Your CRAZYSHOT!<br/>Get Your CRAZYSHOT!
    </div>
    {#if heroMobile.length > 0}
      {#each heroMobile as b (b.id)}
        {#if b.link_url}
          <a href={b.link_url} class="m-hero-banner-link">
            <img src={b.image_url} alt={b.title ?? ''} class="m-hero-bg" />
          </a>
        {:else}
          <img src={b.image_url} alt={b.title ?? ''} class="m-hero-bg" />
        {/if}
      {/each}
    {:else}
      <img src="/home/mobile/ac4438597a6842bccc5d44da173a03a9f3614d50.png" alt="" class="m-hero-bg" aria-hidden="true"/>
    {/if}
    <div class="m-hero-stripes" aria-hidden="true">
      {#each Array(10) as _, i}
        <div style="height:9px;background:{i%2===0 ? 'rgba(0,115,170,0.5)' : 'rgba(255,158,116,0.5)'}"></div>
      {/each}
    </div>
    <img src="/home/mobile/b473ea708107badf385ed8827f8fb7a156223d67.png" alt="" class="m-hero-overlay" aria-hidden="true"/>
    <div class="m-hero-copy">
      <div class="m-hero-tag1">이 구역 장비명빨!</div>
      <div class="m-hero-tag2">크레이지한<br/>썸머풀팩</div>
      <div class="m-hero-tag3">한번에 왕창 예약해서 <b>30</b>% 절약해봐요</div>
      <div class="m-hero-cta">80,000원·1일</div>
    </div>
  </div>

  <!-- ② 취향직격 PICK + 패키지 슬라이더 -->
  <div class="m-section m-pick-section">
    <div class="section-head">
      <svg width="34" height="16" viewBox="0 0 34 16" fill="none" aria-hidden="true">
        <path d="M2 8 Q8.5 2 17 8 Q25.5 14 32 8" stroke="#ff3535" stroke-width="3.5" stroke-linecap="round" fill="none"/>
      </svg>
      <span class="section-title" style="color:{redDeep}">취·향·직·격 PICK!</span>
    </div>
    <p class="section-sub">취향에 따라 상황에 맞춘 고민 따위 필요없이<br/>찰떡궁합 촬영 패키지 추천 받으세요.</p>
    <div class="pick-circles">
      {#each PICKS_MOBILE as p}
        <button class="pick-item">
          <div class="pick-img-wrap pick-img-wrap--sm">
            <img src={p.img} alt={p.label} class="pick-img"/>
          </div>
          <div class="pick-label-wrap">
            <span class="pick-label">{p.label}</span>
            <span class="pick-sub">{p.sub}</span>
            <svg width="20" height="12" viewBox="0 0 20 12" fill="none" style="margin-top:4px" aria-hidden="true">
              <path d="M2 2 L10 10 L18 2" stroke="{purple}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            </svg>
          </div>
        </button>
      {/each}
    </div>

    <div bind:this={pkgSliderEl} onscroll={onPkgScroll} class="m-snap-slider">
      {#each PACKAGES as pkg}
        <div class="m-pkg-card">
          <img src={pkg.img} alt={pkg.name} class="m-pkg-img"/>
          <div class="m-pkg-overlay" aria-hidden="true"></div>
          <div class="m-pkg-info">
            <div class="m-pkg-badges">
              <div class="hl-badge" style="background:{purpleLight}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2" stroke="white" stroke-width="2"/><path d="M16 7V5a2 2 0 00-8 0v2" stroke="white" stroke-width="2"/></svg>
              </div>
              <div class="hl-badge" style="background:{red}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="4" stroke="white" stroke-width="2"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>
              </div>
            </div>
            <div class="m-pkg-cat-badge" style="background:{purpleLight}">{pkg.cat}</div>
            <div class="m-pkg-name">{pkg.name}</div>
            <div class="m-pkg-price" style="color:{red}">{pkg.price}</div>
          </div>
        </div>
      {/each}
    </div>
    <div class="dot-indicators">
      {#each PACKAGES as _, i}
        <div class="dot" class:active={i === pkgIdx}></div>
      {/each}
    </div>
  </div>

  <!-- ③ 미칠 PICK 슬라이더 -->
  <div class="m-section m-michil-section">
    <div class="m-michil-head">
      <h2 class="michil-title"><span style="color:{redDeep}">미·칠</span> PICK!</h2>
    </div>
    <div bind:this={mpickSliderEl} onscroll={onMpickScroll} class="m-snap-slider">
      {#each M_PRODUCTS as p, _i}
        <div class="m-prod-card">
          <img src={p.img} alt={p.name} class="m-prod-img"/>
          <div class="m-prod-dots" aria-hidden="true">
            {#each M_PRODUCTS as _, j}
              <div class="dot" class:active={j === mpickIdx} style="background:white"></div>
            {/each}
          </div>
          <div class="m-prod-fade" aria-hidden="true"></div>
          <div class="m-prod-info">
            <div class="m-prod-name">{p.name}</div>
            <div class="m-prod-price" style="color:{purple}">{p.price}</div>
            <div class="m-prod-desc">{p.desc}</div>
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- ④ 요즘 크레이지로그 -->
  <div class="m-blog-section">
    <div class="section-head">
      <svg width="34" height="16" viewBox="0 0 34 16" fill="none" aria-hidden="true">
        <path d="M2 8 Q8.5 2 17 8 Q25.5 14 32 8" stroke="white" stroke-width="3.5" stroke-linecap="round" fill="none"/>
      </svg>
      <span class="section-title" style="color:white">요즘 크레이지로그!</span>
    </div>
    <p class="section-sub" style="color:white">신상 리뷰도, 내 유튜브채널 홍보도 크레이지로그로!</p>
    <div class="m-blog-cards">
      {#each BLOG_M as post}
        <div class="m-blog-card">
          <img src={post.img} alt={post.title} class="m-blog-img"/>
          <div class="m-blog-header" style="background:{post.catBg}">
            <span class="blog-cat-label">{post.cat}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 18l6-6-6-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="m-blog-footer">
            <p class="m-blog-title">{post.title}</p>
            {#if post.desc}<p class="m-blog-desc">{post.desc}</p>{/if}
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- ⑤ 아티클 목록 -->
  <div class="m-section m-articles-section">
    <div class="m-articles-head">
      <span class="m-articles-heading">더 다양한 로그 둘러보기</span>
      <div class="m-articles-more-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9 18l6-6-6-6" stroke="{purpleLight}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>
    {#each ARTICLES as a}
      <div class="m-article-card">
        <div class="m-article-img-wrap">
          <img src={a.img} alt="" class="m-article-img" aria-hidden="true"/>
        </div>
        <div class="m-article-body">
          <p class="m-article-title">{a.title}</p>
          <p class="m-article-meta">{a.time}·by {a.by}</p>
        </div>
      </div>
    {/each}
  </div>

  <!-- ⑥ FAQ -->
  <div class="m-section m-faq-section">
    <div class="m-faq-brand" style="background:{purplePale}">
      <div class="faq-logo"><span class="logo-crazy-lg">CRAZY</span><span class="logo-shot-lg">SHOT</span></div>
    </div>
    <div class="m-faq-intro-wrap">
      <div class="faq-brand-text" style="color:{navy}">다양한 영상장비 쉽고 빠른 렌탈 마법 가이드</div>
      <p class="faq-intro" style="color:{purple}">크레이샷만의 빠른 예약, 장비 수령, 반납까지 자주 묻는 질문을 바로 확인하세요.</p>
    </div>
    <div class="faq-list">
      {#each FAQ_MOBILE as item}
        <div class="faq-item">
          <button
            class="faq-q"
            onclick={() => openFaqId = openFaqId === item.id ? null : item.id}
            aria-expanded={openFaqId === item.id}
          >
            <span class="faq-q-text">{item.q}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"
              style="transform:{openFaqId === item.id ? 'rotate(180deg)' : 'rotate(0deg)'};transition:transform 0.22s;flex-shrink:0">
              <path d="M6 9l6 6 6-6" stroke="{muted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          {#if openFaqId === item.id}
            <div class="faq-a"><p>{item.a}</p></div>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <!-- ⑦ 브랜드 마퀴 -->
  <div class="brand-marquee-wrap">
    <div class="cz-track">
      {#each BRAND_SET as brand}
        <div class="cz-logo">
          <img src={brand.src} alt={brand.alt} class="cz-logo-img"/>
        </div>
      {/each}
    </div>
  </div>

  <!-- ⑧ 모바일 하단 탭바 -->
  <div class="m-tab-bar">
    {#each MOBILE_TABS as tab}
      <button
        class="m-tab-item"
        class:tab-active={mActiveTab === tab.id}
        class:tab-popping={poppingTab === tab.id}
        onclick={() => { mActiveTab = tab.id; triggerPop(tab.id); if (tab.id === 'All') goto('/products'); if (tab.id === 'More') moreMenuOpen = true }}
      >
        {#if tab.id === 'More'}
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="17" viewBox="0 0 20 17" fill="none" aria-hidden="true">
            <path d="M18.5 6.75C19.3284 6.75 20 7.42157 20 8.25C20 9.07843 19.3284 9.75 18.5 9.75H1.5C0.671573 9.75 0 9.07843 0 8.25C0 7.42157 0.671573 6.75 1.5 6.75H18.5Z" fill="#CF0000"/>
            <path d="M18.5 14C19.1904 14 19.75 14.5596 19.75 15.25C19.75 15.9404 19.1904 16.5 18.5 16.5H1.5C0.809644 16.5 0.25 15.9404 0.25 15.25C0.25 14.5596 0.809644 14 1.5 14H18.5ZM18.5 0C19.1904 0 19.75 0.559644 19.75 1.25C19.75 1.94036 19.1904 2.5 18.5 2.5H1.5C0.809644 2.5 0.25 1.94036 0.25 1.25C0.25 0.559644 0.809644 0 1.5 0H18.5Z" fill="#201857"/>
          </svg>
        {:else if tab.id === 'All'}
          <svg xmlns="http://www.w3.org/2000/svg" width="21" height="20" viewBox="0 0 21 20" fill="none" aria-hidden="true">
            <path d="M0.410645 9.70711C0.410645 8.03551 1.9244 7.4292 3.41064 8.17676L8.91099 11.1096C9.54029 11.4261 10.281 11.4261 10.9103 11.1096L16.8046 8.17674C18.2908 7.42917 19.9106 8.03551 19.9106 9.70711V13.8328C19.9106 14.7198 19.3922 15.524 18.5871 15.8858L11.2342 19.6161C10.654 19.8769 9.49121 19.8769 8.91099 19.6161L1.73415 15.8858C0.92905 15.524 0.410645 14.7198 0.410645 13.8328V9.70711Z" fill="#CF0000"/>
            <path d="M17.3203 7.37376C17.3203 6.81909 17.0084 6.31056 16.5117 6.05481L10.8516 3.14017C10.4181 2.91705 9.90222 2.91705 9.46875 3.14017L3.80859 6.05481C3.31189 6.31056 3 6.81909 3 7.37376V12.6805C3 13.2352 3.31189 13.7437 3.80859 13.9994L9.46875 16.9141C9.90222 17.1372 10.4181 17.1372 10.8516 16.9141L16.5117 13.9994C17.0084 13.7437 17.3203 13.2352 17.3203 12.6805V7.37376ZM20.3203 12.6805C20.3203 14.3444 19.3855 15.87 17.8955 16.6373L12.4106 19.4977C11.1099 20.1674 9.40032 20.1674 8.09963 19.4977L2.4248 16.6373C0.934852 15.87 0 14.3444 0 12.6805V7.37376C0 5.70987 0.934852 4.18421 2.4248 3.41693L8.08496 0.502283C9.38566 -0.167428 10.9347 -0.167428 12.2354 0.502283L17.8955 3.41693C19.3855 4.18421 20.3203 5.70987 20.3203 7.37376V12.6805Z" fill="#201857"/>
          </svg>
        {:else if tab.id === 'Home'}
          <svg xmlns="http://www.w3.org/2000/svg" width="21" height="20" viewBox="0 0 21 20" fill="none" aria-hidden="true">
            <path d="M10.5009 5.89594e-07C11.5905 0.000624114 12.7132 0.41156 13.7051 0.927735C14.7246 1.45838 15.7471 2.1745 16.6718 2.94629C17.5985 3.71968 18.4602 4.57667 19.1513 5.40918C19.8181 6.21242 20.4175 7.10114 20.6972 7.9375C20.9959 8.83055 21.0275 10.0069 20.9843 11.085C20.939 12.2175 20.7986 13.4581 20.6357 14.5908C20.4722 15.7284 20.2828 16.7835 20.1347 17.5527C20.0606 17.9378 19.996 18.2528 19.9502 18.4727C19.9273 18.5826 19.9092 18.6691 19.8965 18.7285C19.8901 18.758 19.8853 18.781 19.8818 18.7969C19.8801 18.8046 19.8789 18.8111 19.8779 18.8154C19.8774 18.8176 19.8759 18.8213 19.8759 18.8213V18.8232C19.6974 19.6322 18.8968 20.1434 18.0879 19.9648C17.2789 19.7863 16.7678 18.9857 16.9463 18.1768L16.9472 18.1729C16.9479 18.1699 16.9488 18.1653 16.9502 18.1592C16.953 18.146 16.9571 18.1254 16.9629 18.0986C16.9744 18.045 16.9921 17.9648 17.0136 17.8613C17.0567 17.6543 17.1176 17.3538 17.1884 16.9854C17.3305 16.247 17.5111 15.241 17.666 14.1641C17.8216 13.082 17.9477 11.9536 17.9873 10.9648C18.029 9.9219 17.9632 9.22379 17.8515 8.88965C17.7482 8.58082 17.43 8.03259 16.8427 7.3252C16.2797 6.647 15.5508 5.91839 14.75 5.25C13.9472 4.57999 13.1039 3.9967 12.3203 3.58887C11.5092 3.16673 10.8901 3.00021 10.499 3C10.119 2.99985 9.50282 3.16863 8.68357 3.60449C7.89443 4.02435 7.04446 4.62328 6.23533 5.30566C5.42838 5.98623 4.69417 6.72284 4.13083 7.39746C3.53803 8.1074 3.23492 8.63098 3.14841 8.88965C3.03673 9.22378 2.9709 9.92188 3.01267 10.9648C3.05227 11.9536 3.17836 13.082 3.33396 14.1641C3.48883 15.241 3.6694 16.247 3.8115 16.9854C3.8824 17.3538 3.94319 17.6543 3.9863 17.8613C4.00785 17.9648 4.02557 18.045 4.03708 18.0986C4.04284 18.1254 4.04692 18.146 4.04978 18.1592C4.05111 18.1653 4.05206 18.1699 4.05271 18.1729L4.05368 18.1768L4.07908 18.3281C4.16711 19.0833 3.67051 19.7975 2.91208 19.9648C2.15386 20.1321 1.40314 19.6935 1.16501 18.9717L1.124 18.8232V18.8213C1.124 18.8213 1.1235 18.8176 1.12302 18.8154C1.12207 18.8111 1.11984 18.8047 1.11814 18.7969C1.11468 18.781 1.10981 18.7579 1.10349 18.7285C1.09073 18.6691 1.07265 18.5825 1.04978 18.4727C1.00399 18.2527 0.939316 17.9378 0.865208 17.5527C0.717175 16.7835 0.527812 15.7284 0.364231 14.5908C0.201344 13.4581 0.0609608 12.2175 0.0155987 11.085C-0.0275806 10.0069 0.00401917 8.83057 0.302708 7.9375C0.571737 7.13324 1.17202 6.26032 1.8281 5.47461C2.51375 4.65351 3.37435 3.79483 4.30173 3.0127C5.22698 2.23238 6.25185 1.5001 7.27439 0.956055C8.2668 0.42806 9.40003 -0.00058024 10.5009 5.89594e-07Z" fill="#201857"/>
            <path d="M12.25 17.5C12.25 18.4665 11.4665 19.25 10.5 19.25C9.53347 19.25 8.74997 18.4665 8.74997 17.5V14C8.74997 13.0335 9.53347 12.25 10.5 12.25C11.4665 12.25 12.25 13.0335 12.25 14V17.5Z" fill="#CF0000"/>
          </svg>
        {:else if tab.id === 'Cart'}
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="20" viewBox="0 0 22 20" fill="none" aria-hidden="true">
            <path d="M7.99919 20C5.88901 20 4.0824 19.2485 2.75115 17.874C1.52311 16.6061 0.785015 14.8992 0.495286 12.9902L0.443529 12.6055L0.440599 12.584L0.438646 12.5615L0.00602908 7.70508C-0.0675772 6.87997 0.5413 6.15083 1.36638 6.07715C2.19153 6.00354 2.9207 6.61332 2.99431 7.43848L3.42302 12.251L3.46208 12.543C3.67975 13.9768 4.20499 15.0629 4.90642 15.7871C5.63327 16.5374 6.64321 17 7.99919 17L13.1984 17C14.5546 17 15.5653 16.5376 16.2922 15.7871C17.0369 15.0182 17.5833 13.8414 17.7736 12.2734L18.2043 7.43848C18.2779 6.61349 19.0063 6.00382 19.8312 6.07715C20.6564 6.15076 21.2662 6.87993 21.1926 7.70508L20.759 12.5615L20.757 12.584L20.7551 12.6055C20.5096 14.6694 19.7564 16.5215 18.4465 17.874C17.1152 19.2484 15.3085 20 13.1984 20L7.99919 20Z" fill="#201857"/>
            <path d="M12.5653 7.5V5.08496C12.5653 4.27678 12.2702 3.79435 11.9296 3.49609C11.5533 3.16675 11.0458 3.0001 10.5995 3C10.1532 3 9.64579 3.16678 9.2694 3.49609C8.92865 3.79434 8.63271 4.2766 8.63269 5.08496V7.5C8.63269 8.32843 7.96111 9 7.13269 9C6.30426 9 5.63269 8.32843 5.63269 7.5V5.08496C5.63271 3.4263 6.2903 2.11575 7.29284 1.23828C8.25978 0.39198 9.48643 0 10.5995 0C11.7124 9.12656e-05 12.9383 0.392127 13.9051 1.23828C14.9077 2.11575 15.5653 3.42629 15.5653 5.08496V7.5C15.5653 8.32843 14.8937 9 14.0653 9C13.2887 8.9999 12.6499 8.40969 12.5731 7.65332L12.5653 7.5Z" fill="#CF0000"/>
          </svg>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="21" viewBox="0 0 18 21" fill="none" aria-hidden="true">
            <path d="M3.5166 9.80831C4.25743 9.43754 5.15853 9.73838 5.5293 10.4792C5.89994 11.22 5.60015 12.1212 4.85938 12.4919C3.60299 13.1209 3.00006 14.1566 3 15.0007C3.00025 15.4743 3.35259 16.0962 4.6875 16.6745C5.95258 17.2226 7.64741 17.4997 9.13574 17.4997C10.6231 17.4997 12.2387 17.2221 13.4238 16.6843C14.6471 16.1291 14.9988 15.522 14.999 15.0007C14.999 14.1565 14.3959 13.1209 13.1387 12.4919C12.3979 12.1212 12.0982 11.2201 12.4688 10.4792C12.8394 9.73832 13.7406 9.43766 14.4814 9.80831C16.502 10.8192 17.9987 12.7626 17.999 14.9997C17.9988 17.2791 16.3041 18.6724 14.6641 19.4167C12.9854 20.1785 10.9196 20.4997 9.13574 20.4997C7.35304 20.4997 5.23002 20.179 3.49512 19.4274C1.83041 18.7063 0 17.3272 0 14.9997L0.00390625 14.7917C0.0935471 12.6428 1.55959 10.7878 3.5166 9.80831Z" fill="#201857"/>
            <path d="M11.1886 4.80273C11.1886 3.51944 10.1692 2.50005 8.88591 2.5C7.60258 2.5 6.58317 3.51941 6.58317 4.80273C6.58323 6.08601 7.60261 7.10547 8.88591 7.10547C10.1692 7.10541 11.1886 6.08598 11.1886 4.80273ZM13.6886 4.80273C13.6886 7.46669 11.5499 9.60541 8.88591 9.60547C6.2219 9.60547 4.08323 7.46673 4.08317 4.80273C4.08317 2.13869 6.22187 0 8.88591 0C11.5499 5.49456e-05 13.6886 2.13873 13.6886 4.80273Z" fill="#CF0000"/>
          </svg>
        {/if}
        <span class="m-tab-label" style="color:{mActiveTab === tab.id ? navy : muted}">{tab.label}</span>
      </button>
    {/each}
  </div>

  <MobileMoreMenu open={moreMenuOpen} onclose={() => { moreMenuOpen = false; mActiveTab = 'Home' }} />
</div><!-- /mobile-wrap -->

<style>
  /* ── 반응형 래퍼 ── */
  .desktop-wrap { display: none; background: var(--cs-lilac); overflow-x: hidden; }
  .mobile-wrap  { display: block; background: var(--cs-lilac); padding-bottom: 80px; overflow-x: hidden; }
  @media (min-width: 768px) {
    .desktop-wrap { display: block; }
    .mobile-wrap  { display: none; }
  }

  /* ── 공통 섹션 패턴 ── */
  .d-section {
    max-width: var(--layout-pc-max);
    margin: 0 auto;
    padding: 80px 40px;
    display: flex;
    flex-direction: column;
    gap: 40px;
  }
  .m-section {
    padding: 40px 20px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .section-head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .section-title {
    font-family: var(--font-kr-heading);
    font-size: 28px;
    font-weight: 900;
  }
  .section-sub {
    font-family: var(--font-kr);
    font-size: 15px;
    font-weight: 700;
    text-align: center;
    color: #444;
    line-height: 1.7;
  }

  /* ── DESKTOP HERO ── */
  .d-hero {
    position: relative;
    width: 100%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 936px;
    background: linear-gradient(252deg, rgb(229,193,109) 2%, rgb(164,233,225) 98%);
  }
  /* DB 배너 오버레이 (마이그레이션 #45 이후) */
  .d-hero-banner-link {
    position: absolute;
    inset: 0;
    display: block;
  }
  .d-hero-banner-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .m-hero-banner-link {
    position: absolute;
    inset: 0;
    display: block;
  }
  .d-hero-left {
    position: absolute;
    bottom: 0;
    left: 4%;
    height: 96%;
    object-fit: contain;
    object-position: bottom;
    pointer-events: none;
  }
  .d-hero-right {
    position: absolute;
    bottom: 0;
    right: 2%;
    height: 100%;
    object-fit: contain;
    object-position: bottom;
    pointer-events: none;
  }
  .d-hero-copy {
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    margin-top: 48px;
  }
  .d-hero-line1 { display: flex; align-items: flex-end; gap: 12px; }
  .d-hero-saengae {
    font-family: var(--font-kr-heading);
    font-size: 44px;
    color: #f64572;
    line-height: 1;
  }
  .d-hero-first {
    font-family: var(--font-en-display);
    font-size: 80px;
    color: white;
    line-height: 1;
    font-style: italic;
  }
  .d-hero-rental {
    font-family: var(--font-kr-heading);
    font-size: 110px;
    color: white;
    letter-spacing: 4px;
    line-height: 1;
    text-shadow: 4px 4px 0 rgba(30,10,70,0.3);
  }
  .d-hero-badge {
    background: rgba(255,33,136,0.7);
    border: 2px solid rgba(255,255,255,0.3);
    border-radius: 5px;
    padding: 8px 32px;
    margin-top: 4px;
  }
  .d-hero-badge-text {
    font-family: var(--font-kr-heading);
    font-size: 52px;
    color: white;
    letter-spacing: 4px;
    text-shadow: 4px 4px 0 rgba(146,2,79,0.6);
  }

  /* ── PICK CIRCLES ── */
  .d-pick-section { align-items: center; }
  .m-pick-section { align-items: center; }
  .pick-circles {
    display: flex;
    gap: 28px;
    align-items: flex-start;
    justify-content: center;
    flex-wrap: wrap;
  }
  .pick-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    background: none;
    border: none;
    cursor: pointer;
    transition: transform 0.2s;
  }
  .pick-item:hover { transform: scale(1.06); }
  .pick-item:active { transform: scale(0.95); }
  .pick-img-wrap {
    border-radius: 50%;
    overflow: hidden;
    border: 3px solid #e1def3;
    box-shadow: 0 4px 16px rgba(59,47,138,0.18);
    flex-shrink: 0;
  }
  .pick-img-wrap--lg { width: 180px; height: 180px; }
  .pick-img-wrap--sm { width: 130px; height: 130px; }
  .pick-img { width: 100%; height: 100%; object-fit: cover; }
  .pick-label-wrap { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .pick-label { font-family: var(--font-kr); font-size: 15px; font-weight: 700; color: #201857; }
  .pick-sub   { font-family: var(--font-kr); font-size: 13px; font-weight: 500; color: #201857; }

  /* ── HIGHLIGHT CARDS ── */
  .d-hl-cards {
    display: flex;
    gap: 12px;
    justify-content: center;
    padding: 24px 40px;
    max-width: var(--layout-pc-max);
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }
  .hl-card {
    position: relative;
    flex-shrink: 0;
    overflow: hidden;
    cursor: pointer;
    width: 300px;
    height: 300px;
    border-radius: 50px;
    transition: transform 0.2s, box-shadow 0.2s;
  }
  .hl-card:hover { transform: translateY(-6px) scale(1.02); }
  .hl-card-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .hl-card-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, #100b32 0%, rgba(16,11,50,0.6) 40%, transparent 100%);
  }
  .hl-card-info {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    padding: 28px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .hl-card-badges { display: flex; gap: 8px; }
  .hl-badge {
    border-radius: 9999px;
    width: 40px; height: 40px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .hl-cat  { font-family: var(--font-kr); font-size: 15px; font-weight: 700; color: white; }
  .hl-name { font-family: var(--font-en-display); font-size: 26px; color: white; line-height: 1.3; }
  .hl-price { font-family: var(--font-en-display); font-size: 26px; line-height: 1.3; }

  /* ── CATEGORY + SLIDER ── */
  .d-cat-section { gap: 32px; }
  .pkg-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 40px;
    background: var(--cs-lilac);
  }
  .pkg-bar-label { font-family: var(--font-en-display); font-size: 18px; color: var(--cs-dark); }
  .pkg-bar-icon {
    width: 22px; height: 22px; border-radius: 7px;
    background: #e1def3;
    display: flex; align-items: center; justify-content: center;
  }
  .cat-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 40px;
    justify-content: center;
    padding: 0 20px;
  }
  .cat-tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    background: none;
    border: none;
    cursor: pointer;
    width: 100px;
    min-height: 44px;
  }
  .cat-tab-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100px; height: 100px;
    border-radius: 30px;
    transition: background 0.18s;
  }
  .cat-tab-label {
    font-family: var(--font-kr);
    font-size: 15px;
    font-weight: 700;
    color: var(--cs-dark);
  }
  .michil-heading { display: flex; justify-content: center; }
  .michil-title {
    font-family: var(--font-kr-heading);
    font-size: 32px;
    font-weight: 900;
    color: #201857;
  }

  /* 슬라이더 */
  .prod-slider-wrap { position: relative; }
  .slider-arrow {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 10;
    width: 40px; height: 40px;
    border-radius: 9999px;
    background: white;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 16px rgba(0,0,0,0.15);
    transition: transform 0.15s;
    min-width: 44px; min-height: 44px;
  }
  .slider-arrow:hover { transform: translateY(-50%) scale(1.1); }
  .slider-arrow.left  { left: -22px; }
  .slider-arrow.right { right: -22px; }
  .prod-slider {
    display: flex;
    gap: 24px;
    overflow-x: auto;
    padding-bottom: 16px;
    padding-inline: 8px;
    scrollbar-width: none;
  }
  .prod-slider::-webkit-scrollbar { display: none; }
  .prod-card {
    position: relative;
    flex-shrink: 0;
    overflow: hidden;
    cursor: pointer;
    width: 300px; height: 580px;
    background: #e1def3;
    border-radius: 50px 50px 50px 20px;
    transition: transform 0.2s;
  }
  .prod-card:hover { transform: translateY(-8px); }
  .prod-card-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .prod-card-fade {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 180px;
    background: linear-gradient(to top, rgba(225,222,243,0.95) 0%, rgba(225,222,243,0.8) 30%, transparent 100%);
  }
  .prod-card-info {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    padding: 24px 32px;
  }
  .prod-card-price { font-family: var(--font-kr); font-size: 22px; font-weight: 900; color: var(--cs-dark); line-height: 2; }
  .prod-card-name  { font-family: var(--font-kr); font-size: 15px; font-weight: 700; color: #444; }
  .prod-card-desc  { font-family: var(--font-kr); font-size: 12px; font-weight: 400; color: #444; }

  /* ── BLOG GRID ── */
  .d-blog-section { align-items: center; gap: 32px; }
  .blog-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 20px;
    height: 540px;
    width: 100%;
  }
  .blog-main-card {
    position: relative;
    overflow: hidden;
    cursor: pointer;
    border-radius: 50px;
    grid-row: 1 / 3;
    transition: transform 0.2s;
  }
  .blog-main-card:hover { transform: scale(1.01); }
  .blog-sub-card {
    position: relative;
    overflow: hidden;
    cursor: pointer;
    border-radius: 50px;
    transition: transform 0.2s;
  }
  .blog-sub-card:hover { transform: scale(1.01); }
  .blog-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .blog-main-header, .blog-sub-header {
    position: relative;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 40px;
  }
  .blog-cat-label { font-family: var(--font-en-display); font-size: 20px; color: white; }
  .blog-main-footer {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    padding: 40px;
    background: linear-gradient(to top, rgba(16,11,50,0.8) 0%, transparent 100%);
  }
  .blog-main-caption { font-family: var(--font-kr); font-size: 22px; font-weight: 900; color: white; line-height: 1.5; }

  /* ── FAQ ── */
  .d-faq-section {
    flex-direction: row;
    gap: 64px;
    align-items: flex-start;
  }
  .faq-brand-box {
    flex-shrink: 0;
    width: 480px;
    min-height: 400px;
    border-radius: 50px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    padding: 40px;
  }
  .faq-logo {
    display: flex;
    flex-direction: column;
    line-height: 1;
    align-items: center;
  }
  .logo-crazy-lg {
    font-family: var(--font-kr-heading);
    font-size: 30px;
    color: #cf0000;
    font-weight: 900;
    letter-spacing: 0.06em;
  }
  .logo-shot-lg {
    font-family: var(--font-en-display);
    font-size: 26px;
    color: #100b32;
    letter-spacing: 0.08em;
  }
  .faq-brand-text {
    font-family: var(--font-kr-heading);
    font-size: 28px;
    font-weight: 900;
    text-align: center;
    line-height: 1.4;
  }
  .faq-col { flex: 1; display: flex; flex-direction: column; gap: 32px; }
  .faq-intro { font-family: var(--font-kr); font-size: 22px; font-weight: 900; color: #444; }
  .faq-list { display: flex; flex-direction: column; gap: 16px; width: 100%; }
  .faq-item { border-radius: 20px; overflow: hidden; }
  .faq-q {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 32px;
    background: #3b2f8a;
    border: none;
    cursor: pointer;
    text-align: left;
    min-height: 44px;
  }
  .faq-q-text { font-family: var(--font-kr); font-size: 15px; font-weight: 700; color: white; line-height: 1.6; flex: 1; }
  .faq-a {
    background: #2d2470;
    padding: 20px 32px;
  }
  .faq-a p { font-family: var(--font-kr); font-size: 14px; color: #c1bbec; line-height: 1.8; margin: 0; }

  /* ── BRAND MARQUEE ── */
  .brand-marquee-wrap {
    background: white;
    overflow: hidden;
    padding: 28px 0;
  }
  .cz-track {
    display: flex;
    align-items: center;
    gap: 80px;
    width: max-content;
    animation: cz-marquee 22s linear infinite;
  }
  .cz-track:hover { animation-play-state: paused; }
  @keyframes cz-marquee {
    from { transform: translateX(0); }
    to   { transform: translateX(-50%); }
  }
  .cz-logo {
    height: 38px;
    flex-shrink: 0;
    opacity: 0.55;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .cz-logo:hover { opacity: 1; }
  .cz-logo-img { height: 100%; max-width: 160px; object-fit: contain; }

  /* ── MOBILE HERO ── */
  .m-hero {
    position: relative;
    width: 100%;
    overflow: hidden;
    height: 720px;
    background: #fdefc3;
  }
  .m-hero-watermark {
    position: absolute;
    left: -24px;
    top: 80px;
    font-family: var(--font-kr-heading);
    font-size: 60px;
    color: #fff8e1;
    opacity: 0.5;
    line-height: 0.88;
    white-space: nowrap;
    pointer-events: none;
    user-select: none;
  }
  .m-hero-bg {
    position: absolute;
    top: 20px;
    left: 0;
    width: 100%;
    height: 680px;
    object-fit: cover;
    object-position: top;
    pointer-events: none;
  }
  .m-hero-stripes {
    position: absolute;
    left: 0; right: 0;
    bottom: 82px;
    display: flex;
    flex-direction: column;
  }
  .m-hero-overlay {
    position: absolute;
    left: 0;
    bottom: 72px;
    width: 100%;
    height: 340px;
    object-fit: cover;
    object-position: top;
    pointer-events: none;
  }
  .m-hero-copy {
    position: absolute;
    left: 28px;
    bottom: 140px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .m-hero-tag1 {
    background: #ff9581;
    padding: 4px 16px;
    align-self: flex-start;
    font-family: var(--font-kr);
    font-size: 22px;
    color: white;
    font-weight: 500;
  }
  .m-hero-tag2 {
    background: rgba(250,232,177,0.5);
    padding: 4px 8px;
    font-family: var(--font-kr-heading);
    font-size: 38px;
    color: white;
    line-height: 1.3;
  }
  .m-hero-tag3 {
    background: #02c5f1;
    padding: 4px 16px;
    align-self: flex-start;
    font-family: var(--font-kr);
    font-size: 17px;
    color: white;
    font-weight: 500;
  }
  .m-hero-tag3 b { font-size: 19px; font-weight: 700; }
  .m-hero-cta {
    background: #d30071;
    padding: 8px 20px;
    border-radius: 15px;
    align-self: flex-start;
    margin-top: 4px;
    font-family: var(--font-kr);
    font-size: 22px;
    color: white;
    font-weight: 900;
  }

  /* ── SNAP SLIDER ── */
  .m-snap-slider {
    display: flex;
    gap: 16px;
    overflow-x: auto;
    padding-bottom: 8px;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
  }
  .m-snap-slider::-webkit-scrollbar { display: none; }

  /* PACKAGES */
  .m-pkg-card {
    position: relative;
    flex-shrink: 0;
    overflow: hidden;
    cursor: pointer;
    width: 300px; height: 560px;
    background: #1d183e;
    border-radius: 50px;
    scroll-snap-align: center;
    transition: transform 0.15s;
  }
  .m-pkg-card:active { transform: scale(0.97); }
  .m-pkg-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .m-pkg-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(to top, rgba(16,11,50,0.95) 0%, rgba(16,11,50,0.6) 40%, transparent 100%);
  }
  .m-pkg-info { position: absolute; bottom: 0; left: 0; right: 0; padding: 28px; display: flex; flex-direction: column; gap: 12px; }
  .m-pkg-badges { display: flex; gap: 8px; }
  .m-pkg-cat-badge {
    border-radius: 15px;
    padding: 2px 16px;
    align-self: flex-start;
    font-family: var(--font-kr);
    font-size: 13px;
    color: white;
    font-weight: 500;
  }
  .m-pkg-name  { font-family: var(--font-kr); font-size: 22px; font-weight: 900; color: white; line-height: 1.4; }
  .m-pkg-price { font-family: var(--font-kr); font-size: 19px; font-weight: 700; margin-top: 4px; }

  /* DOT INDICATORS */
  .dot-indicators { display: flex; justify-content: center; gap: 8px; }
  .dot {
    height: 10px;
    width: 10px;
    background: #c1bbec;
    border-radius: 9999px;
    opacity: 0.4;
    transition: width 0.2s, opacity 0.2s;
  }
  .dot.active { width: 28px; opacity: 0.8; }

  /* MOBILE MICHIL */
  .m-michil-section { padding-top: 40px; }
  .m-michil-head { padding: 0; }
  .m-prod-card {
    position: relative;
    flex-shrink: 0;
    overflow: hidden;
    cursor: pointer;
    width: 260px; height: 450px;
    background: #e1def3;
    border-radius: 50px 50px 50px 20px;
    scroll-snap-align: center;
    transition: transform 0.15s;
  }
  .m-prod-card:active { transform: scale(0.97); }
  .m-prod-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .m-prod-dots {
    position: absolute;
    top: 16px;
    left: 0; right: 0;
    display: flex;
    justify-content: center;
    gap: 8px;
    z-index: 10;
  }
  .m-prod-fade {
    position: absolute; bottom: 0; left: 0; right: 0;
    height: 190px;
    background: linear-gradient(to top, rgba(225,222,243,0.95) 0%, rgba(225,222,243,0.85) 30%, transparent 100%);
  }
  .m-prod-info { position: absolute; bottom: 0; left: 0; right: 0; padding: 0 28px 28px; }
  .m-prod-name  { font-family: var(--font-kr); font-size: 17px; font-weight: 700; color: var(--cs-dark); }
  .m-prod-price { font-family: var(--font-kr); font-size: 15px; font-weight: 700; }
  .m-prod-desc  { font-family: var(--font-kr); font-size: 13px; font-weight: 500; color: #666; }

  /* ── MOBILE BLOG ── */
  .m-blog-section {
    background: #ffb3b3;
    border-radius: 0 50px 0 0;
    padding: 48px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
  }
  .m-blog-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 32px;
    justify-content: center;
  }
  .m-blog-card {
    position: relative;
    overflow: hidden;
    cursor: pointer;
    width: 300px; height: 380px;
    border-radius: 30px;
    box-shadow: 4px 4px 0 rgba(39,27,122,0.5);
    transition: transform 0.15s;
  }
  .m-blog-card:active { transform: scale(0.97); }
  .m-blog-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .m-blog-header {
    position: absolute;
    top: 0; left: 0; right: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
  }
  .m-blog-footer {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    padding: 24px;
    background: linear-gradient(to top, rgba(16,11,50,0.85) 0%, transparent 100%);
  }
  .m-blog-title { font-family: var(--font-kr); font-size: 21px; font-weight: 900; color: white; line-height: 1.4; margin: 0; }
  .m-blog-desc  { font-family: var(--font-kr); font-size: 16px; font-weight: 700; color: white; margin: 4px 0 0; }

  /* ── MOBILE ARTICLES ── */
  .m-articles-section { gap: 24px; }
  .m-articles-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 0;
  }
  .m-articles-heading { font-family: var(--font-kr); font-size: 20px; font-weight: 700; color: var(--cs-dark); }
  .m-articles-more-btn {
    width: 22px; height: 22px;
    border-radius: 7px;
    background: #e1def3;
    display: flex; align-items: center; justify-content: center;
  }
  .m-article-card {
    background: white;
    border-radius: 30px;
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.15s;
  }
  .m-article-card:active { transform: scale(0.98); }
  .m-article-img-wrap { height: 150px; position: relative; }
  .m-article-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .m-article-body { padding: 20px 28px; }
  .m-article-title { font-family: var(--font-kr); font-size: 17px; font-weight: 700; color: #444; line-height: 1.5; margin: 0; }
  .m-article-meta  { font-family: var(--font-kr); font-size: 12px; font-weight: 500; color: #666; margin: 4px 0 0; }

  /* ── MOBILE FAQ ── */
  .m-faq-section { gap: 24px; }
  .m-faq-brand {
    border-radius: 50px;
    min-height: 180px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .m-faq-intro-wrap { display: flex; flex-direction: column; gap: 8px; }

  /* ── MOBILE TAB BAR ── */
  .m-tab-bar {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    z-index: 50;
    background: var(--cs-lilac);
    box-shadow: 0 -4px 24px rgba(0,0,0,0.1);
    display: flex;
    justify-content: center;
    align-items: center;
    height: 70px;
  }
  .m-tab-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    cursor: pointer;
    min-width: 60px;
    min-height: 60px;
    justify-content: center;
    flex: 1;
    max-width: 78px;
  }
  .m-tab-label { font-family: var(--font-kr); font-size: 11px; font-weight: 500; }

  @keyframes tab-bubble {
    0%   { transform: scale(1); }
    25%  { transform: scale(1.4); }
    55%  { transform: scale(0.88); }
    75%  { transform: scale(1.12); }
    100% { transform: scale(1); }
  }
  .tab-popping svg {
    animation: tab-bubble 0.65s cubic-bezier(0.36, 0.07, 0.19, 0.97) forwards;
  }
</style>
