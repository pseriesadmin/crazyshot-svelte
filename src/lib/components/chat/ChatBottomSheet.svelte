<script lang="ts">
  // PRD.1.7 — ChatBottomSheet: 바텀업 모달 컨테이너
  // 플랜: border-radius 50px 50px 0 0, max-height 85vh, 슬라이드업 애니메이션
  // 접근성: role="dialog" + aria-modal + 포커스 트랩

  import ChatWindow from './ChatWindow.svelte'

  interface Props {
    isOpen: boolean
    userId: string
    userName: string
    userHandle?: string
    contextType?: string
    contextId?: string
    onclose: () => void
  }

  let {
    isOpen,
    userId,
    userName,
    userHandle = '',
    contextType,
    contextId,
    onclose,
  }: Props = $props()

  let dialogEl = $state<HTMLDivElement | null>(null)

  // 열릴 때 포커스 이동
  $effect(() => {
    if (isOpen && dialogEl) {
      dialogEl.focus()
    }
  })

  // ESC 키로 닫기
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose()
  }

  // 백드롭 클릭으로 닫기
  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose()
  }
</script>

{#if isOpen}
  <!-- 백드롭: dialog와 형제 관계 → aria-hidden이 dialog를 감싸지 않음 -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={handleBackdropClick} aria-hidden="true"></div>

  <!-- 바텀시트: 백드롭과 형제, 독립적으로 포커스 수신 -->
  <div
    class="bottom-sheet"
    role="dialog"
    aria-modal="true"
    aria-label="크레이지샷 채팅"
    bind:this={dialogEl}
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    <!-- 드래그 핸들 -->
    <div class="drag-handle" aria-hidden="true"></div>

    <!-- 채팅 창 -->
    <div class="sheet-body">
      <ChatWindow
        {userId}
        {userName}
        {userHandle}
        {contextType}
        {contextId}
        {onclose}
      />
    </div>
  </div>
{/if}

<style>
  /* 백드롭 — opacity 대신 background-color 트랜지션: stacking context 미생성 */
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(16, 11, 50, 0);
    z-index: 200;
    animation: fade-in 0.2s ease forwards;
  }

  @keyframes fade-in {
    from { background: rgba(16, 11, 50, 0); }
    to   { background: rgba(16, 11, 50, 0.45); }
  }

  /* 바텀시트 — 독립 fixed, backdrop과 별개로 위치 */
  .bottom-sheet {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 201;
    background: #e1def3;
    border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
    height: 93vh;
    display: flex;
    flex-direction: column;
    outline: none;
    animation: slide-up 0.3s cubic-bezier(0.32, 0.72, 0, 1);
    max-width: 480px;
    margin: 0 auto;
  }

  @keyframes slide-up {
    from { transform: translateY(100%); }
    to   { transform: translateY(0); }
  }

  /* 드래그 핸들 */
  .drag-handle {
    width: 40px;
    height: 4px;
    background: rgba(59, 47, 138, 0.25);
    border-radius: 2px;
    margin: 12px auto 0;
    flex-shrink: 0;
  }

  /* 채팅 창 래퍼 */
  .sheet-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* PC: 우하단 팝업 */
  @media (min-width: 640px) {
    .bottom-sheet {
      bottom: calc(var(--layout-footer-h, 80px) + 24px + 56px);
      right: 24px;
      left: auto;
      margin: 0;
      width: 380px;
      max-width: 380px;
      height: 640px;
      border-radius: var(--radius-xl);
    }

    .drag-handle {
      display: none;
    }
  }
</style>
