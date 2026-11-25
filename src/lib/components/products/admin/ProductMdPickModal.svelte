<script lang="ts">
  // MD 픽 모달 — ProductHeroModal과 동일 구조, key만 다름
  import ProductHeroModal from './ProductHeroModal.svelte'
  import type { ProductListMode } from '$lib/utils/productListOrder'

  interface HeroSettings {
    products: { id: string; order: number }[]
    mode: ProductListMode
    popup?: { on_wish?: boolean; on_reserve?: boolean }
  }

  interface Props {
    initialSettings: HeroSettings
    onclose: () => void
    embedded?: boolean
  }

  let { initialSettings, onclose, embedded = false }: Props = $props()
</script>

<ProductHeroModal
  settingKey="product_page_md_picks"
  {initialSettings}
  {onclose}
  {embedded}
/>
