<script lang="ts">
  import { goto } from '$app/navigation'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  let searchQuery = $state('')

  const filtered = $derived(
    searchQuery.trim() === ''
      ? data.products
      : data.products.filter(p => {
          const q = searchQuery.toLowerCase()
          const nameMatch = p.name.toLowerCase().includes(q)
          const codeMatch = p.product_code?.toLowerCase().includes(q) ?? false
          return nameMatch || codeMatch
        })
  )

  function thumbUrl(imageUrls: string[]): string {
    const first = imageUrls[0]
    if (!first) return ''
    if (first.includes('/large_')) return first.replace('/large_', '/thumb_')
    return first
  }

  function goToHistory(id: string) {
    goto(`/cms/products?selected=${id}&tab=history`)
  }
</script>

<div class="page-wrap">
  <div class="page-header">
    <h1 class="page-title">이력관리</h1>
    <p class="page-sub">상품을 선택해 이력을 확인하거나 등록하세요.</p>
  </div>

  <div class="toolbar">
    <input
      class="search-in"
      type="text"
      placeholder="상품명 또는 품번으로 검색"
      bind:value={searchQuery}
    />
    <span class="result-count">{filtered.length}개</span>
  </div>

  {#if data.products.length >= 200}
    <div class="limit-notice" role="alert">
      표시 가능한 최대 200개 상품이 로드됐습니다. 검색어를 입력해 좁혀보세요.
    </div>
  {/if}

  {#if filtered.length === 0}
    <div class="no-data">검색 결과가 없습니다.</div>
  {:else}
    <div class="product-grid">
      {#each filtered as product}
        <button
          type="button"
          class="product-card"
          onclick={() => goToHistory(product.id)}
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
              <span class="product-code">{product.product_code}</span>
            {:else}
              <span class="product-code no-code">품번 미발행</span>
            {/if}
          </div>
          <span class="arrow-icon">›</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 20px 24px 32px;
  }

  .page-header { margin-bottom: 16px; }
  .page-title {
    font: var(--text-pc-htitle-25);
    color: var(--cs-text);
    margin: 0 0 4px;
  }
  .page-sub {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
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
    margin-bottom: 16px;
  }

  .no-data {
    text-align: center;
    padding: 48px 20px;
    font: var(--text-pc-body-14);
    color: var(--cs-text-light);
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
    transition: border-color 0.15s, background 0.15s;
    text-align: left;
    min-height: 64px;
  }
  .product-card:hover {
    border-color: var(--cs-purple);
    background: rgba(59,47,138,0.04);
  }

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

  .product-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .product-thumb-placeholder {
    font-size: 18px;
    color: var(--cs-text-light);
  }

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

  .product-code {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }
  .product-code.no-code { color: var(--cs-text-light); }

  .arrow-icon {
    font-size: 20px;
    color: var(--cs-text-light);
    flex-shrink: 0;
  }
</style>
