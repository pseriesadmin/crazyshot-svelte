<script lang="ts">
  import { supabase } from '$lib/services/supabase'
  import BottomTabBar from '$lib/components/common/BottomTabBar.svelte'
  import SubGnb from '$lib/components/common/SubGnb.svelte'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import SearchKeywordBar from '$lib/components/products/SearchKeywordBar.svelte'
  import SearchProductGrid from '$lib/components/products/SearchProductGrid.svelte'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'
  import { recordSearchClick } from '$lib/services/searchService'

  // ── 검색 상태 ──────────────────────────────────────────────
  let searchQuery      = $state('')
  let isSearching      = $state(false)
  let pickerSelectedId = $state<string | null>(null)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  /** G-3: 현재 검색 세션의 log ID — recordSearchClick에 전달 */
  let searchLogId      = $state<string | null>(null)

  interface SearchProduct { id: string; name: string; category: string; price24h: number; price12h: number; img: string; slug?: string }
  let searchResults      = $state<SearchProduct[]>([])
  let recommendedProducts = $state<SearchProduct[]>([])

  // 마운트 시 추천 상품 로드
  $effect(() => {
    supabase
      .from('products')
      .select('id, name, category, image_urls, slug, price_rules(price, duration_type)')
      .eq('is_active', true)
      .limit(6)
      .then(({ data }) => {
        if (!data) return
        recommendedProducts = (data as Record<string, unknown>[]).map(r => {
          const rules = (r['price_rules'] as { price: number; duration_type: string }[] | null) ?? []
          const p24 = rules.find(x => x.duration_type === '24h')?.price ?? 0
          const p12 = rules.find(x => x.duration_type === '12h')?.price ?? Math.round(p24 * 0.7)
          const imgs = r['image_urls'] as string[] | null
          return {
            id:       String(r['id'] ?? ''),
            name:     String(r['name'] ?? ''),
            category: String(r['category'] ?? ''),
            slug:     r['slug'] ? String(r['slug']) : undefined,
            price24h: p24,
            price12h: p12,
            img:      imgs?.[0] ?? '/images/products/grid-flat.png',
          }
        })
      })
  })

  const pickerOptions = $derived<SuggestPickerOption[]>(
    searchResults.map(p => ({ id: p.id, label: p.name, meta: [p.price24h.toLocaleString('ko-KR') + '원/일'] }))
  )

  function onPickerInput(val: string) {
    searchQuery = val
    if (debounceTimer) clearTimeout(debounceTimer)
    if (!val.trim()) { searchResults = []; return }
    debounceTimer = setTimeout(() => doSearch(val.trim()), 280)
  }

  async function doSearch(q: string) {
    isSearching = true
    searchLogId = null  // 새 검색 시 이전 log ID 초기화
    try {
      // 2026-08-06: 브라우저 직접 RPC → /api/search/products API 라우트 경유로 전환
      // 자연어 레이어(MiniSearch)는 서버에서만 동작 가능 — 이 배선 변경이 필수 전제조건
      const resp = await fetch(`/api/search/products?q=${encodeURIComponent(q)}&limit=12`)
      if (!resp.ok) throw new Error(`검색 API 오류: ${resp.status}`)
      const payload = await resp.json() as { results: Record<string, unknown>[]; search_log_id?: string | null }
      // G-3: search_log_id 캡처 (migration 203 이후 RPC가 반환)
      searchLogId = payload.search_log_id ?? null
      searchResults = (payload.results ?? []).map(r => {
        const p24 = Number(r['price_min'] ?? r['base_price_daily'] ?? 0)
        return {
          id:       String(r['product_id'] ?? r['id'] ?? ''),
          name:     String(r['name'] ?? ''),
          category: String(r['category'] ?? ''),
          price24h: p24,
          price12h: Math.round(p24 * 0.7),
          img:      ((r['image_urls'] as string[] | null)?.[0]) ?? (r['image_url'] ? String(r['image_url']) : '/images/products/grid-flat.png'),
        }
      })
    } catch {
      searchResults = []
    } finally {
      isSearching = false
    }
  }

  /** G-3: 상품 클릭 시 CTR 기록 — fire-and-forget (UX 차단 없음) */
  function handleProductClick(productId: string) {
    if (searchLogId && productId) {
      recordSearchClick(searchLogId, productId)
        .catch(() => {/* CTR 기록 실패는 UX에 영향 없음 — 무시 */})
    }
  }

  function onProductSelect(opt: SuggestPickerOption) {
    // 드롭다운 선택 → 검색 결과 그리드 유지, 상세 이동 없음
    // 상세 이동은 ProductDPCard 클릭으로만
    searchQuery = opt.label
  }
</script>

<div class="page-root">

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
              <svg class="search-icon" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <circle cx="7.5" cy="7.5" r="6" stroke="#3B2F8A" stroke-width="2"/>
                <path d="M12 12L16 16" stroke="#3B2F8A" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <input
                type="search"
                class="search-input"
                id={c.id}
                placeholder={c.placeholder}
                value={c.value}
                oninput={c.oninput}
                onkeydown={c.onkeydown}
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
            </div>
          {/snippet}
        </SuggestPicker>
      </div>
    </div>
  </section>

  <!-- ── 관심집중 키워드 ── -->
  <SearchKeywordBar />

  <!-- ── 검색 결과 그리드 ── -->
  <SearchProductGrid
    title={searchQuery.trim() ? `"${searchQuery}" 검색결과` : '추천 상품'}
    products={searchQuery.trim() ? searchResults : recommendedProducts}
    onProductClick={searchQuery.trim() ? handleProductClick : undefined}
  />

</div>

<BottomTabBar />

<style>
  /* ── 페이지 루트 ── */
  .page-root {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--cs-lilac, #ecebf4);
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
