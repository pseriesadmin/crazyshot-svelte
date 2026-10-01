<script lang="ts">
  import BottomTabBar from '$lib/components/common/BottomTabBar.svelte'
  import ProductDPCard from '$lib/components/products/ProductDPCard.svelte'
  import { toggleWish } from '$lib/utils/wishlist'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

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
          <div class="theme-prod-item">
            <ProductDPCard
              id={prod.id}
              name={prod.name}
              category={prod.category ?? undefined}
              imageUrl={productImg(prod)}
              price24h={prod.price24h}
              price12h={prod.price12h}
              href={productLink(prod)}
              wished={wishedSet.has(prod.id)}
              onWishToggle={data.isLoggedIn ? handleWishToggle : undefined}
            />
          </div>
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
  .theme-prod-item {
    width: auto;
  }

  .theme-empty {
    text-align: center;
    color: var(--cs-text-mid, #666);
    font-size: 14px;
    padding: 60px 0;
  }

  /* 모바일 2열 강제 — /products .m-prod-grid·SearchProductGrid.svelte 동일 패턴
     (flex + calc(50% - 5px)). ProductDPCard 자체 고정폭(174px)이 좁은 화면(예: 360px)에서
     기존 24px gap과 함께 1열로 줄바꿈되던 버그 수정(2026-09-30). */
  @media (max-width: 640px) {
    .theme-page { padding-top: var(--layout-mob-gnb-offset); }
    .theme-page-inner { padding: 24px 20px; }
    .theme-prod-grid { gap: 26px 10px; }
    .theme-prod-item {
      width: calc(50% - 5px);
      min-width: 0;
      box-sizing: border-box;
    }
    .theme-prod-item :global(.pc-card) {
      width: 100%;
      max-width: 100%;
      min-width: 0;
      flex-shrink: 1;
    }
    .theme-prod-item :global(.pc-img-wrap) {
      width: 100%;
      height: auto;
      aspect-ratio: 1;
      flex-shrink: 1;
    }
  }
</style>
