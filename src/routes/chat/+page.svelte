<script lang="ts">
  // PRD.1.7 T10 — 고객 채팅 전용 라우트
  // URL: /chat | /chat?context=product&id=X | /chat?context=reservation&id=X

  import ChatWindow from '$lib/components/chat/ChatWindow.svelte'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()
</script>

<div class="chat-page">
  <ChatWindow
    userId={data.userId}
    userName={data.userName}
    userHandle={data.userHandle}
    contextType={data.contextType}
    contextId={data.contextId}
  />
</div>

<style>
  .chat-page {
    position: fixed;
    inset: 0;
    /* 헤더 높이만큼 상단 여백 */
    top: 64px;
    background: #e1def3;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 10;
  }

  @media (min-width: 640px) {
    .chat-page {
      top: 64px;
      max-width: 480px;
      margin: 0 auto;
      /* PC: 카드형으로 표시 */
      inset: 64px auto 0 50%;
      transform: translateX(-50%);
      width: 480px;
      box-shadow: 0 0 40px rgba(16, 11, 50, 0.15);
      border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
    }
  }
</style>
