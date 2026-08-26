<script lang="ts">
  import ProductDPCard from '$lib/components/products/ProductDPCard.svelte'

  interface WishItem {
    wishlist_id: string
    product_id: string
    product_name: string
    category: string
    image_url: string
    slug: string
    price24h: number | null
    price12h: number | null
    wished_at: string
  }

  interface Props {
    items?: WishItem[]
    totalCount?: number
    hideTitle?: boolean
  }

  let { items = [], totalCount = 0, hideTitle = false }: Props = $props()

  let localItems = $state([...items])
  let localCount = $state(totalCount)

  $effect(() => {
    localItems = [...items]
    localCount = totalCount
  })

  async function handleWishToggle(productId: string | undefined) {
    if (!productId) return
    const res = await fetch('/api/wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: productId }),
    })
    if (!res.ok) return
    const data = await res.json() as { ok: boolean; action?: string }
    if (!data.ok) return

    if (data.action === 'removed') {
      localItems = localItems.filter(i => i.product_id !== productId)
      localCount = Math.max(0, localCount - 1)
    }
  }
</script>

<div class="relative shrink-0 w-full">
  <div class="flex flex-col items-start pt-[20px] px-[25px] relative size-full">

    <!-- 섹션 타이틀 — PC 호출부는 자체 헤더를 별도로 두므로 hideTitle로 중복 렌더 방지 -->
    {#if !hideTitle}
      <div class="section-header">
        <p class="section-title">관심가져봄</p>
        <div class="section-right">
          <p class="section-count">{localCount}</p>
          <div class="chevron-wrap">
            <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
              <path d="M1 1L7 7L1 13" stroke="#444444" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>
            </svg>
          </div>
        </div>
      </div>
    {/if}

    <!-- 가로 스크롤 카드 목록 -->
    {#if localItems.length === 0}
      <div class="empty-wish">
        <p class="empty-wish-msg">관심 상품이 없습니다</p>
        <p class="empty-wish-sub">마음에 드는 상품에 하트를 눌러 보세요</p>
      </div>
    {:else}
      <div class="scroll-track">
        <div class="scroll-inner">
          {#each localItems as item (item.wishlist_id)}
            <ProductDPCard
              id={item.product_id}
              name={item.product_name}
              category={item.category}
              imageUrl={item.image_url || '/placeholder.png'}
              price24h={item.price24h}
              price12h={item.price12h}
              href={`/products/${item.slug}`}
              wished
              onWishToggle={handleWishToggle}
            />
          {/each}
        </div>
      </div>
    {/if}

  </div>
</div>

<style>
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 30px 0;
  }
  .section-title {
    font: var(--text-m-title-21);
    letter-spacing: -0.3px;
    color: var(--cs-text-dark);
  }
  .section-right {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .section-count {
    font-family: var(--font-kr);
    font-size: 16px;
    font-weight: 500;
    letter-spacing: -0.5px;
    color: var(--cs-text-dark);
    line-height: 1.6;
  }
  .chevron-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 6px;
    transform: rotate(90deg);
  }

  .scroll-track {
    overflow-x: auto;
    width: 100%;
    padding-bottom: 8px;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .scroll-track::-webkit-scrollbar {
    display: none;
  }
  .scroll-inner {
    display: flex;
    gap: 20px;
    align-items: flex-start;
    width: max-content;
  }

  /* "관심가져봄" 상품 썸네일 — front-uiux.md §14-4 "S(소형)" 크기 등급(2026-08-26 신설,
     ProductDPCard 기본(M) 대비 30% 축소) 적용. ProductDPCard.svelte는 §14-4 "⛔ 내부 CSS
     직접 수정 금지" 원칙에 따라 그대로 두고 부모 :global() 오버라이드로만 처리.
     기준값은 실제 ProductDPCard.svelte 라이브 코드(.pc-clip, 비대칭 radius)를 그대로
     ×0.7 스케일 — 문서(§14-4) 구버전(.pc-heart/30px 균일/36px)은 최신 코드와 불일치해
     이번에 함께 정정함. 모바일·PC 둘 다 각자의 M 기준값에서 동일 비율로 축소. */

  /* Mobile 기본(M 174px → S 122px) */
  .scroll-inner :global(.pc-card) {
    width: 122px;
  }
  .scroll-inner :global(.pc-img-wrap) {
    width: 122px;
    height: 122px;
    border-radius: 14px 6px 14px 6px;
  }
  .scroll-inner :global(.pc-clip) {
    width: 15px;
    height: 15px;
    top: 5px;
    right: 5px;
  }
  .scroll-inner :global(.pc-clip svg) {
    width: 10px;
    height: 10px;
  }

  /* PC(M 290px → S 203px, ×5/3 비대칭 radius 33/13 → 23/9) */
  @media (min-width: 768px) {
    .scroll-inner :global(.pc-card) {
      width: 203px;
    }
    .scroll-inner :global(.pc-img-wrap) {
      width: 203px;
      height: 203px;
      border-radius: 23px 9px 23px 9px;
    }
    .scroll-inner :global(.pc-clip) {
      width: 31px;
      height: 31px;
      top: 10px;
      right: 10px;
    }
    .scroll-inner :global(.pc-clip svg) {
      width: 24px;
      height: 24px;
    }
  }

  .empty-wish {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 40px 0 30px;
  }
  .empty-wish-msg {
    font-family: var(--font-kr);
    font-size: 15px;
    font-weight: 700;
    color: var(--cs-text);
  }
  .empty-wish-sub {
    font-family: var(--font-kr);
    font-size: 13px;
    color: var(--cs-text-mid);
  }
</style>
