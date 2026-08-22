<script lang="ts">
  import HomeHighlightModal from './HomeHighlightModal.svelte'
  import HomePickProductModal from './HomePickProductModal.svelte'

  // 히어로배너(hero_banner)는 Phase 2부터 HomeBannerModal이 +page.svelte에서 직접
  // 마운트된다(pcBanners/mobileBanners 등 실데이터 props 필요 — 이 래퍼는 그 데이터를
  // 갖고 있지 않아 더 이상 매개할 수 없음). 이 래퍼 자체는 여전히 아무 곳에서도
  // import되지 않는 미사용 컴포넌트.
  interface Props {
    activeModal: 'highlight' | 'pick_products' | null
    onclose: () => void
  }

  let { activeModal, onclose }: Props = $props()
</script>

<HomeHighlightModal open={activeModal === 'highlight'} {onclose} />
<HomePickProductModal open={activeModal === 'pick_products'} {onclose} />
