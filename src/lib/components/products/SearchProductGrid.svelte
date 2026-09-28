<script lang="ts">
  import ProductDPCard from '$lib/components/products/ProductDPCard.svelte'

  interface Product {
    id: string | number
    name: string
    category?: string
    price24h?: number | null
    price12h?: number | null
    img: string
    href?: string
    wished?: boolean
  }

  interface Props {
    title?: string
    products?: Product[]
    /** G-3: 상품 클릭 시 호출 — recordSearchClick 배선용 */
    onProductClick?: (productId: string) => void
    /** 없으면 하트 미노출(비로그인) */
    onWishToggle?: (productId: string) => void
  }

  let {
    title = '검색 해봄',
    products = [],
    onProductClick,
    onWishToggle,
  }: Props = $props()

  let expanded = $state(true)
</script>

{#if products.length > 0}
<section class="results-section">
  <div class="results-inner">
    <button class="results-header" onclick={() => (expanded = !expanded)}>
      <span class="results-title">{title}</span>
      <span class="results-count">{products.length}</span>
    </button>

    {#if expanded}
      <!-- 표시 순서 = products 배열 순서(API search_products RPC 랭킹 그대로) -->
      <div class="product-grid">
        {#each products as p (p.id)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="product-grid-item" onclick={() => onProductClick?.(String(p.id))}>
            <ProductDPCard
              id={String(p.id)}
              name={p.name}
              category={p.category}
              imageUrl={p.img}
              price24h={p.price24h ?? null}
              price12h={p.price12h ?? null}
              href={p.href ?? `/products/${p.id}`}
              wished={p.wished ?? false}
              onWishToggle={onWishToggle ? () => onWishToggle(String(p.id)) : undefined}
            />
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>
{:else}
<section class="results-section results-section--empty">
  <div class="results-inner">
    <p class="empty-msg">검색 결과가 없습니다.<br>다른 키워드로 검색해보세요.</p>
  </div>
</section>
{/if}

<style>
  .results-section {
    width: 100%;
    padding: 0 25px 100px;
    background: var(--cs-bg-primary, #ffffff);
    border-radius: 0 50px 0 0;
  }
  .results-section--empty {
    padding: 60px 25px;
    text-align: center;
  }
  .empty-msg {
    font-size: 15px;
    color: var(--cs-text-mid, #666666);
    line-height: 1.7;
  }
  @media (min-width: 1024px) {
    .results-section {
      padding: 0 100px 80px;
    }
  }
  .results-inner {
    max-width: 1600px;
    margin: 0 auto;
  }
  .results-header {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 30px 0;
    cursor: pointer;
    background: none;
    border: none;
  }
  .results-title {
    font-size: 18px;
    font-weight: 500;
    line-height: 1.6;
    letter-spacing: -0.3px;
    color: var(--cs-text-dark, #444444);
    font-family: 'Noto Sans KR', sans-serif;
  }
  .results-count {
    font-size: 16px;
    font-weight: 500;
    line-height: 1.6;
    letter-spacing: -0.5px;
    color: var(--cs-text-dark, #444444);
    font-family: 'Noto Sans KR', sans-serif;
  }

  /* 모바일 2열 — /products .m-prod-grid 동일 패턴(flex + calc(50% - 5px), 2026-09-28) */
  .product-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 26px 10px;
  }
  .product-grid-item {
    width: calc(50% - 5px);
    min-width: 0;
    box-sizing: border-box;
  }
  .product-grid-item :global(.pc-card) {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    flex-shrink: 1;
  }
  .product-grid-item :global(.pc-img-wrap) {
    width: 100%;
    height: auto;
    aspect-ratio: 1;
    flex-shrink: 1;
  }

  @media (min-width: 768px) {
    .product-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 60px 30px;
    }
    .product-grid-item {
      width: auto;
    }
  }
</style>
