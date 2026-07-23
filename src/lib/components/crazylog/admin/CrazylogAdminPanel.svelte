<script lang="ts">
  import CrazylogWbModal from './CrazylogWbModal.svelte'
  import CrazylogHeadPostsModal from './CrazylogHeadPostsModal.svelte'

  interface Props {
    activeModal: 'wb_hero' | 'head_posts' | null
    onclose: () => void
  }

  let { activeModal, onclose }: Props = $props()
</script>

<CrazylogWbModal open={activeModal === 'wb_hero'} {onclose} />
<CrazylogHeadPostsModal open={activeModal === 'head_posts'} {onclose} />
