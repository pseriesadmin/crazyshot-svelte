<script lang="ts">
  import ProductDPCard from '$lib/components/products/ProductDPCard.svelte'
  import type { ProductCategoryEnum } from '$lib/types/database'
  import thumb1 from '$lib/assets/account/product-thumb-1.png'
  import thumb2 from '$lib/assets/account/product-thumb-2.png'
  import thumb3 from '$lib/assets/account/product-thumb-3.png'
  import thumb4 from '$lib/assets/account/product-thumb-4.png'

  interface WishItem {
    id?: string
    imageUrl: string
    name: string
    category?: ProductCategoryEnum | string
    price24h?: number | null
    price12h?: number | null
    href?: string
  }

  const defaultItems: WishItem[] = [
    { imageUrl: thumb1, name: 'SONY A7S3',   category: 'camera',     price24h: 120000, price12h: 80000 },
    { imageUrl: thumb2, name: 'SONY CAM',    category: 'camcorder',  price24h: 120000, price12h: 80000 },
    { imageUrl: thumb3, name: 'SONY A7S3',   category: 'camera',     price24h: 120000, price12h: 80000 },
    { imageUrl: thumb4, name: '인스타 360',  category: 'action_cam', price24h: 120000, price12h: 80000 },
  ]

  interface Props {
    items?: WishItem[]
    totalCount?: number
  }

  let { items = defaultItems, totalCount = 6 }: Props = $props()
</script>

<div class="relative shrink-0 w-full">
  <div class="flex flex-col items-start pt-[20px] px-[25px] relative size-full">

    <!-- 섹션 타이틀 -->
    <div class="section-header">
      <p class="section-title">관심가져봄</p>
      <div class="section-right">
        <p class="section-count">{totalCount}</p>
        <div class="chevron-wrap">
          <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
            <path d="M1 1L7 7L1 13" stroke="#444444" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>
          </svg>
        </div>
      </div>
    </div>

    <!-- 가로 스크롤 카드 목록 -->
    <div class="scroll-track">
      <div class="scroll-inner">
        {#each items as item}
          <ProductDPCard
            id={item.id}
            name={item.name}
            category={item.category}
            imageUrl={item.imageUrl}
            price24h={item.price24h ?? null}
            price12h={item.price12h ?? null}
            href={item.href}
          />
        {/each}
      </div>
    </div>

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
</style>
