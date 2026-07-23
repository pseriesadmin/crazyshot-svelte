<script lang="ts">
  import HelpHeroModal from './HelpHeroModal.svelte'
  import HelpFaqModal from './HelpFaqModal.svelte'

  interface Props {
    activeModal: 'hero' | 'faq' | null
    onclose: () => void
  }

  let { activeModal, onclose }: Props = $props()
</script>

<HelpHeroModal open={activeModal === 'hero'} {onclose} />
<HelpFaqModal open={activeModal === 'faq'} {onclose} />
