<script lang="ts">
  import type { PageData } from './$types'
  import type { ProductCard } from './+page.server'
  import ProductCategoryModal from '$lib/components/products/admin/ProductCategoryModal.svelte'
  import ProductHeroModal from '$lib/components/products/admin/ProductHeroModal.svelte'
  import ProductGridModal from '$lib/components/products/admin/ProductGridModal.svelte'
  import ProductMdPickModal from '$lib/components/products/admin/ProductMdPickModal.svelte'

  let { data }: { data: PageData } = $props()

  // ── 정적 타입 (폴백용) ──────────────────────────────────────────────────
  interface ImgStyle { h: string; l: string; t: string; w: string }
  interface MobileSlide { img: string; imgStyle: ImgStyle; title: string; price: string; desc: string }
  interface DesktopSlide { img: string; imgStyle: ImgStyle; price: string; name: string; desc: string }
  interface DesktopProduct { img: string; imgStyle?: ImgStyle; price: string; name: string; flat?: boolean }
  interface MobileProduct { img: string; imgStyle: ImgStyle; name: string; price: string }

  // ── 카테고리 아이콘 매핑 (code → SVG 인덱스 0~7) ───────────────────────
  const CAT_ICON: Record<string, number> = {
    hypepack:   0,
    camera:     1,
    lens:       2,
    actcam:     3,
    dronegim:   5,
    light:      4,
    accessorie: 7,
    phone:      6,
    partner:    7,
    'used-item': 7,
  }
  function catIconIdx(code: string): number {
    return CAT_ICON[code] ?? 7
  }

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

  const mobileSlides: MobileSlide[] = [
    { img:'/images/products/feat-1.png', imgStyle:{h:'188.62%',l:'-139.39%',t:'-24.06%',w:'364.67%'}, title:'코프로 히어로 11', price:'120,000 원 / 1일', desc:'초소형 디자인으로 무게감이 훨씬' },
    { img:'/images/products/feat-2.png', imgStyle:{h:'180%',   l:'-10%',    t:'-5%',    w:'120%'   }, title:'캐논 300DF',      price:'120,000 원 / 1일', desc:'초소형 디자인으로 무게감이 훨씬' },
    { img:'/images/products/feat-3.png', imgStyle:{h:'132.73%',l:'-53.86%', t:'-15.52%',w:'194.92%'}, title:'코프로 히어로 11', price:'120,000 원 / 1일', desc:'초소형 디자인으로 무게감이 훨씬' },
    { img:'/images/products/feat-4.png', imgStyle:{h:'111.22%',l:'-22.33%', t:'-19.34%',w:'151.95%'}, title:'SONY A7S3',      price:'$ 230 / 1w',       desc:'Ultra Compact Design' },
    { img:'/images/products/feat-6.png', imgStyle:{h:'138.06%',l:'-43.05%', t:'-36.79%',w:'188.68%'}, title:'SONY A7S3',      price:'$ 320 / 1w',       desc:'Ultra Compact Design' },
  ]

  const desktopSlides: DesktopSlide[] = [
    { img:'/images/products/feat-1.png', imgStyle:{h:'199.13%',l:'-106.84%',t:'-18.45%',w:'302.04%'}, price:'$ 180 / 1w', name:'GOPRO HERO11',            desc:'Ultra Compact Design Weighs Only' },
    { img:'/images/products/feat-2.png', imgStyle:{h:'180%',   l:'-10%',    t:'-5%',    w:'120%'   }, price:'$ 320 / 1w', name:'SONY FE 24-105 F4 G OSS', desc:'Ultra Compact Design Weighs Only' },
    { img:'/images/products/feat-3.png', imgStyle:{h:'132.73%',l:'-53.86%', t:'-15.52%',w:'194.92%'}, price:'$ 270 / 1w', name:'SONY A7S3',                desc:'Ultra Compact Design Weighs Only' },
    { img:'/images/products/feat-4.png', imgStyle:{h:'111.22%',l:'-22.33%', t:'-19.34%',w:'151.95%'}, price:'$ 230 / 1w', name:'SONY A7S3',                desc:'Ultra Compact Design Weighs Only' },
    { img:'/images/products/feat-5.png', imgStyle:{h:'140.11%',l:'-50.24%', t:'-33.49%',w:'191.42%'}, price:'$ 195 / 1w', name:'SONY HXR-NX30N',          desc:'Ultra Compact Design Weighs Only' },
    { img:'/images/products/feat-6.png', imgStyle:{h:'138.06%',l:'-43.05%', t:'-36.79%',w:'188.68%'}, price:'$ 320 / 1w', name:'SONY A7S3',                desc:'Ultra Compact Design Weighs Only' },
  ]

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
    if (savedItems.length > 0) {
      const matched = [...savedItems]
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
      // 유효한 매칭이 전체 카테고리의 절반 이상이면 사용 (구 코드 스테일 데이터 감지)
      if (matched.length >= Math.ceil(data.categories.length / 2)) return matched
    }
    // 저장 없거나 스테일 → 전체 카테고리 기본 순서
    return data.categories.map((c) => ({
      id: c.id, code: c.code, name: CAT_LABELS[c.code] ?? c.name,
      sort_order: c.sort_order, icon_url: null,
    }))
  })())

  // 초기 활성 카테고리 (camera = index 0 or 1)
  const _initId = data.categories.find((c) => c.code === 'camera')?.id
               ?? data.categories[0]?.id
               ?? ''
  let activeCategory = $state(_initId)
  let activeCategoryLabel = $derived(
    displayCats.find((c) => c.id === activeCategory)?.name ?? ''
  )

  // ── 슬라이드 (DB or 폴백) ────────────────────────────────────────────
  let useDbHero  = $derived(data.heroProducts.length > 0)
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
    useDbHero
      ? Math.max(0, Math.ceil(data.heroProducts.length / dPerPage) - 1)
      : Math.ceil(desktopSlides.length / dPerPage) - 1
  )
  let dPage = $state(0)
  $effect(() => { if (dPage > D_MAX_PAGE) dPage = 0 })

  let visibleDesktopSlides = $derived(
    useDbHero
      ? data.heroProducts.slice(dPage * dPerPage, dPage * dPerPage + dPerPage)
      : desktopSlides.slice(dPage * dPerPage, dPage * dPerPage + dPerPage)
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
      <div class="cat-icons" style="position:relative">
        {#each displayCats as cat}
          <button
            class="cat-btn"
            class:active={activeCategory === cat.id}
            onclick={() => { activeCategory = cat.id }}
            aria-pressed={activeCategory === cat.id}
          >
            <div class="cat-icon-box">
              {#if cat.icon_url}
                <img src={cat.icon_url} alt={cat.name} class="cat-custom-icon" />
              {:else if catIconIdx(cat.code) === 0}
                <svg xmlns="http://www.w3.org/2000/svg" width="46" height="49" viewBox="0 0 46 49" fill="none" aria-hidden="true">
                  <path d="M1 35.4413C1 37.7196 3.4397 39.1664 5.43889 38.0737L21.5611 29.2612C22.4578 28.7711 23.5422 28.7711 24.4389 29.2612L40.5611 38.0737C42.5603 39.1664 45 37.7196 45 35.4413V16.3044C45 15.2075 44.4014 14.1981 43.4389 13.672L24.4389 3.2865C23.5422 2.79639 22.4578 2.79639 21.5611 3.2865L2.56111 13.672C1.59863 14.1981 1 15.2075 1 16.3044V35.4413Z" fill="#FF3535"/>
                  <path d="M42.1101 16.2502C42.1101 14.8331 41.3421 13.5272 40.1053 12.8403L24.8856 4.38634C23.7127 3.73492 22.2874 3.73505 21.1144 4.38634L5.89376 12.8403C4.65708 13.5273 3.88992 14.8332 3.88992 16.2502V32.7498C3.88992 34.1668 4.65703 35.4728 5.89376 36.1597L21.1144 44.6127C22.2875 45.2642 23.7126 45.2643 24.8856 44.6127L40.1053 36.1597C41.3421 35.4728 42.1101 34.1669 42.1101 32.7498V16.2502ZM46 32.7498C46 35.5839 44.4648 38.1948 41.9914 39.5687L26.7717 48.0227C24.4255 49.3258 21.5745 49.3258 19.2283 48.0227L4.00863 39.5687C1.53502 38.1948 0 35.584 0 32.7498V16.2502C0 13.4161 1.53502 10.8052 4.00863 9.43129L19.2283 0.977352C21.5745 -0.325784 24.4255 -0.325784 26.7717 0.977352L41.9914 9.43129C44.4648 10.8053 46 13.4162 46 16.2502V32.7498Z" fill="#3B2F8A"/>
                  <path d="M1 16.0587C1 13.7804 3.4397 12.3336 5.43889 13.4263L21.5611 22.2388C22.4578 22.7289 23.5422 22.7289 24.4389 22.2388L40.5611 13.4263C42.5603 12.3336 45 13.7804 45 16.0587V35.1956C45 36.2925 44.4014 37.3019 43.4389 37.828L24.4389 48.2135C23.5422 48.7036 22.4578 48.7036 21.5611 48.2135L2.56111 37.828C1.59863 37.3019 1 36.2925 1 35.1956V16.0587Z" fill="#3B2F8A"/>
                </svg>
              {:else if catIconIdx(cat.code) === 1}
                <svg width="46" height="39" viewBox="0 0 46 39" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path class="cam-body" d="M46 26.8075V17.3422C46 13.0745 46 10.9406 45.1822 9.3105C43.5075 5.97267 40.4885 5.14973 37 5.14973C36.0433 5.14973 35.3083 4.33952 34.9217 3.46438C33.8467 1.03132 30.4876 0 28 0H19C16.364 0 12.3809 1.15812 11.4532 3.91513C11.2321 4.57222 10.6933 5.14973 10 5.14973C5.99786 5.14973 2.84232 5.27539 0.817837 9.3105C0 10.9406 0 13.0745 0 17.3422V26.8075C0 31.0753 0 33.2092 0.817837 34.8392C1.53723 36.2731 2.68512 37.4389 4.09701 38.1694C5.7021 39 7.80329 39 12.0057 39H33.9943C38.1967 39 40.2979 39 41.903 38.1694C43.3149 37.4389 44.4628 36.2731 45.1822 34.8392C46 33.2092 46 31.0753 46 26.8075Z" fill="#3B2F8A"/>
                  <path d="M23.5 10.5C29.299 10.5 34 15.201 34 21C34 26.799 29.299 31.5 23.5 31.5C17.701 31.5 13 26.799 13 21C13 15.201 17.701 10.5 23.5 10.5Z" fill="#E1DEF3" stroke="#FF3535" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              {:else if catIconIdx(cat.code) === 2}
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
                  <path d="M24 46C36.1503 46 46 36.1503 46 24C46 11.8497 36.1503 2 24 2C11.8497 2 2 11.8497 2 24C2 36.1503 11.8497 46 24 46Z" fill="#FF3535" stroke="#3B2F8A" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M24 40C32.8366 40 40 32.8366 40 24C40 15.1634 32.8366 8 24 8C15.1634 8 8 15.1634 8 24C8 32.8366 15.1634 40 24 40Z" fill="#3B2F8A"/>
                  <path d="M24 31C27.866 31 31 27.866 31 24C31 20.134 27.866 17 24 17C20.134 17 17 20.134 17 24C17 27.866 20.134 31 24 31Z" fill="#E1DEF3"/>
                </svg>
              {:else if catIconIdx(cat.code) === 3}
                <svg xmlns="http://www.w3.org/2000/svg" width="45" height="41" viewBox="0 0 45 41" fill="none" aria-hidden="true">
                  <path d="M34.2588 0C39.6394 0.000140955 44.2588 4.61937 44.2588 10C44.2588 12.0007 44.2565 16.1283 44.2549 19.7549C44.2541 21.5681 44.2535 23.2563 44.2529 24.4912C44.2526 25.1087 44.2521 25.6131 44.252 25.9629V26.5078C44.2512 27.8884 43.1315 29.0074 41.751 29.0068C40.3704 29.0061 39.2514 27.8864 39.252 26.5059V25.96C39.2521 25.6103 39.2526 25.1064 39.2529 24.4893C39.2535 23.2543 39.2541 21.5653 39.2549 19.752C39.2565 16.1252 39.2588 11.9993 39.2588 10C39.2588 7.3808 36.878 5.00015 34.2588 5C32.2593 5 27.1948 5.00134 22.1299 5.00293C17.0657 5.00452 12.0005 5.00684 10 5.00684C7.38071 5.00684 5 7.38755 5 10.0068C5 12.0074 4.99976 19.0072 5 25.5068C5.00012 28.7568 5.00089 31.8819 5.00098 34.1943V38.0068C5.00098 39.3875 3.88161 40.5067 2.50098 40.5068C1.20665 40.5068 0.141806 39.5232 0.0136719 38.2627L0.000976562 38.0068V25.5068C0.000732443 19.0073 3.97228e-08 12.0075 0 10.0068C4.09365e-07 4.62612 4.61929 0.00585938 10 0.00585938C11.9996 0.00585933 17.064 0.00451667 22.1289 0.00292969C27.1931 0.00134292 32.2583 0 34.2588 0ZM41.502 33.0068C43.435 33.0068 45.002 34.5738 45.002 36.5068C45.002 38.4398 43.435 40.0068 41.502 40.0068C39.569 40.0068 38.002 38.4398 38.002 36.5068C38.002 34.5738 39.569 33.0068 41.502 33.0068ZM16.501 9.25391C20.9193 9.25391 24.501 12.8356 24.501 17.2539V28.2529C24.501 32.6712 20.9193 36.2539 16.501 36.2539C12.0827 36.2539 8.50098 32.6712 8.50098 28.2529V17.2539C8.50098 12.8356 12.0827 9.25391 16.501 9.25391ZM16.501 24.2539C14.2918 24.2539 12.501 26.0448 12.501 28.2539C12.5012 30.4628 14.292 32.2539 16.501 32.2539C18.71 32.2539 20.5007 30.4628 20.501 28.2539C20.501 26.0448 18.7101 24.2539 16.501 24.2539Z" fill="#3B2F8A"/>
                  <path d="M20.501 17.2534C20.501 19.4626 18.7101 21.2534 16.501 21.2534C14.2918 21.2534 12.501 19.4626 12.501 17.2534C12.501 15.0443 14.2918 13.2534 16.501 13.2534C18.7101 13.2534 20.501 15.0443 20.501 17.2534Z" fill="#FF3535"/>
                </svg>
              {:else if catIconIdx(cat.code) === 4}
                <svg xmlns="http://www.w3.org/2000/svg" width="46" height="31" viewBox="0 0 46 31" fill="none" aria-hidden="true">
                  <rect y="16.0469" width="14" height="14" rx="5" fill="#3B2F8A"/>
                  <rect x="32" y="16.1406" width="14" height="14" rx="5" fill="#3B2F8A"/>
                  <rect x="16" y="16.0469" width="14" height="14" rx="5" fill="#FF3535"/>
                  <rect width="14" height="14" rx="5" fill="#3B2F8A"/>
                  <rect x="16" width="14" height="14" rx="5" fill="#FF3535"/>
                  <rect x="32" y="0.09375" width="14" height="14" rx="5" fill="#3B2F8A"/>
                </svg>
              {:else if catIconIdx(cat.code) === 5}
                <svg xmlns="http://www.w3.org/2000/svg" width="45" height="45" viewBox="0 0 45 45" fill="none" aria-hidden="true">
                  <path d="M36 29C39.866 29 43 32.134 43 36C43 39.866 39.866 43 36 43C32.134 43 29 39.866 29 36C29 32.134 32.134 29 36 29ZM9 2C12.866 2 16 5.13401 16 9C16 12.866 12.866 16 9 16C5.13401 16 2 12.866 2 9C2 5.13401 5.13401 2 9 2Z" fill="#FF3535"/>
                  <path d="M9 27C13.9706 27 18 31.0294 18 36C18 40.9706 13.9706 45 9 45C4.02944 45 0 40.9706 0 36C0 31.0294 4.02944 27 9 27ZM36 27C40.9706 27 45 31.0294 45 36C45 40.9706 40.9706 45 36 45C31.0294 45 27 40.9706 27 36C27 31.0294 31.0294 27 36 27ZM9 31C6.23858 31 4 33.2386 4 36C4 38.7614 6.23858 41 9 41C11.7614 41 14 38.7614 14 36C14 33.2386 11.7614 31 9 31ZM36 31C33.2386 31 31 33.2386 31 36C31 38.7614 33.2386 41 36 41C38.7614 41 41 38.7614 41 36C41 33.2386 38.7614 31 36 31ZM25.3281 15.4287C26.4997 14.2571 28.3997 14.2571 29.5713 15.4287C30.7428 16.6003 30.7429 18.5003 29.5713 19.6719L28.6318 20.6104C28.5235 21.8899 28.524 23.1097 28.6328 24.3896L29.5713 25.3281C30.7429 26.4997 30.7428 28.3997 29.5713 29.5713C28.3997 30.7429 26.4997 30.7429 25.3281 29.5713L24.3779 28.6211C23.1051 28.5104 21.8946 28.5075 20.6279 28.6143L19.6719 29.5713C18.5003 30.7429 16.6003 30.7428 15.4287 29.5713C14.2571 28.3997 14.2571 26.4997 15.4287 25.3281L16.4395 24.3164C16.5471 23.0866 16.5464 21.9107 16.4375 20.6807L15.4287 19.6719C14.2571 18.5003 14.2571 16.6003 15.4287 15.4287C16.6003 14.2572 18.5003 14.2571 19.6719 15.4287L20.6689 16.4258C21.9036 16.5325 23.0886 16.5311 24.335 16.4209L25.3281 15.4287ZM9 0C13.9706 0 18 4.02944 18 9C18 13.9706 13.9706 18 9 18C4.02944 18 0 13.9706 0 9C0 4.02944 4.02944 1.03081e-06 9 0ZM36 0C40.9706 0 45 4.02944 45 9C45 13.9706 40.9706 18 36 18C31.0294 18 27 13.9706 27 9C27 4.02944 31.0294 1.03081e-06 36 0ZM9 4C6.23858 4 4 6.23858 4 9C4 11.7614 6.23858 14 9 14C11.7614 14 14 11.7614 14 9C14 6.23857 11.7614 4 9 4ZM36 4C33.2386 4 31 6.23858 31 9C31 11.7614 33.2386 14 36 14C38.7614 14 41 11.7614 41 9C41 6.23857 38.7614 4 36 4Z" fill="#3B2F8A"/>
                </svg>
              {:else if catIconIdx(cat.code) === 6}
                <svg xmlns="http://www.w3.org/2000/svg" width="45" height="36" viewBox="0 0 45 36" fill="none" aria-hidden="true">
                  <path d="M28 0C26.0745 6.58148e-05 24.331 0.777963 23.0654 2.03613H17C15.6194 2.03626 14.5 3.15553 14.5 4.53613C14.5002 5.91663 15.6195 7.036 17 7.03613H21V17C21 20.8659 24.1341 23.9999 28 24H37.8125V26.5C37.8125 29.1193 35.9318 31 33.3125 31H9.5C6.88084 30.9999 5 29.1192 5 26.5V13L4.9873 12.7441C4.85914 11.4836 3.79432 10.5 2.5 10.5C1.20578 10.5001 0.140827 11.4837 0.0126953 12.7441L0 13V26.5C0 31.8806 4.11941 35.9999 9.5 36H33.3125C38.6932 36 42.8125 31.8807 42.8125 26.5V22.0811C44.1591 20.8053 45 19.0014 45 17V7C45 3.13401 41.866 0 38 0H28ZM7.57031 1C5.63743 1.00013 4.07031 2.56708 4.07031 4.5C4.07031 6.43292 5.63743 7.99987 7.57031 8C9.50331 8 11.0703 6.433 11.0703 4.5C11.0703 2.567 9.50331 1 7.57031 1Z" fill="#3B2F8A"/>
                  <path d="M27.0002 12C27.0002 15.5899 29.9104 18.5 33.5002 18.5C37.0901 18.5 40.0002 15.5899 40.0002 12C40.0002 8.41015 37.0901 5.5 33.5002 5.5C29.9104 5.5 27.0002 8.41015 27.0002 12Z" fill="#FF3535"/>
                </svg>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" width="41" height="47" viewBox="0 0 41 47" fill="none" aria-hidden="true">
                  <rect width="30" height="38" rx="10" fill="#3B2F8A"/>
                  <path d="M37.9902 18.1094L37.9902 32.2236C37.9902 38.8484 32.1699 44.2187 24.9902 44.2187C17.8105 44.2187 11.9902 38.8483 11.9902 32.2236L11.9902 26.2261" stroke="#3B2F8A" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M15.1951 12.1094L10.9951 19.1094H17.9951L13.7951 26.1094" stroke="#FF3535" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              {/if}
            </div>
            <span class="cat-label" class:active={activeCategory === cat.id}>{cat.name}</span>
          </button>
        {/each}

        <!-- 관리자: hover 시 우측 상단 버튼만 노출 -->
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
      <div class="m-slider-track">
        {#if useDbHero}
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
        {:else}
          {#each mobileSlides as slide, i}
            <a href="/products/9" class="m-feat-card">
              <div class="m-feat-bg"></div>
              <div class="m-feat-img-box">
                <img
                  src={slide.img} alt={slide.title} class="abs-img"
                  style="height:{slide.imgStyle.h};left:{slide.imgStyle.l};top:{slide.imgStyle.t};width:{slide.imgStyle.w}"
                  loading={i === 0 ? 'eager' : 'lazy'}
                />
              </div>
              <div class="m-feat-dots">
                {#each mobileSlides as _, di}
                  {#if di === i}
                    <span class="feat-dot-active"></span>
                  {:else}
                    <span class="feat-dot"></span>
                  {/if}
                {/each}
              </div>
              <div class="m-feat-info">
                <p class="m-feat-title">{slide.title}</p>
                <div class="m-feat-price-wrap">
                  <p class="m-feat-price">{slide.price}</p>
                  <p class="m-feat-desc">{slide.desc}</p>
                </div>
              </div>
            </a>
          {/each}
        {/if}
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
        <div class="d-slider-cards" style="--dpp:{dPerPage}">
          {#if useDbHero}
            {#each visibleDesktopSlides as prod, i (dPage * dPerPage + i)}
              <a href={productLink(prod as ProductCard)} class="d-feat-card">
                <div class="d-feat-bg"></div>
                <div class="d-feat-img-box">
                  <img
                    src={productImg(prod as ProductCard)} alt={(prod as ProductCard).name} class="abs-img"
                    style="width:100%;height:100%;object-fit:cover;left:0;top:0"
                    loading="eager"
                  />
                </div>
                <div class="d-feat-info">
                  <p class="d-feat-price">{heroMobilePrice(prod as ProductCard)}</p>
                  <div>
                    <p class="d-feat-name">{(prod as ProductCard).name}</p>
                    <p class="d-feat-desc">{(prod as ProductCard).product_caption ?? ''}</p>
                  </div>
                </div>
              </a>
            {/each}
          {:else}
            {#each visibleDesktopSlides as slide, i (dPage * dPerPage + i)}
              <a href="/products/9" class="d-feat-card">
                <div class="d-feat-bg"></div>
                <div class="d-feat-img-box">
                  <img
                    src={(slide as DesktopSlide).img} alt={(slide as DesktopSlide).name} class="abs-img"
                    style="height:{(slide as DesktopSlide).imgStyle.h};left:{(slide as DesktopSlide).imgStyle.l};top:{(slide as DesktopSlide).imgStyle.t};width:{(slide as DesktopSlide).imgStyle.w}"
                    loading="eager"
                  />
                </div>
                <div class="d-feat-info">
                  <p class="d-feat-price">{(slide as DesktopSlide).price}</p>
                  <div>
                    <p class="d-feat-name">{(slide as DesktopSlide).name}</p>
                    <p class="d-feat-desc">{(slide as DesktopSlide).desc}</p>
                  </div>
                </div>
              </a>
            {/each}
          {/if}
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
    transition: background 0.2s;
  }
  .cat-icon-box:hover {
    background: #3b2f8a;
  }
  /* Camera body becomes light on hover (body fill same as bg) */
  .cat-icon-box:hover .cam-body { fill: #E1DEF3; }
  .cat-custom-icon {
    width: 40px;
    height: 40px;
    object-fit: contain;
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
  /* 관리자: 카테고리 설정 버튼 — cat-icons hover 시 우측 상단 노출 */
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
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s;
  }
  .cat-icons:hover .admin-cat-btn {
    opacity: 1;
    pointer-events: all;
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
    .cat-icon-box svg { width: 50px; height: auto; }
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
