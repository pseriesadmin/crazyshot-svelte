<script lang="ts">
  import { goto } from '$app/navigation'
  import { enhance } from '$app/forms'
  import { fly } from 'svelte/transition'
  import { invalidateAll } from '$app/navigation'
  import ProductDetailPanel from '$lib/components/cms/ProductDetailPanel.svelte'
  import CmsSimilarNameInput from '$lib/components/cms/CmsSimilarNameInput.svelte'
  import CmsPagination from '$lib/components/cms/CmsPagination.svelte'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const CATEGORIES = $derived([
    { value: 'all', label: '전체' },
    ...data.categories,
  ])

  // 카드 배지용: product_category 값 → 레이블 (depth=0 기준, 서버 제공)
  const CATEGORY_LABEL = $derived<Record<string, string>>(data.categoryLabels ?? {})

  let searchInput = $state(data.q)

  $effect(() => {
    searchInput = data.q
  })

  type SortMode = 'newest' | 'oldest' | 'asc' | 'desc'
  const SORT_CYCLE: SortMode[] = ['asc', 'desc', 'newest', 'oldest']
  const SORT_LABELS: Record<SortMode, string> = {
    asc: '오름순',
    desc: '내림순',
    newest: '최신 등록순',
    oldest: '과거 등록순',
  }

  function nextSort() {
    const current = data.sort as SortMode
    const idx = SORT_CYCLE.indexOf(current)
    const next = SORT_CYCLE[(idx + 1) % SORT_CYCLE.length]
    const params = new URLSearchParams(window.location.search)
    params.set('sort', next)
    params.delete('page')
    params.delete('selected')
    goto(`/cms/products?${params.toString()}`)
  }

  // 페이지네이션
  function goToPage(p: number) {
    const params = new URLSearchParams(window.location.search)
    params.set('page', p.toString())
    params.delete('selected')
    goto(`/cms/products?${params.toString()}`)
  }

  const panelOpen = $derived(!!data.selectedId && !!data.selectedProduct)

  function selectProduct(id: string) {
    const params = new URLSearchParams(window.location.search)
    params.set('selected', id)
    goto(`/cms/products?${params.toString()}`, { replaceState: true, noScroll: true })
  }

  function closePanel() {
    const params = new URLSearchParams(window.location.search)
    params.delete('selected')
    const qs = params.toString()
    goto(`/cms/products${qs ? '?' + qs : ''}`, { replaceState: true, noScroll: true })
  }

  function onCategoryClick(value: string) {
    const params = new URLSearchParams()
    if (value !== 'all') params.set('category', value)
    if (searchInput) params.set('q', searchInput)
    if (data.sort !== 'newest') params.set('sort', data.sort)
    // page 리셋 (카테고리 변경 시 1페이지로)
    goto(`/cms/products?${params.toString()}`)
  }

  function runSearch(): void {
    const params = new URLSearchParams()
    if (data.category !== 'all') params.set('category', data.category)
    const q = searchInput.trim()
    if (q) params.set('q', q)
    if (data.sort !== 'newest') params.set('sort', data.sort)
    // page 리셋 (검색 시 1페이지로)
    goto(`/cms/products?${params.toString()}`)
  }

  function onSearch(e: Event) {
    e.preventDefault()
    runSearch()
  }

  function formatPrice(price: number | null): string {
    if (price == null) return '—'
    return price.toLocaleString('ko-KR') + '원'
  }

  function thumbUrl(imageUrls: string[]): string {
    const first = imageUrls[0]
    if (!first) return ''
    if (first.startsWith('http')) return first
    return `https://res.cloudinary.com/crazyshot/image/upload/w_64,h_64,c_fill,f_auto,q_auto/${first}.jpg`
  }

  // 토글 상태 변경 후 즉시 목록 갱신
  function handleToggle() {
    return async ({ result }: { result: { type: string } }) => {
      if (result.type === 'success') {
        await invalidateAll()
      }
    }
  }
</script>

<svelte:head><title>상품목록 — CrazyShot CMS</title></svelte:head>

<div class="products-wrap">

  <!-- 카테고리 탭 -->
  <div class="cat-tabs" role="tablist" aria-label="상품 카테고리">
    {#each CATEGORIES as cat}
      <button
        role="tab"
        aria-selected={data.category === cat.value}
        class="cat-tab"
        class:active={data.category === cat.value}
        onclick={() => onCategoryClick(cat.value as string)}
        type="button"
      >{cat.label}</button>
    {/each}
  </div>

  <!-- 검색 + 등록 버튼 -->
  <div class="toolbar">
    <form class="search-form" onsubmit={onSearch}>
      <div class="search-field">
        <CmsSimilarNameInput
          id="product-search"
          bind:value={searchInput}
          source="product_search"
          minChars={1}
          overlayLayer={true}
          listLabel="상품 검색 제안"
          placeholder="상품명·브랜드·키워드 검색"
          categoryLabels={CATEGORY_LABEL}
          onselect={() => runSearch()}
        >
          {#snippet field(c)}
            <input
              type="search"
              class="f-input search-input"
              id={c.id}
              placeholder={c.placeholder}
              value={c.value}
              oninput={c.oninput}
              onkeydown={(e) => {
                c.onkeydown(e)
                if (e.key === 'Enter' && !e.defaultPrevented) {
                  e.preventDefault()
                  runSearch()
                }
              }}
              onfocus={c.onfocus}
              onblur={c.onblur}
              aria-label="상품 검색"
              aria-autocomplete={c.ariaAutocomplete}
              aria-expanded={c.ariaExpanded}
              aria-controls={c.ariaControls}
              autocomplete="off"
            />
          {/snippet}
        </CmsSimilarNameInput>
      </div>
    </form>
    <div class="tb-actions">
      <button
        type="button"
        class="sort-btn"
        onclick={nextSort}
        aria-label="정렬: {SORT_LABELS[data.sort as SortMode]}"
        title={SORT_LABELS[data.sort as SortMode]}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30" fill="none">
          <rect width="30" height="30" rx="15" fill={data.sort !== 'newest' ? 'rgba(59,47,138,0.08)' : '#F6F6F6'}/>
          <path d="M12.999 12V21L9 16.7651M17 18V9L21 13.2349"
            stroke={data.sort !== 'newest' ? '#3B2F8A' : '#AAAAAA'}
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="sort-label" class:sort-label-active={data.sort !== 'newest'}>{SORT_LABELS[data.sort as SortMode]}</span>
      </button>
      <a href="/cms/products/new" class="cta-btn">+ 상품등록</a>
    </div>
  </div>

  <!-- 페이지네이션 상단 (검색 레이아웃과 카드목록 사이) -->
  <CmsPagination
    page={data.page}
    totalPages={data.totalPages}
    onpage={goToPage}
    variant="top"
    ariaLabel="상품 목록 페이지 탐색"
  />

  <!-- 마스터-디테일 레이아웃 -->
  <div class="master-detail">

    <!-- 카드 목록 패널 -->
    <div class="list-pane" class:narrow={panelOpen}>

      {#if data.products.length === 0}
        <div class="empty-state">
          <p class="empty-msg">등록된 상품이 없습니다.</p>
          <a href="/cms/products/new" class="cta-btn">첫 상품 등록하기</a>
        </div>
      {:else}
        <div class="card-list" role="list">
          {#each data.products as product (product.id)}
            <div
              class="product-card"
              class:selected={data.selectedId === product.id}
              role="listitem"
            >
              <!-- 카드 클릭 영역 (썸네일 + 정보) -->
              <button
                class="card-body"
                onclick={() => selectProduct(product.id)}
                aria-pressed={data.selectedId === product.id}
                aria-label={`${product.name} 상세 보기`}
                type="button"
              >
                <!-- 썸네일 -->
                <div class="card-thumb-wrap">
                  {#if product.image_urls.length > 0}
                    <img
                      src={thumbUrl(product.image_urls)}
                      alt={product.name}
                      class="card-thumb"
                      width="60"
                      height="60"
                      loading="lazy"
                    />
                  {:else}
                    <div class="card-thumb-empty" aria-label="이미지 없음">📷</div>
                  {/if}
                </div>

                <!-- 상품 정보 -->
                <div class="card-info">
                  <div class="card-info-top">
                    <span class="cat-badge">{CATEGORY_LABEL[product.category] ?? product.category}</span>
                    <span class="stock-badge" class:stock-zero={product.assetCount === 0}>{product.assetCount}개</span>
                  </div>
                  <p class="card-name">{product.name}</p>
                  {#if product.brand}
                    <p class="card-brand">{product.brand}</p>
                  {/if}
                  <div class="card-bottom-row">
                    <div class="card-prices">
                      <span class="price-badge">12H {formatPrice(product.price12h)}</span>
                      <span class="price-badge">Day {formatPrice(product.price24h)}</span>
                    </div>
                  </div>
                </div>
              </button>

              <!-- 상태 토글 (카드 우측 하단) -->
              <div class="card-actions">
                <form
                  method="POST"
                  action="?/toggleStatus"
                  use:enhance={handleToggle}
                  class="toggle-form"
                >
                  <input type="hidden" name="id" value={product.id} />
                  <input type="hidden" name="is_active" value={product.is_active.toString()} />
                  <button
                    type="submit"
                    class="status-toggle"
                    class:on={product.is_active}
                    aria-label={product.is_active ? '미노출로 전환' : '노출로 전환'}
                    title={product.is_active ? '클릭하여 미노출' : '클릭하여 노출'}
                  >
                    <span class="toggle-track">
                      <span class="toggle-thumb"></span>
                    </span>
                  </button>
                </form>
              </div>
            </div>
          {/each}
        </div>

        <!-- 페이지네이션 하단 -->
        <CmsPagination
          page={data.page}
          totalPages={data.totalPages}
          onpage={goToPage}
          variant="bottom"
          ariaLabel="상품 목록 페이지 탐색 (하단)"
        />
      {/if}
    </div>

    <!-- 상세 뷰어 패널 — {#key}로 상품 전환 시 $state 완전 재초기화 -->
    {#if panelOpen && data.selectedProduct}
      <div class="detail-pane" transition:fly={{ x: 24, duration: 200 }}>
        {#key data.selectedId}
          <ProductDetailPanel
            product={data.selectedProduct}
            priceRules={data.selectedPriceRules}
            categories={data.categories}
            categoryLabel={CATEGORY_LABEL[data.selectedProduct.category] ?? data.selectedProduct.category}
            initialTab={data.initialTab}
            inventoryList={data.inventoryList}
            partnerComboItems={data.partnerComboItems}
            onclose={closePanel}
          />
        {/key}
      </div>
    {/if}

  </div>
</div>

<style>
  .products-wrap {
    display: flex;
    flex-direction: column;
    gap: 30px;
    padding: 20px 20px 48px;
  }

  /* 카테고리 탭 */
  .cat-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 12px 16px;
    background: var(--cs-white);
    border-radius: var(--radius-xl);
    flex-shrink: 0;
  }
  .cat-tab {
    padding: 6px 14px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-text-mid);
    font: var(--text-pc-body-14);
    cursor: pointer;
    min-height: 36px;
    transition: background 0.12s, color 0.12s;
  }
  .cat-tab:hover  { background: var(--cs-lilac); color: var(--cs-text); }
  .cat-tab.active { background: var(--cs-purple); color: var(--cs-white); }

  /* 툴바 */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    position: relative;
    z-index: 30;
  }
  .search-form {
    flex: 1;
    min-width: 0;
  }
  .search-field {
    flex: 1;
    min-width: 0;
    position: relative;
    z-index: 31;
  }
  .search-field :global(.search-input) {
    width: 100%;
    height: 44px;
    box-sizing: border-box;
    display: block;
  }
  .f-input {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--cms-radius-sm);
    padding: 0 16px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
  }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
  .f-input::placeholder { color: var(--cs-text-placeholder); }
  .tb-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }
  .sort-btn {
    display: inline-flex;
    flex-direction: row;
    align-items: center;
    gap: 10px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    min-height: 44px;
    justify-content: center;
    opacity: 1;
    transition: opacity 0.12s;
  }
  .sort-btn:hover { opacity: 0.75; }
  .sort-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    white-space: nowrap;
    line-height: 1;
  }
  .sort-label-active { color: var(--cs-purple); }
  .cta-btn {
    display: inline-flex;
    align-items: center;
    height: 44px;
    padding: 0 30px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border-radius: var(--radius-md);
    font: var(--text-pc-body-14);
    text-decoration: none;
    white-space: nowrap;
    transition: background 0.12s;
  }
  .cta-btn:hover { background: var(--cs-purple-hover); }

  /* 마스터-디테일 */
  .master-detail {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }

  /* 카드 목록 패널 */
  .list-pane {
    width: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    transition: width 0.22s ease;
  }
  .list-pane.narrow {
    width: 420px;
    flex-shrink: 0;
  }

  /* 카드 목록 */
  .card-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-right: 4px;
  }
  /* 스크롤바 항상 표시 */
  .card-list::-webkit-scrollbar {
    width: 6px;
  }
  .card-list::-webkit-scrollbar-track {
    background: var(--cs-surface-gray);
    border-radius: 3px;
  }
  .card-list::-webkit-scrollbar-thumb {
    background: rgba(59,47,138,0.20);
    border-radius: 3px;
  }
  .card-list::-webkit-scrollbar-thumb:hover {
    background: rgba(59,47,138,0.35);
  }

  /* 상품 카드 */
  .product-card {
    display: flex;
    align-items: stretch;
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    box-shadow: 0px 1px 2px rgba(0,0,0,0.06);
    transition: background 0.15s;
    flex-shrink: 0;
    overflow: hidden;
  }
  .product-card:hover { background: var(--cs-lilac); }
  .product-card.selected { background: rgba(59,47,138,0.06); }

  /* 카드 클릭 영역 */
  .card-body {
    display: flex;
    align-items: center;
    gap: 15px;
    flex: 1;
    min-width: 0;
    padding: 15px 0 15px 20px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
  }

  /* 썸네일 */
  .card-thumb-wrap {
    flex-shrink: 0;
    width: 60px;
    height: 60px;
    background: #E8E4F8;
    border-radius: var(--cms-radius-sm);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .card-thumb {
    width: 60px;
    height: 60px;
    object-fit: cover;
    display: block;
  }
  .card-thumb-empty {
    width: 60px;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    color: var(--cs-text-light);
  }

  /* 카드 정보 */
  .card-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
  .card-info-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .cat-badge {
    display: inline-block;
    padding: 5px 10px;
    background: var(--cs-lilac);
    color: var(--cs-purple-dark);
    border-radius: var(--radius-sm);
    font: var(--text-pc-descript-10);
    white-space: nowrap;
  }
  .stock-badge {
    display: inline-block;
    padding: 5px 10px;
    background: #F3F4F6;
    color: var(--cs-text-mid);
    border-radius: var(--radius-sm);
    font: var(--text-pc-descript-10);
    white-space: nowrap;
  }
  .stock-badge.stock-zero {
    background: rgba(255,53,53,0.10);
    color: var(--cs-red-badge);
  }
  .card-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-brand {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 10px;
    font-weight: 400;
    color: var(--cs-text-light);
    margin: 0;
  }
  .card-bottom-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }
  .card-prices {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .price-badge {
    display: inline-flex;
    align-items: center;
    padding: 5px 10px;
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    white-space: nowrap;
  }

  /* 카드 우측 하단 액션 (토글) */
  .card-actions {
    display: flex;
    align-items: flex-end;
    padding: 0 20px 15px 8px;
    flex-shrink: 0;
  }
  .toggle-form { display: flex; }
  .status-toggle {
    display: flex;
    align-items: center;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px;
    min-height: 44px;
    min-width: 44px;
    justify-content: center;
  }
  .toggle-track {
    position: relative;
    width: 36px;
    height: 20px;
    background: var(--cs-disabled-toggle);
    border-radius: var(--cms-radius-sm);
    transition: background 0.18s;
    display: block;
    flex-shrink: 0;
    padding: 2px;
    box-sizing: border-box;
  }
  .status-toggle.on .toggle-track { background: var(--cs-purple); }
  .toggle-thumb {
    position: absolute;
    top: 2px; left: 2px;
    width: 16px; height: 16px;
    border-radius: 50%;
    background: var(--cs-white);
    transition: transform 0.18s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.18);
    display: block;
  }
  .status-toggle.on .toggle-thumb { transform: translateX(16px); }

  /* 빈 상태 */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 60px 20px;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
  }
  .empty-msg {
    font: var(--text-pc-title-16);
    color: var(--cs-text-light);
  }

  /* 상세 패널 */
  .detail-pane {
    flex: 1;
    min-width: 0;
  }
</style>
