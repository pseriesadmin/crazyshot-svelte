<script lang="ts">
  import { goto } from '$app/navigation'
  import { fly, slide } from 'svelte/transition'
  import ProductDetailPanel from '$lib/components/cms/ProductDetailPanel.svelte'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  let searchInput = $state(data.q)
  $effect(() => { searchInput = data.q })

  function runSearch(): void {
    const params = new URLSearchParams()
    const q = searchInput.trim()
    if (q) params.set('q', q)
    goto(`/cms/rental/history?${params.toString()}`)
  }

  function onSearch(e: Event): void {
    e.preventDefault()
    runSearch()
  }

  function thumbUrl(imageUrls: string[]): string {
    const first = imageUrls[0]
    if (!first) return ''
    if (first.includes('/large_')) return first.replace('/large_', '/thumb_')
    return first
  }

  const panelOpen = $derived(!!data.rootProduct)

  function selectProduct(id: string): void {
    const params = new URLSearchParams(window.location.search)
    params.set('selected', id)
    goto(`/cms/rental/history?${params.toString()}`, { replaceState: true, noScroll: true })
  }

  function closePanel(): void {
    const params = new URLSearchParams(window.location.search)
    params.delete('selected')
    const qs = params.toString()
    goto(`/cms/rental/history${qs ? '?' + qs : ''}`, { replaceState: true, noScroll: true })
  }
</script>

<svelte:head><title>이력관리 — CrazyShot CMS</title></svelte:head>

<div class="history-wrap">
  <div class="page-header">
    <h1 class="page-title">이력관리</h1>
    <p class="page-sub">상품을 선택해 이력을 확인하거나 등록하세요.</p>
  </div>

  <form class="toolbar" onsubmit={onSearch}>
    <input
      class="search-in"
      type="search"
      placeholder="상품명 또는 품번으로 검색"
      bind:value={searchInput}
    />
    <button type="submit" class="search-btn">검색</button>
    <span class="result-count">{data.products.length}개</span>
  </form>

  {#if data.products.length >= 200}
    <div class="limit-notice" role="alert">
      표시 가능한 최대 200개 상품이 로드됐습니다. 검색어를 입력해 좁혀보세요.
    </div>
  {/if}

  <div class="master-detail">
    <!-- 대표 상품 목록 -->
    <div class="list-pane" class:narrow={panelOpen}>
      {#if data.products.length === 0}
        <div class="no-data">검색 결과가 없습니다.</div>
      {:else}
        <div class="product-grid">
          {#each data.products as product (product.id)}
            <button
              type="button"
              class="product-card"
              class:selected={data.selectedId === product.id}
              onclick={() => selectProduct(product.id)}
            >
              <div class="product-thumb-wrap">
                {#if thumbUrl(product.image_urls)}
                  <img
                    src={thumbUrl(product.image_urls)}
                    alt={product.name}
                    class="product-thumb"
                    loading="lazy"
                  />
                {:else}
                  <div class="product-thumb-placeholder">📦</div>
                {/if}
              </div>
              <div class="product-info">
                <span class="product-name">{product.name}</span>
                {#if product.product_code}
                  <!-- products.md §2-1: 부모는 품번이 영구히 없는 게 정상 — 레거시 부모만 자체
                       product_code를 가짐. 없다고 "미발행"으로 표시하지 않음(발행 예정 아님) -->
                  <span class="product-code">{product.product_code}</span>
                {/if}
              </div>
              <span class="arrow-icon">›</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- 이력 패널 -->
    {#if panelOpen && data.rootProduct}
      {@const rp = data.rootProduct}
      <div class="detail-pane" transition:fly={{ x: 24, duration: 200 }}>

        <!-- 대표 상품 헤더 -->
        <div class="root-card" class:root-card--active={data.selectedId === rp.id}>
          <button type="button" class="root-card-body" onclick={() => selectProduct(rp.id)}>
            <div class="root-thumb-wrap">
              {#if thumbUrl(rp.image_urls)}
                <img src={thumbUrl(rp.image_urls)} alt={rp.name} class="root-thumb" loading="lazy" />
              {:else}
                <div class="root-thumb-empty">📷</div>
              {/if}
            </div>
            <div class="root-info">
              <span class="root-label">대표 상품 이력</span>
              <p class="root-name">{rp.name}</p>
            </div>
          </button>
          <button type="button" class="root-close-btn" onclick={closePanel} aria-label="패널 닫기">✕</button>
        </div>

        {#if data.selectedId === rp.id && data.selectedProduct}
          <div class="panel-slot" transition:slide={{ duration: 200 }}>
            {#key data.selectedId}
              <ProductDetailPanel
                product={data.selectedProduct}
                priceRules={data.selectedPriceRules}
                categories={[]}
                categoryLabel={data.categoryLabels[rp.category] ?? rp.category}
                initialTab="history"
                tabs={['history']}
                inventoryList={data.inventoryList}
                onclose={closePanel}
              />
            {/key}
          </div>
        {/if}

        <!-- 재고 단위(자식) 목록 — 개별 유닛 이력 -->
        {#if data.inventoryList.length > 0}
          <div class="inv-section">
            <div class="inv-section-title">재고 단위별 이력</div>
            <div class="inv-list">
              {#each data.inventoryList as unit (unit.id)}
                {@const isActive = data.selectedId === unit.id}
                <div class="inv-item" class:inv-item--active={isActive}>
                  <button type="button" class="inv-trigger" onclick={() => selectProduct(unit.id)}>
                    <span class="inv-code">{unit.product_code ?? '—'}</span>
                    <span class="inv-name">{unit.name}</span>
                  </button>
                  {#if isActive}
                    <button type="button" class="inv-close-btn" onclick={closePanel} aria-label="패널 닫기">✕</button>
                  {/if}
                </div>
                {#if isActive && data.selectedProduct}
                  <div class="inv-panel-slot" transition:slide={{ duration: 200 }}>
                    {#key data.selectedId}
                      <ProductDetailPanel
                        product={data.selectedProduct}
                        priceRules={data.selectedPriceRules}
                        categories={[]}
                        categoryLabel={data.categoryLabels[rp.category] ?? rp.category}
                        initialTab="history"
                        tabs={['history']}
                        inventoryList={data.inventoryList}
                        onclose={closePanel}
                      />
                    {/key}
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        {:else}
          <div class="inv-empty-notice">등록된 재고 단위가 없습니다.</div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .history-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 20px 24px 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .page-header { display: flex; flex-direction: column; gap: 4px; }
  .page-title {
    font: var(--text-pc-htitle-25);
    color: var(--cs-text);
    margin: 0;
  }
  .page-sub {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .search-in {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--cms-radius-sm);
    padding: 8px 14px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    width: 300px;
    height: 38px;
  }
  .search-in::placeholder { color: var(--cs-text-placeholder); }
  .search-in:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
  .search-btn {
    height: 38px;
    padding: 0 18px;
    background: var(--cs-white);
    color: var(--cs-purple-dark);
    border: 1px solid #201857;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.12s;
  }
  .search-btn:hover { background: rgba(59,47,138,0.06); }
  .result-count {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .limit-notice {
    background: var(--cs-bg-warning);
    border-left: 3px solid var(--cs-warning);
    border-radius: var(--cms-radius-sm);
    padding: 8px 12px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-warning);
  }

  .no-data {
    text-align: center;
    padding: 48px 20px;
    font: var(--text-pc-body-14);
    color: var(--cs-text-light);
  }

  /* 마스터-디테일 */
  .master-detail {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }

  .list-pane {
    width: 100%;
    min-width: 0;
    transition: width 0.22s ease;
  }
  .list-pane.narrow {
    width: 420px;
    flex-shrink: 0;
  }

  .product-grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .product-card {
    display: flex;
    align-items: center;
    gap: 14px;
    background: var(--cs-white);
    border: 1px solid var(--cs-border);
    border-radius: var(--cms-radius-md);
    padding: 10px 14px;
    cursor: pointer;
    text-align: left;
    min-height: 64px;
    width: 100%;
    transition: border-color 0.15s, background 0.15s;
  }
  .product-card:hover { border-color: var(--cs-purple); background: rgba(59,47,138,0.04); }
  .product-card.selected { border-color: var(--cs-purple); background: rgba(59,47,138,0.06); }

  .product-thumb-wrap {
    width: 48px;
    height: 36px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    flex-shrink: 0;
    background: var(--cs-surface-gray);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .product-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
  .product-thumb-placeholder { font-size: 18px; color: var(--cs-text-light); }

  .product-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .product-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .product-code { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

  .arrow-icon { font-size: 20px; color: var(--cs-text-light); flex-shrink: 0; }

  /* 디테일 패널 */
  .detail-pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .root-card {
    position: relative;
    display: flex;
    align-items: center;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    border: 1.5px solid transparent;
    transition: border-color 0.15s;
  }
  .root-card--active { border-color: var(--cs-purple); }
  .root-card-body {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .root-card-body:hover { background: rgba(59,47,138,0.03); }
  .root-thumb-wrap {
    flex-shrink: 0;
    width: 48px;
    height: 48px;
    background: #E8E4F8;
    border-radius: var(--cms-radius-sm);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .root-thumb { width: 48px; height: 48px; object-fit: cover; display: block; }
  .root-thumb-empty { width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; font-size: 18px; color: var(--cs-text-light); }
  .root-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .root-label {
    font: var(--text-pc-descript-10);
    font-weight: 700;
    color: var(--cs-purple);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .root-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .root-close-btn {
    flex-shrink: 0;
    width: 28px; height: 28px;
    margin-right: 12px;
    display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: var(--radius-sm);
    color: var(--cs-text-light); font-size: 14px; cursor: pointer; min-height: 28px;
    transition: background 0.12s, color 0.12s;
  }
  .root-close-btn:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

  .panel-slot { overflow: hidden; }

  .inv-section { display: flex; flex-direction: column; gap: 6px; }
  .inv-section-title {
    padding: 0 4px;
    font: var(--text-pc-descript-10);
    font-weight: 700;
    color: var(--cs-text-mid);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .inv-empty-notice {
    padding: 20px 16px;
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-md);
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    text-align: center;
  }
  .inv-list { display: flex; flex-direction: column; gap: 4px; }
  .inv-item {
    display: flex;
    align-items: center;
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-md);
    border: 1.5px solid transparent;
    transition: border-color 0.15s;
  }
  .inv-item--active { border-color: var(--cs-purple); background: var(--cs-white); }
  .inv-trigger {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 12px 12px 16px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    min-height: 44px;
  }
  .inv-trigger:hover { background: rgba(59,47,138,0.04); }
  .inv-code {
    font: var(--text-pc-descript-10);
    font-weight: 700;
    color: var(--cs-text-mid);
    flex-shrink: 0;
  }
  .inv-item--active .inv-code { color: var(--cs-purple); }
  .inv-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inv-close-btn {
    flex-shrink: 0;
    width: 28px; height: 28px;
    margin-right: 8px;
    display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: var(--radius-sm);
    color: var(--cs-text-light); font-size: 14px; cursor: pointer; min-height: 28px;
    transition: background 0.12s, color 0.12s;
  }
  .inv-close-btn:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }
  .inv-panel-slot { overflow: hidden; }
</style>
