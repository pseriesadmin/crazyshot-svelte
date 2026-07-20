<!-- re-export shim: 기존 호출 경로 호환 유지 → 공통 컴포넌트 위임 -->
<script lang="ts">
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import type { ComponentProps } from 'svelte'

  type Props = ComponentProps<typeof SuggestPicker>
  let props: Props = $props()
</script>

<SuggestPicker {...props} />
