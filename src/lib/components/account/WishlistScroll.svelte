<script lang="ts">
  import ProductDPCard from '$lib/components/products/ProductDPCard.svelte'
  import { supabase } from '$lib/services/supabase'

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
  }

  let { items = [], totalCount = 0 }: Props = $props()

  let localItems = $state([...items])
  let localCount = $state(totalCount)

  $effect(() => {
    localItems = [...items]
    localCount = totalCount
  })

  async function handleWishToggle(productId: string | undefined) {
    if (!productId) return
    const rpc = supabase.rpc as unknown as (fn: string, params: Record<string, string>) => Promise<{ data: { ok: boolean; action: string } | null }>
    const { data } = await rpc('toggle_product_wishlist', { p_product_id: productId })
    if (!data?.ok) return

    if (data.action === 'removed') {
      localItems = localItems.filter(i => i.product_id !== productId)
      localCount = Math.max(0, localCount - 1)
    }
  }
</script>

<div class="relative shrink-0 w-full">
  <div class="flex flex-col items-start pt-[20px] px-[25px] relative size-full">

    <!-- 섹션 타이틀 -->
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
    font-family: var(--font-kr);
    font-size: 18px;
    font-weight: 500;
    letter-spacing: -0.3px;
    color: var(--cs-text-dark);
    line-height: 1.6;
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
