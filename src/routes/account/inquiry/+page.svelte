<script lang="ts">
  import { enhance } from '$app/forms'
  import { invalidateAll } from '$app/navigation'
  import SubGnb from '$lib/components/common/SubGnb.svelte'
  import BottomTabBar from '$lib/components/common/BottomTabBar.svelte'
  import { csToast } from '$lib/utils/toast'
  import type { PageData, ActionData } from './$types'
  import type { MyPost } from './+page.server'

  interface Props { data: PageData; form: ActionData }
  let { data, form }: Props = $props()

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

  const CATEGORIES = [
    { value: 'general', label: '일반 문의' },
    { value: 'rental',  label: '대여 관련' },
    { value: 'payment', label: '결제·환불' },
    { value: 'product', label: '상품 관련' },
    { value: 'other',   label: '기타' },
  ]

  let showForm    = $state(false)
  let expandedId  = $state<string | null>(null)
  let isSubmitting = $state(false)

  $effect(() => {
    if (form?.ok === true) {
      csToast.success('문의가 등록되었습니다.')
      showForm = false
      invalidateAll()
    } else if (form && 'error' in form && form.error) {
      csToast.error(form.error as string)
    }
  })

  function togglePost(id: string) {
    expandedId = expandedId === id ? null : id
  }

  function formatDate(dt: string): string {
    return dt.slice(0, 10)
  }
</script>

<div class="page-wrap">

  <SubGnb title="빠른 문의" />

  <div class="content">

    <!-- 새 문의 작성 버튼 -->
    <div class="new-btn-row">
      <button class="btn-new" onclick={() => { showForm = !showForm }}>
        {showForm ? '취소' : '새 문의 작성 +'}
      </button>
    </div>

    <!-- 문의 작성 폼 -->
    {#if showForm}
      <div class="form-card">
        <h3 class="form-title">문의 등록</h3>
        <form method="POST" action="?/submit" use:enhance={() => {
          isSubmitting = true
          return ({ update }) => {
            isSubmitting = false
            update()
          }
        }}>

          <div class="field">
            <label class="field-label" for="inq-category">카테고리</label>
            <select id="inq-category" name="category" class="field-select">
              {#each CATEGORIES as cat}
                <option value={cat.value}>{cat.label}</option>
              {/each}
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="inq-title">제목 <span class="req">*</span></label>
            <input
              id="inq-title"
              name="title"
              type="text"
              class="field-input"
              placeholder="문의 제목을 입력해 주세요"
              maxlength="200"
              required
            />
          </div>

          <div class="field">
            <label class="field-label" for="inq-content">내용 <span class="req">*</span></label>
            <textarea
              id="inq-content"
              name="content"
              class="field-textarea"
              placeholder="문의 내용을 자세히 입력해 주세요"
              rows="5"
              required
            ></textarea>
          </div>

          <button type="submit" class="btn-submit" disabled={isSubmitting}>
            {isSubmitting ? '등록 중...' : '문의 등록'}
          </button>
        </form>
      </div>
    {/if}

    <!-- 문의 목록 -->
    {#if data.posts.length > 0}
      <div class="list-wrap">
        {#each data.posts as post (post.id)}
          {@const st = STATUS_STYLE[post.status] ?? STATUS_STYLE['open']}
          {@const isOpen = expandedId === post.id}
          {@const replyCount = post.cs_inquiries?.length ?? 0}

          <div class="post-card" class:post-open={isOpen}>
            <button
              class="post-head"
              onclick={() => togglePost(post.id)}
              aria-expanded={isOpen}
            >
              <span
                class="status-chip"
                style="background:{st.bg};color:{st.color}"
              >{STATUS_LABEL[post.status] ?? post.status}</span>

              <div class="post-summary">
                <span class="post-title">{post.title}</span>
                <span class="post-meta-row">
                  <span class="post-cat">{CATEGORY_LABEL[post.category] ?? post.category}</span>
                  <span class="post-date">{formatDate(post.created_at)}</span>
                  {#if replyCount > 0}
                    <span class="reply-count-badge">답변 {replyCount}</span>
                  {/if}
                </span>
              </div>

              <span class="chevron-icon" class:rotated={isOpen}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 5L7 9L12 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </span>
            </button>

            <!-- 펼침 내용 -->
            {#if isOpen}
              <div class="post-body">
                <!-- 내 문의 내용 -->
                <div class="my-content">
                  <div class="section-label">내 문의</div>
                  <div class="content-text">{post.content}</div>
                </div>

                <!-- 관리자 답변 -->
                {#if post.cs_inquiries && post.cs_inquiries.length > 0}
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
    {:else}
      <div class="empty-state">
        <p class="empty-msg">등록된 문의가 없습니다.</p>
        <p class="empty-sub">궁금한 점이 있으시면 문의를 남겨 주세요.</p>
      </div>
    {/if}

  </div>

  <BottomTabBar />
</div>

<style>
  .page-wrap {
    min-height: 100vh;
    background: var(--cs-lilac);
    display: flex;
    flex-direction: column;
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 70px 20px 100px;
    max-width: 600px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }

  /* 새 문의 버튼 */
  .new-btn-row {
    display: flex;
    justify-content: flex-end;
  }
  .btn-new {
    height: 40px;
    padding: 0 20px;
    border-radius: var(--radius-xl);
    background: var(--cs-purple);
    color: #fff;
    border: none;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -0.3px;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .btn-new:hover { opacity: 0.85; }

  /* 작성 폼 */
  .form-card {
    background: #fff;
    border-radius: var(--radius-2xl);
    padding: 24px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .form-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-text);
    margin: 0 0 4px;
  }

  .field { display: flex; flex-direction: column; gap: 6px; }
  .field-label {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-text);
  }
  .req { color: var(--cs-orange); }

  .field-input,
  .field-select,
  .field-textarea {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--radius-md);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    color: var(--cs-text);
    background: #fff;
    box-sizing: border-box;
  }
  .field-input:focus,
  .field-select:focus,
  .field-textarea:focus {
    outline: 2px solid var(--cs-purple);
    outline-offset: -2px;
  }
  .field-textarea { resize: vertical; min-height: 100px; }

  .btn-submit {
    height: 48px;
    border-radius: var(--radius-xl);
    background: var(--cs-purple);
    color: #fff;
    border: none;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.15s;
    width: 100%;
  }
  .btn-submit:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-submit:not(:disabled):hover { opacity: 0.85; }

  /* 목록 */
  .list-wrap { display: flex; flex-direction: column; gap: 8px; }

  .post-card {
    background: #fff;
    border-radius: 20px;
    overflow: hidden;
  }
  .post-card.post-open { box-shadow: 0 2px 12px rgba(59,47,138,0.1); }

  .post-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 14px 16px;
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
  .post-cat {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    color: var(--cs-text-mid);
  }
  .post-date {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    color: var(--cs-text-mid);
  }
  .reply-count-badge {
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

  .chevron-icon {
    flex-shrink: 0;
    color: var(--cs-text-mid);
    transition: transform 0.2s;
    margin-top: 3px;
  }
  .chevron-icon.rotated { transform: rotate(180deg); }

  /* 펼침 본문 */
  .post-body {
    padding: 0 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    border-top: 1px solid var(--cs-lilac);
    padding-top: 14px;
  }

  .section-label {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    font-weight: 700;
    color: var(--cs-text-mid);
    margin-bottom: 6px;
  }
  .reply-label { color: var(--cs-purple); }

  .my-content {}
  .content-text {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    color: var(--cs-text);
    white-space: pre-wrap;
    line-height: 1.7;
    background: #f6f6f6;
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
    padding: 8px 0;
  }

  /* 빈 상태 */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 60px 20px;
    background: #fff;
    border-radius: 20px;
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

  /* PC (≥768px) */
  @media (min-width: 768px) {
    .content {
      padding: 100px 40px 60px;
      max-width: 720px;
    }
  }
</style>
