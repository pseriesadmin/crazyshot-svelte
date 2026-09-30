<script lang="ts">
  import { goto } from '$app/navigation'
  import MobileMoreMenu from '$lib/components/common/MobileMoreMenu.svelte'
  import HomeBannerModal from '$lib/components/home/admin/HomeBannerModal.svelte'
  import HomeThemeGroupModal from '$lib/components/home/admin/HomeThemeGroupModal.svelte'
  import ProductCategoryModal from '$lib/components/products/admin/ProductCategoryModal.svelte'
  import HomeCategoryProductsModal from '$lib/components/home/admin/HomeCategoryProductsModal.svelte'
  import ProductMdPickModal from '$lib/components/products/admin/ProductMdPickModal.svelte'
  import BrandMarquee from '$lib/components/products/BrandMarquee.svelte'
  import HelpHeroBgModal from '$lib/components/help/admin/HelpHeroBgModal.svelte'
  import {
    HELP_HERO_DEFAULT_TITLE, HELP_HERO_DEFAULT_SUB, HELP_HERO_DEFAULT_BG,
  } from '$lib/constants/helpHero'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // DB 배너 (마이그레이션 #45 적용 후 활성화) — 표시용 (is_active + 날짜 필터)
  const heroPC     = $derived(data.bannerMap?.['hero_pc']     ?? [])
  const heroMobile = $derived(data.bannerMap?.['hero_mobile'] ?? [])

  // ── 캐러셀 상태 ───────────────────────────────────────────────────
  let pcIdx    = $state(0)
  let mobileIdx = $state(0)
  let pcCarousel    = $state<typeof heroPC>([])
  let mobileCarousel = $state<typeof heroMobile>([])

  // 캐러셀 배열 초기화 (랜덤/고정 모드 반영)
  $effect(() => {
    const list = data.bannerMap?.['hero_pc'] ?? []
    pcCarousel = data.heroBannerSettings?.pc_mode === 'random'
      ? [...list].sort(() => Math.random() - 0.5)
      : [...list]
    pcIdx = 0
  })

  $effect(() => {
    const list = data.bannerMap?.['hero_mobile'] ?? []
    mobileCarousel = data.heroBannerSettings?.mobile_mode === 'random'
      ? [...list].sort(() => Math.random() - 0.5)
      : [...list]
    mobileIdx = 0
  })

  // 자동 슬라이드 (4초 인터벌)
  $effect(() => {
    if (pcCarousel.length <= 1) return
    const id = setInterval(() => {
      pcIdx = (pcIdx + 1) % pcCarousel.length
    }, 4000)
    return () => clearInterval(id)
  })

  $effect(() => {
    if (mobileCarousel.length <= 1) return
    const id = setInterval(() => {
      mobileIdx = (mobileIdx + 1) % mobileCarousel.length
    }, 4000)
    return () => clearInterval(id)
  })

  // ── CMS 배너 관리 모달 ──────────────────────────────────────────────
  let showBannerModal         = $state(false)
  let showThemeGroupModal     = $state(false)
  let showCategoryModal       = $state(false)
  let showCatProductsModal    = $state(false)
  let catProductsTabId        = $state('')
  let catProductsTabName      = $state('')
  let showMdPickModal         = $state(false)
  let showHelpHeroModal       = $state(false)
  // ── 로컬 컬러 (app.css 토큰에 없는 값) ──────────────────────────
  const navy     = '#100b32'
  const navyDeep = '#201857'
  const purple   = '#3b2f8a'
  const purpleLight = '#553fe0'
  const purplePale  = '#e1def3'
  const red      = '#ff3535'
  const redDeep  = '#cf0000'
  const muted    = '#c1bbec'

  // ── 더미 데이터 (PICKS_DESKTOP/PICKS_MOBILE 제거 — DB 테마그룹으로 대체) ──
  // HL_CARDS(하이라이트 카드) 제거 — 테마그룹과 무관한 순수 하드코딩이었음 (Stephen 확인 후 제거)

  // PRODUCTS 하드코딩 제거 — Phase 4에서 data.categoryProducts[activeTab](DB)으로 교체됨

  const PACKAGES = [
    { img:'/home/mobile/8c932c01a63712857026f826beb90a3293b5f28f.png', cat:'Casual log',  name:'소니 FX3 완전체 패키지',       price:'80,000원 / 1일' },
    { img:'/home/mobile/417c117d76ed4fe8925192eaadd1583287f78d2f.png', cat:'Casual log',  name:'Sony Alpha 7 Pack',             price:'80,000원 / 1일' },
    { img:'/home/mobile/fd32b27c7dfc24baba6f46b438189955d0192da8.png', cat:'Casual log',  name:'CANON 100mm F2.8 L IS USM',     price:'80,000원 / 1일' },
    { img:'/home/mobile/8a3ac2d8f7bcace345136452001ed2288550d883.png', cat:'Starter kit', name:'Sony FDR-AX43A 4K',             price:'$ 350 / 1w'     },
  ]

  // M_PRODUCTS 하드코딩 제거 — Phase 4에서 activeCatProds(DB)으로 교체됨

  // BLOG_M 제거 — data.crazylogPosts(DB 동기화)로 교체됨 (Phase 1-A)

  // ARTICLES 하드코딩 제거 — data.recentLogPosts(DB 동기화, /crazylog/list와 동일 소스)로 교체됨

  // /crazylog/list relativeTime()과 동일 로직 — "더 다양한 로그 둘러보기" 카드 시각 표시용
  function logRelativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime()
    const mins  = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days  = Math.floor(diff / 86400000)
    if (mins  <  1) return '방금 전'
    if (hours <  1) return `${mins}분 전`
    if (days  <  1) return `${hours}시간 전`
    if (days  < 30) return `${days}일 전`
    return new Date(iso).toLocaleDateString('ko-KR')
  }

  // FAQ_DESKTOP / FAQ_MOBILE 제거 — data.topFaqs(DB 동기화, canned_responses 상위5)로 교체됨 (Phase 1-B)

  const CATEGORY_ICON_BY_CODE: Record<string, string> = {
    hypepack:   'package',
    camera:     'camera',
    lens:       'aperture',
    phone:      'phone',
    light:      'zap',
    dronegim:   'plane',
    actcam:     'video',
    accessorie: 'wrench',
  }
  // /products의 카테고리 설정(product_page_categories)을 완전 공유 — displayCats 패턴 그대로
  // (src/routes/products/+page.svelte 정본): 저장된 항목만, sort_order 순, 커스텀 icon_url 반영.
  // 저장값이 없으면 /products와 동일하게 빈 배열(전체 code_mapping_groups를 임의 노출하지 않음).
  const CATEGORY_TABS = $derived((() => {
    const savedItems = data.categoryPageSettings?.items ?? []
    if (savedItems.length === 0) return []
    return [...savedItems]
      .sort((a, b) => a.sort_order - b.sort_order)
      .flatMap((item) => {
        const cat = data.categories.find((c) => c.id === item.code_id)
        if (!cat) return []
        return [{
          id:       cat.id,
          label:    cat.name,
          icon:     CATEGORY_ICON_BY_CODE[cat.code] ?? 'wrench',
          icon_url: (item as { icon_url?: string | null }).icon_url ?? null,
          icon_active_url: (item as { icon_active_url?: string | null }).icon_active_url ?? null,
        }]
      })
  })())

  // ── 상태 ──────────────────────────────────────────────────────────
  let activeTab = $state('camera')

  // 취향직격 테마 원형 탭(PC, Figma node 2072:5988 구조) — 원형 선택 시 그 테마의
  // 상품 하이라이트 슬라이드 1개만 아래에 표시(테마마다 개별 슬라이드 반복 아님)
  let activeThemeId = $state<string | null>(null)
  const activeThemeProducts = $derived(
    (data.themeGroups ?? []).find((g) => g.id === (activeThemeId ?? data.themeGroups?.[0]?.id))?.products ?? []
  )

  // Phase 4: 현재 탭의 큐레이션 상품 (categoryProducts[activeTab])
  const activeCatProds = $derived(
    (data.categoryProducts ?? {})[activeTab] ?? []
  )
  let openFaqId = $state<string | null>(null)
  let pkgIdx = $state(0)
  let mActiveTab = $state('Home')
  let poppingTab = $state<string | null>(null)
  let moreMenuOpen = $state(false)

  // ── 바텀 탭바 스크롤 인터랙션 (ui-mobile.md 강제 정책) ──────────
  let tabBarHidden = $state(false)
  let lastScrollY = 0
  function onTabBarScroll() {
    const y = window.scrollY
    if (y > lastScrollY && y > 50) tabBarHidden = true
    else if (y < lastScrollY)      tabBarHidden = false
    lastScrollY = y
  }
  $effect(() => {
    lastScrollY = window.scrollY
    window.addEventListener('scroll', onTabBarScroll, { passive: true })
    return () => window.removeEventListener('scroll', onTabBarScroll)
  })

  function triggerPop(id: string) {
    poppingTab = id
    setTimeout(() => { poppingTab = null }, 700)
  }

  // 취향직격 테마 원형탭(PC) — 좌우 화살표 제거(2026-09-30), 가로 스크롤(드래그·트랙패드)만 유지
  let themeTabsEl: HTMLDivElement | undefined = $state()

  // 취향직격 테마 원형탭(Mobile) — PC와 동일 구조(activeThemeId 공유)
  let mThemeTabsEl: HTMLDivElement | undefined = $state()

  // 선택한 원형 탭을 스크롤 트랙 중앙으로 부드럽게 이동 — PC·모바일 동일 동작
  // scrollIntoView({inline:'center'})는 브라우저별 편차가 있어(특히 Safari), 컨테이너·타겟의
  // 현재 위치를 직접 계산해 scrollBy로 이동 — 가장자리 항목은 스크롤 한계까지만 이동(자연스러운 clamping).
  function selectTheme(id: string, target: HTMLElement) {
    activeThemeId = id
    const container = target.closest<HTMLElement>('.theme-circle-tabs, .m-theme-circle-tabs')
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const delta = (targetRect.left + targetRect.width / 2) - (containerRect.left + containerRect.width / 2)
    container.scrollBy({ left: delta, behavior: 'smooth' })
  }

  let pkgSliderEl: { scrollLeft: number } | undefined
  function onPkgScroll() {
    if (!pkgSliderEl) return
    pkgIdx = Math.round(pkgSliderEl.scrollLeft / 316)
  }

  const MOBILE_TABS = [
    { id: 'More', label: 'More' },
    { id: 'All',  label: 'All'  },
    { id: 'Home', label: 'Home' },
    { id: 'Cart', label: 'Cart' },
    { id: 'My',   label: 'My'   },
  ]
</script>

<svelte:head>
  <title>CRAZYSHOT — 비대면 AI 검수 렌탈 플랫폼</title>
  <!-- 홈 모바일(≤640px)에서만 전역 푸터(+layout.svelte .site-footer, 전역 규칙으로 모바일 숨김)를 다시 노출(2026-09-29).
       <svelte:head> 스타일은 홈 화면을 벗어나면 제거되므로 다른 화면의 모바일 푸터 숨김에는 영향 없음.
       하단 고정 탭바(70px)에 푸터 끝이 가리지 않도록 하단 패딩 확보 -->
  <style>
    @media (max-width: 640px) {
      .site-footer { display: block !important; padding-bottom: 70px; }
    }
  </style>
</svelte:head>

{#snippet faqHero(extra: string)}
  <section class="mh-hero {extra}">
    <img src={data.faqHeroBgUrl || HELP_HERO_DEFAULT_BG} alt="" class="mh-hero-bg" />
    {#if data.isCms}
      <button class="mh-hero-edit-btn" onclick={() => (showHelpHeroModal = true)} aria-label="헬프 히어로 배경·문구 관리">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        BG 관리
      </button>
    {/if}
    <div class="mh-hero-gradient"></div>
    <div class="mh-hero-content">
      <div class="mh-hero-heading">
        <img src="/logo-bi-hero.svg" alt="크레이지샷" class="mh-hero-logo" width="109" height="72" />
        <h2 class="mh-hero-title">{data.faqHeroTitle || HELP_HERO_DEFAULT_TITLE}</h2>
        <p class="mh-hero-sub">{data.faqHeroSub || HELP_HERO_DEFAULT_SUB}</p>
      </div>
    </div>
  </section>
{/snippet}

<!-- ═══════════════════════════════════════════════════════════════
     DESKTOP (md↑)
════════════════════════════════════════════════════════════════ -->
<div class="desktop-wrap">

  <!-- ① Hero -->
  <div class="d-hero">
    {#if data.isCms}
      <button class="hero-cms-btn" onclick={() => (showBannerModal = true)}>⚙ 배너 관리</button>
    {/if}
    {#if pcCarousel.length > 0}
      {@const b = pcCarousel[pcIdx]}
      {#if b}
        {#if b.link_url}
          <a href={b.link_url} class="d-hero-banner-link">
            <img src={b.image_url} alt={b.title ?? ''} class="d-hero-banner-img" />
          </a>
        {:else}
          <img src={b.image_url} alt={b.title ?? ''} class="d-hero-banner-img" />
        {/if}
        {#if b.sub_copy}
          <div class="d-hero-sub-copy">{b.sub_copy}</div>
        {/if}
      {/if}
    {:else}
      <img src="/home/desktop/1fbafe64eb226e679021660588c1e5d840401f59.png" alt="" class="d-hero-left" aria-hidden="true"/>
      <img src="/home/desktop/1bbde5f74b1d99829b62da01db4cd68c18c25510.png" alt="" class="d-hero-right" aria-hidden="true"/>
    {/if}
  </div>

  <!-- ② 취향직격 PICK (PC) — Figma node 2072:5988 구조 그대로:
       [제목·부제(좌) + 원형 테마 탭(우)] 헤더 1줄 → 선택된 테마의 상품 하이라이트 슬라이드 1개.
       테마마다 개별 슬라이드를 반복하지 않고, 원형 탭 클릭 시 슬라이드 내용만 전환된다. -->
  <div class="d-section d-theme-section">
    <div class="theme-pick-row">
      <div class="theme-pick-head">
        <div class="theme-pick-title-wrap">
          <svg width="38" height="21" viewBox="0 0 38 21" fill="none" aria-hidden="true">
            <path d="M17.8899 0.218353C18.6016 -0.0728023 19.3988 -0.072768 20.1106 0.218353L20.262 0.28476L20.387 0.349213C20.995 0.681504 21.3406 1.19289 21.5178 1.47714C21.7224 1.80539 21.9327 2.22721 22.1321 2.62265L24.2747 6.87363L28.9592 5.30624C29.4012 5.15823 29.8653 5.00075 30.2551 4.90878C30.6075 4.8257 31.3078 4.68499 32.052 4.96542C32.9 5.28515 33.5462 5.97536 33.8196 6.82675C34.058 7.57012 33.8969 8.25404 33.801 8.60507C33.6952 8.99225 33.5215 9.45227 33.3567 9.89511L31.8293 13.9967L36.8264 16.2633C37.8322 16.7196 38.2776 17.9049 37.8215 18.9107C37.3651 19.9163 36.1798 20.3621 35.1741 19.9059L29.7776 17.4586C29.5783 17.3682 29.3209 17.2523 29.1028 17.1314C28.8626 16.9983 28.5301 16.7857 28.2366 16.4303C27.8561 15.9694 27.6248 15.4047 27.5706 14.8131C27.5289 14.3582 27.6129 13.9752 27.6877 13.7125C27.756 13.4731 27.8555 13.2084 27.9329 13.0006L29.2639 9.42148L25.134 10.8053C24.9449 10.8686 24.6962 10.9535 24.47 11.0103C24.2191 11.0734 23.8562 11.1416 23.427 11.0953C22.8646 11.0345 22.3332 10.8121 21.8958 10.4586C21.5626 10.1893 21.3547 9.88693 21.2219 9.6666C21.1019 9.46734 20.9848 9.23285 20.8938 9.05234L18.9993 5.2955L17.1067 9.05136V9.05234C17.0157 9.23282 16.8986 9.46742 16.7786 9.6666C16.6458 9.8869 16.4377 10.1894 16.1047 10.4586C15.6673 10.8119 15.1358 11.0346 14.5735 11.0953C14.1442 11.1415 13.7813 11.0734 13.5305 11.0103C13.3042 10.9534 13.0556 10.8686 12.8665 10.8053L8.7356 9.42148L10.0676 13.0006C10.145 13.2085 10.2445 13.4731 10.3127 13.7125C10.3876 13.9752 10.4716 14.3581 10.4299 14.8131C10.3757 15.4046 10.1444 15.9694 9.76392 16.4303C9.47044 16.7855 9.13786 16.9983 8.89771 17.1314C8.67964 17.2522 8.42204 17.3683 8.2229 17.4586L2.82642 19.9059C1.82066 20.3619 0.635292 19.9164 0.178955 18.9107C-0.277049 17.905 0.168563 16.7197 1.17407 16.2633L6.17017 13.9967L4.6438 9.89511C4.479 9.45221 4.30527 8.99228 4.19946 8.60507C4.10357 8.25406 3.94252 7.57005 4.18091 6.82675L4.23657 6.66953C4.53582 5.89099 5.15351 5.26527 5.94849 4.96542L6.08716 4.91757C6.77856 4.70212 7.41493 4.83087 7.74536 4.90878C8.13518 5.00072 8.59918 5.1582 9.04126 5.30624L13.7249 6.87363L15.8684 2.62265C16.0677 2.22732 16.2781 1.80535 16.4827 1.47714C16.6716 1.17402 17.0524 0.611777 17.7385 0.28476L17.8899 0.218353Z" fill="#FF3535"/>
          </svg>
          <span class="section-title" style="color:{redDeep}">취·향·직·격 PICK!</span>
        </div>
        <p class="theme-pick-desc">취향에 따라 상황에 맞춘 고민 따위 필요없이<br/>찰떡궁합 촬영 패키지 추천 받으세요.</p>
        {#if data.isCms}
          <button class="theme-cms-btn" onclick={() => (showThemeGroupModal = true)}>⚙ 테마그룹 관리</button>
        {/if}
      </div>

      {#if data.themeGroups && data.themeGroups.length > 0}
        <div class="theme-circle-tabs-wrap">
          <div class="theme-circle-tabs" class:theme-circle-tabs--capped={data.themeGroups.length > 3} bind:this={themeTabsEl}>
            {#each data.themeGroups as tg, i}
              {@const isActive = (activeThemeId ?? data.themeGroups[0].id) === tg.id}
              <button class="theme-circle-tab" onclick={(e) => selectTheme(tg.id, e.currentTarget as HTMLElement)} type="button" aria-pressed={isActive}>
                <div class="theme-hl-card theme-hl-card--circle" class:is-active={isActive}>
                  {#if tg.image_url}
                    <img src={tg.image_url} alt={tg.title} class="theme-hl-card-img"/>
                  {:else}
                    <div class="theme-group-img-ph" aria-hidden="true"></div>
                  {/if}
                </div>
                <div class="theme-circle-info">
                  <span class="theme-circle-name">{tg.title}</span>
                  {#if tg.sub_copy}
                    <span class="theme-circle-sub">{tg.sub_copy}</span>
                  {/if}
                </div>
                <!-- Figma node 2072:5959 Polygon6 실벡터 그대로 반영(채워진 삼각형, ChevronIcon과 다른 형태) -->
                <svg class="theme-tab-polygon" width="21" height="19" viewBox="0 0 21.1583 18.5113" fill="none" aria-hidden="true">
                  <path d="M8.8573 0.982543C9.63142 -0.327512 11.5269 -0.327516 12.301 0.982539L20.8727 15.4885C21.812 17.0781 20.2796 18.9829 18.5257 18.4057L11.2043 15.9966C10.7982 15.8629 10.3601 15.8629 9.95401 15.9966L2.63259 18.4057C0.878729 18.9829 -0.653715 17.0781 0.285591 15.4885L8.8573 0.982543Z" fill={isActive ? '#3b2f8a' : '#c1bbec'}/>
                </svg>
              </button>
            {/each}
          </div>
        </div>
      {:else}
        <!-- 테마그룹 0개 — 레이아웃 자리 유지용 샘플 원형탭(모든 방문자에게 노출, 신규 등록 시 가려짐) -->
        <div class="theme-circle-tabs theme-circle-tabs--sample">
          <div class="theme-circle-tab">
            <div class="theme-hl-card theme-hl-card--circle">
              <img src="/home/desktop/571a11c577774467d3b4cfa10fb7ea6ba6f178ba.png" alt="샘플 테마 배너" class="theme-hl-card-img"/>
            </div>
            <div class="theme-circle-info">
              <span class="theme-circle-name">Sample Theme</span>
              <span class="theme-circle-sub">테마그룹 등록 시 실제 콘텐츠가 표시됩니다</span>
            </div>
            <svg class="theme-tab-polygon" width="21" height="19" viewBox="0 0 21.1583 18.5113" fill="none" aria-hidden="true">
              <path d="M8.8573 0.982543C9.63142 -0.327512 11.5269 -0.327516 12.301 0.982539L20.8727 15.4885C21.812 17.0781 20.2796 18.9829 18.5257 18.4057L11.2043 15.9966C10.7982 15.8629 10.3601 15.8629 9.95401 15.9966L2.63259 18.4057C0.878729 18.9829 -0.653715 17.0781 0.285591 15.4885L8.8573 0.982543Z" fill="#3b2f8a"/>
            </svg>
          </div>
        </div>
      {/if}
    </div>

    {#if data.themeGroups && data.themeGroups.length > 0}
      {#if activeThemeProducts.length > 0}
        <!-- 표준 상품슬라이드 디자인(prod-card, "미칠 PICK"과 동일 규격) 재사용 -->
        <div class="prod-slider theme-prod-slider">
          {#each activeThemeProducts as prod}
            <div
              class="prod-card"
              onclick={() => goto('/products/' + (prod.slug || prod.id))}
              role="button"
              tabindex={0}
              onkeydown={(e) => e.key === 'Enter' && goto('/products/' + (prod.slug || prod.id))}
            >
              <img src={prod.image_urls?.[0] ?? '/favicon.png'} alt={prod.name} class="prod-card-img" loading="lazy"/>
              <div class="prod-card-info">
                <div class="prod-card-headline">
                  <span class="prod-card-name">{prod.name}</span>
                </div>
                <div class="prod-card-price">
                  {#if prod.sale_only}
                    <span class="price-label">Price</span><span class="price-num">{(prod.sale_price ?? 0).toLocaleString('ko-KR')}</span>
                  {:else}
                    {#if prod.price_24h}<span class="price-label">Day</span><span class="price-num">{prod.price_24h.toLocaleString('ko-KR')}</span>{/if}
                    {#if prod.price_24h && prod.price_12h}<span class="price-sep">/</span>{/if}
                    {#if prod.price_12h}<span class="price-label">12H</span><span class="price-num">{prod.price_12h.toLocaleString('ko-KR')}</span>{/if}
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {:else}
      <!-- 상품 슬라이드 샘플 더미 — 표준 상품슬라이드 디자인(prod-card)과 동일하게 구현,
           테마그룹 등록 시 이 자리에 실제 상품이 동일한 모습으로 노출됨 -->
      <div class="prod-slider theme-prod-slider">
        {#each [
          { img: '/home/desktop/0e5cfa4b24ea4086c4f8a27ab299ce413ce61789.png', cat: 'Starter kit', name: 'GOPRO HERO11', day: '35,000', h12: '25,000', desc: 'Ultra Compact Design Weighs Only' },
          { img: '/home/desktop/0f6bb06ce53ce5862f01e33b020560170e675963.png', cat: 'Starter kit', name: 'SONY ZV-E10', day: '42,000', h12: '28,000', desc: 'All-round Vlogging Camera' },
          { img: '/home/desktop/1bbde5f74b1d99829b62da01db4cd68c18c25510.png', cat: 'Starter kit', name: 'DJI OSMO POCKET', day: '28,000', h12: '19,000', desc: 'Pocket-size Stabilized Gimbal' },
        ] as sample}
          <div class="prod-card prod-card--sample">
            <img src={sample.img} alt={sample.name} class="prod-card-img"/>
            <div class="prod-card-info">
              <div class="prod-card-headline">
                <span class="prod-card-cat">{sample.cat}</span>
                <span class="prod-card-name">{sample.name}</span>
              </div>
              <div class="prod-card-price">
                <span class="price-label">Day</span><span class="price-num">{sample.day}</span>
                <span class="price-sep">/</span>
                <span class="price-label">12H</span><span class="price-num">{sample.h12}</span>
              </div>
              <div class="prod-card-desc">{sample.desc}</div>
            </div>
          </div>
        {/each}
      </div>
      {#if data.isCms}
        <p class="theme-empty-notice">테마그룹을 추가해 취향직격 섹션을 구성하세요.</p>
      {/if}
    {/if}
  </div>

  <!-- ④ 카테고리 탭 + 슬라이더 -->
  <div class="d-section d-cat-section">
    <!-- 카테고리 아이콘 탭 -->
    <div class="cat-tabs">
      {#each CATEGORY_TABS as tab}
        <button class="cat-tab" class:active={activeTab === tab.id} onclick={() => activeTab = tab.id}>
          <div class="cat-tab-icon" class:has-on={!!(tab.icon_url && tab.icon_active_url)} style={tab.icon_url && tab.icon_active_url ? '' : `background:${activeTab === tab.id ? purple : purplePale}`}>
            {#if tab.icon_url && tab.icon_active_url}
              <!-- ON 이미지(호버·선택 공용, 상자 배경 포함 SVG) — OFF 위에 겹쳐 교차 전환. /products 카테고리 메뉴와 동일 설정 공유 -->
              <img src={tab.icon_url} alt={tab.label} class="cat-tab-custom-icon cat-tab-icon-off" />
              <img src={tab.icon_active_url} alt="" aria-hidden="true" class="cat-tab-custom-icon cat-tab-icon-on" />
            {:else if tab.icon_url}
              <img src={tab.icon_url} alt={tab.label} class="cat-tab-custom-icon" />
            {:else if tab.icon === 'package'}
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

    <!-- 활성 카테고리 타이틀 바 -->
    <div class="pkg-bar">
      <span class="pkg-bar-label">{CATEGORY_TABS.find((t) => t.id === activeTab)?.label ?? 'Category'}</span>
    </div>

    {#if data.isCms}
      <div class="cat-cms-btns">
        <button class="cat-cms-btn" onclick={() => (showCategoryModal = true)}>⚙ 카테고리 설정</button>
        <button class="cat-cms-btn" onclick={() => { catProductsTabId = activeTab; catProductsTabName = CATEGORY_TABS.find((t) => t.id === activeTab)?.label ?? activeTab; showCatProductsModal = true }}>
          ⚙ {CATEGORY_TABS.find((t) => t.id === activeTab)?.label ?? ''} 상품 큐레이션
        </button>
      </div>
    {/if}

    <!-- 상품 슬라이더 (Phase 4: DB 큐레이션 데이터) -->
    {#if activeCatProds.length > 0}
      <div class="prod-slider-wrap">
        <div class="prod-slider">
          {#each activeCatProds as p}
            <div
              class="prod-card"
              onclick={() => goto('/products/' + (p.slug || p.id))}
              role="button"
              tabindex={0}
              onkeydown={(e) => e.key === 'Enter' && goto('/products/' + (p.slug || p.id))}
            >
              <img src={p.image_urls?.[0] ?? '/favicon.png'} alt={p.name} class="prod-card-img" loading="lazy"/>
              <div class="prod-card-info">
                <div class="prod-card-headline">
                  {#if p.category}<span class="prod-card-cat">{p.category}</span>{/if}
                  <span class="prod-card-name">{p.name}</span>
                </div>
                <div class="prod-card-price">
                  {#if p.sale_only}
                    <span class="price-label">Price</span><span class="price-num">{(p.sale_price ?? 0).toLocaleString('ko-KR')}</span>
                  {:else}
                    {#if p.price_24h}<span class="price-label">Day</span><span class="price-num">{p.price_24h.toLocaleString('ko-KR')}</span>{/if}
                    {#if p.price_24h && p.price_12h}<span class="price-sep">/</span>{/if}
                    {#if p.price_12h}<span class="price-label">12H</span><span class="price-num">{p.price_12h.toLocaleString('ko-KR')}</span>{/if}
                  {/if}
                </div>
                {#if p.product_caption}<div class="prod-card-desc">{p.product_caption}</div>{/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {:else if data.isCms}
      <p class="cat-empty-notice">⚙ 상품 큐레이션에서 이 카테고리의 상품을 추가하세요.</p>
    {/if}
  </div>

  <!-- ⑤ 크레이지로그 -->
  <div class="d-section d-blog-section">
    <div class="section-head">
      <svg width="34" height="19" viewBox="0 0 38 21" fill="none" aria-hidden="true">
        <path d="M17.8899 0.218353C18.6016 -0.0728023 19.3988 -0.072768 20.1106 0.218353L20.262 0.28476L20.387 0.349213C20.995 0.681504 21.3406 1.19289 21.5178 1.47714C21.7224 1.80539 21.9327 2.22721 22.1321 2.62265L24.2747 6.87363L28.9592 5.30624C29.4012 5.15823 29.8653 5.00075 30.2551 4.90878C30.6075 4.8257 31.3078 4.68499 32.052 4.96542C32.9 5.28515 33.5462 5.97536 33.8196 6.82675C34.058 7.57012 33.8969 8.25404 33.801 8.60507C33.6952 8.99225 33.5215 9.45227 33.3567 9.89511L31.8293 13.9967L36.8264 16.2633C37.8322 16.7196 38.2776 17.9049 37.8215 18.9107C37.3651 19.9163 36.1798 20.3621 35.1741 19.9059L29.7776 17.4586C29.5783 17.3682 29.3209 17.2523 29.1028 17.1314C28.8626 16.9983 28.5301 16.7857 28.2366 16.4303C27.8561 15.9694 27.6248 15.4047 27.5706 14.8131C27.5289 14.3582 27.6129 13.9752 27.6877 13.7125C27.756 13.4731 27.8555 13.2084 27.9329 13.0006L29.2639 9.42148L25.134 10.8053C24.9449 10.8686 24.6962 10.9535 24.47 11.0103C24.2191 11.0734 23.8562 11.1416 23.427 11.0953C22.8646 11.0345 22.3332 10.8121 21.8958 10.4586C21.5626 10.1893 21.3547 9.88693 21.2219 9.6666C21.1019 9.46734 20.9848 9.23285 20.8938 9.05234L18.9993 5.2955L17.1067 9.05136V9.05234C17.0157 9.23282 16.8986 9.46742 16.7786 9.6666C16.6458 9.8869 16.4377 10.1894 16.1047 10.4586C15.6673 10.8119 15.1358 11.0346 14.5735 11.0953C14.1442 11.1415 13.7813 11.0734 13.5305 11.0103C13.3042 10.9534 13.0556 10.8686 12.8665 10.8053L8.7356 9.42148L10.0676 13.0006C10.145 13.2085 10.2445 13.4731 10.3127 13.7125C10.3876 13.9752 10.4716 14.3581 10.4299 14.8131C10.3757 15.4046 10.1444 15.9694 9.76392 16.4303C9.47044 16.7855 9.13786 16.9983 8.89771 17.1314C8.67964 17.2522 8.42204 17.3683 8.2229 17.4586L2.82642 19.9059C1.82066 20.3619 0.635292 19.9164 0.178955 18.9107C-0.277049 17.905 0.168563 16.7197 1.17407 16.2633L6.17017 13.9967L4.6438 9.89511C4.479 9.45221 4.30527 8.99228 4.19946 8.60507C4.10357 8.25406 3.94252 7.57005 4.18091 6.82675L4.23657 6.66953C4.53582 5.89099 5.15351 5.26527 5.94849 4.96542L6.08716 4.91757C6.77856 4.70212 7.41493 4.83087 7.74536 4.90878C8.13518 5.00072 8.59918 5.1582 9.04126 5.30624L13.7249 6.87363L15.8684 2.62265C16.0677 2.22732 16.2781 1.80535 16.4827 1.47714C16.6716 1.17402 17.0524 0.611777 17.7385 0.28476L17.8899 0.218353Z" fill="#FF3535"/>
      </svg>
      <span class="section-title" style="color:{redDeep}">요즘 크레이지·로그</span>
    </div>
    <p class="section-sub" style="color:{navyDeep}">신상 리뷰도, 내 유튜브채널 홍보도 크레이지로그로!</p>

    {#if data.isCms}
      <a href="/crazylog" class="cms-section-link" aria-label="크레이지로그 설정 페이지로 이동">✦ 크레이지로그 설정</a>
    {/if}

    {#if data.crazylogPosts.length >= 1}
      <div class="blog-grid">
        <div class="blog-main-card">
          {#if data.crazylogPosts[0].img}
            <img src={data.crazylogPosts[0].img} alt={data.crazylogPosts[0].title} class="blog-img"/>
          {/if}
          <div class="blog-main-header" style="background:{data.crazylogPosts[0].catBg}">
            <span class="blog-cat-label">{data.crazylogPosts[0].cat}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 18l6-6-6-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="blog-main-footer">
            <p class="blog-main-caption">{data.crazylogPosts[0].title}</p>
            {#if data.crazylogPosts[0].desc}
              <p class="blog-main-sub">{data.crazylogPosts[0].desc}</p>
            {/if}
          </div>
        </div>
        {#if data.crazylogPosts.length >= 2}
          <div class="blog-sub-card top">
            {#if data.crazylogPosts[1].img}
              <img src={data.crazylogPosts[1].img} alt={data.crazylogPosts[1].title} class="blog-img"/>
            {/if}
            <div class="blog-sub-header" style="background:{data.crazylogPosts[1].catBg}">
              <span class="blog-cat-label">{data.crazylogPosts[1].cat}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 18l6-6-6-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div class="blog-sub-footer">
              <p class="blog-main-caption blog-sub-caption">{data.crazylogPosts[1].title}</p>
              {#if data.crazylogPosts[1].desc}
                <p class="blog-main-sub">{data.crazylogPosts[1].desc}</p>
              {/if}
            </div>
          </div>
        {/if}
        {#if data.crazylogPosts.length >= 3}
          <div class="blog-sub-card bottom">
            {#if data.crazylogPosts[2].img}
              <img src={data.crazylogPosts[2].img} alt={data.crazylogPosts[2].title} class="blog-img"/>
            {/if}
            <div class="blog-sub-header" style="background:{data.crazylogPosts[2].catBg}">
              <span class="blog-cat-label">{data.crazylogPosts[2].cat}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 18l6-6-6-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div class="blog-sub-footer">
              <p class="blog-main-caption blog-sub-caption">{data.crazylogPosts[2].title}</p>
              {#if data.crazylogPosts[2].desc}
                <p class="blog-main-sub">{data.crazylogPosts[2].desc}</p>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- ⑥ FAQ -->
  <div class="d-section d-faq-section">
    <!-- PC도 모바일과 동일한 히어로(BG 이미지+로고+문구, CMS BG 관리) — 가로폭 480px 유지, 세로만 약간 확대(2026-09-29) -->
    {@render faqHero('mh-hero--pc')}
    <div class="faq-col">
      {#if data.isCms}
        <a href="/help" class="cms-section-link" aria-label="헬프 설정 페이지로 이동">✦ 헬프 설정</a>
      {/if}
      <p class="faq-intro">FAQ ·자주 묻는 질문</p>
      <div class="faq-list">
        {#each data.topFaqs as item}
          <div class="faq-item">
            <button
              class="faq-q"
              onclick={() => openFaqId = openFaqId === item.id ? null : item.id}
              aria-expanded={openFaqId === item.id}
            >
              <span class="faq-q-text">{item.title}</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"
                style="transform:{openFaqId === item.id ? 'rotate(180deg)' : 'rotate(0deg)'};transition:transform 0.22s;flex-shrink:0">
                <path d="M6 9l6 6 6-6" stroke="{muted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            {#if openFaqId === item.id}
              <div class="faq-a"><p>{item.content}</p></div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>

  <!-- ⑦ 브랜드 마퀴 — BrandMarquee(/products 정본 SSOT) -->
  <BrandMarquee surface="home" />

</div><!-- /desktop-wrap -->


<!-- ═══════════════════════════════════════════════════════════════
     MOBILE (md 미만)
════════════════════════════════════════════════════════════════ -->
<div class="mobile-wrap">

  <!-- ① 모바일 히어로 -->
  <!-- 관리자 전용 버튼 게이팅은 PC 반응형 전용 노출 기능 — 모바일에는 노출하지 않음 -->
  <div class="m-hero">
    {#if mobileCarousel.length > 0}
      {@const b = mobileCarousel[mobileIdx]}
      {#if b}
        {#if b.link_url}
          <a href={b.link_url} class="m-hero-banner-link">
            <img src={b.image_url} alt={b.title ?? ''} class="m-hero-bg" />
          </a>
        {:else}
          <img src={b.image_url} alt={b.title ?? ''} class="m-hero-bg" />
        {/if}
        {#if b.sub_copy}
          <div class="m-hero-sub-copy">{b.sub_copy}</div>
        {/if}
      {/if}
    {:else}
      <img src="/home/mobile/ac4438597a6842bccc5d44da173a03a9f3614d50.png" alt="" class="m-hero-bg" aria-hidden="true"/>
    {/if}
  </div>

  <!-- ② 취향직격 테마그룹 (Mobile) -->
  <div class="m-section m-theme-section">
    <div class="section-head">
      <!-- PC(.theme-pick-title-wrap)와 동일한 스파클 아이콘을 모바일 비율로 축소 반영
           (2026-08-26, Stephen 지적 — 기존엔 다른 섹션과 공용인 일반 물결 아이콘을 오용) -->
      <svg width="34" height="19" viewBox="0 0 38 21" fill="none" aria-hidden="true">
        <path d="M17.8899 0.218353C18.6016 -0.0728023 19.3988 -0.072768 20.1106 0.218353L20.262 0.28476L20.387 0.349213C20.995 0.681504 21.3406 1.19289 21.5178 1.47714C21.7224 1.80539 21.9327 2.22721 22.1321 2.62265L24.2747 6.87363L28.9592 5.30624C29.4012 5.15823 29.8653 5.00075 30.2551 4.90878C30.6075 4.8257 31.3078 4.68499 32.052 4.96542C32.9 5.28515 33.5462 5.97536 33.8196 6.82675C34.058 7.57012 33.8969 8.25404 33.801 8.60507C33.6952 8.99225 33.5215 9.45227 33.3567 9.89511L31.8293 13.9967L36.8264 16.2633C37.8322 16.7196 38.2776 17.9049 37.8215 18.9107C37.3651 19.9163 36.1798 20.3621 35.1741 19.9059L29.7776 17.4586C29.5783 17.3682 29.3209 17.2523 29.1028 17.1314C28.8626 16.9983 28.5301 16.7857 28.2366 16.4303C27.8561 15.9694 27.6248 15.4047 27.5706 14.8131C27.5289 14.3582 27.6129 13.9752 27.6877 13.7125C27.756 13.4731 27.8555 13.2084 27.9329 13.0006L29.2639 9.42148L25.134 10.8053C24.9449 10.8686 24.6962 10.9535 24.47 11.0103C24.2191 11.0734 23.8562 11.1416 23.427 11.0953C22.8646 11.0345 22.3332 10.8121 21.8958 10.4586C21.5626 10.1893 21.3547 9.88693 21.2219 9.6666C21.1019 9.46734 20.9848 9.23285 20.8938 9.05234L18.9993 5.2955L17.1067 9.05136V9.05234C17.0157 9.23282 16.8986 9.46742 16.7786 9.6666C16.6458 9.8869 16.4377 10.1894 16.1047 10.4586C15.6673 10.8119 15.1358 11.0346 14.5735 11.0953C14.1442 11.1415 13.7813 11.0734 13.5305 11.0103C13.3042 10.9534 13.0556 10.8686 12.8665 10.8053L8.7356 9.42148L10.0676 13.0006C10.145 13.2085 10.2445 13.4731 10.3127 13.7125C10.3876 13.9752 10.4716 14.3581 10.4299 14.8131C10.3757 15.4046 10.1444 15.9694 9.76392 16.4303C9.47044 16.7855 9.13786 16.9983 8.89771 17.1314C8.67964 17.2522 8.42204 17.3683 8.2229 17.4586L2.82642 19.9059C1.82066 20.3619 0.635292 19.9164 0.178955 18.9107C-0.277049 17.905 0.168563 16.7197 1.17407 16.2633L6.17017 13.9967L4.6438 9.89511C4.479 9.45221 4.30527 8.99228 4.19946 8.60507C4.10357 8.25406 3.94252 7.57005 4.18091 6.82675L4.23657 6.66953C4.53582 5.89099 5.15351 5.26527 5.94849 4.96542L6.08716 4.91757C6.77856 4.70212 7.41493 4.83087 7.74536 4.90878C8.13518 5.00072 8.59918 5.1582 9.04126 5.30624L13.7249 6.87363L15.8684 2.62265C16.0677 2.22732 16.2781 1.80535 16.4827 1.47714C16.6716 1.17402 17.0524 0.611777 17.7385 0.28476L17.8899 0.218353Z" fill="#FF3535"/>
      </svg>
      <span class="section-title" style="color:{redDeep}">취·향·직·격 PICK!</span>
      <!-- 관리자 전용 버튼 게이팅은 PC 반응형 전용 노출 기능 — 모바일에는 노출하지 않음 -->
    </div>
    {#if data.themeGroups && data.themeGroups.length > 0}
      <!-- PC와 동일 구조: 원형 탭 선택 시 하나의 상품슬라이드만 전환(그룹마다 반복 아님) -->
      <div class="m-theme-circle-tabs-wrap">
        <div class="m-theme-circle-tabs" class:m-theme-circle-tabs--capped={data.themeGroups.length > 3} bind:this={mThemeTabsEl}>
          {#each data.themeGroups as tg}
            {@const isActive = (activeThemeId ?? data.themeGroups[0].id) === tg.id}
            <button class="theme-circle-tab" onclick={(e) => selectTheme(tg.id, e.currentTarget as HTMLElement)} type="button" aria-pressed={isActive}>
              <div class="theme-hl-card theme-hl-card--m theme-hl-card--circle" class:is-active={isActive}>
                {#if tg.image_url}
                  <img src={tg.image_url} alt={tg.title} class="theme-hl-card-img"/>
                {:else}
                  <div class="m-theme-img-ph" aria-hidden="true"></div>
                {/if}
              </div>
              <div class="theme-circle-info">
                <span class="theme-circle-name">{tg.title}</span>
                {#if tg.sub_copy}
                  <span class="theme-circle-sub">{tg.sub_copy}</span>
                {/if}
              </div>
              <svg class="theme-tab-polygon" width="21" height="19" viewBox="0 0 21.1583 18.5113" fill="none" aria-hidden="true">
                <path d="M8.8573 0.982543C9.63142 -0.327512 11.5269 -0.327516 12.301 0.982539L20.8727 15.4885C21.812 17.0781 20.2796 18.9829 18.5257 18.4057L11.2043 15.9966C10.7982 15.8629 10.3601 15.8629 9.95401 15.9966L2.63259 18.4057C0.878729 18.9829 -0.653715 17.0781 0.285591 15.4885L8.8573 0.982543Z" fill={isActive ? '#3b2f8a' : '#c1bbec'}/>
              </svg>
            </button>
          {/each}
        </div>
      </div>

      {#if activeThemeProducts.length > 0}
        <!-- 표준 상품슬라이드 디자인(m-prod-card, "미칠 PICK"과 동일 규격) 재사용 -->
        <div class="m-snap-slider theme-m-prod-slider" class:m-slider-static={activeThemeProducts.length <= 1}>
          {#each activeThemeProducts as prod}
            <div
              class="m-prod-card"
              onclick={() => goto('/products/' + (prod.slug || prod.id))}
              role="button"
              tabindex={0}
              onkeydown={(e) => e.key === 'Enter' && goto('/products/' + (prod.slug || prod.id))}
            >
              <img src={prod.image_urls?.[0] ?? '/favicon.png'} alt={prod.name} class="m-prod-img" loading="lazy"/>
              <div class="m-prod-info">
                <div class="m-prod-headline">
                  <span class="m-prod-name">{prod.name}</span>
                </div>
                <div class="m-prod-price">
                  {#if prod.sale_only}
                    <span class="price-label">Price</span><span class="price-num">{(prod.sale_price ?? 0).toLocaleString('ko-KR')}</span>
                  {:else}
                    {#if prod.price_24h}<span class="price-label">Day</span><span class="price-num">{prod.price_24h.toLocaleString('ko-KR')}</span>{/if}
                    {#if prod.price_24h && prod.price_12h}<span class="price-sep">/</span>{/if}
                    {#if prod.price_12h}<span class="price-label">12H</span><span class="price-num">{prod.price_12h.toLocaleString('ko-KR')}</span>{/if}
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {:else}
      <!-- 테마그룹 0개 — 레이아웃 자리 유지용 샘플 배너(모든 방문자에게 노출, 신규 상품슬라이드
           등록 시 위 {#if} 분기로 자동 전환되어 샘플은 가려짐) -->
      <div class="m-theme-groups m-theme-groups--sample">
        <div class="m-theme-row">
          <div class="m-theme-header">
            <div class="theme-hl-card theme-hl-card--m theme-hl-card--circle">
              <img src="/home/desktop/571a11c577774467d3b4cfa10fb7ea6ba6f178ba.png" alt="샘플 테마 배너" class="theme-hl-card-img"/>
            </div>
            <div class="theme-circle-info">
              <span class="theme-circle-name">Sample Theme</span>
              <span class="theme-circle-sub">테마그룹 등록 시 실제 콘텐츠가 표시됩니다</span>
            </div>
          </div>
          <!-- 상품 슬라이드 샘플 더미 — 표준 상품슬라이드 디자인(m-prod-card)과 동일하게 구현 -->
          <div class="m-snap-slider theme-m-prod-slider">
            {#each [
              { img: '/home/desktop/0e5cfa4b24ea4086c4f8a27ab299ce413ce61789.png', cat: 'Starter kit', name: 'GOPRO HERO11', day: '35,000', h12: '25,000', desc: 'Ultra Compact Design Weighs Only' },
              { img: '/home/desktop/0f6bb06ce53ce5862f01e33b020560170e675963.png', cat: 'Starter kit', name: 'SONY ZV-E10', day: '42,000', h12: '28,000', desc: 'All-round Vlogging Camera' },
              { img: '/home/desktop/1bbde5f74b1d99829b62da01db4cd68c18c25510.png', cat: 'Starter kit', name: 'DJI OSMO POCKET', day: '28,000', h12: '19,000', desc: 'Pocket-size Stabilized Gimbal' },
            ] as sample}
              <div class="m-prod-card m-prod-card--sample">
                <img src={sample.img} alt={sample.name} class="m-prod-img"/>
                <div class="m-prod-info">
                  <div class="m-prod-headline">
                    <span class="m-prod-cat">{sample.cat}</span>
                    <span class="m-prod-name">{sample.name}</span>
                  </div>
                  <div class="m-prod-price">
                    <span class="price-label">Day</span><span class="price-num">{sample.day}</span>
                    <span class="price-sep">/</span>
                    <span class="price-label">12H</span><span class="price-num">{sample.h12}</span>
                  </div>
                  <div class="m-prod-desc">{sample.desc}</div>
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>
      {#if data.isCms}
        <p class="theme-empty-notice">테마그룹을 추가해 취향직격 섹션을 구성하세요.</p>
      {/if}
    {/if}
  </div>

  <!-- ③ MD 추천 (모바일 초기화면 — /products의 "MD 추천"과 동일한 cms_settings 키
       (product_page_md_picks) 공유, Stephen 확정: 카테고리 슬라이드 메뉴 영역을 대체 -->
  {#if data.mdProducts && data.mdProducts.length > 0}
    <div class="m-section md-picks-section" style="position:relative">
      {#if data.isCms}
        <button class="md-picks-cms-btn" onclick={() => (showMdPickModal = true)} aria-label="MD 추천 설정">
          ✦ MD 추천 설정
        </button>
      {/if}
      <!-- 미칠 PICK 헤딩 — 모바일 전용 노출(PC 홈에서는 제거, 2026-09-29) -->
      <div class="michil-heading">
        <img src="/logo-bi-shadow.svg" alt="크레이지샷" class="michil-logo" width="103" height="68" />
        <h2 class="michil-title"><span style="color:{redDeep}">미·칠</span> PICK!</h2>
      </div>
      <div class="md-picks-track">
        {#each data.mdProducts as prod}
          <a href={'/products/' + (prod.slug || prod.id)} class="md-pick-card">
            <div class="md-pick-img-box">
              <img src={prod.image_urls?.[0] ?? '/favicon.png'} alt={prod.name} class="md-pick-img" loading="lazy" />
            </div>
            <div class="mdp-info">
              {#if prod.category}
                <p class="mdp-category">{CATEGORY_TABS.find((t) => t.id === prod.category)?.label ?? prod.category}</p>
              {/if}
              <div class="mdp-price-row">
                {#if prod.sale_only}
                  <span class="mdp-price-group">
                    <span class="mdp-price-label">Price</span>
                    <span class="mdp-price-num">{(prod.sale_price ?? 0).toLocaleString('ko-KR')}</span>
                  </span>
                {:else}
                  {#if prod.price_24h}
                    <span class="mdp-price-group">
                      <span class="mdp-price-label">Day</span>
                      <span class="mdp-price-num">{prod.price_24h.toLocaleString('ko-KR')}</span>
                    </span>
                  {/if}
                  {#if prod.price_24h && prod.price_12h}<span class="mdp-price-sep">/</span>{/if}
                  {#if prod.price_12h}
                    <span class="mdp-price-group">
                      <span class="mdp-price-label">12H</span>
                      <span class="mdp-price-num">{prod.price_12h.toLocaleString('ko-KR')}</span>
                    </span>
                  {/if}
                {/if}
              </div>
              <p class="mdp-name">{prod.name}</p>
            </div>
          </a>
        {/each}
      </div>
    </div>
  {:else if data.isCms}
    <div class="m-section md-picks-section md-picks-empty">
      <button class="md-picks-cms-btn md-picks-cms-btn--empty" onclick={() => (showMdPickModal = true)}>
        ✦ MD 추천 상품 설정하기
      </button>
    </div>
  {/if}

  <!-- ④ 요즘 크레이지로그 -->
  <div class="m-blog-section">
    <div class="section-head">
      <svg width="34" height="19" viewBox="0 0 38 21" fill="none" aria-hidden="true">
        <path d="M17.8899 0.218353C18.6016 -0.0728023 19.3988 -0.072768 20.1106 0.218353L20.262 0.28476L20.387 0.349213C20.995 0.681504 21.3406 1.19289 21.5178 1.47714C21.7224 1.80539 21.9327 2.22721 22.1321 2.62265L24.2747 6.87363L28.9592 5.30624C29.4012 5.15823 29.8653 5.00075 30.2551 4.90878C30.6075 4.8257 31.3078 4.68499 32.052 4.96542C32.9 5.28515 33.5462 5.97536 33.8196 6.82675C34.058 7.57012 33.8969 8.25404 33.801 8.60507C33.6952 8.99225 33.5215 9.45227 33.3567 9.89511L31.8293 13.9967L36.8264 16.2633C37.8322 16.7196 38.2776 17.9049 37.8215 18.9107C37.3651 19.9163 36.1798 20.3621 35.1741 19.9059L29.7776 17.4586C29.5783 17.3682 29.3209 17.2523 29.1028 17.1314C28.8626 16.9983 28.5301 16.7857 28.2366 16.4303C27.8561 15.9694 27.6248 15.4047 27.5706 14.8131C27.5289 14.3582 27.6129 13.9752 27.6877 13.7125C27.756 13.4731 27.8555 13.2084 27.9329 13.0006L29.2639 9.42148L25.134 10.8053C24.9449 10.8686 24.6962 10.9535 24.47 11.0103C24.2191 11.0734 23.8562 11.1416 23.427 11.0953C22.8646 11.0345 22.3332 10.8121 21.8958 10.4586C21.5626 10.1893 21.3547 9.88693 21.2219 9.6666C21.1019 9.46734 20.9848 9.23285 20.8938 9.05234L18.9993 5.2955L17.1067 9.05136V9.05234C17.0157 9.23282 16.8986 9.46742 16.7786 9.6666C16.6458 9.8869 16.4377 10.1894 16.1047 10.4586C15.6673 10.8119 15.1358 11.0346 14.5735 11.0953C14.1442 11.1415 13.7813 11.0734 13.5305 11.0103C13.3042 10.9534 13.0556 10.8686 12.8665 10.8053L8.7356 9.42148L10.0676 13.0006C10.145 13.2085 10.2445 13.4731 10.3127 13.7125C10.3876 13.9752 10.4716 14.3581 10.4299 14.8131C10.3757 15.4046 10.1444 15.9694 9.76392 16.4303C9.47044 16.7855 9.13786 16.9983 8.89771 17.1314C8.67964 17.2522 8.42204 17.3683 8.2229 17.4586L2.82642 19.9059C1.82066 20.3619 0.635292 19.9164 0.178955 18.9107C-0.277049 17.905 0.168563 16.7197 1.17407 16.2633L6.17017 13.9967L4.6438 9.89511C4.479 9.45221 4.30527 8.99228 4.19946 8.60507C4.10357 8.25406 3.94252 7.57005 4.18091 6.82675L4.23657 6.66953C4.53582 5.89099 5.15351 5.26527 5.94849 4.96542L6.08716 4.91757C6.77856 4.70212 7.41493 4.83087 7.74536 4.90878C8.13518 5.00072 8.59918 5.1582 9.04126 5.30624L13.7249 6.87363L15.8684 2.62265C16.0677 2.22732 16.2781 1.80535 16.4827 1.47714C16.6716 1.17402 17.0524 0.611777 17.7385 0.28476L17.8899 0.218353Z" fill="#FF3535"/>
      </svg>
      <span class="section-title" style="color:white">요즘 크레이지로그!</span>
    </div>
    <p class="section-sub" style="color:white">신상 리뷰도, 내 유튜브채널 홍보도 크레이지로그로!</p>
    {#if data.isCms}
      <a href="/crazylog" class="cms-section-link cms-section-link--light" aria-label="크레이지로그 설정 페이지로 이동">✦ 크레이지로그 설정</a>
    {/if}
    <!-- /crazylog(m-list) m-carousel/m-card 슬라이드 구조 그대로 반영 — 카테고리 헤더색은
         기존 data.crazylogPosts의 catBg(§ +page.server.ts LOG_TYPE_COLORS/SLOT_FALLBACK_COLORS)
         값을 그대로 사용, 3개 슬롯 분리 없이 단일 슬라이드로 구성 -->
    {#if data.crazylogPosts.length > 0}
      <div class="m-blog-carousel" class:m-slider-static={data.crazylogPosts.length <= 1}>
        {#each data.crazylogPosts as post, ci}
          <a href={'/crazylog/view/' + post.id} class="m-blog-card">
            <div class="m-blog-card-bg">
              {#if post.img}<img src={post.img} alt="" class="m-blog-card-bg-img"/>{/if}
            </div>
            <div class="m-blog-card-header" style="background:{post.catBg}">
              <span class="m-blog-card-category">{post.cat}</span>
              <button class="m-blog-card-more" aria-label="더보기" type="button">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                  <rect width="22" height="22" rx="7" fill="rgba(225,222,243,0.9)"/>
                  <path d="M6 11h10M11 6v10" stroke="#553FE0" stroke-width="2.5" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
            <div class="m-blog-card-script">
              <div class="m-blog-card-writing">
                <p class="m-blog-card-title">{post.title}</p>
                {#if post.desc}<p class="m-blog-card-sub">{post.desc}</p>{/if}
              </div>
              {#if data.crazylogPosts.length > 1}
                <div class="m-blog-card-dots">
                  {#each data.crazylogPosts as _, di}
                    <span class="m-dot" class:m-dot-active={di === ci}></span>
                  {/each}
                </div>
              {/if}
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </div>

  <!-- ⑤ 아티클 목록 — /crazylog "K-Trend Log" 섹션(m-article-card: bg 이미지+그라디언트
       오버레이+날짜·제목·본문 미리보기)과 동일 카드 UI 구조 반영 -->
  <div class="m-section m-articles-section">
    <a href="/crazylog/list" class="m-articles-head">
      <span class="m-articles-heading">더 다양한 로그 둘러보기</span>
      <div class="m-articles-more-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9 18l6-6-6-6" stroke="{purpleLight}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </a>
    {#if data.recentLogPosts && data.recentLogPosts.length > 0}
      {#each data.recentLogPosts as post}
        <a href={'/crazylog/view/' + post.id} class="m-article-card" aria-label={post.title}>
          {#if post.img}
            <img src={post.img} alt="" class="m-article-card-bg" aria-hidden="true"/>
          {:else}
            <div class="m-article-card-bg m-article-card-bg-empty" aria-hidden="true"></div>
          {/if}
          <div class="m-article-card-overlay" aria-hidden="true"></div>
          <div class="m-article-card-content">
            <span class="m-article-card-date">{logRelativeTime(post.createdAt)}</span>
            <p class="m-article-card-title">{post.title}</p>
            {#if post.desc}<p class="m-article-card-desc">{post.desc}</p>{/if}
          </div>
        </a>
      {/each}
    {:else}
      <p class="m-articles-empty">아직 등록된 로그가 없습니다.</p>
    {/if}
  </div>

  <!-- ⑥ FAQ -->
  <div class="m-section m-faq-section">
    <!-- 모바일 FAQ 헤더 — /help 히어로(BG 이미지 + 메인·서브 문구 + 카테고리 카드) 구조 그대로, CMS "BG 관리"로 배경·문구 관리 -->
    {@render faqHero('')}
    <div class="faq-list">
      {#each data.topFaqs as item}
        <div class="faq-item">
          <button
            class="faq-q"
            onclick={() => openFaqId = openFaqId === item.id ? null : item.id}
            aria-expanded={openFaqId === item.id}
          >
            <span class="faq-q-text">{item.title}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"
              style="transform:{openFaqId === item.id ? 'rotate(180deg)' : 'rotate(0deg)'};transition:transform 0.22s;flex-shrink:0">
              <path d="M6 9l6 6 6-6" stroke="{muted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          {#if openFaqId === item.id}
            <div class="faq-a"><p>{item.content}</p></div>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <!-- ⑦ 브랜드 마퀴 — 초기화면 전용 surface(home) -->
  <BrandMarquee surface="home" />

  <!-- ⑧ 모바일 하단 탭바 -->
  <div class="m-tab-bar" class:tab-bar-hidden={tabBarHidden}>
    {#each MOBILE_TABS as tab}
      <button
        class="m-tab-item"
        class:tab-active={mActiveTab === tab.id}
        class:tab-popping={poppingTab === tab.id}
        onclick={() => { mActiveTab = tab.id; triggerPop(tab.id); if (tab.id === 'All') goto('/products'); if (tab.id === 'Cart') goto('/cart'); if (tab.id === 'My') goto('/account'); if (tab.id === 'More') moreMenuOpen = true }}
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

{#if data.isCms && showBannerModal}
  <HomeBannerModal
    pcBanners={data.heroBannerRowsRaw?.hero_pc ?? []}
    mobileBanners={data.heroBannerRowsRaw?.hero_mobile ?? []}
    pcMode={data.heroBannerSettings?.pc_mode ?? 'fixed'}
    mobileMode={data.heroBannerSettings?.mobile_mode ?? 'fixed'}
    onclose={() => (showBannerModal = false)}
  />
{/if}

{#if data.isCms && showThemeGroupModal}
  <HomeThemeGroupModal
    groups={data.themeGroupsAdmin ?? []}
    onclose={() => (showThemeGroupModal = false)}
  />
{/if}

{#if data.isCms && showCategoryModal}
  <ProductCategoryModal
    categories={data.categories}
    initialSettings={data.categoryPageSettings}
    initialKeywordsSettings={data.keywordsPageSettings}
    onclose={() => (showCategoryModal = false)}
  />
{/if}

{#if data.isCms && showCatProductsModal}
  {#key catProductsTabId}
    <HomeCategoryProductsModal
      categoryId={catProductsTabId}
      categoryName={catProductsTabName}
      allSettings={data.homeCategoryProductsRaw}
      onclose={() => (showCatProductsModal = false)}
    />
  {/key}
{/if}

{#if data.isCms && showMdPickModal}
  <ProductMdPickModal
    initialSettings={data.mdPicksRaw ?? { products: [], mode: 'fixed' }}
    onclose={() => (showMdPickModal = false)}
  />
{/if}

{#if data.isCms && showHelpHeroModal}
  <HelpHeroBgModal
    initialImages={data.faqHeroBgImages}
    initialMode={data.faqHeroBgMode}
    initialTitle={data.faqHeroTitle}
    initialSub={data.faqHeroSub}
    onclose={() => (showHelpHeroModal = false)}
  />
{/if}

<style>
  /* ── CMS 배너 관리 버튼 ───────────────────────────── */
  /* /products의 admin-edit-btn + admin-float-btn 위치·스타일 규칙과 통일 */
  .hero-cms-btn {
    position: absolute;
    /* GNB(position:fixed, --layout-header-h)에 가려지지 않도록 헤더 높이 아래로 배치 */
    top: calc(var(--layout-header-h) + 10px);
    right: 10px;
    z-index: 20;
    padding: 6px 12px;
    background: rgba(16, 11, 50, 0.75);
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cs-white);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s;
  }
  .hero-cms-btn:hover { background: rgba(16, 11, 50, 0.92); }

  /* /products의 admin-edit-btn + admin-float-btn 위치·스타일 규칙과 통일 */
  .cat-cms-btns {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }
  .cat-cms-btn {
    padding: 6px 12px;
    background: rgba(16, 11, 50, 0.75);
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cs-white, #fff);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s;
  }
  .cat-cms-btn:hover { background: rgba(16, 11, 50, 0.92); }
  .cat-empty-notice {
    font-size: 12px;
    color: var(--cs-text-light);
    text-align: center;
    padding: 24px 0;
    margin: 0;
  }

  /* ── 히어로 배너 서브카피 ─────────────────────────── */
  .d-hero-sub-copy {
    position: absolute;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    max-width: 600px;
    text-align: center;
    color: rgba(255, 255, 255, 0.85);
    font: var(--text-pc-body-14);
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
    pointer-events: none;
  }
  .m-hero-sub-copy {
    position: absolute;
    bottom: 100px;
    left: 20px;
    right: 20px;
    text-align: center;
    color: rgba(255, 255, 255, 0.85);
    font: var(--text-m-script-14B);
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
    pointer-events: none;
  }

  /* ── 반응형 래퍼 ── */
  .desktop-wrap { display: none; background: var(--cs-lilac); overflow-x: hidden; }
  /* 하단 탭바 완충 여백(padding-bottom 80px)에만 purple-20 배경 — 위 브랜드 마퀴 그라데이션 끝색(--cs-purple-pale)과 이어지게 함(2026-09-29) */
  .mobile-wrap  {
    display: block;
    background: linear-gradient(to bottom, var(--cs-lilac) calc(100% - 80px), var(--cs-purple-pale) calc(100% - 80px));
    padding-bottom: 80px;
    overflow-x: hidden;
  }
  /* 모바일 홈 마퀴 좌우 페이드 — 공용 컴포넌트는 단색 라일락이라 마퀴 배경(라일락→purple-20 세로 그라데이션) 위에서 좌우가 띠처럼 떠 보임.
     페이드에 같은 세로 그라데이션을 깔고 가로 방향은 마스크로 투명 처리해 배경과 이어지게 함(2026-09-29). 공용 컴포넌트·PC·/products는 그대로 */
  .mobile-wrap :global(.brand-marquee-wrap.surface-home .marquee-fade-left),
  .mobile-wrap :global(.brand-marquee-wrap.surface-home .marquee-fade-right) {
    background: linear-gradient(to bottom, var(--cs-lilac), var(--cs-purple-pale));
  }
  .mobile-wrap :global(.brand-marquee-wrap.surface-home .marquee-fade-left) {
    -webkit-mask-image: linear-gradient(to right, #000, transparent);
    mask-image: linear-gradient(to right, #000, transparent);
  }
  .mobile-wrap :global(.brand-marquee-wrap.surface-home .marquee-fade-right) {
    -webkit-mask-image: linear-gradient(to left, #000, transparent);
    mask-image: linear-gradient(to left, #000, transparent);
  }
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

  /* ── THEME GROUPS (취향직격 테마그룹) — PC ── */
  /* 다른 섹션과 동일하게 기본 중앙정렬(.section-head align-items:center) 유지 —
     이전 flex-start 오버라이드는 제목행이 좌측으로 쏠리는 원인이었음(그리드 자체는
     .theme-groups가 이미 width:100%라 정렬값과 무관하게 정상 렌더링됨) */
  .d-theme-section { position: relative; }
  /* /products의 admin-edit-btn + admin-float-btn 위치·스타일 규칙과 통일 */
  .theme-cms-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 20;
    padding: 6px 12px;
    background: rgba(16, 11, 50, 0.75);
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cs-white, #fff);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s;
  }
  .theme-cms-btn:hover { background: rgba(16, 11, 50, 0.92); }

  /* ── 취향직격 PICK 헤더행 (Figma node 2072:5988) — 제목/부제(좌) + 원형 테마탭(우) ── */
  .theme-pick-row {
    display: flex;
    gap: 40px;
    align-items: center;
    justify-content: center;
    width: 100%;
  }
  /* 헤드 영역을 남은 공간에 억지로 늘리지 않고(flex:1 0 0 제거) 콘텐츠 크기만큼만 차지 —
     원형탭과 더 붙어 보이도록 함 */
  .theme-pick-head {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    flex: 0 1 auto;
  }
  .theme-pick-title-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
  }
  .theme-pick-desc {
    font-family: var(--font-kr);
    font-size: 16px;
    font-weight: 700;
    color: #444;
    text-align: center;
    line-height: 1.6;
  }
  /* 원형탭 슬라이드 — 3개 초과 시 가로 스크롤(드래그·트랙패드)로 이동(.theme-circle-tabs--capped) */
  /* 탭 그룹(.theme-circle-tabs)을 래퍼 폭 안에서 중앙 정렬 — 모바일(.m-theme-circle-tabs-wrap)과
     동일한 좌측 쏠림 문제가 PC에도 동일하게 있어 동일 처리(2026-08-26) */
  .theme-circle-tabs-wrap { position: relative; display: flex; justify-content: center; }
  .theme-circle-tabs {
    display: flex;
    gap: 30px;
    align-items: center;
    overflow-x: auto;
    /* overflow-x:auto가 지정되면 overflow-y도 자동으로 auto가 되어(CSS 스펙),
       선택 시 스프링 바운스가 정점에서 1.32배까지 커지는 만큼(180px×0.32÷2=28.8px) 위아래
       여백이 없으면 상단이 스크롤 컨테이너에 잘려 보인다 — 그만큼 패딩 확보
       (2026-09-30, 2026-10-01 바운스 정점 1.32배 기준으로 재조정) */
    /* 좌우 여유 패딩(2026-09-30) — 맨 앞·맨 뒤 항목을 선택해 중앙으로 이동시키려 해도
       스크롤 가능 범위가 부족해 0(또는 최대치)에서 클램핑돼 중앙에 못 미치던 문제 보정.
       선택 시 중앙 정렬이 가능하도록 양옆에 미리 스크롤 여유 공간을 확보한다.
       box-sizing:border-box 필수 — 아니면 .theme-circle-tabs--capped의 max-width(600px)에
       이 패딩(400px)이 더해져 캡 자체가 무력화된다. */
    padding: 29px 200px;
    box-sizing: border-box;
  }
  .theme-circle-tabs::-webkit-scrollbar { display: none; }
  /* 테마 3개 초과 시 한 화면에 3개만 노출(180px 원형×3 + gap 30px×2) */
  .theme-circle-tabs--capped {
    max-width: 600px;
    /* 캡(3개만 노출) 모드에서는 좌우 200px 센터링 여유 패딩을 그대로 두면 max-width(600px)
       안에서 실제 보이는 영역이 200px로 줄어 "3개만 노출" 의도가 깨진다 — 이 모드에서는
       기존 마스크 페이드 폭(30px)만큼만 여유를 둬 3개 노출 폭을 그대로 유지한다.
       2026-09-30 Stephen 확정(1번 안): 그 결과 가장자리(맨 앞·맨 뒤) 항목 선택 시 완전한
       중앙 이동은 스크롤 한계에서 자연 클램핑돼 제한될 수 있음 — "3개만 노출" 디자인
       유지를 우선한 의도된 절충이며, 추후 세션에서 재차 "중앙 이동이 안 된다"며 패딩을
       늘리는 시도를 반복하지 말 것(2번 안·완전 중앙 이동 우선은 이미 검토 후 폐기됨). */
    padding-left: 30px;
    padding-right: 30px;
    scroll-snap-type: x proximity;
    /* 좌우 끝을 투명하게 페이드 — 스크롤 중 카드가 컨테이너 경계에서 뚝 잘려나가는
       느낌 대신 배경으로 부드럽게 스며드는 것처럼 보이게 함 */
    mask-image: linear-gradient(to right, transparent 0, black 30px, black calc(100% - 30px), transparent 100%);
    -webkit-mask-image: linear-gradient(to right, transparent 0, black 30px, black calc(100% - 30px), transparent 100%);
  }
  .theme-circle-tabs--capped .theme-circle-tab { scroll-snap-align: start; }
  .theme-circle-tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 15px;
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font: inherit;
  }
  /* ── hl-card(하이라이트 카드) 스타일·인터랙션 그대로 차용 — 원형은 Figma node 2072:5953 기준 180x180 ── */
  /* 카드 자체는 고정 — hover 시 내부 이미지만 부드럽게 확대(잘림 없는 줌 효과) */
  .theme-hl-card {
    position: relative;
    overflow: hidden;
    cursor: pointer;
    width: 180px;
    height: 180px;
    border-radius: 40px;
    flex-shrink: 0;
    /* 원 전체를 통째로 확대 — 이미지만 확대하면 object-fit:cover 특성상 중심에서 먼
       가장자리(얼굴·손 등)가 원 밖으로 밀려나 잘려나감. 원(컨테이너) 자체를 키우면
       이미지도 함께 그대로 커져서 잘림 없이 확대된다. 2026-09-30.
       텐션감 있는 스프링 이징(빠르게 튀어나왔다 살짝 안착) — PC·모바일 공용(동일 클래스). */
    transition: transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .theme-hl-card-img {
    position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
  }
  /* 선택된 원형이 있으면 나머지 원형은 10% 축소 — 선택된 것이 상대적으로 더 크게
     주목되도록 함(PC .theme-circle-tabs / 모바일 .m-theme-circle-tabs 공용 규칙) */
  .theme-circle-tabs:has(.theme-hl-card.is-active) .theme-hl-card:not(.is-active),
  .m-theme-circle-tabs:has(.theme-hl-card.is-active) .theme-hl-card:not(.is-active) {
    transform: scale(0.9);
  }
  .theme-hl-card:hover,
  .theme-hl-card.is-active {
    transform: scale(1.2);
    z-index: 1;
  }
  /* 선택 시 탱탱볼처럼 한 번 튕겨 올랐다 안착하는 스프링 바운스 — 목표(1.2배)를 살짝
     넘겼다 되돌아오며 정착(2026-10-01). forwards 없이도 애니메이션 종료 시 위 규칙의
     scale(1.2)로 자연 복귀돼 끊김이 없다. */
  @keyframes theme-circle-bounce {
    0%   { transform: scale(1); }
    45%  { transform: scale(1.32); }
    65%  { transform: scale(1.12); }
    85%  { transform: scale(1.23); }
    100% { transform: scale(1.2); }
  }
  .theme-hl-card.is-active {
    animation: theme-circle-bounce 0.45s cubic-bezier(0.34, 0.8, 0.64, 1);
  }
  .theme-group-img-ph { width: 100%; height: 100%; background: #ebe9f5; }
  /* 테마 대표이미지 원형 아바타 변형(관리모달 등록 형태와 통일) — 텍스트는 카드 밖 아래에 별도 표시 */
  .theme-hl-card--circle { border-radius: 50%; }
  .theme-circle-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    text-align: center;
    line-height: 1.6;
    transition: transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .theme-circle-name { font-family: var(--font-kr); font-size: 16px; font-weight: 700; color: #201857; letter-spacing: -0.5px; }
  .theme-circle-sub  { font-family: var(--font-kr); font-size: 14px; font-weight: 500; color: #201857; letter-spacing: -0.5px; }
  /* Figma가 원본 Polygon6 경로에 적용한 rotate-180과 동일 — 경로 자체는 원본 그대로 유지 */
  .theme-tab-polygon {
    flex-shrink: 0;
    transform: rotate(180deg);
    transition: transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  /* 선택된 원형이 1.2배로 커지는 만큼(반지름 증가분) 아래 텍스트·폴리곤도 함께 내려가
     확대와 동시에 자연스럽게 간격이 벌어지도록 함 — PC 180px 기준 18px, 모바일 140px 기준 14px */
  .theme-circle-tab:has(.theme-hl-card.is-active) .theme-circle-info { transform: translateY(18px); }
  /* ⚠️ translateY를 rotate보다 앞(바깥쪽)에 둬야 함 — rotate(180deg) translateY(...) 순서로
     쓰면 이동이 회전 이전 좌표계에서 계산된 뒤 180도째 뒤집혀 방향이 반전된다(아래로 이동
     시키려다 위로 튀어오르는 결함, 2026-09-30 실사용 중 발견). */
  .theme-circle-tab:has(.theme-hl-card.is-active) .theme-tab-polygon { transform: translateY(18px) rotate(180deg); }
  .theme-circle-tab:has(.theme-hl-card--m.is-active) .theme-circle-info { transform: translateY(14px); }
  .theme-circle-tab:has(.theme-hl-card--m.is-active) .theme-tab-polygon { transform: translateY(14px) rotate(180deg); }
  /* 상품슬라이드는 "미칠 PICK"과 동일한 표준 prod-card를 재사용(.prod-slider/.prod-card) —
     그룹별로 독립적인 가로 스크롤 슬라이드 */
  .theme-prod-slider { padding-left: 0; }
  /* 샘플 더미 상품 — 실제 상품과 구분되도록 살짝 흐리게 표시(클릭 불가) */
  .prod-card--sample { opacity: 0.6; cursor: default; }

  .theme-empty-notice {
    font-size: 13px;
    color: #9b99bb;
    padding: 12px 0;
    text-align: center;
  }

  /* ── THEME GROUPS — Mobile ── */
  .m-theme-groups {
    display: flex;
    flex-direction: column;
    gap: 28px;
    width: 100%;
  }
  .m-theme-row {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
  }
  .m-theme-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  /* ── hl-card 스타일을 모바일 크기로 축소 적용 ── */
  .theme-hl-card--m {
    width: 140px;
    height: 140px;
    border-radius: 28px;
  }
  /* 복합 선택자로 명시적 우선순위 확보 — 단일클래스끼리는 소스 순서로 승패가 갈려
     위 .theme-hl-card--m의 28px가 .theme-hl-card--circle(50%)보다 나중에 선언되면
     원형이 깨짐(실사용 중 발견: 모바일 테마 아바타가 완전한 원이 아닌 둥근 사각형으로 렌더링) */
  .theme-hl-card--m.theme-hl-card--circle { border-radius: 50%; }

  /* 원형탭 슬라이드(Mobile) — PC(.theme-circle-tabs)와 동일 구조, 원형 크기(140px)만
     모바일 규격으로 축소. 좌우 화살표 제거(2026-09-30) — 가로 스크롤(터치)만으로 이동 */
  /* 좌측으로 쏠려 보이던 문제 해소 — 탭 그룹(.m-theme-circle-tabs)을 래퍼 폭 안에서 중앙
     정렬(2026-08-26 실사용 중 발견) */
  .m-theme-circle-tabs-wrap { position: relative; width: 100%; display: flex; justify-content: center; }
  .m-theme-circle-tabs {
    display: flex;
    gap: 20px;
    align-items: center;
    overflow-x: auto;
    /* 선택 시 스프링 바운스 정점(1.32배) 기준(140px×0.32÷2=22.4px) — hover/active 확대 시
       상단 잘림 방지(2026-09-30, 2026-10-01 바운스 정점 기준으로 재조정) */
    /* 좌우 여유 패딩(2026-10-01) — 맨 앞·맨 뒤 항목 선택 시 화면 정중앙까지 이동 가능하도록
       확보(모바일 실사용 폭 ~365px 기준 필요치 ~113px + 여유). max-width로 패딩만큼 폭을
       늘려 "따라잡으려는" 방식은 패딩을 늘릴수록 필요 패딩도 함께 커지는 자기모순이라
       성립하지 않음(2026-10-01 실측 확인) — 그래서 .m-theme-circle-tabs--capped는 별도
       max-width 없이 이 자연폭 그대로를 사용한다. */
    padding: 23px 120px;
    box-sizing: border-box;
  }
  .m-theme-circle-tabs::-webkit-scrollbar { display: none; }
  /* 테마 3개 초과 시 한 화면에 3개만 노출(140px 원형×3 + gap 20px×2) */
  /* 2026-10-01 Stephen 확정 — 모바일은 PC와 달리 "3개만 노출" 디자인보다 "선택 원형이
     항상 화면 정중앙으로 이동"을 우선한다(2번 안, 모바일 전용). PC(.theme-circle-tabs--capped)는
     1번 안(부분 클램핑 허용) 그대로 유지 — 이 결정은 모바일에만 적용된다.
     ⚠️ max-width로 폭을 인위적으로 제한하지 않는다 — base .m-theme-circle-tabs의 자연폭 +
     120px 패딩을 그대로 사용(패딩만큼 max-width도 함께 늘리는 방식은 늘릴수록 필요 패딩도
     커지는 자기모순이라 성립하지 않음이 실측으로 확인됨, 2026-10-01). */
  .m-theme-circle-tabs--capped {
    scroll-snap-type: x proximity;
    /* 좌우 끝을 투명하게 페이드 — PC(.theme-circle-tabs--capped)와 동일 원리, 모바일 규격만 축소 */
    mask-image: linear-gradient(to right, transparent 0, black 24px, black calc(100% - 24px), transparent 100%);
    -webkit-mask-image: linear-gradient(to right, transparent 0, black 24px, black calc(100% - 24px), transparent 100%);
  }
  .m-theme-circle-tabs--capped .theme-circle-tab { scroll-snap-align: start; }
  .m-theme-img-ph { width: 100%; height: 100%; background: #ebe9f5; }
  /* 상품슬라이드는 "미칠 PICK"과 동일한 표준 m-prod-card를 재사용(.m-snap-slider/.m-prod-card) */
  /* /crazylog(m-carousel) 슬라이드 좌우 구조 반영(2026-09-29) — 전폭 스크롤 + 좌우 25px 패딩 + scroll-padding + snap start
     (섹션 좌우 패딩 20px를 음수 마진으로 상쇄해 뷰포트 끝까지 스크롤). 카드 1개면 스크롤 잠금(.m-slider-static) */
  .theme-m-prod-slider {
    margin: 0 -20px;
    padding: 0 25px 8px;
    scroll-padding: 0 25px;
  }
  .theme-m-prod-slider .m-prod-card { scroll-snap-align: start; }
  .m-slider-static { overflow-x: hidden; }
  .m-prod-card--sample { opacity: 0.6; cursor: default; }

  /* ── CATEGORY + SLIDER ── */
  .d-cat-section { position: relative; gap: 32px; }
  .pkg-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 40px;
    background: var(--cs-lilac);
  }
  .pkg-bar-label { font-family: var(--font-en-display); font-size: 18px; color: var(--cs-dark); }
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
    width: 88px;   /* PC 카테고리 버튼: 100→80px 축소 후 88px로 10% 확대(2026-09-29, /products와 동기화) */
    min-height: 44px;
  }
  .cat-tab-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 88px; height: 88px;
    border-radius: 26px;
    transition: background 0.18s, filter 0.18s;
  }
  /* 호버·선택 인터랙션 — 테두리(box-shadow 링) 대신 filter(밝기·채도) 컬러 톤 변화로 표현.
     parent(.cat-tab-icon)에 filter를 걸면 내장 SVG 아이콘·커스텀 이미지 아이콘(자체 배경
     baked-in) 둘 다 렌더링된 픽셀 전체에 동일하게 적용되어 아이콘 종류 분기 없이 일관 동작 */
  .cat-tab:hover .cat-tab-icon {
    filter: brightness(1.12) saturate(1.15);
  }
  .cat-tab.active .cat-tab-icon {
    filter: brightness(1) saturate(1.3);
  }
  /* 업로드된 커스텀 아이콘 SVG는 전부 100x100 캔버스에 자체 배경(#E1DEF3, rx=30 —
     .cat-tab-icon의 비활성 배경·radius와 동일)을 이미 포함한 "완결형 타일"로 제작돼 있음
     — .cat-tab-icon(부모, 100x100)에 꽉 채워야 실제 글리프가 정상 크기로 보임.
     40x40으로 축소하면 아이콘 내부 여백까지 함께 줄어들어 실제 그림 부분만 40px의 절반
     이하로 쪼그라들어 매우 작게 보이던 버그(2026-08-26 실사용 중 발견) */
  .cat-tab-custom-icon { width: 88px; height: 88px; object-fit: contain; border-radius: 26px; }
  /* ON 이미지가 있는 카테고리: 상자 배경·filter 효과 대신 OFF/ON 이미지 교차 전환 */
  .cat-tab-icon.has-on { position: relative; background: transparent; filter: none !important; }
  .cat-tab-icon.has-on .cat-tab-custom-icon { position: absolute; inset: 0; transition: opacity 0.25s ease; }
  .cat-tab-icon.has-on .cat-tab-icon-on { opacity: 0; }
  .cat-tab:hover .cat-tab-icon.has-on .cat-tab-icon-on,
  .cat-tab.active .cat-tab-icon.has-on .cat-tab-icon-on { opacity: 1; }
  .cat-tab:hover .cat-tab-icon.has-on .cat-tab-icon-off,
  .cat-tab.active .cat-tab-icon.has-on .cat-tab-icon-off { opacity: 0; }
  .cat-tab-label {
    font-family: var(--font-kr);
    font-size: 15px;
    font-weight: 700;
    color: var(--cs-dark);
  }
  /* cat-tabs(카테고리 아이콘 탭)와의 간격 확보 — 부모 .d-cat-section의 공용 gap(32px) 외에
     이 지점에만 추가 여백을 더함(margin-top으로 국소 적용, 다른 형제 요소 간격엔 영향 없음) */
  .michil-heading { display: flex; justify-content: center; align-items: center; gap: 10px; margin-top: 24px; }
  .michil-logo { height: 68px; width: auto; flex-shrink: 0; }   /* 34px(제목 높이) 대비 100% 확대(2026-09-29) */
  .md-picks-section .michil-heading { margin-bottom: 16px; }   /* 제거한 'MD 추천' 라벨 줄(margin-bottom 16px)을 대체 */
  /* 모바일 홈 MD 추천 영역 — 제목 크기는 모바일 토큰(32px→24px)으로 적용 */
  .md-picks-section .michil-title { font: var(--text-m-ad-kr-24); }
  .michil-title {
    font-family: var(--font-kr-heading);
    font-size: 32px;
    font-weight: 900;
    color: #201857;
  }

  /* 슬라이더 */
  .prod-slider-wrap { position: relative; }
  .prod-slider {
    display: flex;
    gap: 24px;
    overflow-x: auto;
    padding-bottom: 16px;
    padding-inline: 8px;
    scrollbar-width: none;
  }
  .prod-slider::-webkit-scrollbar { display: none; }
  /* 표준 상품슬라이드 카드 — Figma node 600:862 스펙 그대로 반영 (정사각 300x300, radius 50px) */
  /* 카드 자체는 고정 — hover 시 내부 이미지만 부드럽게 확대(잘림 없는 줌 효과) */
  .prod-card {
    position: relative;
    flex-shrink: 0;
    overflow: hidden;
    cursor: pointer;
    width: 300px; height: 300px;
    border-radius: 50px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  .prod-card-img {
    position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
    transition: transform 0.4s ease;
  }
  .prod-card:hover .prod-card-img { transform: scale(1.25); }
  .prod-card-info {
    position: relative;
    width: 100%;
    box-sizing: border-box;
    padding: 30px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: linear-gradient(to bottom, rgba(16,11,50,0) 0%, rgba(16,11,50,0.6) 40.385%, #100b32 100%);
  }
  .prod-card-headline { display: flex; flex-direction: column; gap: 5px; }
  .prod-card-cat  { font-family: var(--font-kr); font-size: 12px; font-weight: 700; color: #fff; }
  .prod-card-name { font-family: var(--font-kr); font-size: 18px; font-weight: 700; color: #fff; line-height: 1.7; }
  .prod-card-price {
    display: flex; align-items: center; gap: 5px;
    color: #ff3535; letter-spacing: -0.5px;
  }
  .prod-card-price .price-label { font-family: var(--font-kr); font-size: 14px; font-weight: 700; }
  .prod-card-price .price-num   { font-family: var(--font-kr); font-size: 25px; font-weight: 900; }
  .prod-card-price .price-sep   { font-family: var(--font-kr); font-size: 14px; font-weight: 700; }
  .prod-card-desc { font-family: var(--font-kr); font-size: 12px; font-weight: 700; color: #fff; }

  /* 카테고리 상품 슬라이더(PC) — /products 헤더 카드 슬라이더(.d-slider-relative/.d-slider-cards/.d-feat-card) 컨테이너 값 반영(2026-09-29)
     높이 500px(세로폭 Stephen 지정, /products는 580px) · 카드 3장 균등(gap 20px, 최소 300px) · 반경 50/20/50/20 · 카드 안쪽은 기존 prod-card 스타일 유지.
     .prod-slider-wrap 범위로 한정 — 취향직격 테마 슬라이더(.theme-prod-slider)의 300×300 카드는 그대로 */
  .prod-slider-wrap .prod-slider { gap: 20px; padding: 0; height: 500px; }
  .prod-slider-wrap .prod-card {
    flex: 0 0 calc((100% - 40px) / 3);
    min-width: 300px;
    width: auto;
    height: 500px;
    border-radius: 50px 20px 50px 20px;
  }

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
  /* 우측 카드(2·3): /crazylog 헤더 카드2·3과 동일하게 분류 헤더 + 하단 제목·부제 — 카드 높이가 작아 여백·제목 크기를 줄임 */
  .blog-sub-footer {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    padding: 24px 40px;
    background: linear-gradient(to top, rgba(16,11,50,0.8) 0%, transparent 100%);
  }
  .blog-sub-caption { font-size: 18px; }
  .blog-main-caption { font-family: var(--font-kr); font-size: 22px; font-weight: 900; color: white; line-height: 1.5; }
  /* /crazylog 헤더 카드의 부제(d-shotlog-writing-sub)와 동일 톤 — 본문 첫 문단 요약 */
  .blog-main-sub { margin: 4px 0 0; font-family: var(--font-kr); font-size: 16px; font-weight: 700; color: white; line-height: 1.5; letter-spacing: -0.5px; }

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

  /* ── MOBILE HERO ── */
  .m-hero {
    position: relative;
    width: 100%;
    overflow: hidden;
    height: 720px;
    background: #fdefc3;
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

  /* 표준 상품슬라이드 카드 — Figma node 600:862 스펙(정사각) 모바일 축소 적용 */
  .m-prod-card {
    position: relative;
    flex-shrink: 0;
    overflow: hidden;
    cursor: pointer;
    width: 260px; height: 260px;
    border-radius: 44px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    scroll-snap-align: center;
    transition: transform 0.15s;
  }
  .m-prod-card:active { transform: scale(0.97); }
  .m-prod-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .m-prod-info {
    position: relative;
    width: 100%;
    box-sizing: border-box;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: linear-gradient(to bottom, rgba(16,11,50,0) 0%, rgba(16,11,50,0.6) 40.385%, #100b32 100%);
  }
  .m-prod-headline { display: flex; flex-direction: column; gap: 4px; }
  .m-prod-cat  { font-family: var(--font-kr); font-size: 11px; font-weight: 700; color: #fff; }
  .m-prod-name { font-family: var(--font-kr); font-size: 16px; font-weight: 700; color: #fff; line-height: 1.5; }
  .m-prod-price {
    display: flex; align-items: center; gap: 4px;
    color: #ff3535; letter-spacing: -0.5px;
  }
  .m-prod-price .price-label { font-family: var(--font-kr); font-size: 12px; font-weight: 700; }
  .m-prod-price .price-num   { font-family: var(--font-kr); font-size: 21px; font-weight: 900; }
  .m-prod-price .price-sep   { font-family: var(--font-kr); font-size: 12px; font-weight: 700; }
  .m-prod-desc { font-family: var(--font-kr); font-size: 11px; font-weight: 700; color: #fff; }

  /* ── MD 추천 (모바일 초기화면, /products의 md-picks-* 디자인 그대로 이식) ──
     기존 .m-prod-name/.m-prod-info(흰 글자, 이미지 오버레이용)와 완전히 다른 레이아웃
     (어두운 글자, 이미지 박스 아래 별도 텍스트 영역)이라 이름 충돌 방지를 위해 전용
     클래스로 분리 */
  .md-picks-section { padding-top: 64px; padding-bottom: 80px; }   /* 하단 40px → 80px(+100%) — 아래 크레이지로그 섹션과의 간격(2026-09-29) */
  .md-picks-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 80px;
  }
  /* 좌우 스크롤 해제(요청 2026-09-29) — 2열 그리드로 화면 폭 안에 배치, 카드는 표준 174px를 최대로 폭에 맞춰 축소 */
  .md-picks-track {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 15px;
    justify-items: center;
  }
  /* /products "MD 추천"(모바일) 썸네일 카드 스타일 반영(요청 2026-09-29) — 찜 버튼 등 기능은 제외, 스타일만 이식 */
  .md-pick-card {
    width: 100%;
    max-width: 174px;   /* 표준 상품카드 모바일 썸네일 크기(ProductDPCard 174px, front-uiux.md §14-4) — 재적용 2026-09-29 */
    text-decoration: none;
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: transform 0.2s;
  }
  /* 호버: 카드 자체 확대는 트랙 overflow로 잘려 이미지만 1.04배 */
  .md-pick-img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s ease; }
  .md-pick-card:hover .md-pick-img { transform: scale(1.04); }
  .md-pick-img-box {
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: var(--radius-lg) var(--radius-sm) var(--radius-lg) var(--radius-sm);
    overflow: hidden;
    position: relative;
    background: var(--cs-lilac);
  }
  .mdp-info {
    display: flex;
    flex-direction: column;
    gap: 10.8px;
    padding: 10.8px 0 0;
    width: 100%;
    min-width: 0;
  }
  .mdp-category {
    font: var(--text-m-script-12);
    font-weight: 700;
    color: var(--cs-text-light);
    line-height: 1;
    margin: 0;
    text-transform: uppercase;
  }
  .mdp-price-row {
    display: flex;
    align-items: baseline;
    gap: 3px;
    color: var(--cs-purple-dark);
    letter-spacing: -0.8px;
    flex-wrap: wrap;
  }
  .mdp-price-group { display: flex; align-items: baseline; gap: 3px; }
  .mdp-price-label { font: var(--text-m-tag-11); font-weight: 500; line-height: 1; }
  .mdp-price-num {
    font: var(--text-m-body-16B);
    font-weight: 900;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--cs-purple-light);
  }
  .mdp-price-sep { font: var(--text-m-script-14B); line-height: 1; color: var(--cs-purple-pale); }
  .mdp-name {
    font: var(--text-m-script-12);
    color: var(--cs-purple-dark);
    letter-spacing: -0.5px;
    line-height: 1.12;
    margin: 0;
    width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* CMS 관리 버튼 — 기존 .hero-cms-btn/.cat-cms-btn과 동일 위치·스타일 규칙 통일 */
  .md-picks-cms-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 20;
    padding: 6px 12px;
    background: rgba(16, 11, 50, 0.75);
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cs-white);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
  }
  .md-picks-cms-btn--empty { position: static; }

  /* ── MOBILE BLOG ── */
  /* 모바일 크레이지로그 섹션 제목 28px → 한 사이즈 작은 토큰 --text-m-ad-kr-24(24px, 2026-09-29) */
  .m-blog-section .section-title { font: var(--text-m-ad-kr-24); }
  /* 부제 15px → 한 사이즈 큰 토큰 --text-m-body-16B(16px, 2026-09-29) */
  .m-blog-section .section-sub { font: var(--text-m-body-16B); }
  .m-blog-section {
    background: #ffb3b3;
    border-radius: 0 50px 0 0;
    padding: 48px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
  }
  /* /crazylog(m-carousel/m-card) 슬라이드 구조 그대로 반영 */
  .m-blog-carousel {
    display: flex;
    gap: 50px;   /* /crazylog .m-carousel과 동일 */
    /* 섹션 좌우 패딩(24px)을 상쇄해 뷰포트 전폭 스크롤 + 좌우 25px 패딩 + scroll-padding (/crazylog 구조 그대로) */
    width: calc(100% + 48px);
    margin: 0 -24px;
    overflow-x: auto;
    padding: 0 25px 20px;
    scroll-padding: 0 25px;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .m-blog-carousel::-webkit-scrollbar { display: none; }
  .m-blog-card {
    position: relative;
    flex-shrink: 0;
    width: min(340px, calc(100vw - 50px));   /* /crazylog .m-card 폭 340px — 좁은 화면은 좌우 25px 패딩에 맞춰 축소 */
    height: 380px;
    min-width: min(340px, calc(100vw - 50px));
    border-radius: 30px;
    box-shadow: 4px 4px 0 rgba(39,27,122,0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    text-decoration: none;
    scroll-snap-align: start;
    transition: transform 0.15s;
  }
  .m-blog-card:active { transform: scale(0.97); }
  .m-blog-card-bg { position: absolute; inset: 0; overflow: hidden; border-radius: 30px; pointer-events: none; }
  .m-blog-card-bg-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .m-blog-card-header {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
  }
  .m-blog-card-category { font-family: var(--font-en-display); font-size: 20px; color: white; }
  .m-blog-card-more {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
  }
  .m-blog-card-script {
    position: relative;
    z-index: 1;
    flex: 1 0 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    width: 100%;
  }
  .m-blog-card-writing {
    flex-shrink: 0;
    width: 100%;
    background: linear-gradient(to top, rgba(16,11,50,0) 0%, rgba(16,11,50,0.6) 40%, #100b32 100%);
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .m-blog-card-title { font-family: var(--font-kr); font-size: 21px; font-weight: 900; color: white; line-height: 1.4; margin: 0; }
  .m-blog-card-sub   { font-family: var(--font-kr); font-size: 16px; font-weight: 700; color: white; margin: 0; line-height: 1.5; }
  .m-blog-card-dots  { flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 16px 0; }
  .m-dot { width: 10px; height: 10px; border-radius: 50%; background: rgba(255,255,255,0.3); transition: all 0.2s; }
  .m-dot-active { width: 30px; border-radius: 15px; background: rgba(255,255,255,0.6); }

  /* ── MOBILE ARTICLES (실데이터: data.recentLogPosts, /crazylog/list m-post-card와 동일 UI 언어) ── */
  .m-articles-section { gap: 24px; }
  /* 콘텐츠 카드 사이 여백 24px → 36px(+50%, 2026-09-29) — 제목↔첫 카드 간격(24px)은 유지하려 카드 사이에만 추가 */
  .m-article-card + .m-article-card { margin-top: 12px; }
  .m-articles-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 0;
    text-decoration: none;
  }
  .m-articles-heading { font: var(--text-m-title-18B); color: var(--cs-dark); }   /* 20px → 한 사이즈 작은 토큰 18px(2026-09-29) */
  .m-articles-more-btn {
    width: 22px; height: 22px;
    border-radius: 7px;
    background: #e1def3;
    display: flex; align-items: center; justify-content: center;
  }
  /* /crazylog "K-Trend Log" 섹션(m-article-card) 카드 UI 그대로 반영 —
     bg 이미지 + 그라디언트 오버레이 + 하단 정렬 텍스트(날짜·제목·본문 미리보기) */
  .m-article-card {
    position: relative;
    display: block;
    width: 100%;
    height: 264px;
    border-radius: 30px;
    overflow: hidden;
    text-decoration: none;
    transition: transform 0.15s;
  }
  .m-article-card:active { transform: scale(0.98); }
  .m-article-card-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  .m-article-card-bg-empty { background: var(--cs-dark); }
  .m-article-card-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to top,
      rgba(16, 11, 50, 0.82) 0%,
      rgba(16, 11, 50, 0.30) 60%,
      rgba(16, 11, 50, 0.05) 100%
    );
  }
  .m-article-card-content {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 18px 22px 28px;
    gap: 4px;
  }
  .m-article-card-date { font: var(--text-m-script-12); color: rgba(255, 255, 255, 0.65); letter-spacing: 0.2px; }
  .m-article-card-title {
    font: var(--text-m-ad-kr-20);
    color: #ffffff;
    margin: 0;
    line-height: 1.4;
    letter-spacing: -0.3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .m-article-card-desc {
    font: var(--text-m-script-14B);
    color: rgba(255, 255, 255, 0.70);
    margin: 0;
    line-height: 1.5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .m-articles-empty { font-family: var(--font-kr); font-size: 14px; color: var(--cs-text-light); text-align: center; padding: 24px 0; margin: 0; }

  /* ── MOBILE FAQ ── */
  .m-faq-section { gap: 0; }   /* 히어로 ↔ FAQ 목록 간격 24px → 0(2026-09-29) */
  /* 모바일 FAQ 헤더 — /help 히어로(hero-section·hero 계열·cat-card) 모바일 값 그대로(클래스만 mh- 접두사) */
  .mh-hero {
    position: relative; width: 100%; overflow: hidden; border-radius: 30px 30px 0 0; min-height: 600px;   /* 하단 좌우 라운드 제거(2026-09-29) */
    /* 하단 36%를 투명 그라데이션으로 페이드아웃 — 64%부터 시작, 82% 지점 투명도 55%로 더 빠르게(2026-09-29) — 히어로 전체(이미지·텍스트)에 마스크가 걸리므로
       텍스트는 아래 .mh-hero-content 하단 여백으로 30% 위에 배치해 페이드 구간을 피한다 */
    -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 64%, rgba(0,0,0,0.45) 82%, transparent 100%);
    mask-image: linear-gradient(to bottom, #000 0%, #000 64%, rgba(0,0,0,0.45) 82%, transparent 100%);
  }
  /* PC 홈 FAQ 히어로 — 기존 좌측 브랜드 박스(폭 480px) 자리, 폭 유지 + 높이 400→480px */
  .mh-hero--pc { flex-shrink: 0; width: 480px; min-height: 528px; }   /* 480 → 528px(+10%, 2026-09-29) */
  .mh-hero--pc .mh-hero-content { min-height: 528px; padding-top: 40px; padding-bottom: 77px; }   /* 하단 여백 130px → 77px: 히어로 높이(528px)의 10%(≈53px)만큼 다시 내림(2026-09-29) */
  /* PC: 하단 투명 페이드(마스크) 대신 purple-100(--cs-dark #100B32)으로 끝나는 그라데이션 */
  .mh-hero--pc { -webkit-mask-image: none; mask-image: none; border-radius: var(--radius-2xl); }   /* 4모서리 모두 카드 대 PC 50px(front-uiux.md §4, --radius-2xl) */
  .mh-hero--pc .mh-hero-gradient {
    background: linear-gradient(to bottom, transparent 0%, rgba(16, 11, 50, 0.4) 50%, var(--cs-dark) 100%);
  }
  /* PC 크기 확대(2026-09-29): 로고 72→108px(+50%), 메인 24→35px(두 사이즈 위: 24→30→35, --text-pc-ad-kr-35), 서브 13→16px(두 사이즈 위: 13→14→16, --text-pc-title-16) */
  .mh-hero--pc .mh-hero-logo { height: 108px; }
  .mh-hero--pc .mh-hero-title { font: var(--text-pc-ad-kr-35); line-height: 1.3; }   /* 행 간격 160% → 130% (2026-09-29) */
  .mh-hero--pc .mh-hero-sub { font: var(--text-pc-title-16); line-height: 1.5; }   /* 행 간격 200% → 150% (2026-09-29) */
  .mh-hero-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .mh-hero-gradient {
    position: absolute; inset: 0;
    background: linear-gradient(to bottom, transparent 0%, rgba(16,11,50,0.4) 50%, rgba(16,11,50,0.85) 100%);
  }
  .mh-hero-edit-btn {
    position: absolute; top: 16px; right: 16px; z-index: 10;
    display: flex; align-items: center; gap: 6px;
    padding: 8px 14px;
    background: rgba(16, 11, 50, 0.65);
    color: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: var(--radius-xl);
    font-size: 13px; font-weight: 600;
    cursor: pointer;
    backdrop-filter: blur(6px);
    transition: background 0.15s, color 0.15s;
    min-height: 44px;
  }
  .mh-hero-edit-btn:hover { background: rgba(59, 47, 138, 0.85); color: #fff; border-color: rgba(255, 255, 255, 0.4); }
  .mh-hero-content {
    position: relative; z-index: 1;
    display: flex; flex-direction: column; justify-content: flex-end;
    gap: 24px;
    padding: 96px 20px 84px;   /* 하단 24px + 히어로 높이(600px)의 10%(60px) — 30% 올렸던 문구를 20%(120px) 아래로 재배치(2026-09-29) */
    min-height: 600px;
  }
  .mh-hero-heading { display: flex; flex-direction: column; gap: 12px; color: white; }
  .mh-hero-logo { height: 72px; width: auto; align-self: flex-start; }   /* 제목 위 로고 — 48px에서 50% 확대, 히어로 전용 BI(logo-bi-hero.svg, 2026-09-29) */
  .mh-hero-title {
    white-space: pre-line;
    font: var(--text-m-ad-kr-24);   /* 28px → 한 사이즈 작은 토큰 24px/700(kr-heading), 2026-09-29 */
    margin: 0;
    text-shadow: 0 1px 6px rgba(16, 11, 50, 0.3);   /* 옅은 글자 그림자(2026-09-29) — 배경 사진 위 가독성 */
  }
  .mh-hero-sub {
    white-space: pre-line;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 900; font-size: 13px; line-height: 1.6;
    color: rgba(255,255,255,0.9); margin: 0;
  }

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
    transform: translateY(0);
    transition: transform 0.3s ease;
  }
  .m-tab-bar.tab-bar-hidden {
    transform: translateY(100%);
  }
  @media (min-width: 768px) {
    .m-tab-bar { display: none; }
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

  /* 터치·호버 인터랙션 — 지금 짚고 있는 탭임을 짧은 버블 무빙으로 표현.
     클릭 시 발동하는 tab-bubble(선택 확정 튐)과는 별개로, 누르고 있는/마우스 오버 중인
     동안만 살짝 위로 부풀어 오른 상태를 유지하다 손을 떼면 원위치 — 스프링 바운스 표준
     cubic-bezier(0.34, 1.28, 0.64, 1)(FloatingBar 확정값과 동일 곡선) 재사용, 짧게 0.24s. */
  .m-tab-item svg {
    transition: transform 0.24s cubic-bezier(0.34, 1.28, 0.64, 1);
  }
  .m-tab-item:hover svg,
  .m-tab-item:active svg {
    transform: translateY(-3px) scale(1.1);
  }

  /* ── CMS 편집 링크 버튼 (isCms=true 시 섹션 상단 노출) ── */
  .cms-section-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 18px;
    background: rgba(59, 47, 138, 0.10);
    color: var(--cs-purple);
    border: 1.5px solid var(--cs-purple);
    border-radius: var(--radius-xl);
    font-family: var(--font-kr);
    font-size: 13px;
    font-weight: 700;
    text-decoration: none;
    width: fit-content;
    margin: 0 auto;
    transition: background 0.18s, color 0.18s;
  }
  .cms-section-link:hover {
    background: var(--cs-purple);
    color: #fff;
  }
  /* 어두운 배경 섹션(모바일 크레이지로그) 위에서 쓸 때 */
  .cms-section-link--light {
    background: rgba(255, 255, 255, 0.18);
    color: #fff;
    border-color: rgba(255, 255, 255, 0.6);
  }
  .cms-section-link--light:hover {
    background: rgba(255, 255, 255, 0.35);
    color: #fff;
  }
</style>
