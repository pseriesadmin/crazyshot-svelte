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
  }

  interface Props {
    title?: string
    products?: Product[]
  }

  let {
    title = '검색 해봄',
    products = [],
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
      <div class="product-grid">
        {#each products as p (p.id)}
          <ProductDPCard
            id={String(p.id)}
            name={p.name}
            category={p.category}
            imageUrl={p.img}
            price24h={p.price24h ?? null}
            price12h={p.price12h ?? null}
            href={p.href ?? `/products/${p.id}`}
          />
        {/each}
      </div>
    {/if}
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

  /* ProductDPCard 그리드 — 카드 고정폭 해제, 셀 크기에 맞춤 */
  .product-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    column-gap: 15px;
    row-gap: 40px;
  }
  .product-grid :global(.pc-card) {
    width: 100%;
  }
  .product-grid :global(.pc-img-wrap) {
    width: 100%;
    height: auto;
    aspect-ratio: 1;
  }

  @media (min-width: 768px) {
    .product-grid {
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      column-gap: 30px;
      row-gap: 60px;
    }
  }
</style>
