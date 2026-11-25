<script lang="ts">
  import AdminChatPanel from '$lib/components/chat/AdminChatPanel.svelte'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()
</script>

<svelte:head><title>상담 — CrazyShot 현장앱</title></svelte:head>

<!-- 모바일 전용 상담 화면: 세션 목록 ↔ 대화창을 한 화면씩 전환(상담 기능·로직은 PC 상담 세션과 동일한 AdminChatPanel 그대로) -->
<div class="mob-chat-page">
  <AdminChatPanel mobile initialSessions={data.sessions} initialSessionId={data.initialSessionId} />
</div>

<style>
  .mob-chat-page {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
