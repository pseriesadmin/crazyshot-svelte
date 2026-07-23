<script lang="ts">
  import HomeBannerModal from './HomeBannerModal.svelte'
  import HomeHighlightModal from './HomeHighlightModal.svelte'
  import HomePickProductModal from './HomePickProductModal.svelte'

  interface Props {
    activeModal: 'hero_banner' | 'highlight' | 'pick_products' | null
    onclose: () => void
  }

  let { activeModal, onclose }: Props = $props()
</script>

<HomeBannerModal open={activeModal === 'hero_banner'} {onclose} />
<HomeHighlightModal open={activeModal === 'highlight'} {onclose} />
<HomePickProductModal open={activeModal === 'pick_products'} {onclose} />
