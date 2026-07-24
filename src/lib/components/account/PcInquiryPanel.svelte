<script lang="ts">
  interface InquiryReply {
    id: string
    response: string
    is_resolution: boolean
    created_at: string
  }

  interface InquiryItem {
    id: string
    title: string
    content: string
    category: string
    status: string
    created_at: string
    cs_inquiries: InquiryReply[]
  }

  interface Props {
    inquiries: InquiryItem[]
    onback: () => void
  }

  let { inquiries, onback }: Props = $props()

  const STATUS_LABEL: Record<string, string> = {
    open:        '답변대기',
    in_progress: '처리중',
    resolved:    '해결됨',
    closed:      '종결',
  }

  const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
    open:        { bg: 'rgba(14,165,233,0.12)',  color: '#0369A1' },
    in_progress: { bg: 'rgba(59,47,138,0.12)',   color: '#3B2F8A' },
    resolved:    { bg: 'rgba(16,185,129,0.12)',  color: '#047857' },
    closed:      { bg: 'rgba(102,102,102,0.12)', color: '#666666' },
  }

  const CATEGORY_LABEL: Record<string, string> = {
    general: '일반',
    rental:  '대여',
    payment: '결제·환불',
    product: '상품',
    other:   '기타',
  }

  let expandedId = $state<string | null>(null)

  function toggle(id: string) {
    expandedId = expandedId === id ? null : id
  }

  function formatDate(dt: string): string {
    return dt.slice(0, 10)
  }
</script>

<div class="panel">
  <div class="panel-head">
    <button class="btn-back" onclick={onback}>
      <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
        <path d="M7 1L1 7L7 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      돌아가기
    </button>
    <span class="panel-title">빠른 문의</span>
    <a href="/account/inquiry" class="btn-write">새 문의 작성 +</a>
  </div>

  {#if inquiries.length === 0}
    <div class="empty-state">
      <p class="empty-msg">등록된 문의가 없습니다.</p>
      <p class="empty-sub">궁금한 점이 있으시면 문의를 남겨 주세요.</p>
    </div>
  {:else}
    <div class="list-wrap">
      {#each inquiries as post (post.id)}
        {@const st = STATUS_STYLE[post.status] ?? STATUS_STYLE['open']}
        {@const isOpen = expandedId === post.id}
        {@const replyCount = post.cs_inquiries?.length ?? 0}

        <div class="post-card" class:post-open={isOpen}>
          <button
            class="post-head"
            onclick={() => toggle(post.id)}
            aria-expanded={isOpen}
          >
            <span class="status-chip" style="background:{st.bg};color:{st.color}">
              {STATUS_LABEL[post.status] ?? post.status}
            </span>
            <div class="post-summary">
              <span class="post-title">{post.title}</span>
              <span class="post-meta-row">
                <span class="post-cat">{CATEGORY_LABEL[post.category] ?? post.category}</span>
                <span class="post-date">{formatDate(post.created_at)}</span>
                {#if replyCount > 0}
                  <span class="reply-badge">답변 {replyCount}</span>
                {/if}
              </span>
            </div>
            <span class="chevron" class:rotated={isOpen}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 5L7 9L12 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          </button>

          {#if isOpen}
            <div class="post-body">
              <div class="section-label">내 문의</div>
              <div class="content-text">{post.content}</div>

              {#if post.cs_inquiries?.length > 0}
                <div class="replies-wrap">
                  <div class="section-label reply-label">관리자 답변</div>
                  {#each post.cs_inquiries as reply (reply.id)}
                    <div class="reply-bubble">
                      <div class="reply-text">{reply.response}</div>
                      <div class="reply-footer">
                        {#if reply.is_resolution}
                          <span class="resolved-tag">종결 답변</span>
                        {/if}
                        <span class="reply-date">{formatDate(reply.created_at)}</span>
                      </div>
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="no-reply">아직 답변이 등록되지 않았습니다.</div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 16px; }

  .panel-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 4px;
  }
  .btn-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    padding: 6px 0;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    font-weight: 500;
    color: var(--cs-text-mid);
    cursor: pointer;
    transition: color 0.15s;
  }
  .btn-back:hover { color: var(--cs-purple); }
  .panel-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: var(--cs-text);
    flex: 1;
  }
  .btn-write {
    display: inline-flex;
    align-items: center;
    height: 36px;
    padding: 0 16px;
    border-radius: var(--radius-xl);
    background: var(--cs-purple);
    color: #fff;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    font-weight: 700;
    text-decoration: none;
    transition: opacity 0.15s;
    white-space: nowrap;
  }
  .btn-write:hover { opacity: 0.85; }

  /* 빈 상태 */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 60px 20px;
    background: var(--cs-white);
    border-radius: var(--radius-2xl);
  }
  .empty-msg {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-text);
    margin: 0;
  }
  .empty-sub {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    color: var(--cs-text-mid);
    margin: 0;
  }

  /* 목록 */
  .list-wrap { display: flex; flex-direction: column; gap: 8px; }

  .post-card {
    background: var(--cs-white);
    border-radius: 20px;
    overflow: hidden;
  }
  .post-card.post-open { box-shadow: 0 2px 12px rgba(59,47,138,0.10); }

  .post-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 14px 18px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .status-chip {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    border-radius: var(--radius-xl);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
    flex-shrink: 0;
    margin-top: 2px;
  }
  .post-summary {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .post-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .post-meta-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .post-cat, .post-date {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    color: var(--cs-text-mid);
  }
  .reply-badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 8px;
    border-radius: var(--radius-xl);
    background: rgba(59,47,138,0.10);
    color: var(--cs-purple);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 11px;
    font-weight: 700;
  }
  .chevron {
    flex-shrink: 0;
    color: var(--cs-text-mid);
    transition: transform 0.2s;
    margin-top: 3px;
  }
  .chevron.rotated { transform: rotate(180deg); }

  /* 펼침 본문 */
  .post-body {
    padding: 14px 18px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    border-top: 1px solid var(--cs-lilac);
  }
  .section-label {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    font-weight: 700;
    color: var(--cs-text-mid);
    margin-bottom: 4px;
  }
  .reply-label { color: var(--cs-purple); }
  .content-text {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    color: var(--cs-text);
    white-space: pre-wrap;
    line-height: 1.7;
    background: var(--cs-surface-gray);
    border-radius: 12px;
    padding: 12px 14px;
  }
  .replies-wrap { display: flex; flex-direction: column; gap: 8px; }
  .reply-bubble {
    background: rgba(59,47,138,0.05);
    border-left: 3px solid var(--cs-purple);
    border-radius: 0 12px 12px 0;
    padding: 10px 14px;
  }
  .reply-text {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    color: var(--cs-text);
    white-space: pre-wrap;
    line-height: 1.7;
  }
  .reply-footer {
    margin-top: 6px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .resolved-tag {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-xl);
    background: rgba(16,185,129,0.12);
    color: #047857;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 11px;
    font-weight: 700;
  }
  .reply-date {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    color: var(--cs-text-mid);
  }
  .no-reply {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    color: var(--cs-text-mid);
  }
</style>
