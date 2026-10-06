<script lang="ts">
  import BottomTabBar from '$lib/components/common/BottomTabBar.svelte'
  import SubGnb from '$lib/components/common/SubGnb.svelte'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import SearchKeywordBar from '$lib/components/products/SearchKeywordBar.svelte'
  import SearchProductGrid from '$lib/components/products/SearchProductGrid.svelte'
  import SearchCrazylogSection, { type SearchCrazylogPost } from '$lib/components/crazylog/SearchCrazylogSection.svelte'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'
  import { recordSearchClick } from '$lib/services/searchService'
  import { toggleWish } from '$lib/utils/wishlist'
  import { page } from '$app/stores'
  import { goto } from '$app/navigation'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  // ── 검색 상태 ──────────────────────────────────────────────
  let searchQuery      = $state($page.url.searchParams.get('q') ?? '')
  /** 입력창에 보이는 문구 — 키워드 칩 클릭·?q= 진입 때도 검색어를 채워 보여주기 위해 SuggestPicker 내부 값 대신 직접 관리 */
  let inputText        = $state($page.url.searchParams.get('q') ?? '')
  let isSearching      = $state(false)
  let pickerSelectedId = $state<string | null>(null)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let suggestAbort: AbortController | null = null
  /** 자동완성 드롭다운 호출 최소 글자수·디바운스 — 트래픽 절감용 */
  const SUGGEST_MIN_CHARS = 2
  const SUGGEST_DEBOUNCE_MS = 400
  /** 크레이지로그 결과 조회 건수 — 꽉 찼을 때만 "더보기" 링크 노출 */
  const CRAZYLOG_LIMIT = 6
  /** 마지막으로 실제 제출(Enter·검색 아이콘)된 검색어 — 결과 그리드 기준 */
  let submittedQuery   = $state('')
  /** G-3: 현재 검색 세션의 log ID — recordSearchClick에 전달 */
  let searchLogId      = $state<string | null>(null)

  interface SearchProduct {
    id: string
    name: string
    category: string
    price24h: number
    price12h: number | null
    isSaleOnly?: boolean
    salePrice?: number | null
    img: string
    slug?: string
    href?: string
    wished?: boolean
  }
  let searchResults      = $state<SearchProduct[]>([])
  /** 크레이지로그 검색 결과 — 검색 실행(Enter·아이콘·키워드 칩) 때만 조회, 자동완성·추천에서는 호출하지 않음 */
  let crazylogResults    = $state<SearchCrazylogPost[]>([])
  /** 마지막 검색 요청 번호 — 늦게 도착한 이전 검색 응답이 최신 결과를 덮지 않게 */
  let searchSeq = 0
  /** 자동완성 드롭다운 전용 — 결과 그리드(searchResults)와 분리 */
  let suggestResults     = $state<SearchProduct[]>([])
  let recommendedProducts = $state<SearchProduct[]>([])

  /** API 응답 → 그리드 카드 (RPC 랭킹 순서 유지 — 클라이언트 재정렬 없음) */
  function mapSearchApiRow(r: Record<string, unknown>): SearchProduct {
    const p24 = Number(r['price_min'] ?? r['base_price_daily'] ?? 0)
    const slug = r['slug'] ? String(r['slug']) : null
    return {
      id:       String(r['product_id'] ?? r['id'] ?? ''),
      name:     String(r['name'] ?? ''),
      category: String(r['category'] ?? ''),
      slug:     slug ?? undefined,
      price24h: p24,
      // 12h는 검색 API가 내려주는 CMS 실값(price_rules) — 규칙이 없으면 null(12H 표시 생략). 예전 24h×0.7 계산 제거
      price12h: r['price_12h'] != null ? Number(r['price_12h']) : null,
      isSaleOnly: Boolean(r['sale_only']),
      salePrice:  r['sale_price'] != null ? Number(r['sale_price']) : null,
      img:      ((r['image_urls'] as string[] | null)?.[0])
        ?? (r['image_url'] ? String(r['image_url']) : '/images/products/grid-flat.png'),
      href:     slug ? `/products/${slug}` : undefined,
      wished:   Boolean(r['wished']),
    }
  }

  /** 크레이지로그 API 응답 → 결과 카드 (MiniSearch 점수순 유지) */
  function mapCrazylogRow(r: Record<string, unknown>): SearchCrazylogPost {
    return {
      id:           String(r['id'] ?? ''),
      title:        String(r['title'] ?? ''),
      logType:      String(r['category'] ?? ''),
      author:       String(r['author'] ?? '익명'),
      thumbnailUrl: r['thumbnail_url'] ? String(r['thumbnail_url']) : null,
      createdAt:    String(r['created_at'] ?? ''),
    }
  }

  // 마운트 시 URL ?q= 파라미터가 있으면 즉시 검색 실행
  $effect(() => {
    const initialQ = $page.url.searchParams.get('q')?.trim()
    if (initialQ) doSearch(initialQ)
  })

  // 추천 상품 — All(/products) 그리드와 동일 search_products RPC 랭킹 경유
  $effect(() => {
    fetch('/api/search/products?limit=6')
      .then(async (resp) => {
        if (!resp.ok) return
        const payload = await resp.json() as { results: Record<string, unknown>[] }
        recommendedProducts = (payload.results ?? []).map(mapSearchApiRow)
      })
      .catch(() => { recommendedProducts = [] })
  })

  const pickerOptions = $derived<SuggestPickerOption[]>(
    suggestResults.map(p => ({ id: p.id, label: p.name, meta: [p.isSaleOnly ? (p.salePrice ?? 0).toLocaleString('ko-KR') + '원' : p.price24h.toLocaleString('ko-KR') + '원/일'] }))
  )

  /** 입력 중에는 결과 그리드를 건드리지 않고 자동완성 드롭다운만 (디바운스·2자 이상) 갱신 */
  function onPickerInput(val: string) {
    searchQuery = val
    inputText = val
    if (debounceTimer) clearTimeout(debounceTimer)
    suggestAbort?.abort()
    const q = val.trim()
    if (q.length < SUGGEST_MIN_CHARS) { suggestResults = []; return }
    debounceTimer = setTimeout(() => fetchSuggestions(q), SUGGEST_DEBOUNCE_MS)
  }

  async function fetchSuggestions(q: string) {
    suggestAbort?.abort()
    const ctrl = new AbortController()
    suggestAbort = ctrl
    try {
      // 자동완성은 search_logs에 기록되지 않는 경량 API 사용 — 관심집중 키워드 랭킹에 입력 중간 단계가 섞이지 않게(2026-10-06)
      const resp = await fetch(`/api/search/suggest?q=${encodeURIComponent(q)}&limit=8`, { signal: ctrl.signal })
      if (!resp.ok) throw new Error(`검색 API 오류: ${resp.status}`)
      const payload = await resp.json() as { results: Record<string, unknown>[] }
      suggestResults = (payload.results ?? []).map(mapSearchApiRow)
    } catch (e) {
      if ((e as { name?: string }).name !== 'AbortError') suggestResults = []
    }
  }

  /** Enter·검색 아이콘 — 결과 그리드 검색 실행 */
  function submitSearch() {
    const q = searchQuery.trim()
    if (debounceTimer) clearTimeout(debounceTimer)
    suggestAbort?.abort()
    suggestResults = []
    if (!q) { searchSeq++; isSearching = false; submittedQuery = ''; searchResults = []; crazylogResults = []; return }
    doSearch(q)
  }

  function onSearchKeydown(e: KeyboardEvent, pickerKeydown: (e: KeyboardEvent) => void) {
    pickerKeydown(e)  // 드롭다운 항목 하이라이트 상태의 Enter는 SuggestPicker가 선택 처리(preventDefault)
    if (e.key === 'Enter' && !e.defaultPrevented && !e.isComposing) {
      e.preventDefault()
      submitSearch()
    }
  }

  async function fetchProductResults(q: string): Promise<{ results: Record<string, unknown>[]; search_log_id?: string | null }> {
    // 2026-08-06: 브라우저 직접 RPC → /api/search/products API 라우트 경유로 전환
    // 자연어 레이어(MiniSearch)는 서버에서만 동작 가능 — 이 배선 변경이 필수 전제조건
    const resp = await fetch(`/api/search/products?q=${encodeURIComponent(q)}&limit=12`)
    if (!resp.ok) throw new Error(`검색 API 오류: ${resp.status}`)
    return await resp.json()
  }

  async function fetchCrazylogResults(q: string): Promise<{ results: Record<string, unknown>[] }> {
    const resp = await fetch(`/api/search/crazylog?q=${encodeURIComponent(q)}&limit=${CRAZYLOG_LIMIT}`)
    if (!resp.ok) throw new Error(`크레이지로그 검색 API 오류: ${resp.status}`)
    return await resp.json()
  }

  async function doSearch(q: string) {
    const seq = ++searchSeq
    isSearching = true
    searchLogId = null  // 새 검색 시 이전 log ID 초기화
    submittedQuery = q
    crazylogResults = []
    // 상품·크레이지로그를 병렬 조회 — 한쪽 실패가 다른 쪽 결과를 비우지 않는다
    const [productsRes, logsRes] = await Promise.allSettled([fetchProductResults(q), fetchCrazylogResults(q)])
    if (seq !== searchSeq) return  // 더 최신 검색이 시작됨 — 이 응답은 버린다
    if (productsRes.status === 'fulfilled') {
      // G-3: search_log_id 캡처 (migration 203 이후 RPC가 반환)
      searchLogId = productsRes.value.search_log_id ?? null
      searchResults = (productsRes.value.results ?? []).map(mapSearchApiRow)
    } else {
      searchResults = []
    }
    crazylogResults = logsRes.status === 'fulfilled' ? (logsRes.value.results ?? []).map(mapCrazylogRow) : []
    isSearching = false
  }

  /** G-3: 상품 클릭 시 CTR 기록 — fire-and-forget (UX 차단 없음) */
  function handleProductClick(productId: string) {
    if (searchLogId && productId) {
      recordSearchClick(searchLogId, productId)
        .catch(() => {/* CTR 기록 실패는 UX에 영향 없음 — 무시 */})
    }
  }

  async function handleWishToggle(id: string | undefined) {
    if (!id) return
    const action = await toggleWish(id)
    if (!action) return
    const wished = action === 'added'
    const apply = (list: SearchProduct[]) => list.map(p => (p.id === id ? { ...p, wished } : p))
    searchResults = apply(searchResults)
    recommendedProducts = apply(recommendedProducts)
  }

  function onProductSelect(opt: SuggestPickerOption) {
    // 드롭다운 선택 → 해당 상품 상세화면으로 바로 이동
    const picked = suggestResults.find(p => p.id === opt.id)
    goto(`/products/${picked?.slug ?? opt.id}`)
  }
</script>

<svelte:head>
  <title>상품 검색 — CRAZYSHOT</title>
</svelte:head>

<div class="page-root search-page-root">

  <!-- ── Sub GNB (표준 front 디자인 시스템 GNB-NaviBar) ── -->
  <SubGnb title="검색" noGnbOffset />

  <!-- ── 검색 입력 ── -->
  <section class="search-bar-section">
    <div class="search-bar-inner">
      <div class="search-pill" class:searching={isSearching}>
        <SuggestPicker
          id="product-search"
          bind:selectedId={pickerSelectedId}
          options={pickerOptions}
          noFilter
          placeholder="상품명·브랜드·키워드 검색"
          listLabel="상품 검색 결과"
          oninput={onPickerInput}
          onselect={onProductSelect}
        >
          {#snippet field(c)}
            <div class="search-field-row">
              <input
                type="search"
                class="search-input"
                id={c.id}
                placeholder={c.placeholder}
                value={inputText}
                oninput={c.oninput}
                onkeydown={(e) => onSearchKeydown(e, c.onkeydown)}
                onfocus={c.onfocus}
                onblur={c.onblur}
                aria-autocomplete={c.ariaAutocomplete}
                aria-expanded={c.ariaExpanded}
                aria-controls={c.ariaControls}
                autocomplete="off"
              />
              {#if isSearching}
                <span class="search-spinner" aria-hidden="true"></span>
              {/if}
              <button type="button" class="search-icon-btn" aria-label="검색" onclick={submitSearch}>
                <svg class="search-icon" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <circle cx="7.5" cy="7.5" r="6" stroke="#3B2F8A" stroke-width="2"/>
                  <path d="M12 12L16 16" stroke="#3B2F8A" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          {/snippet}
        </SuggestPicker>
      </div>
    </div>
  </section>

  <!-- ── 관심집중 키워드 ── -->
  <SearchKeywordBar
    keywords={data.interestKeywords}
    onkeywordclick={(kw) => { searchQuery = kw; inputText = kw; doSearch(kw) }}
  />

  <!-- ── 검색 결과 그리드 ── -->
  <SearchProductGrid
    title={submittedQuery ? `"${submittedQuery}" 검색결과` : '추천 상품'}
    products={submittedQuery ? searchResults : recommendedProducts}
    onProductClick={submittedQuery ? handleProductClick : undefined}
    onWishToggle={data.isLoggedIn ? handleWishToggle : undefined}
    hideEmpty={!!submittedQuery && crazylogResults.length > 0}
    attached={!!submittedQuery && crazylogResults.length > 0}
  />

  <!-- ── 크레이지로그 검색 결과 (검색 실행 후·결과 1건 이상일 때만, 최대 6건) ── -->
  {#if submittedQuery}
    <SearchCrazylogSection
      posts={crazylogResults}
      topRound={searchResults.length === 0}
      moreHref={crazylogResults.length >= CRAZYLOG_LIMIT ? `/crazylog/list?q=${encodeURIComponent(submittedQuery)}` : undefined}
    />
  {/if}

</div>

<BottomTabBar />

<style>
  /* ── 페이지 루트 ── */
  .page-root {
    /* 높이는 100vh/100dvh 고정 대신 main(flex 컬럼, 아래 :has 규칙)의 남는 공간을 채우는 방식 — 100vh 툴바 재계산 잔떨림 없음(front-uiux §19 취지 유지, 100vh로 되돌리지 말 것) */
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--cs-lilac, #ecebf4);
  }

  /* 검색 결과 없음 화면의 상하폭을 푸터에 맞춤(PC·모바일 공통): main을 flex 컬럼으로 만들어 page-root가 남는 높이를 채우게 한다.
     :has()로 이 페이지가 마운트된 동안만 적용(전역 스타일 누수 방지), 고정 높이 계산 없이 푸터 높이가 바뀌어도 자동 대응 */
  :global(main:has(> .search-page-root)) {
    display: flex;
    flex-direction: column;
  }

  /* ── 검색 입력 섹션 ── */
  .search-bar-section {
    width: 100%;
    padding: 20px 25px 10px;
  }
  @media (min-width: 1024px) {
    .search-bar-section { padding: 24px 100px 10px; }
  }
  .search-bar-inner {
    max-width: 1600px;
    margin: 0 auto;
  }
  .search-pill {
    position: relative;
    background: #fff;
    border: none;
    border-radius: 20px;
    min-height: 56px;
    overflow: visible;
  }
  .search-pill :global(.suggest-picker) {
    width: 100%;
    min-width: 0;
  }
  .search-field-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    padding: 0 20px;
  }
  .search-icon {
    flex-shrink: 0;
  }
  .search-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    min-width: 44px;
    min-height: 44px;
    margin-right: -12px;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
  }
  .search-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 16px;
    font-weight: 500;
    line-height: 1.6;
    letter-spacing: -0.3px;
    color: var(--cs-text, #100b32);
    font-family: 'Noto Sans KR', sans-serif;
    min-height: 44px;
    width: 100%;
  }
  .search-input::placeholder { color: var(--cs-text-light, #b6b6b6); }
  .search-input::-webkit-search-cancel-button { display: none; }
  .search-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid var(--cs-lilac, #e1def3);
    border-top-color: var(--cs-purple, #3B2F8A);
    border-radius: 50%;
    flex-shrink: 0;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* SuggestPicker 드롭다운 스타일 override */
  .search-pill :global([role="listbox"]) {
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    border-radius: 15px;
    box-shadow: none !important;
    border: none !important;
    max-height: 320px;
    overflow-y: auto;
  }
</style>
