<script lang="ts">
  // CMS 관리자 채팅 패널
  // 좌측: 세션 목록 / 우측: 선택된 세션 대화창

  import MessageList from './MessageList.svelte'
  import ChatInput from './ChatInput.svelte'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import {
    loadAdminSessions,
    subscribeToSessions,
    subscribeToChatMessages,
    subscribeToAllMessages,
    loadMessages,
    markMessagesRead,
  } from '$lib/services/chatService'
  import { setSessions, upsertSession, pushMessage, applyIncomingMessagePreview } from '$lib/stores/chat.svelte'
  import { chatStore } from '$lib/stores/chat.svelte'
  import { supabase } from '$lib/services/supabase'
  import type { ChatSession, ChatMessage, ChatSessionStatus } from '$lib/types/chat'

  // 로컬 타입 정의 (routes 크로스-임포트 금지 원칙) — /api/cms/customers/[userId]/summary 응답 형태
  interface CustomerSummary {
    user_id: string
    email: string | null
    member_code: string | null
    membership_grade: string | null
    credit_score: number | null
    blacklisted: boolean
  }

  interface Props {
    initialSessions?: ChatSession[]
    initialSessionId?: string | null
  }

  let { initialSessions = [], initialSessionId = null }: Props = $props()

  // 자동답변 상태 표시 pill (sessions-header)
  let autoReplyEnabled = $state<boolean | null>(null)
  $effect(() => {
    fetch('/api/cms/auto-reply-settings')
      .then((r) => r.ok ? r.json() : null)
      .then((d: { enabled: boolean } | null) => {
        if (d) autoReplyEnabled = d.enabled
      })
      .catch(() => {})
  })

  type FilterTab = 'open' | 'pending' | 'closed'

  let filterTab = $state<FilterTab>('open')
  let selectedSessionId = $state<string | null>(null)
  let messages = $state<ChatMessage[]>([])
  let isSending = $state(false)
  let isUploading = $state(false)
  let isLoadingMessages = $state(false)
  let pendingDeleteId = $state<string | null>(null)
  let isDeleting = $state(false)
  let flashingSessionIds = $state<Set<string>>(new Set())

  // 신규 채팅목록 등장·기존 목록 새 대화 수신/발신 시 카드 배경 점멸 표시 (3회 반복 후 자동 종료)
  function flashSession(sessionId: string): void {
    flashingSessionIds = new Set(flashingSessionIds).add(sessionId)
    setTimeout(() => {
      const next = new Set(flashingSessionIds)
      next.delete(sessionId)
      flashingSessionIds = next
    }, 1900)
  }

  // 세션 목록 초기화 — 마운트 시 1회만 (Realtime이 이후 갱신 담당)
  let storeInitialized = false
  $effect(() => {
    if (!storeInitialized) {
      storeInitialized = true
      setSessions(initialSessions)
      // URL ?session= 딥링크: 해당 세션 자동 선택 + 필터탭 전환
      if (initialSessionId) {
        const target = initialSessions.find((s) => s.id === initialSessionId)
        if (target) {
          if (target.status === 'closed') filterTab = 'closed'
          else if (target.status === 'pending') filterTab = 'pending'
          else filterTab = 'open'
          handleSelectSession(initialSessionId)
        }
      }
    }
  })

  // 전체 세션 Realtime 구독 (INSERT/UPDATE만 — DELETE 방어는 서비스 레이어에서 처리)
  $effect(() => {
    const unsub = subscribeToSessions((session) => {
      const existedBefore = chatStore.sessions.some((s) => s.id === session.id)
      upsertSession(session)
      // 신규 채팅목록(세션) 등장 시 점멸 표시
      if (!existedBefore) flashSession(session.id)
    })
    return unsub
  })

  // 전체 메시지 Realtime 구독 — 목록의 마지막 메시지 미리보기·정렬을 새 메시지 도착 즉시 갱신
  $effect(() => {
    const unsub = subscribeToAllMessages((message) => {
      applyIncomingMessagePreview(message)
      // 기존 채팅목록에 새 대화(수신/발신) 도착 시 점멸 표시
      flashSession(message.session_id)
    })
    return unsub
  })

  // auto_pending 주기적 갱신 — 5분마다 API 호출 → auto_pending_inactive_sessions() RPC 트리거
  // open 세션이 1시간 비활성 시 pending으로 자동 전환되는 조건을 수동 새로고침 없이도 반영
  $effect(() => {
    const timer = setInterval(async () => {
      const { sessions } = await loadAdminSessions()
      if (sessions.length > 0) setSessions(sessions)
    }, 5 * 60 * 1000)
    return () => clearInterval(timer)
  })

  // 선택된 세션 메시지 로드 + Realtime 구독
  $effect(() => {
    const sid = selectedSessionId
    if (!sid) { messages = []; return }

    isLoadingMessages = true
    loadMessages(sid).then(({ messages: msgs }) => {
      messages = msgs
      isLoadingMessages = false
      // 사용자 메시지만 읽음 처리 (관리자가 확인함)
      markMessagesRead(sid, ['user'])
    })

    const unsub = subscribeToChatMessages(
      sid,
      (msg) => {
        const already = messages.some((m) => m.id === msg.id)
        if (!already) messages = [...messages, msg]
        // 새 사용자 메시지 도착 시 즉시 읽음 처리 (관리자 패널 열려 있음)
        markMessagesRead(sid, ['user'])
      },
      (messageId) => {
        // 관리자가 보낸 메시지를 사용자가 읽었을 때 → 로컬 is_read 즉시 반영
        messages = messages.map((m) =>
          m.id === messageId ? { ...m, is_read: true } : m
        )
      }
    )
    return unsub
  })

  let filteredSessions = $derived(
    chatStore.sessions.filter((s) => s.status === filterTab)
  )

  let selectedSession = $derived(
    chatStore.sessions.find((s) => s.id === selectedSessionId) ?? null
  )

  // 고객 기본정보 요약 (chat-header 노출용) — 선택된 세션의 user_id가 바뀔 때만 재조회
  let customerSummary = $state<CustomerSummary | null>(null)
  $effect(() => {
    const uid = selectedSession?.user_id
    if (!uid) { customerSummary = null; return }
    customerSummary = null
    fetch(`/api/cms/customers/${uid}/summary`)
      .then((r) => r.ok ? r.json() : null)
      .then((d: CustomerSummary | null) => { customerSummary = d })
      .catch(() => { customerSummary = null })
  })

  const GRADE_LABEL: Record<string, string> = {
    none: 'NONE', easy: 'EASY', pop: 'POP', crazy: 'CRAZY', admin: 'ADMIN',
  }

  function scoreClass(score: number): string {
    if (score >= 85) return 'score-high'
    if (score >= 70) return 'score-mid'
    if (score >= 50) return 'score-low'
    return 'score-critical'
  }

  async function handleSelectSession(sid: string): Promise<void> {
    selectedSessionId = sid
    // 세션 입장 API — admin_id 배정
    await fetch(`/api/chat/sessions/${sid}/join`, { method: 'POST' })
  }

  async function handleSend(content: string, cannedResponseId?: string): Promise<void> {
    if (!selectedSessionId || isSending) return
    isSending = true
    try {
      const res = await fetch('/api/chat/admin-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: selectedSessionId,
          content,
          // §E SYN-8: 캔드 리스폰스에서 비롯된 발신일 때만 포함 (undefined면 키 미포함)
          ...(cannedResponseId ? { canned_response_id: cannedResponseId } : {}),
        }),
      })
      if (res.ok) {
        const { message } = await res.json()
        if (message) {
          const already = messages.some((m) => m.id === message.id)
          if (!already) messages = [...messages, message]
        }
      }
    } finally {
      isSending = false
    }
  }

  async function handleAdminAttach(file: File): Promise<void> {
    if (!selectedSessionId || isUploading) return
    isUploading = true
    try {
      const ext = file.name.split('.').pop() ?? 'bin'
      const path = `${selectedSessionId}/${Date.now()}_admin.${ext}`

      const { data, error: uploadErr } = await supabase.storage
        .from('chat-attachments')
        .upload(path, file, { upsert: false })

      if (uploadErr || !data) {
        return
      }

      const { data: { publicUrl } } = supabase.storage
        .from('chat-attachments')
        .getPublicUrl(data.path)

      const is_image = file.type.startsWith('image/')
      const res = await fetch('/api/chat/admin-attachment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: selectedSessionId,
          file_name: file.name,
          file_url: publicUrl,
          is_image,
        }),
      })

      if (res.ok) {
        const { message } = await res.json()
        if (message) {
          const already = messages.some((m: ChatMessage) => m.id === message.id)
          if (!already) messages = [...messages, message]
        }
      }
    } finally {
      isUploading = false
    }
  }

  async function handleCloseSession(sid: string): Promise<void> {
    const res = await fetch(`/api/chat/sessions/${sid}/close`, { method: 'POST' })
    if (res.ok) {
      // 로컬 세션 상태 즉시 반영 (Realtime이 갱신하기 전 선제 처리)
      const updated = chatStore.sessions.find((s) => s.id === sid)
      if (updated) upsertSession({ ...updated, status: 'closed' as ChatSessionStatus })
      // 닫은 세션이 현재 선택된 경우 선택 해제
      if (selectedSessionId === sid) selectedSessionId = null
    }
  }

  async function handleRefresh(): Promise<void> {
    const { sessions } = await loadAdminSessions()
    setSessions(sessions)
  }

  function handleDeleteRequest(e: MouseEvent, sid: string): void {
    e.stopPropagation()
    pendingDeleteId = sid
  }

  async function handleDeleteConfirm(): Promise<void> {
    if (!pendingDeleteId || isDeleting) return
    isDeleting = true
    try {
      const res = await fetch(`/api/chat/sessions/${pendingDeleteId}`, { method: 'DELETE' })
      if (res.ok) {
        // 로컬 목록에서 즉시 제거
        const updated = chatStore.sessions.filter((s) => s.id !== pendingDeleteId)
        setSessions(updated)
        if (selectedSessionId === pendingDeleteId) selectedSessionId = null
      }
    } finally {
      isDeleting = false
      pendingDeleteId = null
    }
  }

  function handleDeleteCancel(): void {
    pendingDeleteId = null
  }

  function formatDateTime(iso: string): string {
    const d = new Date(iso)
    const yyyy = d.getFullYear()
    const mm = (d.getMonth() + 1).toString().padStart(2, '0')
    const hh = d.getHours().toString().padStart(2, '0')
    const mi = d.getMinutes().toString().padStart(2, '0')
    return `${yyyy}.${mm}  ${hh}:${mi}`
  }

  function lastMessagePreview(session: ChatSession): string {
    const content = session.last_message_content
    if (!content) return ''
    return content.length > 30 ? content.slice(0, 30) + '…' : content
  }

  function sessionLabel(s: ChatSession): string {
    if (s.user_name) return s.user_name
    if (s.user_handle) return s.user_handle
    return `익명 ${s.user_id.slice(0, 8)}`
  }

  // 아바타 이니셜 2자 추출 (ChatHeader.svelte 고객용 아바타와 동일 로직)
  function initialsOf(name: string): string {
    if (!name) return '?'
    return name.trim().split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '?'
  }

  const STATUS_LABEL: Record<FilterTab, string> = {
    open: '진행중',
    pending: '대기',
    closed: '종료',
  }
</script>

<div class="admin-panel">
  <!-- 좌측: 세션 목록 -->
  <aside class="sessions-pane">
    <div class="sessions-header">
      <h2 class="pane-title">상담 세션</h2>
      {#if autoReplyEnabled !== null}
        <a
          href="/cms/chat/qna"
          class="ar-pill"
          class:ar-pill--on={autoReplyEnabled}
          title="자동답변 설정 바로가기"
          aria-label="자동답변 {autoReplyEnabled ? 'ON' : 'OFF'} — QnA 설정으로 이동"
        >자동답변 {autoReplyEnabled ? 'ON' : 'OFF'}</a>
      {/if}
      <button class="refresh-btn" onclick={handleRefresh} aria-label="새로고침">↻</button>
    </div>

    <div class="filter-tabs" role="tablist">
      {#each (['open', 'pending', 'closed'] as FilterTab[]) as tab}
        <button
          role="tab"
          class="filter-tab"
          class:active={filterTab === tab}
          onclick={() => filterTab = tab}
          aria-selected={filterTab === tab}
        >
          {STATUS_LABEL[tab]}
          <span class="tab-count" class:count-open={tab === 'open'} class:count-etc={tab !== 'open'}>{chatStore.sessions.filter(s => s.status === tab).length}</span>
        </button>
      {/each}
    </div>

    <ul class="session-list" role="listbox" aria-label="채팅 세션 목록">
      {#if filteredSessions.length === 0}
        <li class="empty-sessions">세션 없음</li>
      {:else}
        {#each filteredSessions as session (session.id)}
          <li>
            <div
              class="session-card"
              class:selected={session.id === selectedSessionId}
              class:flash={flashingSessionIds.has(session.id)}
              onclick={() => handleSelectSession(session.id)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSelectSession(session.id) }}
              role="option"
              tabindex="0"
              aria-selected={session.id === selectedSessionId}
            >
              <div class="sc-top">
                <span class="sc-name">{sessionLabel(session)}</span>
                {#if session.is_urgent}
                  <span class="urgent-badge">긴급</span>
                {/if}
                {#if session.last_message_sender === 'user' || session.last_message_sender === 'ai'}
                  <span class="msg-dir-badge msg-dir-in" aria-label="수신">
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M10 2L2 10M2 10V4M2 10H8" stroke="#FF3535" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>
                {:else if session.last_message_sender === 'admin'}
                  <span class="msg-dir-badge msg-dir-out" aria-label="발신">
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M2 10L10 2M10 2V8M10 2H4" stroke="#AAAAAA" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>
                {/if}
                {#if filterTab === 'open' || filterTab === 'pending'}
                  <button
                    class="close-session-btn"
                    onclick={(e) => { e.stopPropagation(); handleCloseSession(session.id) }}
                    aria-label="채팅 종료"
                    title="채팅 종료"
                  >✕</button>
                {:else if filterTab === 'closed'}
                  <button
                    class="delete-session-btn"
                    onclick={(e) => handleDeleteRequest(e, session.id)}
                    aria-label="채팅 삭제"
                    title="완전 삭제"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6M14,11v6"/><path d="M9,6V4h6v2"/></svg>
                  </button>
                {/if}
              </div>
              <div class="sc-mid">
                <span class="sc-last-msg">{lastMessagePreview(session)}</span>
              </div>
              <div class="sc-bottom">
                <span class="sc-time">{formatDateTime(session.updated_at)}</span>
                {#if (session.unread_count ?? 0) > 0}
                  <span class="unread-badge">{session.unread_count}</span>
                {/if}
              </div>
            </div>
          </li>
        {/each}
      {/if}
    </ul>
  </aside>

  <!-- 우측: 대화창 -->
  <section class="chat-pane">
    {#if !selectedSession}
      <div class="no-session">
        <svg xmlns="http://www.w3.org/2000/svg" width="70" height="70" viewBox="0 0 70 70" fill="none" aria-hidden="true" class="no-session-icon">
          <path d="M70 35C70 54.33 54.33 70 35 70C15.67 70 0 54.33 0 35C0 15.67 15.67 0 35 0C54.33 0 70 15.67 70 35Z" fill="#3B2F8A"/>
          <path d="M13.9998 38.532C13.9998 45.7036 23.1602 54.2198 29.7378 54.2198C33.566 54.2198 25.1998 50.7339 29.3125 49.2893C31.7471 48.4342 37.8196 45.7036 37.8196 38.532C37.8196 31.3604 32.29 26.43 25.9097 26.43C19.5294 26.43 13.9998 31.3604 13.9998 38.532Z" fill="#C494FE"/>
          <path d="M56.6772 31.0672C56.6772 39.7986 44.9667 50.1671 36.558 50.1671C31.6641 50.1671 42.3592 45.9231 37.1017 44.1643C33.9894 43.1231 26.2265 39.7986 26.2265 31.0672C26.2265 22.3358 33.2954 16.333 41.4518 16.333C49.6083 16.333 56.6772 22.3358 56.6772 31.0672Z" fill="white"/>
        </svg>
        <p class="no-session-text">상담 세션을 선택하세요.</p>
      </div>
    {:else}
      <div class="chat-header">
        <div class="chat-avatar" aria-hidden="true">
          <span class="chat-avatar-initials">{initialsOf(sessionLabel(selectedSession))}</span>
        </div>

        <div class="chat-header-info">
          <div class="chat-header-top">
            <span class="chat-user">{sessionLabel(selectedSession)}</span>
            <span class="chat-status status-{selectedSession.status}">{STATUS_LABEL[selectedSession.status as FilterTab]}</span>
          </div>

          <!-- 고객 기본정보 요약 -->
          {#if customerSummary}
            <div class="customer-strip">
              {#if customerSummary.email}
                <span class="cs-item cs-email">{customerSummary.email}</span>
              {/if}
              {#if customerSummary.member_code}
                <span class="cs-item cs-code">{customerSummary.member_code}</span>
              {/if}
              {#if customerSummary.membership_grade}
                <span class="grade-badge grade-{customerSummary.membership_grade}">
                  {GRADE_LABEL[customerSummary.membership_grade] ?? customerSummary.membership_grade.toUpperCase()}
                </span>
              {/if}
              {#if customerSummary.credit_score !== null}
                <span class="cs-score {scoreClass(customerSummary.credit_score)}">
                  크레이지스코어 {customerSummary.credit_score}점
                </span>
              {/if}
              {#if customerSummary.blacklisted}
                <span class="badge-danger">블랙리스트</span>
              {/if}
              <a
                class="cs-detail-link"
                href="/cms/customers?selected={customerSummary.user_id}"
                aria-label="고객 정보 화면으로 이동"
                title="고객 정보 화면으로 이동"
              >
                <ChevronIcon size={10} color="currentColor" direction="right" />
              </a>
            </div>
          {/if}
        </div>
      </div>

      <div class="chat-messages">
        {#if isLoadingMessages}
          <div class="loading-msgs">메시지 로딩 중...</div>
        {:else}
          <MessageList
            messages={messages.filter((m) => m.sender_type !== 'ai')}
            currentUserId="admin"
            isAdmin={true}
          />
        {/if}
      </div>

      <div class="chat-input-wrap">
        <ChatInput
          isAdmin={true}
          placeholder={isUploading ? '업로드 중...' : '관리자 답변을 입력하세요...'}
          disabled={isSending || isUploading}
          onsend={handleSend}
          onattach={handleAdminAttach}
        />
      </div>
    {/if}
  </section>
</div>

<!-- 완전 삭제 확인 토스트 -->
{#if pendingDeleteId}
  <div
    class="toast-backdrop"
    role="presentation"
    onclick={handleDeleteCancel}
    onkeydown={(e) => { if (e.key === 'Escape') handleDeleteCancel() }}
  >
    <div
      class="confirm-toast"
      role="alertdialog"
      aria-modal="true"
      aria-label="채팅 완전 삭제 확인"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === 'Escape') handleDeleteCancel() }}
    >
      <p class="toast-msg">완전히 삭제합니까?</p>
      <p class="toast-sub">삭제된 대화 내역은 복구할 수 없습니다.</p>
      <div class="toast-actions">
        <button class="toast-cancel" onclick={handleDeleteCancel} disabled={isDeleting}>취소</button>
        <button class="toast-confirm" onclick={handleDeleteConfirm} disabled={isDeleting}>
          {#if isDeleting}삭제 중...{:else}확인{/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .admin-panel {
    display: flex;
    height: 100%;
    overflow: hidden;
    background: var(--cs-lilac);
  }

  /* ── 세션 목록 사이드 ── */
  .sessions-pane {
    width: 450px;
    flex-shrink: 0;
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    margin: 16px 0 16px 16px;
  }

  .sessions-header {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px 16px 12px;
    flex-shrink: 0;
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg) var(--cms-radius-lg) 0 0;
    position: relative;
  }

  .pane-title {
    font: var(--text-m-title-18B);
    color: var(--cs-dark);
    margin: 0;
  }

  /* 자동답변 ON/OFF 상태 pill */
  .ar-pill {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    height: 22px;
    padding: 0 10px;
    border-radius: var(--radius-full, 99px);
    font: 700 10px/22px 'Noto Sans KR', sans-serif;
    background: var(--cs-surface-gray, #f6f6f6);
    color: var(--cs-text-light, #aaa);
    text-decoration: none;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s;
  }
  .ar-pill--on {
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
  }
  .ar-pill:hover { opacity: 0.8; }

  .refresh-btn {
    position: absolute;
    right: 12px;
    background: transparent;
    border: none;
    font-size: 18px;
    color: var(--cs-text-mid);
    cursor: pointer;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    min-height: 44px;
    min-width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s;
  }
  .refresh-btn:hover { color: var(--cs-dark); }

  .filter-tabs {
    display: flex;
    padding: 0 12px;
    gap: 4px;
    flex-shrink: 0;
    background: var(--cs-white);
    margin: 20px 0;
  }

  .filter-tab {
    flex: 1;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 10px 4px;
    font: var(--text-pc-title-16);
    color: var(--cs-text-mid);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 44px;
    transition: color 0.15s, border-color 0.15s;
  }
  .filter-tab.active {
    color: var(--cs-purple);
    border-bottom-color: var(--cs-purple);
    font-weight: 700;
    background: var(--cs-lilac);
    border-radius: var(--radius-sm);
  }

  .tab-count {
    border-radius: var(--radius-full);
    font-size: 11px;
    font-weight: 700;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .tab-count.count-open { background: var(--cs-red-badge); color: var(--cs-white); opacity: 0.85; }
  .tab-count.count-etc  { background: var(--cs-lilac); color: var(--cs-purple); }

  .session-list {
    flex: 1;
    overflow-y: auto;
    padding: 18px 16px 20px;
    list-style: none;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: var(--cs-white);
    border-radius: 0 0 var(--cms-radius-lg) var(--cms-radius-lg);
  }

  .empty-sessions {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-m-script-14);
    color: var(--cs-text-light);
  }

  .session-card {
    width: 100%;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--cms-radius-md);
    padding: 12px 50px 12px 14px;
    cursor: pointer;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: background 0.15s;
    min-height: 64px;
    position: relative;
  }
  .session-card:hover    { background: var(--cs-lilac); }
  .session-card.selected { background: var(--cs-lilac); }
  .session-card.flash    { animation: session-card-flash 0.6s ease-in-out 3; }

  @keyframes session-card-flash {
    0%, 100% {
      background-color: var(--cs-surface-gray);
      box-shadow: none;
    }
    50% {
      background-color: var(--cs-purple-pale);
      box-shadow: inset 3px 0 0 var(--cs-purple);
    }
  }

  .sc-top {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    gap: 6px;
    min-height: 24px;
    padding-right: 28px;
  }

  .msg-dir-badge {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .msg-dir-in  { background: var(--cs-chat-in-bg); }
  .msg-dir-out { background: var(--cs-surface-gray); }

  .close-session-btn {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    color: var(--cs-text-light);
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    border-radius: var(--radius-sm);
    min-height: 44px;
    min-width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s, color 0.12s;
  }
  .close-session-btn:hover {
    background: var(--cs-red-badge);
    color: var(--cs-white);
  }
  .sc-name {
    font: var(--text-m-script-14B);
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .sc-mid {
    display: flex;
    align-items: center;
  }
  .sc-last-msg {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }
  .sc-bottom {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .sc-time {
    font: var(--text-m-script-12);
    color: var(--cs-text-light);
    flex-shrink: 0;
  }
  .urgent-badge {
    background: var(--cs-red-badge);
    color: var(--cs-white);
    border-radius: var(--radius-full);
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    flex-shrink: 0;
    line-height: 1.5;
  }

  .unread-badge {
    background: var(--cs-red-badge);
    color: var(--cs-white);
    border-radius: var(--radius-full);
    font-size: 11px;
    font-weight: 700;
    padding: 1px 7px;
    min-width: 20px;
    text-align: center;
  }

  /* ── 대화창 ── */
  .chat-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--cs-white);
    margin: 16px;
    border-radius: var(--cms-radius-lg);
  }

  .no-session {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }
  .no-session-icon {
    display: block;
    opacity: 0.85;
  }
  .no-session-text {
    font: var(--text-m-body-16L);
    color: var(--cs-text-light);
    margin: 0;
  }

  .chat-header {
    padding: 20px 24px 16px;
    border-bottom: 1px solid rgba(16,11,50,0.06);
    display: flex;
    align-items: center;
    gap: 30px;
    flex-shrink: 0;
    background: var(--cs-purple-op10);
  }

  /* 48px 원형 아바타 — ChatHeader.svelte 고객용 아바타(65px)와 동일 패턴, CMS 헤더 밀도에 맞춰 축소 */
  .chat-avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--cs-purple);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .chat-avatar-initials {
    font: 700 16px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-white);
    letter-spacing: -0.2px;
  }

  .chat-header-info {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    flex: 1;
  }

  .chat-header-top {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .chat-user {
    font: var(--text-m-title-18B);
    color: var(--cs-dark);
  }

  /* ── 고객 기본정보 요약 ── */
  .customer-strip {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .cs-item {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .cs-email { color: var(--cs-text-mid); }

  .cs-code {
    font-weight: 700;
    color: var(--cs-purple);
    background: var(--cs-purple-op10);
    border-radius: 4px;
    padding: 2px 6px;
  }

  .cs-score {
    font: var(--text-pc-script-12);
    font-weight: 700;
  }
  .cs-score.score-high     { color: var(--cs-success-light); }
  .cs-score.score-mid      { color: var(--cs-text-mid); }
  .cs-score.score-low      { color: var(--cs-warning); }
  .cs-score.score-critical { color: var(--cs-red-badge); }

  .grade-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }
  .grade-none  { background: var(--cs-surface-gray); color: var(--cs-text-mid); }
  .grade-easy  { background: rgba(14,165,233,0.12);  color: var(--cs-info); }
  .grade-pop   { background: rgba(59,47,138,0.10);   color: var(--cs-purple); }
  .grade-crazy { background: rgba(255,69,0,0.12);    color: var(--cs-orange); }
  .grade-admin { background: var(--cs-lilac);        color: var(--cs-purple-dark); }

  .badge-danger {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    background: rgba(255,53,53,0.10);
    color: var(--cs-red-badge);
  }

  /* 심플 화살표 아이콘 버튼 — .refresh-btn과 동일한 표준 아이콘버튼 컨벤션(투명 배경·원형 hover) */
  .cs-detail-link {
    margin-left: auto;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    color: var(--cs-text-mid);
    background: transparent;
    transition: color 0.15s, background 0.15s;
  }
  .cs-detail-link:hover {
    color: var(--cs-purple);
    background: var(--cs-purple-op10);
  }

  .chat-status {
    font: var(--text-m-script-12);
    padding: 3px 10px;
    border-radius: var(--radius-full);
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
  }
  .chat-status.status-open    { background: var(--cs-bg-success); color: var(--cs-text-success); }
  .chat-status.status-pending { background: var(--cs-bg-warning); color: var(--cs-text-warning); }
  .chat-status.status-closed  { background: var(--cs-surface-gray); color: var(--cs-text-light); }

  .chat-messages {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .loading-msgs {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-m-script-14);
    color: var(--cs-text-light);
  }

  .chat-input-wrap {
    padding: 16px 24px 20px;
    flex-shrink: 0;
  }

  /* ── 삭제 버튼 (close-session-btn과 동일 스타일) ── */
  .delete-session-btn {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    color: var(--cs-text-light);
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    border-radius: var(--radius-sm);
    min-height: 44px;
    min-width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s, color 0.12s;
  }
  .delete-session-btn:hover {
    background: rgba(255,53,53,0.08);
    color: var(--cs-red-badge);
  }

  /* ── 완전 삭제 확인 토스트 ── */
  .toast-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(16, 11, 50, 0.35);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 40px;
    z-index: 9000;
  }

  .confirm-toast {
    background: var(--cs-white);
    border-radius: var(--radius-xl);
    padding: 24px 28px 20px;
    width: min(360px, calc(100vw - 40px));
    box-shadow: 0 8px 32px rgba(16, 11, 50, 0.18);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .toast-msg {
    font: var(--text-m-body-16B);
    color: var(--cs-dark);
    margin: 0;
  }

  .toast-sub {
    font: var(--text-m-script-12);
    color: var(--cs-text-mid);
    margin: 0 0 8px;
  }

  .toast-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .toast-cancel {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-xl);
    padding: 10px 24px;
    font: var(--text-m-script-14B);
    color: var(--cs-text-mid);
    cursor: pointer;
    min-height: 44px;
    transition: background 0.12s;
  }
  .toast-cancel:hover:not(:disabled) { background: var(--cs-lilac); }

  .toast-confirm {
    background: var(--cs-red-badge);
    border: none;
    border-radius: var(--radius-xl);
    padding: 10px 24px;
    font: var(--text-m-script-14B);
    color: var(--cs-white);
    cursor: pointer;
    min-height: 44px;
    transition: opacity 0.12s;
  }
  .toast-confirm:hover:not(:disabled) { opacity: 0.85; }
  .toast-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
  .toast-cancel:disabled  { opacity: 0.5; cursor: not-allowed; }
</style>
