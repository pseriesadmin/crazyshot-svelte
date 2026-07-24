<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation'
  import { enhance } from '$app/forms'
  import { fly } from 'svelte/transition'
  import CmsPagination from '$lib/components/cms/CmsPagination.svelte'
  import { csToast } from '$lib/utils/toast'
  import type { PageData, ActionData } from './$types'
  import type { InquiryRow } from './+page.server'

  interface Props { data: PageData; form: ActionData }
  let { data, form }: Props = $props()

  const STATUS_FILTERS = [
    { label: '전체',     value: '' },
    { label: '접수',     value: 'open' },
    { label: '처리중',   value: 'in_progress' },
    { label: '해결됨',   value: 'resolved' },
    { label: '종결',     value: 'closed' },
  ]

  const STATUS_LABEL: Record<string, string> = {
    open:        '접수',
    in_progress: '처리중',
    resolved:    '해결됨',
    closed:      '종결',
  }

  const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
    open:        { bg: 'rgba(14,165,233,0.12)',  color: '#0369A1' },
    in_progress: { bg: 'rgba(59,47,138,0.12)',   color: 'var(--cs-purple)' },
    resolved:    { bg: 'rgba(16,185,129,0.12)',  color: '#047857' },
    closed:      { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
  }

  const CATEGORY_LABEL: Record<string, string> = {
    general: '일반',
    rental:  '대여',
    payment: '결제·환불',
    product: '상품',
    other:   '기타',
  }

  const STATUS_OPTIONS = [
    { value: 'open',        label: '접수' },
    { value: 'in_progress', label: '처리중' },
    { value: 'resolved',    label: '해결됨' },
    { value: 'closed',      label: '종결' },
  ]

  let searchInput  = $state(data.search ?? '')
  let expandedId   = $state<string | null>(null)
  let replyTexts   = $state<Record<string, string>>({})
  let resolutionMap = $state<Record<string, boolean>>({})
  let statusEdits  = $state<Record<string, string>>({})

  $effect(() => { searchInput = data.search ?? '' })

  $effect(() => {
    if (form?.ok === true) {
      csToast.success('처리되었습니다.')
      invalidateAll()
    } else if (form && 'error' in form && form.error) {
      csToast.error(form.error as string)
    }
  })

  function applySearch() {
    const params = new URLSearchParams()
    if (data.status)       params.set('status', data.status)
    if (searchInput.trim()) params.set('search', searchInput.trim())
    params.delete('page')
    goto(`/cms/customers/inquiry?${params.toString()}`, { replaceState: true })
  }

  function setStatus(val: string) {
    const params = new URLSearchParams(window.location.search)
    if (val) params.set('status', val); else params.delete('status')
    params.delete('page')
    goto(`/cms/customers/inquiry?${params.toString()}`, { replaceState: true })
  }

  function goPage(p: number) {
    const params = new URLSearchParams(window.location.search)
    params.set('page', p.toString())
    goto(`/cms/customers/inquiry?${params.toString()}`, { replaceState: true, noScroll: true })
  }

  function toggleRow(id: string) {
    expandedId = expandedId === id ? null : id
    if (!statusEdits[id]) {
      const post = data.posts.find(p => p.id === id)
      if (post) statusEdits[id] = post.status
    }
  }

  function formatDate(dt: string): string {
    return dt.slice(0, 10)
  }
</script>

<div class="page-wrap">
  <!-- 헤더 -->
  <div class="page-header">
    <div class="header-left">
      <h1 class="page-title">빠른문의</h1>
      <p class="page-sub">고객 빠른문의 게시판을 관리합니다.</p>
    </div>
    <a href="/cms/customers" class="btn-ghost-sm">고객목록 →</a>
  </div>

  <!-- 툴바 -->
  <div class="toolbar">
    <div class="toolbar-left">
      <div class="search-wrap">
        <input
          class="search-in"
          type="search"
          placeholder="제목·고객명·이메일"
          bind:value={searchInput}
          onkeydown={(e) => e.key === 'Enter' && applySearch()}
        />
        <button class="btn-secondary" onclick={applySearch}>검색</button>
      </div>
      <div class="filter-chips">
        {#each STATUS_FILTERS as f}
          <button
            class="chip"
            class:chip-active={(data.status ?? '') === f.value}
            onclick={() => setStatus(f.value)}
          >{f.label}</button>
        {/each}
      </div>
    </div>
    <span class="count-badge">총 {data.totalCount}건</span>
  </div>

  <!-- 목록 카드 -->
  <div class="list-card">
    <CmsPagination
      page={data.page}
      totalPages={data.totalPages}
      onpage={goPage}
      variant="top"
      ariaLabel="빠른문의 목록 페이지 탐색"
    />

    <div class="accordion-list">
      {#each data.posts as post (post.id)}
        {@const st = STATUS_STYLE[post.status] ?? STATUS_STYLE['open']}
        {@const isOpen = expandedId === post.id}

        <!-- 아코디언 행 -->
        <div class="accordion-item" class:accordion-open={isOpen}>
          <button
            class="accordion-head"
            onclick={() => toggleRow(post.id)}
            aria-expanded={isOpen}
          >
            <span
              class="status-badge"
              style="background:{st.bg};color:{st.color}"
            >{STATUS_LABEL[post.status] ?? post.status}</span>

            <span class="post-title">{post.title}</span>

            <span class="post-cat">{CATEGORY_LABEL[post.category] ?? post.category}</span>

            <span class="post-meta">
              {post.user_name}
            </span>

            <span class="post-date">{formatDate(post.created_at)}</span>

            <span class="reply-count">
              {#if post.reply_count > 0}
                <span class="reply-badge">{post.reply_count}</span>
              {:else}
                <span class="no-reply">미답변</span>
              {/if}
            </span>

            <span class="chevron" class:rotated={isOpen}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 4L6 8L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          </button>

          <!-- 아코디언 본문 -->
          {#if isOpen}
            <div class="accordion-body" transition:fly={{ y: -8, duration: 150 }}>

              <!-- 문의 내용 -->
              <div class="inquiry-content">
                <div class="content-label">문의 내용</div>
                <div class="content-text">{post.content}</div>
                <div class="content-meta">
                  작성자: {post.user_email} / {formatDate(post.created_at)}
                </div>
              </div>

              <!-- 기존 답변 목록 -->
              {#if post.replies && post.replies.length > 0}
                <div class="replies-section">
                  <div class="replies-label">관리자 답변</div>
                  {#each post.replies as reply (reply.id)}
                    <div class="reply-item">
                      <div class="reply-text">{reply.response}</div>
                      <div class="reply-footer">
                        {#if reply.is_resolution}
                          <span class="resolution-tag">종결 답변</span>
                        {/if}
                        <span class="reply-date">{formatDate(reply.created_at)}</span>
                      </div>
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="no-reply-msg">아직 답변이 없습니다.</div>
              {/if}

              <!-- 답변 작성 폼 -->
              <div class="reply-form-section">
                <div class="reply-form-label">답변 작성</div>
                <form
                  method="POST"
                  action="?/reply"
                  use:enhance={() => {
                    return ({ update }) => update({ reset: false })
                  }}
                >
                  <input type="hidden" name="post_id" value={post.id} />
                  <textarea
                    name="response"
                    class="reply-textarea"
                    placeholder="답변 내용을 입력하세요"
                    rows="4"
                    bind:value={replyTexts[post.id]}
                    required
                  ></textarea>
                  <div class="reply-actions">
                    <label class="resolution-check">
                      <input
                        type="checkbox"
                        bind:checked={resolutionMap[post.id]}
                      />
                      <input
                        type="hidden"
                        name="is_resolution"
                        value={resolutionMap[post.id] ? 'true' : 'false'}
                      />
                      이 답변으로 종결
                    </label>
                    <button type="submit" class="btn-reply">답변 저장</button>
                  </div>
                </form>
              </div>

              <!-- 상태 변경 -->
              <div class="status-change-section">
                <form method="POST" action="?/updateStatus" use:enhance={() => {
                  return ({ update }) => update({ reset: false })
                }}>
                  <input type="hidden" name="post_id" value={post.id} />
                  <div class="status-row">
                    <span class="status-change-label">상태 변경</span>
                    <select name="status" class="status-select" bind:value={statusEdits[post.id]}>
                      {#each STATUS_OPTIONS as opt}
                        <option value={opt.value}>{opt.label}</option>
                      {/each}
                    </select>
                    <button type="submit" class="btn-status-save">저장</button>
                  </div>
                </form>
              </div>

            </div>
          {/if}
        </div>
      {:else}
        <div class="empty-msg">조건에 맞는 문의가 없습니다.</div>
      {/each}
    </div>

    <CmsPagination
      page={data.page}
      totalPages={data.totalPages}
      onpage={goPage}
      variant="bottom"
      ariaLabel="빠른문의 목록 페이지 탐색"
    />
  </div>
</div>

<style>
  .page-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 20px 24px 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* 헤더 */
  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .header-left { display: flex; flex-direction: column; gap: 2px; }
  .page-title  { font: var(--text-pc-title-18); color: var(--cs-text); margin: 0 0 4px; }
  .page-sub    { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0; }

  .btn-ghost-sm {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 16px;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-white);
    border: 1px solid var(--cs-lilac);
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    text-decoration: none;
    white-space: nowrap;
    flex-shrink: 0;
    transition: background 0.12s, color 0.12s;
  }
  .btn-ghost-sm:hover { background: rgba(59,47,138,0.06); color: var(--cs-purple); }

  /* 툴바 */
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .search-wrap { display: flex; align-items: center; gap: 6px; }
  .search-in {
    background: var(--cs-white);
    border: 1px solid var(--cs-lilac);
    border-radius: var(--radius-sm);
    padding: 8px 14px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    width: 220px;
  }
  .search-in:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  .btn-secondary {
    height: 36px;
    padding: 0 16px;
    border-radius: var(--radius-sm);
    background: var(--cs-white);
    border: 1px solid var(--cs-lilac);
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s;
  }
  .btn-secondary:hover { background: rgba(59,47,138,0.06); }

  .filter-chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip {
    height: 32px;
    padding: 0 14px;
    border-radius: var(--radius-xl);
    border: 1px solid var(--cs-lilac);
    background: var(--cs-white);
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .chip:hover { background: rgba(59,47,138,0.06); }
  .chip-active {
    background: var(--cs-purple);
    border-color: var(--cs-purple);
    color: var(--cs-white);
  }

  .count-badge {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* 목록 카드 */
  .list-card {
    background: var(--cs-white);
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* 아코디언 */
  .accordion-list { display: flex; flex-direction: column; }

  .accordion-item {
    border-bottom: 1px solid var(--cs-lilac);
  }
  .accordion-item:last-child { border-bottom: none; }
  .accordion-item.accordion-open { background: rgba(59,47,138,0.02); }

  .accordion-head {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 12px 20px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s;
  }
  .accordion-head:hover { background: rgba(59,47,138,0.04); }

  .status-badge {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    border-radius: var(--radius-xl);
    font: var(--text-pc-script-12);
    font-weight: 700;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .post-title {
    flex: 1;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .post-cat {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    white-space: nowrap;
    flex-shrink: 0;
    width: 60px;
    text-align: center;
  }

  .post-meta {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    white-space: nowrap;
    flex-shrink: 0;
    width: 100px;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .post-date {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    white-space: nowrap;
    flex-shrink: 0;
    width: 80px;
    text-align: right;
  }

  .reply-count {
    flex-shrink: 0;
    width: 60px;
    text-align: right;
  }
  .reply-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    border-radius: var(--radius-xl);
    background: var(--cs-purple);
    color: var(--cs-white);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }
  .no-reply {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .chevron {
    flex-shrink: 0;
    color: var(--cs-text-mid);
    transition: transform 0.2s;
  }
  .chevron.rotated { transform: rotate(180deg); }

  /* 아코디언 본문 */
  .accordion-body {
    padding: 0 20px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .inquiry-content {
    background: var(--cs-surface-gray);
    border-radius: var(--radius-sm);
    padding: 14px 16px;
  }
  .content-label {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
    margin-bottom: 8px;
  }
  .content-text {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    white-space: pre-wrap;
    line-height: 1.7;
  }
  .content-meta {
    margin-top: 8px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .replies-section { display: flex; flex-direction: column; gap: 8px; }
  .replies-label {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-purple);
  }
  .reply-item {
    background: rgba(59,47,138,0.04);
    border-left: 3px solid var(--cs-purple);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    padding: 10px 14px;
  }
  .reply-text {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    white-space: pre-wrap;
    line-height: 1.7;
  }
  .reply-footer {
    margin-top: 6px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .resolution-tag {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-xl);
    background: rgba(16,185,129,0.12);
    color: #047857;
    font: var(--text-pc-script-12);
    font-weight: 700;
  }
  .reply-date {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .no-reply-msg {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    padding: 8px 0;
  }

  /* 답변 작성 */
  .reply-form-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .reply-form-label {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text);
  }
  .reply-textarea {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--radius-sm);
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    background: var(--cs-white);
    resize: vertical;
    min-height: 80px;
    box-sizing: border-box;
  }
  .reply-textarea:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  .reply-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .resolution-check {
    display: flex;
    align-items: center;
    gap: 6px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    cursor: pointer;
    user-select: none;
  }
  .btn-reply {
    height: 36px;
    padding: 0 20px;
    border-radius: var(--radius-md);
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.12s;
  }
  .btn-reply:hover { opacity: 0.85; }

  /* 상태 변경 */
  .status-change-section {
    border-top: 1px solid var(--cs-lilac);
    padding-top: 12px;
  }
  .status-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .status-change-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    white-space: nowrap;
  }
  .status-select {
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    color: var(--cs-text);
    background: var(--cs-white);
    cursor: pointer;
  }
  .btn-status-save {
    height: 34px;
    padding: 0 16px;
    border-radius: var(--radius-sm);
    background: var(--cs-white);
    border: 1px solid var(--cs-lilac);
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .btn-status-save:hover { background: rgba(59,47,138,0.06); color: var(--cs-purple); }

  .empty-msg {
    padding: 40px;
    text-align: center;
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
  }
</style>
