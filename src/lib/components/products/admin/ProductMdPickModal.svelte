<script lang="ts">
  // MD 픽 모달 — ProductHeroModal과 동일 구조, key만 다름
  import ProductHeroModal from './ProductHeroModal.svelte'

  interface HeroSettings {
    products: { id: string; order: number }[]
    mode: 'random' | 'fixed'
  }

  interface Props {
    initialSettings: HeroSettings
    onclose: () => void
  }

  let { initialSettings, onclose }: Props = $props()
</script>

<ProductHeroModal
  settingKey="product_page_md_picks"
  {initialSettings}
  {onclose}
/>
