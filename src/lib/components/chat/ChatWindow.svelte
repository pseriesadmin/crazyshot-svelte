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
    findSavedUserMessage,
    sendAttachment,
    deleteMessage,
    subscribeToChatMessages,
    markMessagesRead,
    clearMyChatHistory,
  } from '$lib/services/chatService'
  import { chatStore, pushMessage, setMessages, prependMessages, setActiveSession, removeMessage, markMessageRead, markMessageSendFailed } from '$lib/stores/chat.svelte'
  import { supabase } from '$lib/services/supabase'
  import type { ChatSession, ActionPayload } from '$lib/types/chat'
  import { validateUploadFile, validateUploadFileSize } from '$lib/utils/fileValidation'
  import { csToast } from '$lib/utils/toast'

  interface Props {
    /** 로그인 사용자 정보 (비로그인 시 'test-user') */
    userId: string
    userName: string
    userHandle?: string
    /** 상품·예약 컨텍스트 딥링크 */
    contextType?: string
    contextId?: string
    /** context_type='reservation' 전용 — rental_reservations.id(bigint), context_id(uuid)와 별개 */
    contextReservationId?: number
    onclose?: () => void
  }

  let {
    userId,
    userName,
    userHandle = '',
    contextType,
    contextId,
    contextReservationId,
    onclose,
  }: Props = $props()

  let session = $state<ChatSession | null>(null)
  let isLoading = $state(true)
  let errorMsg = $state<string | null>(null)
  let isSending = $state(false)
  let isUploading = $state(false)

  // 공통 플로팅 채팅 모달을 다른 화면에서 특정 컨텍스트(예: 대여 건)로 열었을 때
  // (openChatWithContext) props보다 chatStore.contextOverride를 우선 사용
  let effectiveContextType = $derived(chatStore.contextOverride?.context_type ?? contextType)
  let effectiveContextId = $derived(chatStore.contextOverride?.context_id ?? contextId)
  let effectiveContextReservationId = $derived(chatStore.contextOverride?.context_reservation_id ?? contextReservationId)

  // 게스트 헤더 모드: 입력 시작 또는 '비회원' 선택 시 'info'로 전환
  let guestMode = $state<'prompt' | 'info'>('prompt')
  function setGuestInfo() { guestMode = 'info' }

  // 세션 ID 앞 8자를 핸들로 표시 (비로그인 식별용)
  // 관리자 목록과 동일하게 user_id 앞 8자 표시
  let displayHandle = $derived(
    userHandle || (session ? '#' + session.user_id.slice(0, 8) : '')
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
    // effective* 값은 반드시 첫 await 이전(동기 구간)에 읽어야 $effect가 override 변경을
    // 추적해 재실행함 — ensureAuth() 뒤로 옮기면 추적이 끊긴다
    const ctxType = effectiveContextType
    const ctxId = effectiveContextId
    const ctxResId = effectiveContextReservationId

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
    let { session: existing, error } = await loadUserSession(ctxType, ctxId, ctxResId)
    if (error) {
      errorMsg = '채팅을 불러오는 데 실패했습니다.'
      isLoading = false
      return
    }

    // 관리자 RLS bypass 2차 방어: loadUserSession이 타 사용자 세션을 반환하면 무시
    const { data: { session: authSession } } = await supabase.auth.getSession()
    const currentUid = authSession?.user.id
    if (existing && currentUid && existing.user_id !== currentUid) {
      existing = null
    }

    if (!existing || existing.status === 'closed') {
      // 세션 없거나 종료됨 → 서버에서 closed 재활성화 또는 신규 생성
      const created = await createChatSession({ context_type: ctxType as never, context_id: ctxId, context_reservation_id: ctxResId })
      if (created.error || !created.session) {
        errorMsg = created.error ?? '세션 생성 실패'
        isLoading = false
        return
      }
      existing = created.session
    }

    session = existing
    setActiveSession(existing.id)

    // 예약 컨텍스트 세션이면 "예약코드·대표 상품명·대여기간" 요약 대화카드가 기본으로 있도록
    // 보장 — 새로 만든 세션·기존에 열려 있던 세션 둘 다 이 경로를 통과하므로 항상 호출한다
    // (이미 카드가 있으면 서버에서 idempotent하게 아무 것도 안 함). 메시지 로드 전에 await해
    // 첫 렌더부터 카드가 보이게 한다.
    if (existing.context_type === 'reservation' && existing.context_reservation_id) {
      await fetch(`/api/chat/sessions/${existing.id}/reservation-card`, { method: 'POST' }).catch(() => {})
    }

    // 기존 메시지 로드 (2026-08-15: 전체 히스토리 무조건 로드 → 최근 20개만 우선 로드로 변경)
    const { messages: hist, hasMore } = await loadMessages(existing.id, { clearedAt: existing.customer_cleared_at })
    setMessages(hist)
    chatStore.hasMoreOlderMessages = hasMore

    // 받은 메시지(admin, ai)만 읽음 처리 — 본인 메시지는 상대방이 읽어야 활성화
    await markMessagesRead(existing.id, ['admin', 'ai'])

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
        // admin·ai 메시지가 도착했을 때만 읽음 처리
        markMessagesRead(session!.id, ['admin', 'ai'])
      },
      (messageId) => {
        // 상대방이 내 메시지를 읽었을 때 → 로컬 버블 아이콘 즉시 업데이트
        markMessageRead(messageId)
      }
    )

    return unsubscribe
  })

  // MessageList가 위로 스크롤해 상단 근처에 닿으면 호출 — 현재 가장 오래된 메시지 이전 페이지 조회
  async function handleLoadMoreOlderMessages(): Promise<void> {
    const sid = session?.id
    const oldest = messages[0]
    if (!sid || !oldest || chatStore.isLoadingOlderMessages || !chatStore.hasMoreOlderMessages) return

    chatStore.isLoadingOlderMessages = true
    try {
      const { messages: older, hasMore } = await loadMessages(sid, { beforeCreatedAt: oldest.created_at, clearedAt: session?.customer_cleared_at })
      if (session?.id !== sid) return // 로딩 중 세션이 바뀌었으면 결과 버림(stale)
      prependMessages(older)
      chatStore.hasMoreOlderMessages = hasMore
    } finally {
      chatStore.isLoadingOlderMessages = false
    }
  }

  // 내 대화목록 삭제 — 고객 화면에서만 숨기고(관리자 상담 히스토리 보존) 이후 새 메시지는 같은 세션에 이어서 쌓인다
  async function handleClearHistory(): Promise<void> {
    const { error } = await clearMyChatHistory()
    if (error) throw new Error(error)
    if (session) session = { ...session, customer_cleared_at: new Date().toISOString() }
    setMessages([])
    chatStore.hasMoreOlderMessages = false
  }

  // ── 메시지 전송 ──
  // 일시적 실패(네트워크·서버 5xx)는 사용자에게 알리기 전에 조용히 다시 시도한다. 그래도 안 되면 오류 문구 대신
  // 내 말풍선에 "다시 보내기"만 남긴다(입력한 내용이 사라지지 않게). 재시도 전에는 이미 저장됐는지 확인해 중복 전송을 막는다.
  const RETRY_DELAYS_MS = [700, 1500]
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  async function handleSend(content: string) {
    if (!session || isSending) return
    isSending = true
    const sessionId = session.id
    const sinceISO = new Date(Date.now() - 3000).toISOString()

    // 낙관적(optimistic) 렌더링 — 서버 응답(AI 답변 생성 포함) 완료 전에 내 메시지 즉시 표시
    const tempId = `temp-${crypto.randomUUID()}`
    pushMessage({
      id: tempId,
      session_id: sessionId,
      sender_type: 'user',
      content,
      message_type: 'text',
      action_payload: null,
      is_read: false,
      created_at: new Date().toISOString(),
    })

    let failed = false
    try {
      let result = await sendMessage({ session_id: sessionId, content })

      for (let i = 0; result.error && result.retryable && i < RETRY_DELAYS_MS.length; i++) {
        // 서버가 내 메시지를 저장한 뒤 오류를 돌려줬다면(예: AI 답변 저장 단계 실패) 다시 보내지 않는다
        const saved = await findSavedUserMessage(sessionId, content, sinceISO)
        if (saved) {
          removeMessage(tempId)
          pushMessage(saved)
          errorMsg = null
          return
        }
        await wait(RETRY_DELAYS_MS[i])
        result = await sendMessage({ session_id: sessionId, content })
      }

      if (result.error) {
        console.error('[chat] 메시지 전송 실패:', result.error)
        failed = true
      } else if (result.response) {
        removeMessage(tempId)
        // Realtime으로 이미 수신될 수 있으나 fallback으로 직접 push
        pushMessage(result.response.user_message)
        if (result.response.ai_message) pushMessage(result.response.ai_message)
        errorMsg = null
      }
    } finally {
      if (failed) markMessageSendFailed(tempId)
      else removeMessage(tempId)
      isSending = false
    }
  }

  // 실패한 내 메시지의 "다시 보내기" — 실패 말풍선을 치우고 같은 내용을 새로 전송
  function handleResend(messageId: string) {
    const failedMsg = chatStore.messages.find((m) => m.id === messageId)
    if (!failedMsg?.content) return
    removeMessage(messageId)
    void handleSend(failedMsg.content)
  }

  // ── 파일 업로드 ──
  async function handleAttach(file: File) {
    if (!session || isUploading) return

    // front-uiux.md §15-3·§15-1a 표준 — 업로드 시도 전 MIME·용량 클라이언트 검증(2026-09-08)
    const typeCheck = validateUploadFile(file)
    if (!typeCheck.ok) {
      csToast.error(typeCheck.error ?? '허용되지 않는 파일 형식입니다.')
      return
    }
    const sizeCheck = validateUploadFileSize(file)
    if (!sizeCheck.ok) {
      csToast.error(sizeCheck.error ?? '파일 크기가 너무 큽니다.')
      return
    }

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

  // 모바일: 헤더·입력 영역이 대화 목록 위에 반투명하게 덮인다(2026-10-09, Stephen 지시) — 목록이 그 뒤로 지나가도록 목록 위·아래 여백을 두 영역의 실제 높이로 맞춘다
  let overlayTopH = $state(0)
  let overlayBottomH = $state(0)

  // ── 액션 카드 핸들러 ──
  function handleAction(payload: ActionPayload) {
    void payload
  }
</script>

<!-- Figma node 2497:8691: bg #E1DEF3, border-radius 30px, flex-col -->
<div
  class="chat-window"
  style:--chat-overlay-top={overlayTopH ? `${overlayTopH}px` : undefined}
  style:--chat-overlay-bottom={overlayBottomH ? `${overlayBottomH}px` : undefined}
>
  <!-- 헤더 (모바일: 대화 목록 위에 겹치는 반투명 영역 / PC: display: contents로 기존 배치 그대로) -->
  <div class="overlay-top" bind:clientHeight={overlayTopH}>
    <ChatHeader {userId} {userName} userHandle={displayHandle} {guestMode} onGuestInfo={setGuestInfo} {onclose} onclear={handleClearHistory} />
  </div>

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
    <MessageList
      {messages}
      currentUserId={userId}
      onaction={handleAction}
      ondelete={handleDeleteMessage}
      hasMoreOlder={chatStore.hasMoreOlderMessages}
      isLoadingOlder={chatStore.isLoadingOlderMessages}
      awaitingReply={isSending}
      onresend={handleResend}
      onloadmore={handleLoadMoreOlderMessages}
    />
  {/if}

  <!-- 입력 바 (모바일: 대화 목록 위에 겹치는 반투명 영역) -->
  <div class="overlay-bottom" bind:clientHeight={overlayBottomH}>
    <ChatInput
      disabled={isSending || isLoading || isUploading || !session}
      placeholder={isUploading ? '업로드 중...' : isSending ? '응답 중...' : '메시지를 입력하세요...'}
      onsend={handleSend}
      onattach={handleAttach}
      oninputstart={setGuestInfo}
    />
  </div>
</div>

<style>
  /* Figma node 2497:8691 — 00-1.chat: px-20 py-30 gap-30 */
  .chat-window {
    --chat-bg: #e1def3; /* 아래 오버레이 영역과 같은 색을 공유 */
    background: var(--chat-bg); /* Figma: purple-op-10% — CSS 변수 미등록 색상 */
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

  /* PC·기본: 래퍼는 레이아웃에 참여하지 않는다(기존 배치 그대로) */
  .overlay-top,
  .overlay-bottom {
    display: contents;
  }

  /* 모바일(<640px) — 헤더·입력 영역을 대화 목록 위에 겹치고 배경을 50% 알파로 덮어, 대화 목록이 그 뒤로 지나가는 모습이 비쳐 보이게 한다.
     목록 자체는 시트 전체 높이를 쓰고, 위·아래 여백(--chat-overlay-top/bottom)으로 처음/마지막 말풍선이 영역에 가리지 않게 한다. */
  @media (max-width: 639px) {
    .chat-window {
      position: relative;
      padding: 0;
      gap: 0;
    }
    .overlay-top,
    .overlay-bottom {
      display: block;
      position: absolute;
      left: 0;
      right: 0;
      z-index: 3;
      padding: 20px;
      box-sizing: border-box;
      background: color-mix(in srgb, var(--chat-bg) 50%, transparent);
    }
    .overlay-top { top: 0; }
    .overlay-bottom { bottom: 0; }
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
