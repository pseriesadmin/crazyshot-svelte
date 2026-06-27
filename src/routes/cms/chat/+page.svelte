<script lang="ts">
  import AdminChatPanel from '$lib/components/chat/AdminChatPanel.svelte'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()
</script>

<svelte:head><title>상담 — CrazyShot CMS</title></svelte:head>

<AdminChatPanel initialSessions={data.sessions} />
