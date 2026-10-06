<script lang="ts">
  // PRD.1.7 T10 — 고객 채팅 전용 라우트
  // URL: /chat | /chat?context=product&id=X | /chat?context=reservation&id=X
  //
  // 2026-10-06: PC(≥640px)에서 이 라우트는 빈 페이지 위에 풀높이 카드로 보여 어색했다(뒤로 푸터·
  // GNB가 그대로 비침). PC는 홈('/')으로 치환 이동한 뒤 FAB과 동일한 공통 채팅 모달
  // (ChatBottomSheet PC 팝업)을 즉시 여는 방식으로 통일한다. 모바일은 기존 풀스크린 페이지 유지.
  // ⛔ PC에서 ChatWindow를 이 페이지에도 마운트하지 말 것 — 공통 모달의 ChatWindow와 이중 구독된다.

  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import ChatWindow from '$lib/components/chat/ChatWindow.svelte'
  import { openChat, openChatWithContext } from '$lib/stores/chat.svelte'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  let mode = $state<'pending' | 'mobile' | 'pc'>('pending')

  onMount(async () => {
    if (!window.matchMedia('(min-width: 640px)').matches) {
      mode = 'mobile'
      return
    }
    mode = 'pc'
    await goto('/', { replaceState: true, noScroll: true })
    if (data.contextType === 'reservation' && data.contextReservationId) {
      openChatWithContext({ context_type: 'reservation', context_reservation_id: data.contextReservationId })
    } else if (data.contextType && data.contextId) {
      openChatWithContext({ context_type: data.contextType, context_id: data.contextId })
    } else {
      openChat()
    }
  })
</script>

<svelte:head>
  <title>채팅 — CRAZYSHOT</title>
</svelte:head>

{#if mode === 'mobile'}
  <div class="chat-page">
    <ChatWindow
      userId={data.userId}
      userName={data.userName}
      userHandle={data.userHandle}
      contextType={data.contextType}
      contextId={data.contextId}
      contextReservationId={data.contextReservationId}
    />
  </div>
{/if}

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
