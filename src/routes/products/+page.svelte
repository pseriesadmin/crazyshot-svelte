<script lang="ts">
  import { untrack } from 'svelte'
  import { goto } from '$app/navigation'
  import { truncateKeywordLabel } from '$lib/utils/keywordDisplay'
  import { fly, fade } from 'svelte/transition'
  import type { PageData } from './$types'
  import type { ProductCard } from './+page.server'
  import BottomTabBar from '$lib/components/common/BottomTabBar.svelte'
  import BrandMarquee from '$lib/components/products/BrandMarquee.svelte'
  import ProductDPCard from '$lib/components/products/ProductDPCard.svelte'
  import ProductCategoryModal from '$lib/components/products/admin/ProductCategoryModal.svelte'
  import ProductHeroModal from '$lib/components/products/admin/ProductHeroModal.svelte'
  import ProductGridModal from '$lib/components/products/admin/ProductGridModal.svelte'
  import ProductMdPickModal from '$lib/components/products/admin/ProductMdPickModal.svelte'
  import { toggleWish } from '$lib/utils/wishlist'

  let { data }: { data: PageData } = $props()

  let wishedSet = $state(new Set(data.wishedIds))
  $effect(() => { wishedSet = new Set(data.wishedIds) })

  async function handleWishToggle(id: string | undefined) {
    if (!id) return
    const action = await toggleWish(id)
    if (!action) return
    const next = new Set(wishedSet)
    if (action === 'added') next.add(id); else next.delete(id)
    wishedSet = next
  }

  // ── 정적 타입 (폴백용) ──────────────────────────────────────────────────
  interface ImgStyle { h: string; l: string; t: string; w: string }
  interface DesktopProduct { img: string; imgStyle?: ImgStyle; price: string; name: string; flat?: boolean }
  interface MobileProduct { img: string; imgStyle: ImgStyle; name: string; price: string }

  // ── 카테고리 아이콘 매핑 (code → SVG 인덱스 0~7) ───────────────────────

  // 모바일 키워드 필은 CMS "카테고리 설정"에 저장된 값만 반영 — 트렌딩/하드코딩 폴백 없음.
  // 설정값이 없으면 섹션 자체를 숨기고, 저장되면 다시 노출된다.
  let displayKeywords = $derived(data.settings.keywordsRaw.items)


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

  // ── 카테고리: 저장된 설정 기준 표시 (순서·아이콘URL 반영) ───────────────
  interface DisplayCat {
    id: string; code: string; name: string; sort_order: number; icon_url: string | null; icon_active_url: string | null
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
          name:       cat.name,
          sort_order: item.sort_order,
          icon_url:   (item as { icon_url?: string | null }).icon_url ?? null,
          icon_active_url: (item as { icon_active_url?: string | null }).icon_active_url ?? null,
        }]
      })
  })())

  // 카테고리 코드 → 한글 이름 맵 (내부코드 노출 방지)
  let categoryNameMap = $derived<Record<string, string>>(
    Object.fromEntries(data.categories.map((c) => [c.id, c.name]))
  )

  // 활성 카테고리 — URL ?category= 파라미터 기준 (SSR 데이터 반영, 없으면 'all')
  let activeCategory = $derived(data.urlCategory ?? 'all')
  let activeCategoryLabel = $derived(
    activeCategory === 'all'
      ? '전체'
      : (displayCats.find((c) => c.id === activeCategory)?.name ?? '')
  )

  // 선택된 카테고리의 노출 배너(이미지가 있고 노출 ON인 경우만)
  let activeBanner = $derived.by(() => {
    const b = data.settings.categoryBanners?.items.find(
      (x) => x.category_id === activeCategory && x.enabled && !!x.image_url
    )
    return b ? { ...b, link_url: safeHref(b.link_url) } : null
  })

  // 링크는 사이트 내 경로(/…) 또는 http(s)만 허용 — 저장값이 그 외(javascript: 등)여도 렌더링 시 무시
  function safeHref(v: string | null | undefined): string | null {
    const t = (v ?? '').trim()
    // 백슬래시·공백·제어문자는 브라우저가 "/"로 해석하거나 제거해 //외부도메인 으로 바뀔 수 있어 거부
    if (/[\x00-\x20\\]/.test(t)) return null
    return /^\/(?![/\\])/.test(t) || /^https?:\/\//i.test(t) ? t : null
  }

  // 목록 중간 배너(촬영본능 PICK!) — 저장값이 없으면 기존 하드코딩 값 그대로
  let midBanner = $derived({
    enabled: data.settings.categoryBanners?.mid_banner?.enabled ?? true,
    image_url: data.settings.categoryBanners?.mid_banner?.image_url ?? null,
    title: data.settings.categoryBanners?.mid_banner?.title ?? '촬영본능',
    sub: data.settings.categoryBanners?.mid_banner?.sub ?? 'PICK!',
    link_url: safeHref(data.settings.categoryBanners?.mid_banner?.link_url),
  })

  // 모바일 배너 — 모바일 이미지 우선, 없으면 PC 이미지로 대체
  let activeBannerMobile = $derived.by(() => {
    const b = data.settings.categoryBanners?.items.find((x) => x.category_id === activeCategory && x.enabled)
    const src = b?.mobile_image_url || b?.image_url
    return b && src ? { src, link_url: safeHref(b.link_url), alt: b.alt } : null
  })

  // ── 슬라이드 (DB 설정값만 사용) ────────────────────────────────────
  let useDbGrid  = $derived(data.gridProducts.length > 0)

  // ── "전체" 목록 무한스크롤 — 처음 20개는 서버 load, 이후 10개씩은 목록 전용 엔드포인트(/products/_more)에서
  //    추가로 받아 이어 붙임(페이지 전체 load 재실행 없음). 카테고리 이동 등으로 data.gridProducts가 바뀌면 초기화.
  const INFINITE_STEP = 10
  const INFINITE_MAX = 200
  let extraProducts = $state<ProductCard[]>([])
  let exhausted = $state(false)
  // 추가분은 "카테고리가 바뀔 때만" 초기화 — 찜 토글·로그인 변경 등으로 load가 다시 실행돼도 이어 붙인 목록을 유지
  // (랜덤 순서 시드도 카테고리 진입 시점 값을 유지해 추가 조회가 같은 순서를 이어받게 함)
  let listSeed = $state(data.seed)
  $effect(() => {
    void data.urlCategory
    // seed는 추적하지 않음 — URL에 seed가 없으면 load마다 새 값이 만들어지므로, 추적하면 찜 토글 등에서 이어 붙인 목록이 초기화됨
    untrack(() => {
      extraProducts = []
      exhausted = false
      listSeed = data.seed
    })
  })
  // 화면에 표시할 전체 목록(서버 초기분 + 추가분)
  let gridAll = $derived(
    data.infiniteMode
      ? (() => {
          const base = new Set(data.gridProducts.map((p) => p.id))
          // load가 다시 실행돼 초기분이 바뀌어도 추가분과 중복되지 않게 걸러냄
          return [...data.gridProducts, ...extraProducts.filter((p) => !base.has(p.id))]
        })()
      : data.gridProducts,
  )
  // 모바일: 무한스크롤 모드에서는 PC와 동일하게 전체 표시, 카테고리 선택 시엔 기존 CMS 설정 개수
  let mobileGrid = $derived(data.infiniteMode ? gridAll : data.gridProducts.slice(0, data.mobileGridCount))

  let sentinelEl = $state<HTMLDivElement | null>(null)
  let mSentinelEl = $state<HTMLDivElement | null>(null)
  let loadingMore = $state(false)
  // 서버 초기분이 가득 찼고, 추가 조회가 끝(exhausted)에 닿지 않았으며, 상한 전이면 더 있을 수 있음
  let hasMore = $derived(
    data.infiniteMode && useDbGrid && !exhausted &&
    data.gridProducts.length >= data.infiniteLimit && gridAll.length < INFINITE_MAX
  )

  // 스크롤 멈춤 감지 → 하단 도크 슬라이드업 (스크롤 중엔 내려감, 최상단 근처에선 숨김)
  let dockVisible = $state(false)
  // 노출된 30% 영역을 클릭/터치하면 전체가 슬라이드업 — 스크롤 재개 시 다시 접힘
  let dockExpanded = $state(false)
  let dockTimer: ReturnType<typeof setTimeout> | null = null
  // 목록 끝(hasMore=false)에서는 푸터 위 일반 배치를 유지하다가, 스크롤 업이 시작되면 도크로 전환
  let endDock = $state(false)
  // 무한스크롤 진행 중(hasMore)엔 목록 끝에 닿을 수 없으므로 PC·모바일 공통으로 항상 도크
  let dockAuto = $derived(hasMore)
  let dockOn = $derived(dockAuto || endDock)
  // 일반 배치 상태의 실제 높이 — 도크(fixed)로 전환돼도 이 높이만큼 자리를 남겨 페이지가 튀지 않게 함
  let flowH = $state(0)
  // 일반 배치 자리의 기준점(0높이) — 도크 전환 여부와 무관하게 항상 같은 문서 위치에 존재
  let slotEl = $state<HTMLDivElement | null>(null)
  // 모바일 BottomTabBar(스크롤 다운 시 숨김·업 시 노출)와 동일 규칙으로 노출 여부를 추적 — 노출 중이면 도크를 탭바 높이만큼 위로 띄워 가려짐 방지
  let tabBarShown = $state(true)
  let wrapH = $state(0)
  $effect(() => { if (!dockOn && wrapH > 0) flowH = wrapH })

  // 도크 관련 상태 일괄 초기화 — 카테고리 이동 등으로 infiniteMode가 꺼질 때 이전 화면의 fixed 도크가 남지 않게 함
  function resetDockState() {
    endDock = false
    dockVisible = false
    dockExpanded = false
    if (dockTimer) { clearTimeout(dockTimer); dockTimer = null }
  }

  $effect(() => {
    if (!data.infiniteMode) { resetDockState(); return }
    let lastY = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      const goingUp = y < lastY
      if (!dockAuto && slotEl) {
        // 일반 배치 자리(slotEl)의 화면상 위치로 판정 — 스크롤 관성·바운스에 영향받지 않음
        const slotTop = slotEl.getBoundingClientRect().top
        if (goingUp && slotTop > window.innerHeight) endDock = true       // 자리가 화면 아래로 완전히 벗어난 뒤에만 도크 전환
        else if (!goingUp && slotTop <= window.innerHeight) endDock = false // 자리가 화면에 다시 들어오면 일반 배치 복귀
      }
      if (y > lastY && y > 50) tabBarShown = false
      else if (y < lastY) tabBarShown = true
      lastY = y
      dockVisible = false
      dockExpanded = false
      if (dockTimer) clearTimeout(dockTimer)
      dockTimer = setTimeout(() => { dockVisible = window.scrollY > 300 && dockOn }, 120)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      resetDockState()
    }
  })

  async function loadMore() {
    if (loadingMore || !hasMore) return
    loadingMore = true
    try {
      const res = await fetch(
        `/products/_more?offset=${gridAll.length}&limit=${INFINITE_STEP}&seed=${encodeURIComponent(listSeed)}`,
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { products: ProductCard[]; wishedIds: string[]; hasMore: boolean }
      const known = new Set(gridAll.map((p) => p.id))
      const fresh = json.products.filter((p) => !known.has(p.id))   // 조회수순 등은 사이에 순서가 바뀔 수 있어 중복 제거
      extraProducts = [...extraProducts, ...fresh]
      if (json.wishedIds.length > 0) wishedSet = new Set([...wishedSet, ...json.wishedIds])
      if (!json.hasMore || fresh.length === 0) exhausted = true
    } catch {
      exhausted = true   // 실패 시 무한 재시도 방지 — 새로고침 전까지 추가 조회 중단
    } finally {
      loadingMore = false
    }
  }

  $effect(() => {
    if ((!sentinelEl && !mSentinelEl) || !hasMore) return
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) void loadMore() },
      { rootMargin: '400px 0px' }
    )
    // PC·모바일 감지 지점 중 화면에 렌더링된(display:none 아닌) 쪽만 교차 판정됨
    if (sentinelEl) io.observe(sentinelEl)
    if (mSentinelEl) io.observe(mSentinelEl)
    return () => io.disconnect()
  })

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

  // PC 슬라이더 부드러운 슬라이드 방향(2026-09-15, Stephen 지적 — PC 반응형만 페이지
  // 전환이 즉시 컷 전환돼 모바일(native scroll-snap)과 달리 슬라이드 느낌이 없던 결함).
  // dPage가 바뀔 때마다 {#key dPage}로 감싼 카드 묶음이 전부 새로 마운트되므로, 이 값으로
  // 진행 방향에 맞는 쪽에서 fly로 들어오게 한다(다음=오른쪽에서, 이전=왼쪽에서).
  let dDirection = $state<1 | -1>(1)
  function dPrev() { if (dPage > 0) { dDirection = -1; dPage-- } }
  function dNext() { if (dPage < D_MAX_PAGE) { dDirection = 1; dPage++ } }

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
  function productImg(p: ProductCard): string {
    return p.image_urls?.[0] ?? '/images/products/grid-flat.png'
  }

  // ── 관리자 모달 ───────────────────────────────────────────────────────
  let activeModal = $state<'categories' | 'hero' | 'grid' | 'md_picks' | null>(null)
</script>

<svelte:head>
  <title>상품 전체보기 — CRAZYSHOT</title>
</svelte:head>

<div class="products-page">

  <!-- ─────────────────────────────────────────────────────────────────────── -->
  <!-- CATEGORY + SLIDER SECTION -->
  <!-- ─────────────────────────────────────────────────────────────────────── -->
  <div class="body-wrap">
    <div class="cat-section">

        <div class="cat-icons" class:cat-icons-empty={displayCats.length === 0} style="position:relative">

          {#each displayCats as cat}
            <button
              class="cat-btn"
              class:active={activeCategory === cat.id}
              onclick={() => {
                if (cat.name === '추천패키지') { goto('/hype-pack'); return }
                goto(cat.id === 'all' ? '/products' : `/products?category=${cat.id}`)
              }}
              aria-pressed={activeCategory === cat.id}
            >
              {#if cat.icon_url}
                <!-- ON 이미지(호버·선택 공용, 상자 배경 포함 SVG)가 있으면 OFF 위에 겹쳐 교차 전환 -->
                <div class="cat-icon-box" class:has-on={!!cat.icon_active_url}>
                  <img src={cat.icon_url} alt={cat.name} class="cat-custom-icon cat-icon-off" />
                  {#if cat.icon_active_url}
                    <img src={cat.icon_active_url} alt="" aria-hidden="true" class="cat-custom-icon cat-icon-on" />
                  {/if}
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
      

      <!-- Mobile: keyword pills — 설정값 없으면 섹션 자체 미노출 -->
      {#if displayKeywords.length > 0}
        <div class="m-keywords">
          {#each displayKeywords as kw}
            <button
              class="kw-pill"
              title={kw}
              aria-label={kw}
              onclick={() => goto(`/products/search?q=${encodeURIComponent(kw)}`)}
            >{truncateKeywordLabel(kw)}</button>
          {/each}
        </div>
      {/if}

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
    <!-- 카테고리 메뉴 선택 시(모바일): 헤더 슬라이드 대신 카테고리별 모바일 배너(가로 100% × 세로 200px) 노출.
         모바일 이미지가 없으면 PC 이미지로 대체(2026-09-29, Stephen 지시) -->
    {#if activeCategory !== 'all'}
    <div class="m-banner-outer" style="position:relative">
      {#if data.isCms}
        <button class="admin-edit-btn admin-float-btn" onclick={() => { activeModal = 'hero' }} aria-label="카테고리 배너 설정">
          ✦ 카테고리 배너 설정
        </button>
      {/if}
      {#if activeBannerMobile}
        {#if activeBannerMobile.link_url}
          <a class="m-banner-link" href={activeBannerMobile.link_url} aria-label={activeBannerMobile.alt || '배너'}>
            <img class="m-banner-img" src={activeBannerMobile.src} alt={activeBannerMobile.alt} />
          </a>
        {:else}
          <img class="m-banner-img" src={activeBannerMobile.src} alt={activeBannerMobile.alt} />
        {/if}
      {:else if data.isCms}
        <div class="m-banner-empty">등록된 카테고리 배너가 없습니다.</div>
      {/if}
    </div>
    {:else}
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
              <p class="m-feat-name">{prod.name}</p>
              {#if prod.product_caption}
                <p class="m-feat-desc">{prod.product_caption}</p>
              {/if}
              <div class="m-feat-price-row">
                {#if prod.sale_only}
                  <div class="m-feat-price-unit">
                    <span class="m-feat-plabel">Price</span>
                    <span class="m-feat-pnum">{formatPrice(prod.sale_price ?? 0)}</span>
                    <span class="m-feat-pcur">원</span>
                  </div>
                {:else}
                  {#if (prod.price_24h ?? prod.base_price_daily) > 0}
                    <div class="m-feat-price-unit">
                      <span class="m-feat-plabel">Day</span>
                      <span class="m-feat-pnum">{formatPrice(prod.price_24h ?? prod.base_price_daily)}</span>
                      <span class="m-feat-pcur">원</span>
                    </div>
                  {/if}
                  {#if prod.price_12h}
                    <span class="m-feat-psep">/</span>
                    <div class="m-feat-price-unit">
                      <span class="m-feat-plabel">12H</span>
                      <span class="m-feat-pnum">{formatPrice(prod.price_12h)}</span>
                      <span class="m-feat-pcur">원</span>
                    </div>
                  {/if}
                {/if}
              </div>
            </div>
          </a>
        {/each}
      </div>
    </div>
    {/if}

    <!-- ── DESKTOP SLIDER ─────────────────────────────────────────────────── -->
    <!-- 카테고리 메뉴 선택 시(PC): 헤더 슬라이드를 감추고 카테고리별 배너(가로 100% × 세로 150px) 노출
         (2026-09-29, Stephen 지시 — 배너 관리는 '헤더 상품 설정' 모달 내) -->
    {#if activeCategory !== 'all'}
    <div class="d-banner-outer" style="position:relative">
      {#if data.isCms}
        <button class="admin-edit-btn admin-float-btn" onclick={() => { activeModal = 'hero' }} aria-label="카테고리 배너 설정">
          ✦ 카테고리 배너 설정
        </button>
      {/if}
      {#if activeBanner}
        {#if activeBanner.link_url}
          <a class="d-banner-link" href={activeBanner.link_url} aria-label={activeBanner.alt || '배너'}>
            <img class="d-banner-img" src={activeBanner.image_url ?? ''} alt={activeBanner.alt} />
          </a>
        {:else}
          <img class="d-banner-img" src={activeBanner.image_url ?? ''} alt={activeBanner.alt} />
        {/if}
      {:else if data.isCms}
        <div class="d-banner-empty">등록된 카테고리 배너가 없습니다.</div>
      {/if}
    </div>
    {/if}
    {#if activeCategory === 'all'}
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
        <!-- Cards -->
        {#key dPage}
        <div
          class="d-slider-cards"
          class:slider-empty={data.heroProducts.length === 0}
          style="--dpp:{dPerPage}"
          in:fly={{ x: dDirection * 80, duration: 300 }}
          out:fly={{ x: dDirection * -80, duration: 300 }}
        >
          {#each visibleDesktopSlides as prod, i (prod.id)}
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
                <p class="d-feat-name">{prod.name}</p>
                {#if prod.product_caption}
                  <p class="d-feat-desc">{prod.product_caption}</p>
                {/if}
                <div class="d-feat-price-row">
                  {#if prod.sale_only}
                    <div class="d-feat-price-unit">
                      <span class="d-feat-plabel">Price</span>
                      <span class="d-feat-pnum">{formatPrice(prod.sale_price ?? 0)}</span>
                      <span class="d-feat-pcur">원</span>
                    </div>
                  {:else}
                    {#if (prod.price_24h ?? prod.base_price_daily) > 0}
                      <div class="d-feat-price-unit">
                        <span class="d-feat-plabel">Day</span>
                        <span class="d-feat-pnum">{formatPrice(prod.price_24h ?? prod.base_price_daily)}</span>
                        <span class="d-feat-pcur">원</span>
                      </div>
                    {/if}
                    {#if prod.price_12h}
                      <span class="d-feat-psep">/</span>
                      <div class="d-feat-price-unit">
                        <span class="d-feat-plabel">12H</span>
                        <span class="d-feat-pnum">{formatPrice(prod.price_12h)}</span>
                        <span class="d-feat-pcur">원</span>
                      </div>
                    {/if}
                  {/if}
                </div>
              </div>
            </a>
          {/each}
        </div>
        {/key}
      </div>

      <!-- Page dots -->
      <div class="d-slider-dots">
        {#each Array.from({length: D_MAX_PAGE + 1}) as _, i}
          <button
            class="d-dot"
            class:active={dPage === i}
            onclick={() => { dDirection = i >= dPage ? 1 : -1; dPage = i }}
            aria-label="슬라이드 페이지 {i + 1}"
          ></button>
        {/each}
      </div>
    </div>
    {/if}

  </div><!-- /body-wrap -->

  <!-- ─────────────────────────────────────────────────────────────────────── -->
  <!-- PRODUCT LIST SECTION -->
  <!-- ─────────────────────────────────────────────────────────────────────── -->

  <!-- MOBILE list (white bg, rounded top-right) -->
  <div class="m-list">
    <!-- 목록 타이틀(centered) — 선택된 분류명 표시(전체/렌즈/카메라 등, PC 목록 헤더 .d-list-cat과 동일 값) -->
    <div class="m-best-pick-header" style="position:relative">
      {#if data.isCms}
        <button class="admin-edit-btn admin-float-btn" onclick={() => { activeModal = 'grid' }} aria-label="상품 목록 설정">
          ✦ 상품 목록 설정
        </button>
      {/if}
      <div class="m-best-pick-label">
        <span class="m-best-text">{activeCategoryLabel || '전체'}</span>
      </div>
      <div class="m-best-grad-bar"></div>
    </div>

    <!-- Product grid: first 6 -->
    <div class="m-prod-grid">
      {#if useDbGrid}
        {#each mobileGrid.slice(0, 6) as prod (prod.id)}
          {@const d24 = prod.price_24h ?? (prod.base_price_daily > 0 ? prod.base_price_daily : null)}
          {@const d12 = prod.price_12h ?? null}
          {@const isSaleOnly = prod.sale_only}
          {@const salePrice = prod.sale_price}
          <a href={productLink(prod)} class="m-prod-card" in:fade={{ duration: 700 }}>
            <div class="m-prod-img-box">
              <img src={productImg(prod)} alt={prod.name} class="abs-img"
                style="width:100%;height:100%;object-fit:cover;left:0;top:0"
                loading="lazy" />
              {#if data.isLoggedIn}
                <button
                  class="mprod-clip"
                  class:active={wishedSet.has(prod.id)}
                  aria-label={wishedSet.has(prod.id) ? '찜 해제' : '찜하기'}
                  aria-pressed={wishedSet.has(prod.id)}
                  onclick={(e) => { e.preventDefault(); e.stopPropagation(); handleWishToggle(prod.id) }}
                >
                  <svg width="30" height="30" viewBox="0 0 63 63" fill="none" aria-hidden="true">
                    <path d="M31.3184 17.7266C34.3143 14.7584 39.1662 14.7584 42.1621 17.7266C45.1654 20.7024 45.1656 25.5331 42.1621 28.5088L29.5205 41.0322C27.7302 42.8059 24.8332 42.8059 23.043 41.0322C21.2452 39.2508 21.245 36.3565 23.043 34.5752L34.5674 23.1582C35.1558 22.5752 36.1054 22.5796 36.6885 23.168C37.2715 23.7564 37.2671 24.706 36.6787 25.2891L25.1543 36.707C24.5414 37.3146 24.5413 38.2939 25.1543 38.9014C25.7753 39.5166 26.7882 39.5165 27.4092 38.9014L40.0508 26.377C41.8692 24.575 41.8692 21.6594 40.0508 19.8574C38.2241 18.0477 35.2563 18.0477 33.4297 19.8574L20.7686 32.4014C17.744 35.3979 17.744 40.2506 20.7686 43.2471C23.8008 46.251 28.7227 46.2511 31.7549 43.2471L44.9443 30.1797C45.5328 29.5967 46.4824 29.6011 47.0654 30.1895C47.6484 30.7779 47.644 31.7275 47.0557 32.3105L33.8662 45.3779C29.6647 49.5405 22.8588 49.5405 18.6572 45.3779C14.4479 41.2076 14.448 34.4408 18.6572 30.2705L31.3184 17.7266Z" fill="currentColor"/>
                  </svg>
                </button>
              {/if}
            </div>
            <div class="m-prod-info">
              {#if prod.category}
                <p class="m-prod-category">{categoryNameMap[prod.category] ?? prod.category}</p>
              {/if}
              {#if isSaleOnly}
                <div class="m-prod-price-row">
                  <span class="m-prod-price-group">
                    <span class="m-prod-price-label">Price</span>
                    <span class="m-prod-price-num">{formatPrice(salePrice ?? 0)}</span>
                  </span>
                </div>
              {:else if d24 !== null || d12 !== null}
                <div class="m-prod-price-row">
                  {#if d24 !== null}
                    <span class="m-prod-price-group">
                      <span class="m-prod-price-label">Day</span>
                      <span class="m-prod-price-num">{formatPrice(d24)}</span>
                    </span>
                  {/if}
                  {#if d24 !== null && d12 !== null}
                    <span class="m-prod-price-sep">/</span>
                  {/if}
                  {#if d12 !== null}
                    <span class="m-prod-price-group">
                      <span class="m-prod-price-label">12H</span>
                      <span class="m-prod-price-num">{formatPrice(d12)}</span>
                    </span>
                  {/if}
                </div>
              {/if}
              <p class="m-prod-name">{prod.name}</p>
            </div>
          </a>
        {/each}
      {:else}
        {#each mobileProducts.slice(0, 6) as prod}
          <a href="/products" class="m-prod-card">
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

    <!-- CTA card(모바일 목록 중간 배너): 이미지·문구·링크·노출은 헤더 상품 설정 모달에서 관리(product_page_category_banners.mid_banner) -->
    {#if midBanner.enabled}
    <svelte:element this={midBanner.link_url ? 'a' : 'div'} class="m-cta-card" href={midBanner.link_url ?? undefined}>
      <div class="m-cta-img">
        <img src={midBanner.image_url || '/images/products/ellipse.png'} alt={midBanner.title} loading="lazy" />
      </div>
      <div class="m-cta-text">
        <div class="m-cta-arrow-icon" aria-hidden="true">
          <svg width="34" height="16" viewBox="0 0 38 20" fill="none">
            <path d="M2 10H36M36 10L26 2M36 10L26 18" stroke="#FF3535" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <p class="m-cta-title">{midBanner.title}</p>
        <p class="m-cta-pick">{midBanner.sub}</p>
      </div>
      <div class="m-cta-chevron" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M8 4L14 10L8 16" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </svelte:element>
    {/if}

    <!-- Product grid: rest -->
    <div class="m-prod-grid">
      {#if useDbGrid}
        {#each mobileGrid.slice(6) as prod (prod.id)}
          {@const d24 = prod.price_24h ?? (prod.base_price_daily > 0 ? prod.base_price_daily : null)}
          {@const d12 = prod.price_12h ?? null}
          {@const isSaleOnly = prod.sale_only}
          {@const salePrice = prod.sale_price}
          <a href={productLink(prod)} class="m-prod-card" in:fade={{ duration: 700 }}>
            <div class="m-prod-img-box">
              <img src={productImg(prod)} alt={prod.name} class="abs-img"
                style="width:100%;height:100%;object-fit:cover;left:0;top:0"
                loading="lazy" />
              {#if data.isLoggedIn}
                <button
                  class="mprod-clip"
                  class:active={wishedSet.has(prod.id)}
                  aria-label={wishedSet.has(prod.id) ? '찜 해제' : '찜하기'}
                  aria-pressed={wishedSet.has(prod.id)}
                  onclick={(e) => { e.preventDefault(); e.stopPropagation(); handleWishToggle(prod.id) }}
                >
                  <svg width="30" height="30" viewBox="0 0 63 63" fill="none" aria-hidden="true">
                    <path d="M31.3184 17.7266C34.3143 14.7584 39.1662 14.7584 42.1621 17.7266C45.1654 20.7024 45.1656 25.5331 42.1621 28.5088L29.5205 41.0322C27.7302 42.8059 24.8332 42.8059 23.043 41.0322C21.2452 39.2508 21.245 36.3565 23.043 34.5752L34.5674 23.1582C35.1558 22.5752 36.1054 22.5796 36.6885 23.168C37.2715 23.7564 37.2671 24.706 36.6787 25.2891L25.1543 36.707C24.5414 37.3146 24.5413 38.2939 25.1543 38.9014C25.7753 39.5166 26.7882 39.5165 27.4092 38.9014L40.0508 26.377C41.8692 24.575 41.8692 21.6594 40.0508 19.8574C38.2241 18.0477 35.2563 18.0477 33.4297 19.8574L20.7686 32.4014C17.744 35.3979 17.744 40.2506 20.7686 43.2471C23.8008 46.251 28.7227 46.2511 31.7549 43.2471L44.9443 30.1797C45.5328 29.5967 46.4824 29.6011 47.0654 30.1895C47.6484 30.7779 47.644 31.7275 47.0557 32.3105L33.8662 45.3779C29.6647 49.5405 22.8588 49.5405 18.6572 45.3779C14.4479 41.2076 14.448 34.4408 18.6572 30.2705L31.3184 17.7266Z" fill="currentColor"/>
                  </svg>
                </button>
              {/if}
            </div>
            <div class="m-prod-info">
              {#if prod.category}
                <p class="m-prod-category">{categoryNameMap[prod.category] ?? prod.category}</p>
              {/if}
              {#if isSaleOnly}
                <div class="m-prod-price-row">
                  <span class="m-prod-price-group">
                    <span class="m-prod-price-label">Price</span>
                    <span class="m-prod-price-num">{formatPrice(salePrice ?? 0)}</span>
                  </span>
                </div>
              {:else if d24 !== null || d12 !== null}
                <div class="m-prod-price-row">
                  {#if d24 !== null}
                    <span class="m-prod-price-group">
                      <span class="m-prod-price-label">Day</span>
                      <span class="m-prod-price-num">{formatPrice(d24)}</span>
                    </span>
                  {/if}
                  {#if d24 !== null && d12 !== null}
                    <span class="m-prod-price-sep">/</span>
                  {/if}
                  {#if d12 !== null}
                    <span class="m-prod-price-group">
                      <span class="m-prod-price-label">12H</span>
                      <span class="m-prod-price-num">{formatPrice(d12)}</span>
                    </span>
                  {/if}
                </div>
              {/if}
              <p class="m-prod-name">{prod.name}</p>
            </div>
          </a>
        {/each}
      {:else}
        {#each mobileProducts.slice(6) as prod}
          <a href="/products" class="m-prod-card">
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
    {#if hasMore}
      <!-- 모바일 무한스크롤 감지 지점 — 도달 시 다음 10개 로드(PC와 동일) -->
      <div class="d-load-sentinel" bind:this={mSentinelEl} aria-hidden="true"></div>
    {/if}
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
        </div>
      </div>
      <div class="d-prod-grid">
        {#if useDbGrid}
          {#each gridAll as prod (prod.id)}
            <!-- 스크롤로 추가되는 카드는 이동 없이 서서히 나타남(페이드인) — 첫 렌더는 즉시 표시 -->
            <div class="d-prod-item" in:fade={{ duration: 700 }}>
            <ProductDPCard
              id={prod.id}
              name={prod.name}
              imageUrl={productImg(prod)}
              price24h={prod.price_24h ?? (prod.base_price_daily > 0 ? prod.base_price_daily : null)}
              price12h={prod.price_12h ?? null}
              isSaleOnly={prod.sale_only}
              salePrice={prod.sale_price}
              href={productLink(prod)}
              category={prod.category}
              wished={wishedSet.has(prod.id)}
              onWishToggle={data.isLoggedIn ? handleWishToggle : undefined}
            />
            </div>
          {/each}
        {:else}
          {#each desktopProducts as prod}
            <ProductDPCard
              name={prod.name}
              imageUrl={prod.img}
              href="/products"
            />
          {/each}
        {/if}
      </div>
      {#if hasMore}
        <!-- 무한스크롤 감지 지점 — 도달 시 다음 10개 로드, MD추천·브랜드는 항상 목록 아래 유지 -->
        <div class="d-load-sentinel" bind:this={sentinelEl} aria-hidden="true"></div>
      {/if}
    </div>
  </div>

  <!-- ─────────────────────────────────────────────────────────────────────── -->
  <!-- MD 추천 상품 (DB 설정 시 표시) — 전체 상품 목록(모바일 .m-list / PC .d-list)
       아래로 재배치 (2026-09-29, Stephen 지시 — 모바일에만 적용되고 PC에는
       미적용이던 실수를 수정, PC·모바일 공통으로 목록 맨 아래 위치).
       -->
  <!-- ─────────────────────────────────────────────────────────────────────── -->
  <!-- PC 무한스크롤 중(hasMore)에는 목록 끝에 닿을 수 없으므로, 스크롤이 멈추면 화면 하단에서
       살짝 슬라이드업(팝업)되는 도크로 노출 — 스크롤 재개 시 다시 내려감. 목록이 끝나면 일반 흐름 배치 -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div bind:this={slotEl} style="height:0" aria-hidden="true"></div>
  {#if endDock && !dockAuto}
    <div style="height:{flowH}px" aria-hidden="true"></div>
  {/if}
  <div
    class="bottom-dock"
    bind:clientHeight={wrapH}
    class:dock-on={dockOn}
    class:dock-visible={dockVisible}
    class:dock-expanded={dockExpanded}
    class:dock-above-tab={tabBarShown}
    onclickcapture={(e) => {
      // 30%만 보이는 상태에서의 첫 클릭·터치는 내부 링크로 이동하지 않고 펼치기만 수행
      if (dockOn && dockVisible && !dockExpanded) { e.preventDefault(); e.stopPropagation(); dockExpanded = true }
    }}
  >
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
              {#if data.isLoggedIn}
                <button
                  class="mdp-clip"
                  class:active={wishedSet.has(prod.id)}
                  aria-label={wishedSet.has(prod.id) ? '찜 해제' : '찜하기'}
                  aria-pressed={wishedSet.has(prod.id)}
                  onclick={(e) => { e.preventDefault(); e.stopPropagation(); handleWishToggle(prod.id) }}
                >
                  <svg width="14" height="14" viewBox="0 0 63 63" fill="none" aria-hidden="true">
                    <path d="M31.3184 17.7266C34.3143 14.7584 39.1662 14.7584 42.1621 17.7266C45.1654 20.7024 45.1656 25.5331 42.1621 28.5088L29.5205 41.0322C27.7302 42.8059 24.8332 42.8059 23.043 41.0322C21.2452 39.2508 21.245 36.3565 23.043 34.5752L34.5674 23.1582C35.1558 22.5752 36.1054 22.5796 36.6885 23.168C37.2715 23.7564 37.2671 24.706 36.6787 25.2891L25.1543 36.707C24.5414 37.3146 24.5413 38.2939 25.1543 38.9014C25.7753 39.5166 26.7882 39.5165 27.4092 38.9014L40.0508 26.377C41.8692 24.575 41.8692 21.6594 40.0508 19.8574C38.2241 18.0477 35.2563 18.0477 33.4297 19.8574L20.7686 32.4014C17.744 35.3979 17.744 40.2506 20.7686 43.2471C23.8008 46.251 28.7227 46.2511 31.7549 43.2471L44.9443 30.1797C45.5328 29.5967 46.4824 29.6011 47.0654 30.1895C47.6484 30.7779 47.644 31.7275 47.0557 32.3105L33.8662 45.3779C29.6647 49.5405 22.8588 49.5405 18.6572 45.3779C14.4479 41.2076 14.448 34.4408 18.6572 30.2705L31.3184 17.7266Z" fill="currentColor"/>
                  </svg>
                </button>
              {/if}
            </div>
            <div class="mdp-info">
              {#if prod.category}
                <p class="mdp-category">{categoryNameMap[prod.category] ?? prod.category}</p>
              {/if}
              <div class="mdp-price-row">
                {#if prod.sale_only}
                  <span class="mdp-price-group">
                    <span class="mdp-price-label">Price</span>
                    <span class="mdp-price-num">{formatPrice(prod.sale_price ?? 0)}</span>
                  </span>
                {:else}
                  {#if (prod.price_24h ?? prod.base_price_daily) > 0}
                    <span class="mdp-price-group">
                      <span class="mdp-price-label">Day</span>
                      <span class="mdp-price-num">{formatPrice(prod.price_24h ?? prod.base_price_daily)}</span>
                    </span>
                  {/if}
                  {#if prod.price_12h}
                    <span class="mdp-price-sep">/</span>
                    <span class="mdp-price-group">
                      <span class="mdp-price-label">12H</span>
                      <span class="mdp-price-num">{formatPrice(prod.price_12h)}</span>
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
    <div class="md-picks-section md-picks-empty">
      <button class="admin-edit-btn admin-md-empty-btn" onclick={() => { activeModal = 'md_picks' }}>
        ✦ MD 추천 상품 설정하기
      </button>
    </div>
  {/if}
  

  <BrandMarquee surface="home" />
  </div>

</div>

<BottomTabBar />

<!-- ─────────────────────────────────────────────────────────────────────── -->
<!-- 관리자 설정 모달 (isCms 시에만 렌더) -->
<!-- ─────────────────────────────────────────────────────────────────────── -->
{#if data.isCms}
  {#if activeModal === 'categories'}
    <ProductCategoryModal
      categories={data.categories}
      initialSettings={data.settings.categories}
      initialKeywordsSettings={data.settings.keywordsRaw}
      onclose={() => { activeModal = null }}
    />
  {/if}
  {#if activeModal === 'hero'}
    <ProductHeroModal
      settingKey="product_page_hero"
      initialSettings={data.settings.hero}
      categories={displayCats.map((c) => ({ id: c.id, name: c.name }))}
      initialBanners={data.settings.categoryBanners}
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
    min-height: 100dvh; /* 100vh 툴바 재계산 잔떨림 방지 — 되돌리지 말 것(front-uiux §19) */
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
    /* 모바일 공통 GNB 아래 본문 시작 여백 토큰(120px) — 하입팩·테마·헬프·크레이지로그와 통일 */
    padding-top: var(--layout-mob-gnb-offset);
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
    object-fit: contain;
  }
  /* ON 이미지(호버·선택 공용, 상자 배경 포함 SVG)가 등록된 카테고리: 기존 배경색·오버레이 효과 대신
     OFF/ON 두 이미지를 겹쳐 부드럽게 교차 전환 — ON 미등록 카테고리는 기존 효과 유지 */
  .cat-icon-box.has-on,
  .cat-btn:hover .cat-icon-box.has-on { background: transparent; }
  .cat-icon-box.has-on::after { display: none; }
  .cat-icon-box.has-on .cat-icon-off { transition: opacity 0.25s ease; }
  .cat-icon-box.has-on .cat-icon-on {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity 0.25s ease;
  }
  .cat-btn:hover .cat-icon-box.has-on .cat-icon-on,
  .cat-btn.active .cat-icon-box.has-on .cat-icon-on { opacity: 1; }
  .cat-btn:hover .cat-icon-box.has-on .cat-icon-off,
  .cat-btn.active .cat-icon-box.has-on .cat-icon-off { opacity: 0; }
  .cat-label {
    display: none;
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
  /* 모바일 슬라이더: 부모(.body-wrap) 좌우 25px 패딩을 상쇄해 화면 좌우 끝까지 노출(full-bleed)하고,
     트랙 자체 패딩으로 시작·끝 여백 25px을 유지 — 크레이지로그 .m-carousel과 동일 방식(2026-09-29) */
  .m-slider-outer { overflow: hidden; margin: 0 calc(var(--layout-mob-pad) * -1); }

  /* 모바일 카테고리 배너 — 가로 100%(화면 좌우 끝까지, 부모 25px 패딩 상쇄) × 세로 200px.
     화면 끝까지 닿는 형태라 모서리 라운드는 두지 않음 */
  .m-banner-outer { margin: 0 calc(var(--layout-mob-pad) * -1); }
  .m-banner-link { display: block; width: 100%; height: 200px; overflow: hidden; }
  .m-banner-img { display: block; width: 100%; height: 200px; object-fit: cover; }
  .m-banner-empty {
    display: flex; align-items: center; justify-content: center;
    width: 100%; height: 200px; background: var(--cs-lilac); color: var(--cs-text-light);
    font: var(--text-m-script-12);
  }

  .m-slider-track {
    display: flex;
    gap: 15px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding: 0 var(--layout-mob-pad);
    scroll-padding: 0 var(--layout-mob-pad);
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
    border-radius: 50px 20px 50px 20px;
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
    border-radius: 50px 20px 50px 20px;
  }
  .m-feat-img-box {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: 50px 20px 50px 20px;
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
  /* ── m-feat-info: d-feat-info(PC)와 동일 구조(flex-col + gap + padding) ── */
  .m-feat-info {
    background: linear-gradient(to bottom, rgba(225,222,243,0) 0%, rgba(225,222,243,0.85) 30%, rgba(225,222,243,0.95) 100%);
    position: relative;
    z-index: 10;
    width: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 36px 30px 26px;
  }
  .m-feat-name {
    font: var(--text-m-body-16B); /* 한 사이즈 작게: 18B → 16B (2026-09-29) */
    color: #100b32;
    letter-spacing: -0.3px;
    margin: 0;
    width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .m-feat-desc {
    font: var(--text-m-tag-11); /* 한 사이즈 작게: 12 → 11, 굵기 Medium 유지 */
    font-weight: 500;
    color: #666;
    letter-spacing: -0.3px;
    margin: 0;
    width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .m-feat-price-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin: 4px 0 0;
    color: var(--cs-red-badge, #FF3535);
    letter-spacing: -0.8px; /* 자간 -0.8px(요청 2026-09-29) */
  }
  .m-feat-price-unit { display: flex; align-items: baseline; gap: 3px; }
  /* 한 사이즈 작게(2026-09-29): 레이블·원·구분자 16B → 14B, 가격 숫자 24B → 20B */
  .m-feat-plabel { font: var(--text-m-script-14B); }
  .m-feat-pnum {
    font: var(--text-m-htitle-20B);
    font-weight: 900;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .m-feat-pcur { font: var(--text-m-script-14B); }
  .m-feat-psep { font: var(--text-m-script-14B); }

  /* ── DESKTOP SLIDER – hidden on mobile ── */
  .d-load-sentinel { height: 1px; }
  .bottom-dock { display: contents; --dr: 30px; }  /* 모바일 카드 대 30px */
  /* 모바일 MD추천↔브랜드 슬라이드 사이 여백 50% 축소: 위 하단 패딩 −20px + 브랜드 상단 내부 여백 −27px(합계 약 −47px, 기존 약 95px) — PC는 @media에서 해제 */
  .bottom-dock :global(.brand-marquee-wrap) { margin-top: -27px; }
  /* 모바일 일반 배치(목록 끝, 도크 아님): 위 상품 목록 영역과의 여백 +50% (상단 패딩 26px → 39px). 도크로 뜬 상태는 26px 유지 */
  .bottom-dock:not(.dock-on) .md-picks-section { padding-top: 39px; }
  /* 목록을 끝까지 불러와 도크가 일반 흐름 배치로 바뀐 상태(푸터 직전)에서도 동일 상단 라운드 유지 */
  .bottom-dock:not(.dock-on) {
    display: block;
    position: relative;
    background: var(--cs-lilac);
  }
  /* 일반 흐름 배치에서는 뒤(부모)가 라일락이라 border-radius가 보이지 않으므로,
     위쪽 흰 목록 배경색으로 모서리 바깥을 채워 라운드를 시각적으로 구현 */
  .bottom-dock:not(.dock-on)::before {
    display: none;   /* 모바일: 위 .m-list가 이미 하단 라운드(50px)를 가지므로 모서리 채움 불필요 — PC만 @media에서 표시 */
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: var(--dr);
    z-index: 1;
    pointer-events: none;
    background:
      radial-gradient(circle var(--dr) at var(--dr) var(--dr), transparent calc(var(--dr) - 0.5px), #fff var(--dr)) left top / var(--dr) var(--dr) no-repeat,
      radial-gradient(circle var(--dr) at 0 var(--dr), transparent calc(var(--dr) - 0.5px), #fff var(--dr)) right top / var(--dr) var(--dr) no-repeat;
  }
  .bottom-dock.dock-on {
    display: block;
    position: fixed;
    left: 0; right: 0; bottom: 0;
    z-index: 40;
    overflow: hidden;
    max-height: 85vh;
    background: var(--cs-lilac);
    border-radius: var(--dr) var(--dr) 0 0;   /* PC 50px(card 대) / 모바일 30px(card 대 Mobile) — front-uiux.md §4 */
    box-shadow: 0 -6px 28px rgba(16, 11, 50, 0.28);   /* 상단 바깥 그림자로 입체감 — PC·모바일 공통(기존 0.10보다 짙게, 2026-09-29) */
    /* 전체가 아니라 상단 30%만 노출 — 목록을 가리는 면적 최소화 */
    transform: translateY(100%);
    opacity: 0;
    transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease, bottom 0.3s ease;
    pointer-events: none;
  }
  /* 모바일: BottomTabBar(높이 70px, z-index 50)가 노출 중이면 그 위로 배치 — PC는 탭바가 없어 @media에서 해제 */
  .bottom-dock.dock-on.dock-above-tab { bottom: 70px; }
  .bottom-dock.dock-on.dock-visible {
    transform: translateY(70%);
    opacity: 1;
    pointer-events: auto;
    cursor: pointer;
  }
  .bottom-dock.dock-on.dock-visible.dock-expanded {
    transform: translateY(0);
    overflow-y: auto;
    cursor: auto;
  }

  .d-slider-outer { display: none; }
  .d-banner-outer { display: none; }
  .d-banner-link { display: block; width: 100%; height: 150px; border-radius: var(--radius-xl); overflow: hidden; }
  .d-banner-img { display: block; width: 100%; height: 150px; object-fit: cover; border-radius: var(--radius-xl); }
  .d-banner-empty {
    display: flex; align-items: center; justify-content: center;
    width: 100%; height: 150px; border-radius: var(--radius-xl); background: var(--cs-lilac); color: var(--cs-text-light);
    font: var(--text-pc-script-12);
  }

  .d-slider-relative {
    position: relative;
    overflow: hidden;
    /* 2026-09-15: .d-slider-cards가 절대배치로 바뀌며(아래) 부모 높이를 스스로 정할 수
       없게 돼 .d-feat-card 고정 높이(580px)를 명시로 이관 — 부모/자식 높이가 항상
       같이 움직여야 하므로 값을 바꿀 땐 .d-feat-card height도 함께 바꿀 것 */
    height: 580px;
  }
  .d-slider-cards.slider-empty {
    min-height: 400px;
    border-radius: var(--radius-2xl);
    background: var(--cs-surface-gray);
  }

  .d-slider-cards {
    /* 2026-09-15: 부드러운 슬라이드 전환(Stephen 지적 — PC만 즉시 컷 전환) 구현을 위해
       절대배치로 전환 — {#key dPage}의 in/out fly 전환 동안 이전 페이지 카드와 새
       페이지 카드가 동일 위치에 겹쳐 있어야 좌우로 스치듯 지나가는 모양이 나온다
       (일반 흐름이면 새/old가 세로로 밀리며 어긋남) */
    position: absolute;
    inset: 0;
    display: flex;
    gap: 20px;
  }

  .d-feat-card {
    flex: 0 0 calc((100% - (20px * var(--dpp) - 20px)) / var(--dpp));
    min-width: 300px;
    height: 580px;
    border-radius: 50px 20px 50px 20px;
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
    border-radius: 50px 20px 50px 20px;
  }
  .d-feat-img-box {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: 50px 20px 50px 20px;
  }
  .d-feat-info {
    background: linear-gradient(to bottom, rgba(225,222,243,0) 0%, rgba(225,222,243,0.88) 30%, rgba(225,222,243,0.97) 100%);
    position: relative;
    z-index: 2;
    width: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 48px 30px 28px;
  }
  .d-feat-name {
    font: var(--text-pc-title-18);
    color: var(--cs-dark, #1d183e);
    letter-spacing: -0.5px;
    margin: 0;
    width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .d-feat-desc {
    font: var(--text-pc-script-12);
    color: var(--cs-text-dark, #444);
    letter-spacing: -0.3px;
    margin: 0;
    width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .d-feat-price-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0 0;
    flex-wrap: wrap;
    color: var(--cs-red-badge, #FF3535);
  }
  .d-feat-price-unit { display: flex; align-items: baseline; gap: 4px; }
  .d-feat-plabel { font: var(--text-pc-title-16); }
  .d-feat-pnum {
    font: var(--text-pc-htitle-25);
    font-weight: 900;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .d-feat-pcur { font: var(--text-pc-title-16); }
  .d-feat-psep { font: var(--text-pc-title-16); }

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
    /* 상단 여백 추가(요청 2026-09-29) — 위 상품목록 섹션과 붙어 보이던 문제. 모바일 50px(--layout-section-gap), PC는 @media에서 20px 유지 */
    padding: 26px 25px 20px;   /* PC와 동일 상단 26px · 하단 40→20px(모바일 MD추천↔브랜드 여백 50% 축소, 요청 2026-09-29) */
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
    margin-bottom: 30px;   /* PC와 동일 제목↔카드 30px */
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
    width: 139px;   /* PC 232px × 0.60(PC→모바일 카드 이미지 비율, front-uiux.md §24) ≈ 139px */
    text-decoration: none;
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: transform 0.2s;
  }
  /* 호버: 카드(썸네일 틀) 자체 확대는 트랙 overflow로 잘려 깨지므로 내부 이미지만 1.04배 확대 — PC·모바일 공통(ProductDPCard와 동일 배율) */
  .md-pick-img-box .abs-img { transition: transform 0.3s ease; }
  .md-pick-card:hover .md-pick-img-box .abs-img { transform: scale(1.04); }
  .md-pick-img-box {
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: var(--radius-lg) var(--radius-sm) var(--radius-lg) var(--radius-sm);
    overflow: hidden;
    position: relative;
    background: var(--cs-lilac);
  }
  .mdp-clip {
    position: absolute;
    top: 7px;
    right: 7px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: none;
    background: color-mix(in srgb, var(--cs-red-xlight) 80%, transparent); /* 비찜 상태 red-5 토큰(#FFEAEA), 알파 80% 유지 */
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    transition: background 0.18s, transform 0.18s, color 0.18s;
    padding: 0;
  }
  .mdp-clip svg { width: 14px; height: 14px; }
  .mdp-clip:hover { background: #ffb8b8; transform: scale(1.1); }
  .mdp-clip.active { background: rgba(255, 207, 207, 0.8); color: #FF3535; }
  .mdp-clip.active svg path { fill: #FF3535; }
  .mdp-clip:active { transform: scale(0.9); }

  /* Best Pick(m-prod-card) 전용 — 박스가 174px 정사각형이 아니라 157.5×200px로 더 커서
     mdp-clip(22px) 그대로 쓰면 비율상 작아 보임(Stephen 2026-08-26 확인) — 이 카드만 확대 */
  .mprod-clip {
    position: absolute;
    top: 11px;
    right: 11px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    background: color-mix(in srgb, var(--cs-red-xlight) 80%, transparent); /* 비찜 상태 red-5 토큰(#FFEAEA), 알파 80% 유지 */
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    transition: background 0.18s, transform 0.18s, color 0.18s;
    padding: 0;
  }
  /* 카드 폭 157.5→139px(×0.88) 축소에 맞춰 버튼 36→32px·아이콘 30→26px 비례 축소(2026-09-29) */
  .mprod-clip svg { width: 26px; height: 26px; }
  .mprod-clip:hover { background: #ffb8b8; transform: scale(1.1); }
  .mprod-clip.active { background: rgba(255, 207, 207, 0.8); color: #FF3535; }
  .mprod-clip.active svg path { fill: #FF3535; }
  .mprod-clip:active { transform: scale(0.9); }
  .mdp-info {
    display: flex;
    flex-direction: column;
    /* 모바일 상품정보 표준 확정값(front-uiux.md §14-4, 2026-09-29) — 12px의 90% */
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
    /* box-center로는 레이블·숫자 폰트 내부 여백 차이 때문에 레이블이 위로 뜬 것처럼
       보임(2026-09-27, 모바일 Best Pick·.pc-price-row와 동일 원인) — 베이스라인 정렬로 교체 */
    align-items: baseline;
    gap: 3px;
    /* purple-90 컬러토큰 반영(ProductDPCard .pc-price-row와 통일) */
    color: var(--cs-purple-dark);
    letter-spacing: -0.8px;   /* 모바일 확정 자간(PC는 @media에서 -0.5px 복원) */
    flex-wrap: wrap;
  }
  .mdp-price-group { display: flex; align-items: baseline; gap: 3px; }
  .mdp-price-label { font: var(--text-m-tag-11); font-weight: 500; line-height: 1; } /* 11px Medium — 모바일 확정값 */
  .mdp-price-num {
    /* 모바일 확정값(2026-09-29): 16px Black — PC는 아래 미디어쿼리에서 --text-pc-title-18 유지 */
    font: var(--text-m-body-16B);
    font-weight: 900;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    /* purple-60 컬러토큰 반영(ProductDPCard .pc-price-num과 통일) */
    color: var(--cs-purple-light);
  }
  .mdp-price-sep { font: var(--text-m-script-14B); line-height: 1; color: var(--cs-purple-pale); } /* purple-20 */
  .mdp-name {
    /* 모바일 확정값(2026-09-29): 12px Medium · purple-90 · 행간 112% — PC는 @media에서 기존 값 유지 */
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

  /* ─────────────────────────────────────────────────────────────────── */
  /* MOBILE LIST SECTION */
  /* ─────────────────────────────────────────────────────────────────── */
  .m-list {
    background: white;
    border-radius: 30px 30px 50px 50px; /* 상단 좌우 30px = 지침 card 대 Mobile(front-uiux.md §4, 2026-09-29) · 하단 50px는 기존(요청 2026-09-29) 유지 */
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
    font: var(--text-m-title-18B);   /* 기존 16px Medium(body-16L) → 한 단계 위 18px Bold 토큰(2026-09-29) */
    color: #666;
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
    /* 행 간(상하) 여백 부족 — 카드 간 좌우 여백(10px)은 유지, 상하만 확대(2026-09-27,
       1차 10→20px 후 분리도 추가 요청으로 20px×1.3=26px 2차 확대) */
    gap: 26px 10px;
  }
  .m-prod-card {
    width: calc(50% - 5px);
    /* min-width 제거(2026-09-16) — 155px 최소폭이 좁은 화면(가용폭 320px 미만)에서
       2장 나열에 필요한 320px(155×2+gap10)보다 작아 자동 줄바꿈(1열)을 유발하던 결함.
       calc(50% - 5px)는 그 자체로 항상 정확히 2열이 되는 값이라 min-width 없이도
       카드가 과도하게 작아지지 않음(container 폭에 정비례). */
    text-decoration: none;
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: transform 0.2s;
  }
  .m-prod-card:hover { transform: scale(1.02); }
  .m-prod-img-box {
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: var(--radius-lg) var(--radius-sm) var(--radius-lg) var(--radius-sm);
    overflow: hidden;
    position: relative;
    background: #e1def3;
  }
  /* Best Pick 카드 내부 정보 구성 — ProductDPCard(.pc-info/.pc-category/.pc-price-row)와
     동일한 구성(카테고리 배지 → 가격(라벨/숫자 분리) → 상품명)으로 통일(2026-09-18).
     카드 박스 비율(정사각 이미지)은 기존 그대로 유지, 내부 정보 레이아웃만 맞춤.
     여백도 ProductDPCard .pc-info(모바일 gap/padding-top: --spacing-3=12px, PC: --spacing-5=
     20px → 0.6 비율)와 동일 토큰으로 통일(2026-09-27) — 기존 5px/5px/10px 하드코딩은 이
     비율과 무관한 값이었고, 카드 간 세로 간격은 .m-prod-grid의 gap(10px)이 이미 담당하므로
     좌우·하단 패딩은 0으로 맞춤(.pc-info와 동일 구조: 상단만 패딩). */
  .m-prod-info {
    display: flex;
    flex-direction: column;
    /* 카테고리/가격/상품명 간 여백 10% 축소(요청, 2026-09-27) — 12px(--spacing-3) → 10.8px */
    gap: 10.8px;
    padding: 10.8px 0 0;
  }
  .m-prod-category {
    font: var(--text-m-script-12);
    font-weight: 700;
    color: var(--cs-text-light);
    line-height: 1;
    margin: 0;
  }
  .m-prod-price-row {
    display: flex;
    /* box-center(align-items:center)로는 12px 레이블과 16px Black 숫자 폰트의 내부 여백
       차이 때문에 레이블이 위로 뜬 것처럼 보임(2026-09-27 실측 확인) — 텍스트 베이스라인
       기준 정렬로 교체해 실제 시각적 중앙 정렬을 맞춤 */
    align-items: baseline;
    gap: 3px;
    color: var(--cs-purple-dark);
    letter-spacing: -0.8px; /* 자간 미세 축소(요청 2026-09-29): -0.5px → -0.8px */
    flex-wrap: wrap;
  }
  .m-prod-price-group { display: flex; align-items: baseline; gap: 3px; }
  /* 구분자 '/' — purple-20 컬러토큰 반영(2026-09-29) */
  .m-prod-price-sep { font: var(--text-m-script-14B); line-height: 1; color: var(--cs-purple-pale); }
  /* 한 사이즈 작게(12px → 11px, 요청 2026-09-29) — 모바일 토큰 중 12px 다음 단계는 --text-m-tag-11뿐이라
     사용하되 굵기는 기존 Medium(500) 유지 */
  .m-prod-price-label { font: var(--text-m-tag-11); font-weight: 500; line-height: 1; }
  .m-prod-price-num {
    font: var(--text-m-body-16B);
    font-weight: 900;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--cs-purple-light);
  }
  .m-prod-name {
    /* 볼드 제거 + 한 사이즈 작은 폰트토큰 적용(16px Bold → 14px Medium → 12px Medium,
       모바일 전용 추가 축소 요청 2026-09-29) */
    font: var(--text-m-script-12);
    /* purple-90 컬러토큰 반영(2026-09-29) — .pc-name과 동일 */
    color: var(--cs-purple-dark);
    letter-spacing: -0.5px;
    /* 행 간 30% 축소(요청, 2026-09-29) — 토큰 line-height 160% → 112% */
    line-height: 1.12;
    margin: 0;
  }
  /* 정적 폴백(mobileProducts, useDbGrid=false) 전용 — 카테고리·분리가격 데이터가 없어
     기존 한 줄 문자열 표시 그대로 유지 */
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
    text-decoration: none;
    color: inherit;
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
    /* 목록 제목↔상품 그리드 여백 30% 축소: 100px → 70px (요청 2026-09-29, 그리드 하단 여백은 그대로) */
    margin-bottom: -30px;
  }
  .d-list-cat {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 20px;
    color: #100b32;
    letter-spacing: -0.5px;
  }
  .d-prod-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 50px 24px;
    align-items: flex-start;
    justify-content: flex-start;
    width: 100%;
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
    /* 하단 도크 라운드: PC는 카드 대 50px */
    .bottom-dock { --dr: 50px; }
    .bottom-dock :global(.brand-marquee-wrap) { margin-top: 0; }
    .bottom-dock:not(.dock-on) .md-picks-section { padding-top: 26px; }
    .bottom-dock.dock-on.dock-above-tab { bottom: 0; }
    .bottom-dock:not(.dock-on)::before { display: block; }
    .body-wrap {
      padding: 180px 0 60px;
    }

    /* Category icons: single row, 100px each */
    .cat-icons {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 40px;
      margin-bottom: 20px;
    }
    /* PC 카테고리 버튼 크기(2026-09-29): 100→80px로 20% 축소 후 80→88px로 10% 확대 — 상자 88px·반경 26px, 버튼 높이 128px(라벨 영역 유지) */
    .cat-btn { height: 128px; justify-content: space-between; }
    .cat-icon-box { width: 88px; height: 88px; min-width: 88px; min-height: 88px; border-radius: 26px; justify-content: center; align-items: center; }
    .cat-label { display: block; }
    .cat-label.active { color: #3b2f8a; }

    /* Desktop: hide mobile-only elements */
    .m-keywords { display: none; }
    .m-sec-header { display: none; }
    .m-slider-outer { display: none; }
    .m-banner-outer { display: none; }

    /* Desktop slider */
    .d-slider-outer {
      display: block;
      padding: 0;
    }
    .d-banner-outer { display: block; padding: 0; }

    /* Desktop list */
    .m-list { display: none; }
    .d-list { display: block; }

    /* MD picks: desktop layout */
    .md-picks-section { padding: 26px 56px 40px; max-width: 100%; }
    .md-picks-header { margin-bottom: 30px; }  /* 제목↔카드 여백 20px → 30px (+50%, PC 전용, 요청 2026-09-29) */  /* 상단 패딩 20px → 26px (+30%, 요청 2026-09-29) */
    .md-pick-card { width: 232px; }  /* PC 표준 290px 대비 20% 축소(요청 2026-09-29), 이미지는 1:1 유지 */
    .md-pick-img-box { border-radius: 33px 13px 33px 13px; }
    .mdp-clip { top: 14px; right: 14px; width: 44px; height: 44px; }
    .mdp-clip svg { width: 34px; height: 34px; }
    /* 카테고리/가격/상품명 간 여백 30% 축소(요청, 2026-09-27, .pc-info와 동일) — 20px → 14px */
    .mdp-info { gap: 14px; padding: 14px 0 0; }
    /* 한 사이즈 큰 폰트토큰 PC 반영(요청, 2026-09-27) — 18px(--text-m-title-18B) →
       PC는 --text-pc-title-18(동일 18px이지만 PC 전용 lh/폰트 스택), ProductDPCard
       .pc-price-num과 동일 패턴 */
    .mdp-price-num { font: var(--text-pc-title-18); font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; }
    /* PC는 기존 14px Bold 유지(모바일만 축소 요청, 2026-09-27) */
    .mdp-price-label { font: var(--text-pc-body-14); line-height: 1; }
    /* 모바일 확정값이 PC로 새지 않도록 기존 PC 값 복원(2026-09-29) */
    .mdp-price-row { letter-spacing: -0.5px; }
    .mdp-price-sep { color: inherit; }
    .mdp-name { font: var(--text-m-script-14); color: var(--cs-purple-dark); letter-spacing: -0.5px; line-height: 1; margin: 0; }  /* ProductDPCard .pc-name 표준과 동일 */
  }
</style>
