<script lang="ts">
  // GSD-14: P3-2 북마크 목록 뷰
  // 세션별 북마크 목록 — 항목 클릭 시 해당 세션의 메시지로 스크롤 이동

  interface BookmarkItem {
    bookmark_id: string
    message_id: string
    session_id: string
    note: string | null
    created_at: string
    message_content: string | null
    message_type: string
  }

  interface Props {
    sessionId: string | null
    /** 북마크 항목 클릭 시 — 해당 메시지 ID와 세션 ID를 전달 */
    onselect?: (messageId: string, sessionId: string) => void
    onclose?: () => void
  }

  let { sessionId, onselect, onclose }: Props = $props()

  let bookmarks = $state<BookmarkItem[]>([])
  let isLoading = $state(false)

  // sessionId가 바뀌면 북마크 재조회
  $effect(() => {
    if (!sessionId) { bookmarks = []; return }
    isLoading = true
    bookmarks = []
    fetch(`/api/chat/sessions/${sessionId}/bookmarks`)
      .then((r) => r.ok ? r.json() : { bookmarks: [] })
      .then((d: { bookmarks: BookmarkItem[] }) => { bookmarks = d.bookmarks ?? [] })
      .catch(() => { bookmarks = [] })
      .finally(() => { isLoading = false })
  })

  function formatTime(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) +
           ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  function contentPreview(b: BookmarkItem): string {
    if (b.message_type === 'action_card') return '[알림 카드]'
    const c = b.message_content ?? ''
    return c.length > 60 ? c.slice(0, 60) + '…' : c
  }
</script>

<div class="blv" role="region" aria-label="북마크 목록">
  <div class="blv-header">
    <span class="blv-title">북마크</span>
    {#if onclose}
      <button class="blv-close" onclick={onclose} aria-label="북마크 닫기">✕</button>
    {/if}
  </div>

  {#if isLoading}
    <div class="blv-empty">불러오는 중...</div>
  {:else if bookmarks.length === 0}
    <div class="blv-empty">이 세션에 저장된 북마크가 없습니다.</div>
  {:else}
    <ul class="blv-list">
      {#each bookmarks as b (b.bookmark_id)}
        <li>
          <button
            class="blv-item"
            onclick={() => onselect?.(b.message_id, b.session_id)}
            aria-label="북마크된 메시지로 이동"
          >
            <span class="blv-preview">{contentPreview(b)}</span>
            {#if b.note}
              <span class="blv-note">{b.note}</span>
            {/if}
            <span class="blv-time">{formatTime(b.created_at)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .blv {
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    border: 1px solid var(--cs-lilac);
    overflow: hidden;
    min-width: 260px;
  }

  .blv-header {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--cs-lilac);
    background: var(--cs-surface-gray);
  }

  .blv-title {
    font: 700 13px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    flex: 1;
  }

  .blv-close {
    background: transparent;
    border: none;
    color: var(--cs-text-light);
    font-size: 12px;
    cursor: pointer;
    padding: 4px;
    min-height: 28px;
    min-width: 28px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.12s;
  }
  .blv-close:hover { color: var(--cs-red-badge); }

  .blv-empty {
    padding: 20px 14px;
    font: 400 12px/1.5 'Noto Sans KR', sans-serif;
    color: var(--cs-text-light);
    text-align: center;
  }

  .blv-list {
    list-style: none;
    padding: 0;
    margin: 0;
    max-height: 300px;
    overflow-y: auto;
  }

  .blv-item {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 3px;
    text-align: left;
    padding: 10px 14px;
    border: none;
    background: transparent;
    cursor: pointer;
    border-bottom: 1px solid rgba(16, 11, 50, 0.04);
    transition: background 0.12s;
    min-height: 44px;
  }
  .blv-item:last-child { border-bottom: none; }
  .blv-item:hover { background: var(--cs-lilac); }

  .blv-preview {
    font: 400 12px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
  }

  .blv-note {
    font: 400 11px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-purple);
    font-style: italic;
  }

  .blv-time {
    font: 400 10px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-light);
  }
</style>
