<script lang="ts">
  import BottomTabBar from '$lib/components/common/BottomTabBar.svelte'
  import ProductDPCard from '$lib/components/products/ProductDPCard.svelte'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  function productImg(p: { image_urls: string[] | null }): string {
    return p.image_urls?.[0] ?? '/images/products/grid-flat.png'
  }
  function productLink(p: { id: string; slug: string | null }): string {
    return `/products/${p.slug ?? p.id}`
  }
</script>

<div class="theme-page">
  <div class="theme-page-inner">
    <header class="theme-page-head">
      <h1 class="theme-page-title">{data.group.title}</h1>
      {#if data.group.sub_copy}
        <p class="theme-page-subcopy">{data.group.sub_copy}</p>
      {/if}
    </header>

    {#if data.products.length > 0}
      <div class="theme-prod-grid">
        {#each data.products as prod}
          <ProductDPCard
            id={prod.id}
            name={prod.name}
            imageUrl={productImg(prod)}
            price24h={prod.price24h}
            price12h={prod.price12h}
            href={productLink(prod)}
          />
        {/each}
      </div>
    {:else}
      <p class="theme-empty">아직 등록된 상품이 없습니다.</p>
    {/if}
  </div>
</div>

<BottomTabBar />

<style>
  .theme-page {
    background: var(--cs-lilac);
    min-height: 100dvh;
    padding: 100px 0 100px;
  }

  .theme-page-inner {
    max-width: 1240px;
    margin: 0 auto;
    padding: 40px 20px;
  }

  .theme-page-head {
    text-align: center;
    margin-bottom: 40px;
  }

  .theme-page-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 25px;
    font-weight: 900;
    color: var(--cs-text);
    margin: 0 0 8px;
  }

  .theme-page-subcopy {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    color: var(--cs-text-mid, #666);
    margin: 0;
  }

  .theme-prod-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    justify-content: center;
  }

  .theme-empty {
    text-align: center;
    color: var(--cs-text-mid, #666);
    font-size: 14px;
    padding: 60px 0;
  }

  @media (max-width: 640px) {
    .theme-page { padding-top: 87px; }
    .theme-page-inner { padding: 24px 20px; }
    .theme-prod-grid { gap: 12px; }
  }
</style>
