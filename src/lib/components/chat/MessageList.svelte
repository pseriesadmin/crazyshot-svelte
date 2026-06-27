<script lang="ts">
  // PRD.1.7 — MessageList: 스크롤 메시지 목록
  // Figma node: 2497:8699 (chat list)
  // Realtime INSERT → pushMessage → 자동 하단 스크롤

  import MessageBubble from './MessageBubble.svelte'
  import type { ChatMessage, ActionPayload } from '$lib/types/chat'

  interface Props {
    messages: ChatMessage[]
    currentUserId: string
    onaction?: (payload: ActionPayload) => void
    ondelete?: (messageId: string) => void
  }

  let { messages, currentUserId, onaction, ondelete }: Props = $props()

  let listEl = $state<HTMLDivElement | null>(null)

  // 메시지 추가될 때마다 하단 스크롤
  $effect(() => {
    // messages 참조로 반응성 트리거
    void messages.length
    if (listEl) {
      listEl.scrollTop = listEl.scrollHeight
    }
  })
</script>

<div class="message-list" bind:this={listEl} role="log" aria-live="polite" aria-label="채팅 메시지 목록">
  {#if messages.length === 0}
    <div class="empty-state">
      <p>무엇이든 물어보세요!</p>
      <p class="empty-sub">촬영장비 렌탈에 관해 궁금한 점을 남겨주세요.</p>
    </div>
  {:else}
    {#each messages as message (message.id)}
      <MessageBubble
        {message}
        isOwn={currentUserId === 'admin'
          ? message.sender_type === 'admin'
          : message.sender_type === 'user'}
        {onaction}
        {ondelete}
      />
    {/each}
  {/if}
</div>

<style>
  /* Figma node 2497:8699 — chat list */
  .message-list {
    display: flex;
    flex-direction: column;
    gap: 30px; /* Figma: gap-[30px] */
    padding: 20px;
    flex: 1 0 0;
    overflow-y: auto;
    width: 100%;
    min-height: 0;
    scroll-behavior: smooth;
  }

  /* 스크롤바 스타일 */
  .message-list::-webkit-scrollbar {
    width: 4px;
  }
  .message-list::-webkit-scrollbar-track {
    background: transparent;
  }
  .message-list::-webkit-scrollbar-thumb {
    background: var(--cs-points, #c1bbec);
    border-radius: 2px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex: 1;
    padding: 40px 20px;
    text-align: center;
  }

  .empty-state p {
    font: 700 16px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    margin: 0;
  }

  .empty-sub {
    font: 400 13px/1.5 'Noto Sans KR', sans-serif !important;
    color: var(--cs-text-mid, #777777) !important;
  }
</style>
