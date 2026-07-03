<script lang="ts">
  // PRD.1.7 — MessageBubble: 텍스트·이미지·파일·액션카드 버블
  // Figma: user(left, white) / admin·ai(right, lilac)

  import ActionCard from './ActionCard.svelte'
  import { supabase } from '$lib/services/supabase'
  import type { ChatMessage, ActionPayload } from '$lib/types/chat'

  interface Props {
    message: ChatMessage
    isOwn?: boolean
    onaction?: (payload: ActionPayload) => void
    ondelete?: (messageId: string) => void
  }

  let { message, isOwn = false, onaction, ondelete }: Props = $props()

  // 시간 포맷 HH:MM
  let timeLabel = $derived(
    new Date(message.created_at).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  )

  let isActionCard = $derived(message.message_type === 'action_card' && !!message.action_payload)
  let isSystemMsg  = $derived(message.message_type === 'system')
  let isImage      = $derived(message.message_type === 'image')

  interface AttachmentInfo { name: string; url: string; isImg: boolean }

  // 스토리지 URL 패턴 — Supabase Storage public/signed URL
  const STORAGE_URL_RE = /https?:\/\/[^\s]+supabase[^\s]+(storage|object)[^\s]+/i

  let attachment = $derived.by<AttachmentInfo | null>(() => {
    if (!message.content) return null
    const c = message.content

    // 이미지 타입 첨부
    if (isImage) {
      const parts = c.split('\n')
      return { name: parts[0] ?? '', url: parts[1] ?? parts[0], isImg: true }
    }
    // 구형 [이미지] 포맷 호환
    if (c.startsWith('[이미지] ')) {
      const parts = c.replace('[이미지] ', '').split('\n')
      return { name: parts[0], url: parts[1] ?? parts[0], isImg: true }
    }
    // 파일 첨부: "파일명\nURL" 형식 (message_type = 'text' + 스토리지 URL 포함)
    if (c.includes('\n') && STORAGE_URL_RE.test(c)) {
      const idx = c.indexOf('\n')
      const name = c.slice(0, idx).trim()
      const url = c.slice(idx + 1).trim()
      const isImg = /\.(jpe?g|png|gif|webp|bmp|svg)(\?|$)/i.test(url)
      if (name && url) return { name, url, isImg }
    }
    return null
  })

  // Private 버킷 → Signed URL (이미지·파일 공통, 1시간 유효)
  let signedUrl = $state<string | null>(null)

  function extractStoragePath(rawUrl: string): string | null {
    // 이미 signed URL이면 그대로
    if (rawUrl.includes('/storage/v1/object/sign/')) return null
    let urlPath: string
    try {
      urlPath = new URL(rawUrl).pathname
    } catch {
      urlPath = rawUrl.split('?')[0]
    }
    const match = urlPath.match(/\/chat-attachments\/(.+)$/)
    if (!match) return null
    return decodeURIComponent(match[1])
  }

  $effect(() => {
    if (!attachment) { signedUrl = null; return }
    const rawUrl = attachment.url
    // 이미 signed URL이면 그대로 사용
    if (rawUrl.includes('/storage/v1/object/sign/')) {
      signedUrl = rawUrl
      return
    }
    const storagePath = extractStoragePath(rawUrl)
    if (!storagePath) return
    supabase.storage
      .from('chat-attachments')
      .createSignedUrl(storagePath, 3600)
      .then(({ data }) => {
        if (data?.signedUrl) signedUrl = data.signedUrl
      })
  })

  // 파일뷰어 오버레이
  let viewerOpen = $state(false)

  function openViewer() { viewerOpen = true }
  function closeViewer() { viewerOpen = false }

  function handleViewerKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeViewer()
  }

  // 파일 확장자 라벨
  function fileExt(name: string): string {
    return name.split('.').pop()?.toUpperCase() ?? 'FILE'
  }

  // 삭제 확인
  function handleDelete() {
    if (confirm('이 메시지를 삭제하시겠습니까?')) {
      ondelete?.(message.id)
    }
  }
</script>

{#if isSystemMsg}
  <div class="system-msg" role="status">
    <span>{message.content}</span>
  </div>

{:else if attachment}
  <!-- 첨부파일 버블 -->
  <div class="bubble-row" class:bubble-row--own={isOwn}>
    <div class="bubble bubble--attach" class:bubble--own={isOwn} class:bubble--other={!isOwn}>

      <!-- 이미지 썸네일 -->
      {#if attachment.isImg}
        <button class="thumb-btn" onclick={openViewer} aria-label="{attachment.name} 크게 보기">
          {#if signedUrl}
            <img src={signedUrl} alt={attachment.name} class="thumb-img" loading="lazy" />
          {:else}
            <div class="thumb-placeholder" aria-label="이미지 로딩 중...">
              <span class="thumb-loading">⏳</span>
            </div>
          {/if}
        </button>
      {:else}
        <!-- 파일 아이콘 -->
        <button class="file-btn" onclick={openViewer} aria-label="{attachment.name} 보기">
          <div class="file-icon">
            <span class="file-ext">{fileExt(attachment.name)}</span>
          </div>
          <span class="file-name">{attachment.name}</span>
        </button>
      {/if}

      <div class="bubble-status">
        <span class="bubble-time">{timeLabel}</span>
        <svg class="done-double" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-label={message.is_read ? '읽음' : '전송됨'}>
          <path d="M1 8.5l2.8 2.8L8 5" stroke={message.is_read ? 'var(--cs-purple)' : 'var(--cs-text-light,#aaa)'} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M5 8.5l2.8 2.8L13 5" stroke={message.is_read ? 'var(--cs-purple)' : 'var(--cs-text-light,#aaa)'} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        {#if isOwn && ondelete}
          <button class="del-btn" onclick={handleDelete} aria-label="메시지 삭제">✕</button>
        {/if}
      </div>
    </div>
  </div>

  <!-- 파일뷰어 오버레이 -->
  {#if viewerOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div
      class="viewer-backdrop"
      onclick={closeViewer}
      onkeydown={handleViewerKeydown}
      role="dialog"
      aria-modal="true"
      aria-label="파일 보기"
      tabindex="-1"
    >
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="viewer-box" onclick={(e) => e.stopPropagation()}>
        <div class="viewer-header">
          <span class="viewer-title">{attachment.name}</span>
          <div class="viewer-actions">
            {#if !isOwn}
              <!-- 관리자: 다운로드 -->
              <a
                href={signedUrl || attachment.url}
                download={attachment.name}
                class="viewer-btn viewer-btn--dl"
                aria-label="다운로드"
              >↓ 다운로드</a>
            {/if}
            <button class="viewer-btn viewer-btn--close" onclick={closeViewer} aria-label="닫기">✕</button>
          </div>
        </div>

        {#if attachment.isImg}
          <div class="viewer-img-wrap">
            <img src={signedUrl || attachment.url} alt={attachment.name} class="viewer-img" />
          </div>
        {:else}
          <div class="viewer-file-wrap">
            <div class="viewer-file-icon">{fileExt(attachment.name)}</div>
            <p class="viewer-file-name">{attachment.name}</p>
            <a href={signedUrl || attachment.url} target="_blank" rel="noopener noreferrer" class="viewer-open-btn">
              새 탭에서 열기
            </a>
          </div>
        {/if}
      </div>
    </div>
  {/if}

{:else}
  <!-- 일반 텍스트·액션카드 버블 -->
  <div class="bubble-row" class:bubble-row--own={isOwn}>
    <div class="bubble" class:bubble--own={isOwn} class:bubble--other={!isOwn}>
      {#if isActionCard && message.action_payload}
        <ActionCard payload={message.action_payload} {onaction} />
      {/if}
      {#if message.content}
        <p class="bubble-text">{message.content}</p>
      {/if}
      <div class="bubble-status">
        <span class="bubble-time">{timeLabel}</span>
        <svg class="done-double" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-label={message.is_read ? '읽음' : '전송됨'}>
          <path d="M1 8.5l2.8 2.8L8 5" stroke={message.is_read ? 'var(--cs-purple)' : 'var(--cs-text-light,#aaa)'} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M5 8.5l2.8 2.8L13 5" stroke={message.is_read ? 'var(--cs-purple)' : 'var(--cs-text-light,#aaa)'} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ── 공통 버블 행 ── */
  .bubble-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding-right: 50px;
    width: 100%;
    flex-shrink: 0;
  }
  .bubble-row--own {
    align-items: flex-end;
    padding-right: 0;
    padding-left: 50px;
  }

  /* ── 버블 본체 ── */
  .bubble {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 15px 20px;
    border-radius: var(--radius-md);
    max-width: 100%;
  }
  .bubble--own   { background: var(--cs-white); gap: 20px; }
  .bubble--other { background: var(--cs-lilac); }

  /* 첨부 버블: padding 줄임 */
  .bubble--attach { padding: 10px; gap: 6px; }

  /* ── 이미지 썸네일 ── */
  .thumb-btn {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    border-radius: var(--radius-sm);
    overflow: hidden;
    display: block;
    max-width: 200px;
  }
  .thumb-img {
    width: 100%;
    max-width: 200px;
    max-height: 160px;
    object-fit: cover;
    display: block;
    border-radius: var(--radius-sm);
    transition: opacity 0.15s;
  }
  .thumb-btn:hover .thumb-img { opacity: 0.85; }
  .thumb-placeholder {
    width: 200px;
    height: 120px;
    background: var(--cs-lilac);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .thumb-loading { font-size: 24px; }

  /* ── 파일 아이콘 버튼 ── */
  .file-btn {
    background: rgba(59,47,138,0.08);
    border: none;
    border-radius: var(--radius-sm);
    padding: 12px 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    transition: background 0.15s;
  }
  .file-btn:hover { background: rgba(59,47,138,0.15); }
  .file-icon {
    width: 36px;
    height: 36px;
    background: var(--cs-purple);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .file-ext {
    font: 700 9px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-white);
    letter-spacing: 0;
  }
  .file-name {
    font: 700 12px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-dark);
    word-break: break-all;
    text-align: left;
  }

  /* ── 버블 상태 행 ── */
  .bubble-status {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    width: 100%;
  }
  .bubble-time {
    font: 400 12px/16px 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #777777);
    white-space: nowrap;
  }
  .done-double {
    flex-shrink: 0;
  }
  .del-btn {
    background: none;
    border: none;
    color: var(--cs-text-light, #aaaaaa);
    font-size: 11px;
    cursor: pointer;
    padding: 2px 4px;
    min-height: 20px;
    min-width: 20px;
    border-radius: var(--radius-sm);
    line-height: 1;
    transition: color 0.15s;
  }
  .del-btn:hover { color: var(--cs-red-badge, #FF3535); }

  /* ── 텍스트 버블 ── */
  .bubble-text {
    font: 700 14px/1.5 'Noto Sans KR', sans-serif;
    color: var(--cs-dark);
    letter-spacing: -0.5px;
    margin: 0;
    word-break: break-word;
    white-space: pre-wrap;
  }

  /* ── 시스템 메시지 ── */
  .system-msg {
    display: flex;
    justify-content: center;
    width: 100%;
    padding: 4px 16px;
  }
  .system-msg span {
    font: 400 12px/1.5 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #777777);
    background: rgba(193,187,236,0.4);
    padding: 4px 12px;
    border-radius: var(--radius-full, 9999px);
  }

  /* ── 파일뷰어 오버레이 ── */
  .viewer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: rgba(16,11,50,0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .viewer-box {
    background: var(--cs-white);
    border-radius: var(--radius-xl);
    overflow: hidden;
    max-width: 90vw;
    max-height: 90vh;
    width: 100%;
    display: flex;
    flex-direction: column;
  }

  .viewer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--cs-lilac);
    gap: 12px;
    flex-shrink: 0;
  }
  .viewer-title {
    font: 700 14px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-dark);
    word-break: break-all;
    flex: 1;
  }
  .viewer-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .viewer-btn {
    height: 36px;
    padding: 0 14px;
    border-radius: var(--radius-sm);
    font: 700 12px/1 'Noto Sans KR', sans-serif;
    cursor: pointer;
    border: none;
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
  }
  .viewer-btn--dl {
    background: var(--cs-purple);
    color: var(--cs-white);
    transition: background 0.15s;
  }
  .viewer-btn--dl:hover { background: var(--cs-purple-hover); }
  .viewer-btn--close {
    background: var(--cs-lilac);
    color: var(--cs-text-mid);
    transition: background 0.15s;
  }
  .viewer-btn--close:hover { background: var(--cs-points); }

  /* 이미지 뷰어 */
  .viewer-img-wrap {
    overflow: auto;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: #f0f0f0;
  }
  .viewer-img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: var(--radius-sm);
  }

  /* 파일 뷰어 */
  .viewer-file-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 40px 20px;
  }
  .viewer-file-icon {
    width: 80px;
    height: 80px;
    background: var(--cs-purple);
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    font: 700 16px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-white);
  }
  .viewer-file-name {
    font: 700 14px/1.5 'Noto Sans KR', sans-serif;
    color: var(--cs-dark);
    text-align: center;
    word-break: break-all;
    margin: 0;
  }
  .viewer-open-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 44px;
    padding: 0 24px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border-radius: var(--radius-xl);
    font: 700 14px/1 'Noto Sans KR', sans-serif;
    text-decoration: none;
    transition: background 0.15s;
  }
  .viewer-open-btn:hover { background: var(--cs-purple-hover); }
</style>
