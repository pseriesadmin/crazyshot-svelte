<script lang="ts">
  import { goto } from '$app/navigation'
  import type { PageData } from './$types'
  import type { ProductCard } from './+page.server'
  import ProductCategoryModal from '$lib/components/products/admin/ProductCategoryModal.svelte'
  import ProductHeroModal from '$lib/components/products/admin/ProductHeroModal.svelte'
  import ProductGridModal from '$lib/components/products/admin/ProductGridModal.svelte'
  import ProductMdPickModal from '$lib/components/products/admin/ProductMdPickModal.svelte'

  let { data }: { data: PageData } = $props()

  // ── 정적 타입 (폴백용) ──────────────────────────────────────────────────
  interface ImgStyle { h: string; l: string; t: string; w: string }
  interface DesktopProduct { img: string; imgStyle?: ImgStyle; price: string; name: string; flat?: boolean }
  interface MobileProduct { img: string; imgStyle: ImgStyle; name: string; price: string }

  // ── 카테고리 아이콘 매핑 (code → SVG 인덱스 0~7) ───────────────────────


  // ── 카테고리 한글 라벨 (code_mapping_groups.name 우선, 폴백용) ──────────
  const CAT_LABELS: Record<string, string> = {
    camera:     '카메라',
    lens:       '렌즈',
    actcam:     '액션캠',
    dronegim:   '드론/짐벌',
    light:      '조명',
    accessorie: '악세서리',
    hypepack:   '추천패키지',
    phone:      '스마트폰',
    partner:    '협력사',
    'used-item': '중고',
  }

  const KEYWORDS_FALLBACK = ['SONY', 'CANON', 'NIKON', 'Fujitsu', 'Olympus', 'Panasonic']
  let displayKeywords = $derived(
    data.settings.keywords.items.length > 0
      ? data.settings.keywords.items
      : KEYWORDS_FALLBACK
  )


  const desktopProducts: DesktopProduct[] = [
    { img:'/images/products/grid-flat.png', price:'Day 35,000 / 12H 25,000', name:'SONY FE 24-105 F4 G OSS', flat:true },
    { img:'/images/products/grid-flat.png', price:'Day 35,000 / 12H 25,000', name:'SONY FE 24-105 F4 G OSS', flat:true },
    { img:'/images/products/grid-flat.png', price:'Day 35,000 / 12H 25,000', name:'SONY FE 24-105 F4 G OSS', flat:true },
    { img:'/images/products/grid-flat.png', price:'Day 35,000 / 12H 25,000', name:'SONY FE 24-105 F4 G OSS', flat:true },
    { img:'/images/products/feat-4.png',  imgStyle:{h:'111.22%',l:'-22.33%',t:'-19.34%',w:'151.95%'}, price:'$ 230 / 1w', name:'SONY A7S3' },
    { img:'/images/products/feat-5.png',  imgStyle:{h:'140.11%',l:'-50.24%',t:'-33.49%',w:'191.42%'}, price:'$ 195 / 1w', name:'SONY HXR-NX30N' },
    { img:'/images/products/grid-11.png', imgStyle:{h:'103.27%',l:'-14.26%',t:'-2.44%', w:'141.14%'}, price:'$ 180 / 1w', name:'SONY FE 24-105 F4 G OSS' },
    { img:'/images/products/grid-10.png', imgStyle:{h:'140.11%',l:'-53.68%',t:'-37.83%',w:'191.42%'}, price:'$ 230 / 1w', name:'SONY A7S3' },
    { img:'/images/products/feat-6.png',  imgStyle:{h:'138.06%',l:'-43.05%',t:'-36.79%',w:'188.68%'}, price:'$ 320 / 1w', name:'SONY A7S3' },
    { img:'/images/products/grid-8.png',  imgStyle:{h:'140.11%',l:'-29.64%',t:'-34.71%',w:'191.42%'}, price:'$ 195 / 1w', name:'SONY HXR-NX30N' },
    { img:'/images/products/grid-15.png', imgStyle:{h:'148.29%',l:'-43.64%',t:'-24.95%',w:'202.67%'}, price:'$ 180 / 1w', name:'SONY FE 24-105 F4 G OSS' },
    { img:'/images/products/grid-14.png', imgStyle:{h:'140.11%',l:'-43.92%',t:'-39.56%',w:'191.42%'}, price:'$ 230 / 1w', name:'SONY A7S3' },
  ]

  const mobileProducts: MobileProduct[] = [
    { img:'/images/products/mob-0.png',   imgStyle:{h:'140.56%',l:'-21.45%',t:'-21.01%',w:'170.38%'}, name:'SONY A7S3', price:'120,000 원 / 1일' },
    { img:'/images/products/feat-2.png',  imgStyle:{h:'137.82%',l:'-18.71%',t:'-22.6%', w:'167.05%'}, name:'SONY A7S3', price:'80,000 원 / 1일' },
    { img:'/images/products/feat-5.png',  imgStyle:{h:'152.17%',l:'-58.19%',t:'-28.24%',w:'212.12%'}, name:'SONY A7S3', price:'120,000 원 / 1일' },
    { img:'/images/products/mob-2.png',   imgStyle:{h:'151.2%', l:'-15.32%',t:'-25.25%',w:'183.27%'}, name:'SONY A7S3', price:'120,000 원 / 1일' },
    { img:'/images/products/grid-15.png', imgStyle:{h:'165.76%',l:'-44.75%',t:'-16.95%',w:'200.92%'}, name:'SONY A7S3', price:'120,000 원 / 1일' },
    { img:'/images/products/feat-6.png',  imgStyle:{h:'154.95%',l:'-46.45%',t:'-32.84%',w:'187.82%'}, name:'SONY CAM',  price:'120,000 원 / 1일' },
    { img:'/images/products/mob-2.png',   imgStyle:{h:'172.35%',l:'-16.43%',t:'-33.37%',w:'208.9%' }, name:'SONY A7S3', price:'120,000 원 / 1일' },
    { img:'/images/products/feat-2.png',  imgStyle:{h:'103.88%',l:'-10.76%',t:'-1.06%', w:'125.91%'}, name:'인스타 360',price:'120,000 원 / 1일' },
    { img:'/images/products/feat-5.png',  imgStyle:{h:'152.17%',l:'-57.19%',t:'-28.84%',w:'212.12%'}, name:'캐논 300m', price:'120,000 원 / 1일' },
  ]

  const BRAND_LOGOS = [
    { src:'/images/products/brand-canon.png',   h:'27.68px', w:'93px',      imgStyle:{h:'145.67%',l:'-16.29%',t:'-20.32%',w:'132.5%'} },
    { src:'/images/products/brand-samsung.png', h:'23.602px',w:'154px',     cover:true },
    { src:'/images/products/brand-nikon.png',   h:'25px',    w:'143.191px', imgStyle:{h:'140.12%',l:'-3.16%', t:'-18.25%',w:'106.15%'} },
    { src:'/images/products/brand-gopro.png',   h:'33px',    w:'102.969px', imgStyle:{h:'325.76%',l:'-34.39%',t:'-112.88%',w:'167.04%'} },
  ]

  // ── 카테고리: 저장된 설정 기준 표시 (순서·아이콘URL 반영) ───────────────
  interface DisplayCat {
    id: string; code: string; name: string; sort_order: number; icon_url: string | null
  }

  let displayCats = $derived<DisplayCat[]>((() => {
    const savedItems = data.settings.categories?.items ?? []
    if (savedItems.length === 0) return []
    return [...savedItems]
      .sort((a, b) => a.sort_order - b.sort_order)
      .flatMap((item) => {
        const cat = data.categories.find((c) => c.id === item.code_id)
        if (!cat) return []
        return [{
          id:         cat.id,
          code:       cat.code,
          name:       CAT_LABELS[cat.code] ?? cat.name,
          sort_order: item.sort_order,
          icon_url:   (item as { icon_url?: string | null }).icon_url ?? null,
        }]
      })
  })())

  // 활성 카테고리 — URL ?category= 파라미터 기준 (SSR 데이터 반영, 없으면 'all')
  let activeCategory = $derived(data.urlCategory ?? 'all')
  let activeCategoryLabel = $derived(
    activeCategory === 'all'
      ? '전체'
      : (displayCats.find((c) => c.id === activeCategory)?.name ?? '')
  )

  // ── 슬라이드 (DB 설정값만 사용) ────────────────────────────────────
  let useDbGrid  = $derived(data.gridProducts.length > 0)

  // 데스크탑 슬라이더 페이지네이션
  let dPerPage = $state(4)  // SSR 기본값 4, 클라이언트에서 뷰포트에 따라 결정
  $effect(() => {
    const update = () => { dPerPage = window.innerWidth >= 1600 ? 4 : 3 }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  })
  let D_MAX_PAGE = $derived(
    Math.max(0, Math.ceil(data.heroProducts.length / dPerPage) - 1)
  )
  let dPage = $state(0)
  $effect(() => { if (dPage > D_MAX_PAGE) dPage = 0 })

  let visibleDesktopSlides = $derived(
    data.heroProducts.slice(dPage * dPerPage, dPage * dPerPage + dPerPage)
  )

  function dPrev() { if (dPage > 0) dPage-- }
  function dNext() { if (dPage < D_MAX_PAGE) dPage++ }

  // ── 휠·스와이프 네비게이션 ────────────────────────────────────────────
  let wheelCooldown = false
  function onDSliderWheel(e: WheelEvent) {
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY) && Math.abs(e.deltaY) < 30) return
    e.preventDefault()
    if (wheelCooldown) return
    wheelCooldown = true
    setTimeout(() => { wheelCooldown = false }, 500)
    const delta = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    if (delta > 0) dNext(); else dPrev()
  }

  let touchStartX = 0
  function onDSliderTouchStart(e: TouchEvent) { touchStartX = e.touches[0].clientX }
  function onDSliderTouchEnd(e: TouchEvent) {
    const dx = touchStartX - e.changedTouches[0].clientX
    if (Math.abs(dx) < 40) return
    if (dx > 0) dNext(); else dPrev()
  }

  // ── 가격 포맷 ─────────────────────────────────────────────────────────
  function formatPrice(n: number | undefined | null): string {
    return (n ?? 0).toLocaleString('ko-KR')
  }
  function productLink(p: ProductCard): string {
    return `/products/${p.slug ?? p.id}`
  }
  function dayPrice(p: ProductCard): string {
    return `Day ${formatPrice(p.base_price_daily)} / 12H ${formatPrice(Math.round(p.base_price_daily * 0.7))}`
  }
  function heroMobilePrice(p: ProductCard): string {
    return `${formatPrice(p.base_price_daily)} 원 / 1일`
  }
  function productImg(p: ProductCard): string {
    return p.image_urls?.[0] ?? '/images/products/grid-flat.png'
  }

  // ── 관리자 모달 ───────────────────────────────────────────────────────
  let activeModal = $state<'categories' | 'hero' | 'grid' | 'md_picks' | null>(null)
</script>

<div class="products-page">

  <!-- ─────────────────────────────────────────────────────────────────────── -->
  <!-- CATEGORY + SLIDER SECTION -->
  <!-- ─────────────────────────────────────────────────────────────────────── -->
  <div class="body-wrap">
    <div class="cat-section">

      <!-- Desktop: "Package" title bar (desktop only) -->
      <div class="d-pkg-title-bar">
        <span class="d-pkg-title">Package</span>
      </div>

      <!-- Category icons -->
      <div class="cat-icons" class:cat-icons-empty={displayCats.length === 0} style="position:relative">

        {#each displayCats as cat}
          <button
            class="cat-btn"
            class:active={activeCategory === cat.id}
            onclick={() => goto(cat.id === 'all' ? '/products' : `/products?category=${cat.id}`)}
            aria-pressed={activeCategory === cat.id}
          >
            {#if cat.icon_url}
              <div class="cat-icon-box">
                <img src={cat.icon_url} alt={cat.name} class="cat-custom-icon" />
              </div>
            {/if}
            <span class="cat-label" class:active={activeCategory === cat.id}>{cat.name}</span>
          </button>
        {/each}

        <!-- 관리자: 카테고리 설정 버튼 상시 노출 -->
        {#if data.isCms}
          <button
            class="admin-cat-btn"
            onclick={() => { activeModal = 'categories' }}
            aria-label="카테고리 설정"
          >⚙ 카테고리 설정</button>
        {/if}
      </div>

      <!-- Mobile: keyword pills -->
      <div class="m-keywords">
        {#each displayKeywords as kw}
          <button class="kw-pill">{kw}</button>
        {/each}
      </div>

      <!-- Mobile: section header (category label + chevron + more) -->
      <div class="m-sec-header">
        <span class="m-sec-label">{activeCategoryLabel}</span>
        <div class="m-sec-right">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true" style="transform:scaleY(-1)">
            <path d="M2 4.5L6.5 9L11 4.5" stroke="#3b2f8a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>

    </div>

    <!-- ── MOBILE SLIDER ───────────────────────────────────────────────────── -->
    <div class="m-slider-outer" style="position:relative">
      {#if data.isCms}
        <button class="admin-edit-btn admin-float-btn" onclick={() => { activeModal = 'hero' }} aria-label="헤더 상품 설정">
          ✦ 헤더 상품 설정
        </button>
      {/if}
      <div class="m-slider-track" class:slider-empty={data.heroProducts.length === 0}>
        {#each data.heroProducts as prod, i}
          <a href={productLink(prod)} class="m-feat-card">
            <div class="m-feat-bg"></div>
            <div class="m-feat-img-box">
              <img
                src={productImg(prod)} alt={prod.name} class="abs-img"
                style="width:100%;height:100%;object-fit:cover;left:0;top:0"
                loading={i === 0 ? 'eager' : 'lazy'}
              />
            </div>
            <div class="m-feat-dots">
              {#each data.heroProducts as _, di}
                {#if di === i}
                  <span class="feat-dot-active"></span>
                {:else}
                  <span class="feat-dot"></span>
                {/if}
              {/each}
            </div>
            <div class="m-feat-info">
              <p class="m-feat-title">{prod.name}</p>
              <div class="m-feat-price-wrap">
                <p class="m-feat-price">{heroMobilePrice(prod)}</p>
                <p class="m-feat-desc">{prod.product_caption ?? ''}</p>
              </div>
            </div>
          </a>
        {/each}
      </div>
    </div>

    <!-- ── DESKTOP SLIDER ─────────────────────────────────────────────────── -->
    <div class="d-slider-outer" style="position:relative">
      {#if data.isCms}
        <button class="admin-edit-btn admin-float-btn" onclick={() => { activeModal = 'hero' }} aria-label="헤더 상품 설정">
          ✦ 헤더 상품 설정
        </button>
      {/if}
      <div class="d-slider-relative"
        onwheel={onDSliderWheel}
        ontouchstart={onDSliderTouchStart}
        ontouchend={onDSliderTouchEnd}
      >
        <!-- Prev button -->
        <button
          class="d-nav-btn d-nav-prev"
          onclick={dPrev}
          disabled={dPage === 0}
          aria-label="이전"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M13 4L7 10L13 16" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>

        <!-- Cards -->
        <div class="d-slider-cards" class:slider-empty={data.heroProducts.length === 0} style="--dpp:{dPerPage}">
          {#each visibleDesktopSlides as prod, i (dPage * dPerPage + i)}
            <a href={productLink(prod)} class="d-feat-card">
              <div class="d-feat-bg"></div>
              <div class="d-feat-img-box">
                <img
                  src={productImg(prod)} alt={prod.name} class="abs-img"
                  style="width:100%;height:100%;object-fit:cover;left:0;top:0"
                  loading="eager"
                />
              </div>
              <div class="d-feat-info">
                <p class="d-feat-price">{heroMobilePrice(prod)}</p>
                <div>
                  <p class="d-feat-name">{prod.name}</p>
                  <p class="d-feat-desc">{prod.product_caption ?? ''}</p>
                </div>
              </div>
            </a>
          {/each}
        </div>

        <!-- Next button -->
        <button
          class="d-nav-btn d-nav-next"
          onclick={dNext}
          disabled={dPage >= D_MAX_PAGE}
          aria-label="다음"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M7 4L13 10L7 16" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <!-- Page dots -->
      <div class="d-slider-dots">
        {#each Array.from({length: D_MAX_PAGE + 1}) as _, i}
          <button
            class="d-dot"
            class:active={dPage === i}
            onclick={() => { dPage = i }}
            aria-label="슬라이드 페이지 {i + 1}"
          ></button>
        {/each}
      </div>
    </div>

  </div><!-- /body-wrap -->

  <!-- ─────────────────────────────────────────────────────────────────────── -->
  <!-- MD 추천 상품 (DB 설정 시 표시) -->
  <!-- ─────────────────────────────────────────────────────────────────────── -->
  {#if data.mdProducts.length > 0}
    <div class="md-picks-section" style="position:relative">
      {#if data.isCms}
        <button class="admin-edit-btn admin-float-btn" onclick={() => { activeModal = 'md_picks' }} aria-label="MD 추천 설정">
          ✦ MD 추천 설정
        </button>
      {/if}
      <div class="md-picks-header">
        <span class="md-picks-label">MD 추천</span>
      </div>
      <div class="md-picks-track">
        {#each data.mdProducts as prod}
          <a href={productLink(prod)} class="md-pick-card">
            <div class="md-pick-img-box">
              <img src={productImg(prod)} alt={prod.name} class="abs-img"
                style="width:100%;height:100%;object-fit:cover;left:0;top:0"
                loading="lazy" />
            </div>
            <div class="m-prod-info">
              <p class="m-prod-name">{prod.name}</p>
              <p class="m-prod-price">{dayPrice(prod)}</p>
            </div>
          </a>
        {/each}
      </div>
    </div>
  {:else if data.isCms}
    <div class="md-picks-section md-picks-empty">
      <button class="admin-edit-btn admin-md-empty-btn" onclick={() => { activeModal = 'md_picks' }}>
        ✦ MD 추천 상품 설정하기
      </button>
    </div>
  {/if}

  <!-- ─────────────────────────────────────────────────────────────────────── -->
  <!-- PRODUCT LIST SECTION -->
  <!-- ─────────────────────────────────────────────────────────────────────── -->

  <!-- MOBILE list (white bg, rounded top-right) -->
  <div class="m-list">
    <!-- Best Pick title (centered) -->
    <div class="m-best-pick-header" style="position:relative">
      {#if data.isCms}
        <button class="admin-edit-btn admin-float-btn" onclick={() => { activeModal = 'grid' }} aria-label="상품 목록 설정">
          ✦ 상품 목록 설정
        </button>
      {/if}
      <div class="m-best-pick-label">
        <span class="m-best-text">Best Pick</span>
        <span class="m-best-count">{useDbGrid ? data.gridProducts.length : 15}</span>
      </div>
      <div class="m-best-grad-bar"></div>
    </div>

    <!-- Product grid: first 6 -->
    <div class="m-prod-grid">
      {#if useDbGrid}
        {#each data.gridProducts.slice(0, 6) as prod}
          <a href={productLink(prod)} class="m-prod-card">
            <div class="m-prod-img-box">
              <img src={productImg(prod)} alt={prod.name} class="abs-img"
                style="width:100%;height:100%;object-fit:cover;left:0;top:0"
                loading="lazy" />
            </div>
            <div class="m-prod-info">
              <p class="m-prod-name">{prod.name}</p>
              <p class="m-prod-price">{dayPrice(prod)}</p>
            </div>
          </a>
        {/each}
      {:else}
        {#each mobileProducts.slice(0, 6) as prod}
          <a href="/products/9" class="m-prod-card">
            <div class="m-prod-img-box">
              <img src={prod.img} alt={prod.name} class="abs-img"
                style="height:{prod.imgStyle.h};left:{prod.imgStyle.l};top:{prod.imgStyle.t};width:{prod.imgStyle.w}"
                loading="lazy" />
            </div>
            <div class="m-prod-info">
              <p class="m-prod-name">{prod.name}</p>
              <p class="m-prod-price">{prod.price}</p>
            </div>
          </a>
        {/each}
      {/if}
    </div>

    <!-- CTA card: image LEFT, text RIGHT -->
    <div class="m-cta-card">
      <div class="m-cta-img">
        <img src="/images/products/ellipse.png" alt="크레이지샷 픽" loading="lazy" />
      </div>
      <div class="m-cta-text">
        <div class="m-cta-arrow-icon" aria-hidden="true">
          <svg width="34" height="16" viewBox="0 0 38 20" fill="none">
            <path d="M2 10H36M36 10L26 2M36 10L26 18" stroke="#FF3535" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <p class="m-cta-title">촬영본능</p>
        <p class="m-cta-pick">PICK!</p>
      </div>
      <div class="m-cta-chevron" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M8 4L14 10L8 16" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>

    <!-- Product grid: rest -->
    <div class="m-prod-grid">
      {#if useDbGrid}
        {#each data.gridProducts.slice(6) as prod}
          <a href={productLink(prod)} class="m-prod-card">
            <div class="m-prod-img-box">
              <img src={productImg(prod)} alt={prod.name} class="abs-img"
                style="width:100%;height:100%;object-fit:cover;left:0;top:0"
                loading="lazy" />
            </div>
            <div class="m-prod-info">
              <p class="m-prod-name">{prod.name}</p>
              <p class="m-prod-price">{dayPrice(prod)}</p>
            </div>
          </a>
        {/each}
      {:else}
        {#each mobileProducts.slice(6) as prod}
          <a href="/products/9" class="m-prod-card">
            <div class="m-prod-img-box">
              <img src={prod.img} alt={prod.name} class="abs-img"
                style="height:{prod.imgStyle.h};left:{prod.imgStyle.l};top:{prod.imgStyle.t};width:{prod.imgStyle.w}"
                loading="lazy" />
            </div>
            <div class="m-prod-info">
              <p class="m-prod-name">{prod.name}</p>
              <p class="m-prod-price">{prod.price}</p>
            </div>
          </a>
        {/each}
      {/if}
    </div>
  </div>

  <!-- DESKTOP list -->
  <div class="d-list">
    <div class="d-list-inner">
      <div class="d-list-header" style="position:relative">
        <span class="d-list-cat">{activeCategoryLabel}</span>
        <div style="display:flex;align-items:center;gap:16px">
          {#if data.isCms}
            <button class="admin-edit-btn" onclick={() => { activeModal = 'grid' }} aria-label="상품 목록 설정">
              ✦ 상품 목록 설정
            </button>
          {/if}
          <a href="/products" class="d-list-more">전체보기 →</a>
        </div>
      </div>
      <div class="d-prod-grid">
        {#if useDbGrid}
          {#each data.gridProducts as prod, idx}
            {#if idx < 4}
              <!-- flat card style for first 4 -->
              <a href={productLink(prod)} class="d-prod-flat">
                <div class="d-flat-img-box">
                  <img src={productImg(prod)} alt={prod.name} loading="lazy" class="d-flat-img" />
                </div>
                <div class="d-flat-info">
                  <p class="d-flat-price">{dayPrice(prod)}</p>
                  <p class="d-flat-name">{prod.name}</p>
                </div>
              </a>
            {:else}
              <!-- overlay card style for the rest -->
              <a href={productLink(prod)} class="d-prod-card">
                <div class="d-prod-bg"></div>
                <div class="d-prod-img-box">
                  <img src={productImg(prod)} alt={prod.name} class="abs-img"
                    style="width:100%;height:100%;object-fit:cover;left:0;top:0"
                    loading="lazy" />
                </div>
                <div class="d-prod-info">
                  <p class="d-prod-price">{dayPrice(prod)}</p>
                  <p class="d-prod-name">{prod.name}</p>
                </div>
              </a>
            {/if}
          {/each}
        {:else}
          {#each desktopProducts as prod}
            {#if prod.flat}
              <a href="/products/9" class="d-prod-flat">
                <div class="d-flat-img-box">
                  <img src={prod.img} alt={prod.name} loading="lazy" class="d-flat-img" />
                </div>
                <div class="d-flat-info">
                  <p class="d-flat-price">{prod.price}</p>
                  <p class="d-flat-name">{prod.name}</p>
                </div>
              </a>
            {:else}
              <a href="/products/9" class="d-prod-card">
                <div class="d-prod-bg"></div>
                <div class="d-prod-img-box">
                  <img src={prod.img} alt={prod.name} class="abs-img"
                    style="height:{prod.imgStyle?.h};left:{prod.imgStyle?.l};top:{prod.imgStyle?.t};width:{prod.imgStyle?.w}"
                    loading="lazy" />
                </div>
                <div class="d-prod-info">
                  <p class="d-prod-price">{prod.price}</p>
                  <p class="d-prod-name">{prod.name}</p>
                </div>
              </a>
            {/if}
          {/each}
        {/if}
      </div>
    </div>
  </div>

  <!-- Brand marquee (all viewports) -->
  <div class="brand-marquee-wrap">
    <div class="marquee-fade-left" aria-hidden="true"></div>
    <div class="marquee-fade-right" aria-hidden="true"></div>
    <div class="marquee-inner">
      {#each [...BRAND_LOGOS, ...BRAND_LOGOS, ...BRAND_LOGOS, ...BRAND_LOGOS] as logo}
        <div class="marquee-logo-box" style="height:{logo.h};width:{logo.w}">
          {#if logo.cover}
            <img src={logo.src} alt="" class="abs-img" style="inset:0;width:100%;height:100%;object-fit:cover" loading="lazy" />
          {:else if logo.imgStyle}
            <img src={logo.src} alt="" class="abs-img"
              style="height:{logo.imgStyle.h};left:{logo.imgStyle.l};top:{logo.imgStyle.t};width:{logo.imgStyle.w}"
              loading="lazy" />
          {/if}
        </div>
      {/each}
    </div>
  </div>

</div>

<!-- ─────────────────────────────────────────────────────────────────────── -->
<!-- 관리자 설정 모달 (isCms 시에만 렌더) -->
<!-- ─────────────────────────────────────────────────────────────────────── -->
{#if data.isCms}
  {#if activeModal === 'categories'}
    <ProductCategoryModal
      categories={data.categories}
      initialSettings={data.settings.categories}
      initialKeywordsSettings={data.settings.keywords}
      onclose={() => { activeModal = null }}
    />
  {/if}
  {#if activeModal === 'hero'}
    <ProductHeroModal
      settingKey="product_page_hero"
      initialSettings={data.settings.hero}
      onclose={() => { activeModal = null }}
    />
  {/if}
  {#if activeModal === 'grid'}
    <ProductGridModal
      categories={data.categories}
      initialSettings={data.settings.grid}
      onclose={() => { activeModal = null }}
    />
  {/if}
  {#if activeModal === 'md_picks'}
    <ProductMdPickModal
      initialSettings={data.settings.mdPicks}
      onclose={() => { activeModal = null }}
    />
  {/if}
{/if}

<style>
  /* ── base ── */
  .products-page {
    background: #ecebf4;
    min-height: 100vh;
    width: 100%;
  }
  .abs-img {
    position: absolute;
    max-width: none;
    pointer-events: none;
  }

  /* ── body-wrap: max 1240px centered ── */
  .body-wrap {
    width: 100%;
    max-width: 1240px;
    margin: 0 auto;
    padding: 0 25px;
    padding-top: 90px;
    padding-bottom: 50px;
    display: flex;
    flex-direction: column;
    gap: 30px;
  }

  /* ── CAT SECTION ── */
  .cat-section {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* Desktop "Package" title – hidden on mobile */
  .d-pkg-title-bar {
    display: none;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0 20px;
  }
  .d-pkg-title {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 20px;
    color: #100b32;
    letter-spacing: -0.5px;
  }

  /* Category icons grid */
  .cat-icons {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 20px 20px;
    cursor: pointer;
    margin-bottom: 20px;
  }
  /* 카테고리 미설정 상태: 라운드 블록 BG만 표시 */
  .cat-icons-empty {
    display: block;
    background: var(--cs-surface-gray);
    border-radius: var(--radius-2xl);
    min-height: 100px;
    margin-bottom: 20px;
  }
  .cat-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }
  .cat-icon-box {
    display: flex;
    width: 70px;
    height: 70px;
    min-width: 70px;
    min-height: 70px;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    aspect-ratio: 1 / 1;
    border-radius: 20px;
    background: #E1DEF3;
    overflow: hidden;
    transition: background 0.2s;
  }
  .cat-btn:hover .cat-icon-box {
    background: #3b2f8a;
  }
  .cat-icon-box {
    position: relative;
  }
  .cat-icon-box::after {
    content: '';
    position: absolute;
    inset: 0;
    background: #3b2f8a;
    border-radius: 20px;
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
  }
  .cat-btn:hover .cat-icon-box::after {
    opacity: 0.45;
  }
  .cat-custom-icon {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .cat-label {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 14px;
    color: #100b32;
    white-space: nowrap;
    text-align: center;
    line-height: 2;
    letter-spacing: -0.5px;
    transition: color 0.15s;
  }
  .cat-label.active { color: var(--cs-text); }

  /* Mobile keyword pills */
  .m-keywords {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 20px;
  }
  .kw-pill {
    background: #e1def3;
    border: none;
    border-radius: 13px;
    padding: 8px 25px;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 500;
    font-size: 14px;
    color: #444;
    cursor: pointer;
    white-space: nowrap;
    letter-spacing: -0.5px;
    min-height: 44px;
  }

  /* Mobile section header (category label + icon) */
  .m-sec-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 0;
  }
  .m-sec-label {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 21px;
    color: #100b32;
    letter-spacing: -0.3px;
    line-height: 1.6;
  }
  .m-sec-right { display: flex; align-items: center; gap: 15px; }

  /* ── MOBILE SLIDER ── */
  .m-slider-outer { overflow: hidden; }

  .m-slider-track {
    display: flex;
    gap: 15px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding-right: 40px;
  }
  .m-slider-track::-webkit-scrollbar { display: none; }
  .m-slider-track.slider-empty {
    min-height: 300px;
    border-radius: var(--radius-2xl);
    background: var(--cs-surface-gray);
  }

  .m-feat-card {
    flex: none;
    width: 310px;
    min-width: 310px;
    height: 450px;
    border-radius: 50px 50px 50px 20px;
    overflow: clip;
    position: relative;
    scroll-snap-align: start;
    text-decoration: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
  }
  .m-feat-bg {
    position: absolute;
    inset: 0;
    background: #e1def3;
    border-radius: 50px 50px 50px 20px;
  }
  .m-feat-img-box {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: 50px 50px 50px 20px;
  }
  .m-feat-dots {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 20px 0;
    position: relative;
    z-index: 10;
  }
  .feat-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(255,255,255,0.3);
    display: inline-block;
  }
  .feat-dot-active {
    width: 30px;
    height: 10px;
    border-radius: 15px;
    background: rgba(255,255,255,0.6);
    display: inline-block;
  }
  .m-feat-info {
    background: linear-gradient(to bottom, rgba(225,222,243,0) 0%, rgba(225,222,243,0.85) 30%, rgba(225,222,243,0.95) 100%);
    position: relative;
    z-index: 10;
    width: 100%;
  }
  .m-feat-info > * {
    padding: 0 30px 30px;
  }
  .m-feat-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 18px;
    color: #100b32;
    line-height: 1.6;
    letter-spacing: -0.3px;
    white-space: nowrap;
    margin: 0 0 15px;
    padding: 30px 30px 0;
  }
  .m-feat-price-wrap { padding: 0 30px 30px; }
  .m-feat-price {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 16px;
    color: #3b2f8a;
    line-height: 1.6;
    letter-spacing: -0.5px;
    white-space: nowrap;
    margin: 0 0 5px;
  }
  .m-feat-desc {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 500;
    font-size: 14px;
    color: #666;
    line-height: 1.6;
    margin: 0;
  }

  /* ── DESKTOP SLIDER – hidden on mobile ── */
  .d-slider-outer { display: none; }

  .d-slider-relative {
    position: relative;
    overflow: hidden;
  }
  .d-slider-cards.slider-empty {
    min-height: 400px;
    border-radius: var(--radius-2xl);
    background: var(--cs-surface-gray);
  }

  .d-nav-btn {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 10;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(16, 11, 50, 0.55);
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s, background 0.15s;
    backdrop-filter: blur(4px);
  }
  .d-slider-relative:hover .d-nav-btn:not(:disabled) { opacity: 1; }
  .d-nav-btn:hover:not(:disabled) { background: rgba(16, 11, 50, 0.88); }
  .d-nav-btn:disabled { opacity: 0 !important; cursor: default; }
  .d-nav-prev { left: 16px; }
  .d-nav-next { right: 16px; }

  .d-slider-cards {
    display: flex;
    gap: 20px;
  }

  .d-feat-card {
    flex: 0 0 calc((100% - (20px * var(--dpp) - 20px)) / var(--dpp));
    min-width: 300px;
    height: 580px;
    border-radius: 50px;
    overflow: clip;
    position: relative;
    text-decoration: none;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-end;
    transition: transform 0.2s;
  }
  .d-feat-card:hover { transform: translateY(-4px); }

  .d-feat-bg {
    position: absolute;
    inset: 0;
    background: #e1def3;
    border-radius: 50px;
  }
  .d-feat-img-box {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: 50px;
  }
  .d-feat-info {
    background: linear-gradient(to bottom, rgba(225,222,243,0) 0%, rgba(225,222,243,0.85) 30%, rgba(225,222,243,0.95) 100%);
    position: relative;
    z-index: 2;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 40px 35px 25px;
  }
  .d-feat-price {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 900;
    font-size: 25px;
    color: #1d183e;
    line-height: 2;
    white-space: nowrap;
    margin: 0;
  }
  .d-feat-name {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 16px;
    color: #444;
    line-height: 2;
    letter-spacing: -0.5px;
    white-space: nowrap;
    margin: 0;
  }
  .d-feat-desc {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 14px;
    color: #444;
    line-height: 1;
    letter-spacing: -0.5px;
    margin: 0;
  }

  .d-slider-dots {
    display: flex;
    gap: 8px;
    justify-content: center;
    margin-top: 24px;
  }
  .d-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: none;
    background: #c0bdd9;
    cursor: pointer;
    padding: 0;
    min-width: 8px;
    min-height: 8px;
    transition: width 0.3s, background 0.3s;
  }
  .d-dot.active { width: 24px; background: #3b2f8a; border-radius: 4px; }

  /* ─────────────────────────────────────────────────────────────────── */
  /* MD 추천 섹션 */
  /* ─────────────────────────────────────────────────────────────────── */
  .md-picks-section {
    width: 100%;
    max-width: 1240px;
    margin: 0 auto;
    padding: 0 25px 40px;
    overflow: hidden;
  }
  .md-picks-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 80px;
  }
  .md-picks-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }
  .md-picks-label {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 20px;
    color: #100b32;
    letter-spacing: -0.5px;
  }
  .md-picks-track {
    display: flex;
    gap: 15px;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .md-picks-track::-webkit-scrollbar { display: none; }
  .md-pick-card {
    flex: none;
    width: 200px;
    text-decoration: none;
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: transform 0.2s;
  }
  .md-pick-card:hover { transform: scale(1.02); }
  .md-pick-img-box {
    width: 100%;
    height: 200px;
    border-radius: 20px 20px 0 0;
    overflow: hidden;
    position: relative;
    background: #e1def3;
  }

  /* ─────────────────────────────────────────────────────────────────── */
  /* MOBILE LIST SECTION */
  /* ─────────────────────────────────────────────────────────────────── */
  .m-list {
    background: white;
    border-radius: 50px 50px 0 0;
    padding: 70px 25px 100px;
    display: flex;
    flex-direction: column;
    gap: 60px;
  }

  /* Best Pick header – centered */
  .m-best-pick-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 15px;
    width: 100%;
  }
  .m-best-pick-label {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .m-best-text {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 500;
    font-size: 16px;
    color: #666;
    line-height: 1.6;
    letter-spacing: -0.5px;
  }
  .m-best-count {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 16px;
    color: #201857;
    line-height: 1.6;
    letter-spacing: -0.5px;
  }
  .m-best-grad-bar {
    width: 40px;
    height: 8px;
    border-radius: 20px;
    background: linear-gradient(to right, #ff3535, #c1bbec);
  }

  /* Mobile product grid */
  .m-prod-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 10px;
  }
  .m-prod-card {
    width: calc(50% - 5px);
    min-width: 155px;
    text-decoration: none;
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: transform 0.2s;
  }
  .m-prod-card:hover { transform: scale(1.02); }
  .m-prod-img-box {
    width: 100%;
    height: 200px;
    border-radius: 20px 20px 0 0;
    overflow: hidden;
    position: relative;
    background: #e1def3;
  }
  .m-prod-info { padding: 5px 5px 10px; }
  .m-prod-name {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 16px;
    color: #1d183e;
    line-height: 1.6;
    letter-spacing: -0.5px;
    margin: 0 0 2px;
  }
  .m-prod-price {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 14px;
    color: #3b2f8a;
    line-height: 2;
    letter-spacing: -0.5px;
    margin: 0;
  }

  /* Mobile CTA card: image LEFT, text CENTER, chevron RIGHT */
  .m-cta-card {
    width: 100%;
    border-radius: 30px;
    background: linear-gradient(135deg, #ff3535 0%, #3b2f8a 60%);
    padding: 25px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: relative;
    overflow: hidden;
  }
  .m-cta-img {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
  }
  .m-cta-img img { width: 100%; height: 100%; object-fit: cover; }
  .m-cta-text {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    flex: 1;
  }
  .m-cta-arrow-icon { height: 16px; display: flex; align-items: center; }
  .m-cta-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 900;
    font-size: 24px;
    color: white;
    line-height: 1.6;
    letter-spacing: -0.5px;
    margin: 0;
  }
  .m-cta-pick {
    font-weight: 700;
    font-size: 30px;
    color: white;
    line-height: 1.3;
    margin: 0;
  }
  .m-cta-chevron { flex-shrink: 0; }

  /* DESKTOP LIST – hidden on mobile */
  .d-list { display: none; background: white; }

  .d-list-inner {
    max-width: 1240px;
    margin: 0 auto;
    padding: 80px 0;
    display: flex;
    flex-direction: column;
    gap: 100px;
  }
  .d-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0 10px;
  }
  .d-list-cat {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 20px;
    color: #100b32;
    letter-spacing: -0.5px;
  }
  .d-list-more {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 700;
    color: #553fe0;
    text-decoration: none;
    letter-spacing: -0.5px;
  }

  .d-prod-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 50px 20px;
    align-items: flex-start;
    justify-content: space-between;
    width: 100%;
  }

  /* Flat card */
  .d-prod-flat {
    width: 290px;
    height: 410px;
    border-radius: 40px;
    overflow: clip;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-decoration: none;
    cursor: pointer;
    transition: transform 0.2s;
  }
  .d-prod-flat:hover { transform: scale(1.02); }
  .d-flat-img-box {
    width: 100%;
    height: 290px;
    overflow: hidden;
    flex-shrink: 0;
  }
  .d-flat-img { width: 100%; height: 100%; object-fit: cover; }
  .d-flat-info {
    background: #e1def3;
    width: 100%;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1;
  }
  .d-flat-price {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 900;
    font-size: 18px;
    color: #100b32;
    line-height: 1;
    letter-spacing: -0.5px;
    margin: 0;
    white-space: nowrap;
  }
  .d-flat-name {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 14px;
    color: #444;
    line-height: 2;
    letter-spacing: -0.5px;
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Overlay card */
  .d-prod-card {
    width: 290px;
    height: 410px;
    border-radius: 50px;
    overflow: clip;
    position: relative;
    text-decoration: none;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-end;
    cursor: pointer;
    transition: transform 0.2s;
  }
  .d-prod-card:hover { transform: scale(1.02); }
  .d-prod-bg {
    position: absolute;
    inset: 0;
    background: #e1def3;
    border-radius: 50px;
  }
  .d-prod-img-box {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: 50px;
  }
  .d-prod-info {
    background: #e1def3;
    position: relative;
    z-index: 2;
    width: 100%;
    padding: 15px 30px 25px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .d-prod-price {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 900;
    font-size: 25px;
    color: #1d183e;
    line-height: 2;
    white-space: nowrap;
    margin: 0;
  }
  .d-prod-name {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 16px;
    color: #444;
    line-height: 2;
    letter-spacing: -0.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin: 0;
  }

  /* ─────────────────────────────────────────────────────────────────── */
  /* BRAND MARQUEE */
  /* ─────────────────────────────────────────────────────────────────── */
  .brand-marquee-wrap {
    width: 100%;
    max-width: 1240px;
    margin: 0 auto;
    height: 90px;
    overflow: hidden;
    position: relative;
  }
  .marquee-fade-left {
    position: absolute;
    inset-block: 0;
    left: 0;
    width: 60px;
    z-index: 10;
    background: linear-gradient(to right, #ecebf4, transparent);
    pointer-events: none;
  }
  .marquee-fade-right {
    position: absolute;
    inset-block: 0;
    right: 0;
    width: 60px;
    z-index: 10;
    background: linear-gradient(to left, #ecebf4, transparent);
    pointer-events: none;
  }
  .marquee-inner {
    display: flex;
    gap: 80px;
    align-items: center;
    width: max-content;
    animation: marquee 28s linear infinite;
    padding: 20px 0;
  }
  .brand-marquee-wrap:hover .marquee-inner { animation-play-state: paused; }
  .marquee-logo-box {
    position: relative;
    flex-shrink: 0;
    overflow: hidden;
  }
  @keyframes marquee {
    from { transform: translateX(0) }
    to   { transform: translateX(-50%) }
  }

  /* ─────────────────────────────────────────────────────────────────── */
  /* 관리자 공통 버튼 (front-uiux.md 토큰 기반) */
  /* ─────────────────────────────────────────────────────────────────── */
  .admin-edit-btn {
    background: rgba(16,11,50,0.75);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-sm);
    padding: 6px 12px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 32px;
    white-space: nowrap;
    transition: background 0.12s;
    z-index: 20;
  }
  .admin-edit-btn:hover { background: rgba(16,11,50,0.92); }

  /* 카테고리 전체 영역 클릭 오버레이 (isCms) */
  /* 관리자: 카테고리 설정 버튼 — 상시 노출 */
  .admin-cat-btn {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 20;
    background: rgba(16,11,50,0.72);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    padding: 4px 10px;
    min-height: 32px;
    cursor: pointer;
    white-space: nowrap;
  }

  .admin-float-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 20;
  }

  .admin-md-empty-btn {
    background: rgba(59,47,138,0.12);
    color: var(--cs-purple);
    border: 1px dashed var(--cs-purple);
    padding: 16px 32px;
    border-radius: var(--radius-xl);
    min-height: 56px;
  }

  /* ─────────────────────────────────────────────────────────────────── */
  /* DESKTOP BREAKPOINT ≥641px */
  /* ─────────────────────────────────────────────────────────────────── */
  @media (min-width: 641px) {
    .body-wrap {
      padding: 180px 0 60px;
    }

    /* Desktop: "Package" title bar */
    .d-pkg-title-bar { display: flex; }

    /* Category icons: single row, 100px each */
    .cat-icons {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 40px;
      margin-bottom: 20px;
    }
    .cat-btn { height: 140px; justify-content: space-between; }
    .cat-icon-box { width: 100px; height: 100px; min-width: 100px; min-height: 100px; border-radius: 30px; justify-content: center; align-items: center; }
    .cat-label.active { color: #3b2f8a; }

    /* Desktop: hide mobile-only elements */
    .m-keywords { display: none; }
    .m-sec-header { display: none; }
    .m-slider-outer { display: none; }

    /* Desktop slider */
    .d-slider-outer {
      display: block;
      padding: 0;
    }

    /* Desktop list */
    .m-list { display: none; }
    .d-list { display: block; }

    /* Brand marquee: white background on desktop */
    .brand-marquee-wrap { max-width: 100%; }
    .marquee-fade-left  { background: linear-gradient(to right, white, transparent); }
    .marquee-fade-right { background: linear-gradient(to left, white, transparent); }

    /* MD picks: desktop layout */
    .md-picks-section { padding: 20px 56px 40px; max-width: 100%; }
  }
</style>
