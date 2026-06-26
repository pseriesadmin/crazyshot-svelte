<script lang="ts">
  // PRD.1.7 — ChatWindow: 채팅 창 전체 조합 컴포넌트
  // Figma node: 2497:8691 (00-1.chat)
  // 구조: ChatHeader + MessageList + ChatInput
  // Realtime: subscribeToChatMessages → pushMessage

  import ChatHeader from './ChatHeader.svelte'
  import MessageList from './MessageList.svelte'
  import ChatInput from './ChatInput.svelte'
  import {
    createChatSession,
    loadUserSession,
    loadMessages,
    sendMessage,
    sendAttachment,
    deleteMessage,
    subscribeToChatMessages,
    markMessagesRead,
  } from '$lib/services/chatService'
  import { chatStore, pushMessage, setMessages, setActiveSession, removeMessage, markMessageRead } from '$lib/stores/chat.svelte'
  import { supabase } from '$lib/services/supabase'
  import type { ChatSession, ActionPayload } from '$lib/types/chat'

  interface Props {
    /** 로그인 사용자 정보 (비로그인 시 'test-user') */
    userId: string
    userName: string
    userHandle?: string
    /** 상품·예약 컨텍스트 딥링크 */
    contextType?: string
    contextId?: string
    onclose?: () => void
  }

  let {
    userId,
    userName,
    userHandle = '',
    contextType,
    contextId,
    onclose,
  }: Props = $props()

  let session = $state<ChatSession | null>(null)
  let isLoading = $state(true)
  let errorMsg = $state<string | null>(null)
  let isSending = $state(false)
  let isUploading = $state(false)

  // 세션 ID 앞 8자를 핸들로 표시 (비로그인 식별용)
  let displayHandle = $derived(
    userHandle || (session ? '#' + session.id.slice(0, 8) : '')
  )

  // 메시지 목록은 chatStore에서 파생
  let messages = $derived(chatStore.messages)

  // ── Guest: Anonymous Sign-in (쿠키 기반) ──
  // createBrowserClient → 세션을 쿠키에 저장 → 서버 safeGetSession()이 읽을 수 있음
  async function ensureAuth(): Promise<boolean> {
    const { data: { session: authSession } } = await supabase.auth.getSession()
    if (authSession) return true

    const { error } = await supabase.auth.signInAnonymously()
    return !error
  }

  // ── 세션 초기화 ──
  async function initSession() {
    isLoading = true
    errorMsg = null

    // 비로그인 guest → 익명 로그인으로 real UUID 확보
    const authed = await ensureAuth()
    if (!authed) {
      errorMsg = '채팅 연결에 실패했습니다. 잠시 후 다시 시도해주세요.'
      isLoading = false
      return
    }

    // 기존 열린 세션 조회 → 없으면 생성
    let { session: existing, error } = await loadUserSession(contextType, contextId)
    if (error) {
      errorMsg = '채팅을 불러오는 데 실패했습니다.'
      isLoading = false
      return
    }

    if (!existing) {
      const created = await createChatSession({ context_type: contextType as never, context_id: contextId })
      if (created.error || !created.session) {
        errorMsg = created.error ?? '세션 생성 실패'
        isLoading = false
        return
      }
      existing = created.session
    }

    session = existing
    setActiveSession(existing.id)

    // 기존 메시지 로드
    const { messages: hist } = await loadMessages(existing.id)
    setMessages(hist)

    // 읽음 처리
    await markMessagesRead(existing.id)

    isLoading = false
  }

  // ── Realtime 구독 ──
  $effect(() => {
    void initSession()
  })

  $effect(() => {
    if (!session?.id) return

    const unsubscribe = subscribeToChatMessages(
      session.id,
      (msg) => {
        pushMessage(msg)
        // 창이 열려있으면 즉시 읽음 처리
        markMessagesRead(session!.id)
      },
      (messageId) => {
        // 상대방이 내 메시지를 읽었을 때 → 로컬 버블 아이콘 즉시 업데이트
        markMessageRead(messageId)
      }
    )

    return unsubscribe
  })

  // ── 메시지 전송 ──
  async function handleSend(content: string) {
    if (!session || isSending) return
    isSending = true

    const { response, error } = await sendMessage({ session_id: session.id, content })

    if (error) {
      errorMsg = error
    } else if (response) {
      // Realtime으로 이미 수신될 수 있으나 fallback으로 직접 push
      pushMessage(response.user_message)
      if (response.ai_message) pushMessage(response.ai_message)
      errorMsg = null
    }

    isSending = false
  }

  // ── 파일 업로드 ──
  async function handleAttach(file: File) {
    if (!session || isUploading) return
    isUploading = true

    const ext = file.name.split('.').pop() ?? 'bin'
    const path = `${session.id}/${Date.now()}.${ext}`

    const { data, error: uploadError } = await supabase.storage
      .from('chat-attachments')
      .upload(path, file, { upsert: false })

    if (uploadError || !data) {
      errorMsg = '파일 업로드에 실패했습니다.'
      isUploading = false
      return
    }

    const { data: { publicUrl } } = supabase.storage
      .from('chat-attachments')
      .getPublicUrl(data.path)

    const is_image = file.type.startsWith('image/')
    const { message, error } = await sendAttachment({
      session_id: session.id,
      file_name: file.name,
      file_url: publicUrl,
      is_image,
    })

    if (error || !message) {
      errorMsg = error ?? '파일 전송 실패'
    } else {
      pushMessage(message)
    }

    isUploading = false
  }

  // ── 첨부 메시지 삭제 ──
  async function handleDeleteMessage(messageId: string) {
    const { error } = await deleteMessage(messageId)
    if (!error) removeMessage(messageId)
  }

  // ── 액션 카드 핸들러 ──
  function handleAction(payload: ActionPayload) {
    void payload
  }
</script>

<!-- Figma node 2497:8691: bg #E1DEF3, border-radius 30px, flex-col -->
<div class="chat-window">
  <!-- 헤더 -->
  <ChatHeader {userName} userHandle={displayHandle} {onclose} />

  <!-- 메시지 목록 -->
  {#if isLoading}
    <div class="loading-state" aria-label="채팅 로딩 중">
      <div class="loading-dot"></div>
      <div class="loading-dot"></div>
      <div class="loading-dot"></div>
    </div>
  {:else if errorMsg}
    <div class="error-state" role="alert">
      <p>{errorMsg}</p>
      <button onclick={initSession}>다시 시도</button>
    </div>
  {:else}
    <MessageList {messages} currentUserId={userId} onaction={handleAction} ondelete={handleDeleteMessage} />
  {/if}

  <!-- 입력 바 -->
  <ChatInput
    disabled={isSending || isLoading || isUploading || !session}
    placeholder={isUploading ? '업로드 중...' : isSending ? '응답 중...' : '메시지를 입력하세요...'}
    onsend={handleSend}
    onattach={handleAttach}
  />
</div>

<style>
  /* Figma node 2497:8691 — 00-1.chat: px-20 py-30 gap-30 */
  .chat-window {
    background: #e1def3; /* Figma: purple-op-10% — CSS 변수 미등록 색상 */
    border-radius: var(--radius-xl); /* 30px */
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 20px;
    overflow: hidden;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
  }

  /* 로딩 닷 애니메이션 */
  .loading-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex: 1;
    padding: 40px;
  }

  .loading-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--cs-purple);
    animation: bounce 1.2s infinite ease-in-out;
  }
  .loading-dot:nth-child(2) { animation-delay: 0.2s; }
  .loading-dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes bounce {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
    40%           { transform: scale(1);   opacity: 1;   }
  }

  /* 에러 상태 */
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    flex: 1;
    padding: 40px 20px;
    text-align: center;
  }

  .error-state p {
    font: 400 14px/1.5 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #777777);
    margin: 0;
  }

  .error-state button {
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    padding: 10px 24px;
    min-height: 44px;
    font: 700 14px/1 'Noto Sans KR', sans-serif;
    cursor: pointer;
    transition: background 0.15s;
  }

  .error-state button:hover {
    background: var(--cs-purple-hover);
  }
</style>
