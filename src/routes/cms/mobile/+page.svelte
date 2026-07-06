<script lang="ts">
  import { goto } from '$app/navigation'
  import { matchesSearch } from '$lib/utils/chosungSearch'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  let searchQuery = $state('')

  const filtered = $derived(
    data.products.filter(p => matchesSearch({ name: p.name, product_code: p.product_code }, searchQuery))
  )

  function thumbUrl(imageUrls: string[]): string {
    const first = imageUrls[0]
    if (!first) return ''
    if (first.includes('/large_')) return first.replace('/large_', '/thumb_')
    return first
  }
</script>

<div class="mob-page">
  <div class="search-wrap">
    <input
      type="search"
      class="search-input"
      placeholder="상품명·자음·품번 검색 (예: 소니, ㅅㄴ, CAM)"
      bind:value={searchQuery}
      aria-label="상품 검색"
    />
  </div>

  {#if data.products.length >= 200}
    <div class="limit-notice" role="alert">최대 200개까지 표시됩니다.</div>
  {/if}

  {#if filtered.length === 0}
    <div class="no-data">검색 결과가 없습니다.</div>
  {:else}
    <ul class="product-list" role="list">
      {#each filtered as product (product.id)}
        <li>
          <button
            type="button"
            class="product-item"
            onclick={() => goto(`/cms/mobile/${product.id}`)}
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
                <div class="product-thumb-placeholder" aria-hidden="true">📦</div>
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
            <span class="product-arrow" aria-hidden="true">›</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .mob-page {
    display: flex;
    flex-direction: column;
    flex: 1;
    background: var(--cs-lilac);
  }

  .search-wrap {
    padding: 10px 14px 6px;
    background: var(--cs-lilac);
  }

  .search-input {
    width: 100%;
    background: var(--cs-white);
    border: none;
    border-radius: var(--radius-lg);
    padding: 10px 16px;
    font-size: 15px;
    color: var(--cs-text);
    height: 44px;
  }
  .search-input::placeholder { color: var(--cs-text-placeholder); }
  .search-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  .limit-notice {
    margin: 10px 16px 0;
    padding: 8px 12px;
    background: var(--cs-bg-warning);
    border-radius: var(--radius-sm);
    font-size: 12px;
    color: var(--cs-text-warning);
  }

  .no-data {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: var(--cs-text-light);
    padding: 48px 20px;
  }

  .product-list {
    list-style: none;
    margin: 10px 0 0;
    padding: 0 12px 24px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .product-item {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--cs-white);
    border: none;
    border-radius: var(--radius-lg);
    padding: 12px 14px;
    cursor: pointer;
    text-align: left;
    width: 100%;
    min-height: 64px;
    transition: background 0.12s;
  }
  .product-item:active { background: rgba(59,47,138,0.06); }

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
    font-size: 20px;
  }

  .product-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .product-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .product-code {
    font-size: 12px;
    color: var(--cs-text-mid);
  }
  .product-code.no-code { color: var(--cs-text-light); }

  .product-arrow {
    font-size: 22px;
    color: var(--cs-text-light);
    flex-shrink: 0;
    line-height: 1;
  }
</style>
