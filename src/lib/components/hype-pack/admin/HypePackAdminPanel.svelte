<script lang="ts">
  import HypePackBannerModal from './HypePackBannerModal.svelte'
  import HypePackThemeModal from './HypePackThemeModal.svelte'
  import HypePackCarouselModal from './HypePackCarouselModal.svelte'
  import HypePackHotModal from './HypePackHotModal.svelte'

  interface Props {
    activeModal: 'ad_banner' | 'pack_themes' | 'hero_carousel' | 'hot_products' | null
    onclose: () => void
  }

  let { activeModal, onclose }: Props = $props()
</script>

<HypePackBannerModal open={activeModal === 'ad_banner'} {onclose} />
<HypePackThemeModal open={activeModal === 'pack_themes'} {onclose} />
<HypePackCarouselModal open={activeModal === 'hero_carousel'} {onclose} />
<HypePackHotModal open={activeModal === 'hot_products'} {onclose} />
