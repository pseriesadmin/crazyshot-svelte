<script lang="ts">
  // PRD.1.7 — FloatingChatButton: fab-bar 내 채팅 fab-btn
  // 구조: dev/cart fab-bar 패턴 동일 적용
  // 아이콘: 커스텀 SVG (35×35 viewBox, 52px 표시)

  import ChatBottomSheet from './ChatBottomSheet.svelte'
  import ChatIcon from '$lib/components/common/ChatIcon.svelte'
  import { chatStore, toggleChat, resetUnreadCount, pushMessage, setActiveSession } from '$lib/stores/chat.svelte'
  import { subscribeToChatMessages, loadUserSession } from '$lib/services/chatService'
  import { supabase } from '$lib/services/supabase'

  interface Props {
    userId: string
    userName: string
    userHandle?: string
    contextType?: string
    contextId?: string
    /** true면 원형 FAB 버튼은 숨기고 ChatBottomSheet(공통 모달)만 마운트 —
        다른 화면(예: /account/rental)의 자체 버튼이 openChatWithContext()로만 열 때 사용 */
    hideFab?: boolean
  }

  let {
    userId,
    userName,
    userHandle = '',
    contextType,
    contextId,
    hideFab = false,
  }: Props = $props()

  let isOpen = $derived(chatStore.isOpen)
  let unreadCount = $derived(chatStore.unreadCount)
  let badgeLabel = $derived(unreadCount > 99 ? '99+' : String(unreadCount))

  function handleToggle() {
    toggleChat()
    if (chatStore.isOpen) resetUnreadCount()
  }

  function handleClose() {
    if (chatStore.isOpen) toggleChat()
  }

  // ── 페이지 로드 시 세션 자동 복구 ──
  // 새로고침 후 chatStore.activeSessionId는 null로 초기화됨.
  // Supabase 익명 auth는 localStorage에 유지되므로 재로그인 없이
  // 기존 채팅 세션을 찾아 activeSessionId를 복구한다.
  // $effect 내부에서 비동기 콜백(.then) 안의 읽기는 추적되지 않아
  // 이 effect는 마운트 시 단 한 번만 실행된다.
  $effect(() => {
    supabase.auth.getSession().then(({ data: { session: authSession } }) => {
      if (!authSession) return          // 미인증 → 복구 불가
      if (chatStore.activeSessionId) return  // 이미 설정됨 (채팅이 열린 상태)

      // props는 .then() 내부에서 접근하므로 추적 대상 아님
      const ct = contextType
      const ci = contextId
      loadUserSession(ct, ci).then(({ session }) => {
        // closed 포함 모든 상태의 세션에 구독
        // 관리자가 closed 세션에 메시지를 보내면 서버가 자동으로 open으로 복구하고
        // Realtime INSERT가 발생 → 이미 구독 중이면 알림 수신 가능
        if (session && !chatStore.activeSessionId) {
          setActiveSession(session.id)
        }
      })
    })
  })

  // ── 백그라운드 구독: 채팅 닫혀 있어도 관리자 메시지 수신 ──
  // activeSessionId가 설정되는 즉시 (채팅 열기 또는 위 복구 로직) 구독 시작.
  // ChatWindow가 열린 상태에서는 두 구독이 동시에 동작하지만
  // pushMessage 내부 dedup + isOpen=true 조건으로 카운트 중복 없음.
  $effect(() => {
    const sessionId = chatStore.activeSessionId
    if (!sessionId) return

    const unsub = subscribeToChatMessages(sessionId, (msg) => {
      pushMessage(msg)
    })
    return unsub
  })
</script>

{#if !hideFab}
  <!-- fab-btn — dev/cart 패턴 동일 (배경 없음, drop-shadow, scale hover) -->
  <div class="chat-fab-wrap">
    <!-- 전파 확산 링: 미읽음 메시지 도착 시 표시 -->
    {#if unreadCount > 0 && !isOpen}
      <span class="ripple ripple-1" aria-hidden="true"></span>
      <span class="ripple ripple-2" aria-hidden="true"></span>
    {/if}

    <button
      class="fab-btn"
      class:has-unread={unreadCount > 0 && !isOpen}
      onclick={handleToggle}
      aria-label={isOpen
        ? '채팅 닫기'
        : `채팅 열기${unreadCount > 0 ? ` (새 메시지 ${unreadCount}개)` : ''}`}
      aria-expanded={isOpen}
      aria-haspopup="dialog"
    >
      <!-- 커스텀 채팅 아이콘 (Stephen 확정 디자인) — 공통 컴포넌트(common/ChatIcon.svelte) 사용 -->
      <ChatIcon size={70} />

      <!-- 레드 원점 — 미읽음 메시지 도착 시 우측 상단 -->
      {#if unreadCount > 0 && !isOpen}
        <span class="red-dot" aria-hidden="true"></span>
      {/if}
    </button>
  </div>
{/if}

<!-- 채팅 바텀시트 — 글로벌 오버레이 -->
<ChatBottomSheet
  {isOpen}
  {userId}
  {userName}
  {userHandle}
  {contextType}
  {contextId}
  onclose={handleClose}
/>

<style>
  /* fab-btn 래퍼 — 원점·링 위치 기준점 */
  .chat-fab-wrap {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* dev/cart fab-btn 패턴 동일 */
  .fab-btn {
    background: none;
    border: none;
    outline: none;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s;
    filter: drop-shadow(0 4px 10px rgba(16, 11, 50, 0.22));
    position: relative;
    z-index: 1;
  }

  .fab-btn:hover  { transform: scale(1.07); }
  .fab-btn:active { transform: scale(0.95); }

  /* PC 반응형: 아이콘 40px — ChatIcon은 자식 컴포넌트라 :global()로 스코프 경계를 넘어야 함 */
  @media (min-width: 640px) {
    .fab-btn :global(svg) { width: 40px; height: 40px; }
  }

  /* ── 레드 원점 — 우측 상단 ── */
  .red-dot {
    position: absolute;
    top: 1px;
    right: 1px;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--cs-red-badge, #FF3535);
    border: 2px solid var(--cs-white, #fff);
    pointer-events: none;
  }

  @media (min-width: 640px) {
    /* PC: 아이콘 40px 기준 위치 조정 */
    .red-dot {
      top: -1px;
      right: -1px;
      width: 10px;
      height: 10px;
    }
  }

  /* ── 전파 확산 링 ── */
  .ripple {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 2.5px solid rgba(255, 53, 53, 0.8);
    border: 2.5px solid color-mix(in srgb, var(--cs-red-badge, #FF3535) 80%, transparent);
    opacity: 0;
    pointer-events: none;
    animation: ripple-wave 2.4s ease-out infinite;
  }

  .ripple-2 {
    animation-delay: 0.8s;
  }

  @keyframes ripple-wave {
    0% {
      transform: scale(1);
      opacity: 0.7;
    }
    100% {
      transform: scale(1.65);
      opacity: 0;
    }
  }
</style>
