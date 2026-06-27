<script lang="ts">
  import AdminChatPanel from '$lib/components/chat/AdminChatPanel.svelte'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()
</script>

<AdminChatPanel initialSessions={data.sessions} />
