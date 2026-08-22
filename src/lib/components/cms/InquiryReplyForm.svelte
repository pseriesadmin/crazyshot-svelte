<script lang="ts">
  // 관리자용 빠른문의 답변 등록 화면 — CMS 채팅(/cms/chat) INQUIRY_NEW_CARD 대화카드 CTA
  // 모달에서 컴포넌트로 직접 마운트된다(AdminChatPanel.svelte 참고). 실제 저장 로직은 새로
  // 만들지 않고 기존 /cms/customers/inquiry 페이지의 ?/reply 폼 액션을 절대경로로 그대로
  // 재사용한다(cms/CustomerDetailPanel.svelte가 /cms/customers?/updateCustomerInfo를
  // 절대경로로 호출하는 것과 동일 패턴 — 그 액션은 request.formData()/session만 사용해
  // 현재 라우트에 의존하지 않으므로 안전).

  import { enhance } from '$app/forms'
  import { csToast } from '$lib/utils/toast'

  interface InquiryReply {
    id: string
    response: string
    is_resolution: boolean
    created_at: string
  }

  interface InquiryPost {
    id: string
    title: string
    content: string
    category: string
    status: string
    created_at: string
    cs_inquiries: InquiryReply[]
  }

  interface Props {
    post: InquiryPost | null
    isLoading?: boolean
    onSubmitted: () => void
  }

  let { post, isLoading = false, onSubmitted }: Props = $props()

  let responseText = $state('')
  let isResolution = $state(false)
  let isSaving = $state(false)

  const CATEGORY_LABEL: Record<string, string> = {
    general: '일반', rental: '대여', payment: '결제·환불', product: '상품', other: '기타',
  }
  const STATUS_LABEL: Record<string, string> = {
    open: '접수', in_progress: '처리중', resolved: '해결됨', closed: '종결',
  }

  function fmtDate(iso: string): string {
    return iso.slice(0, 10)
  }
</script>

<div class="reply-form">
  {#if isLoading}
    <div class="reply-empty">불러오는 중...</div>
  {:else if !post}
    <div class="reply-empty">문의 내용을 찾을 수 없습니다.</div>
  {:else}
    <div class="post-card">
      <div class="post-head">
        <span class="post-category">{CATEGORY_LABEL[post.category] ?? post.category}</span>
        <span class="post-status">{STATUS_LABEL[post.status] ?? post.status}</span>
        <span class="post-date">{fmtDate(post.created_at)}</span>
      </div>
      <p class="post-title">{post.title}</p>
      <p class="post-content">{post.content}</p>
    </div>

    {#if post.cs_inquiries.length > 0}
      <div class="section-title">기존 답변</div>
      <div class="reply-list">
        {#each post.cs_inquiries as reply (reply.id)}
          <div class="reply-item">
            <p class="reply-text">{reply.response}</p>
            <div class="reply-footer">
              {#if reply.is_resolution}<span class="resolution-tag">종결 답변</span>{/if}
              <span class="reply-date">{fmtDate(reply.created_at)}</span>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <div class="section-title">답변 작성</div>
    <form
      method="POST"
      action="/cms/customers/inquiry?/reply"
      use:enhance={() => {
        isSaving = true
        return async ({ result }) => {
          isSaving = false
          if (result.type === 'success') {
            csToast.success('답변이 등록되었습니다.')
            responseText = ''
            isResolution = false
            onSubmitted()
          } else if (result.type === 'failure') {
            csToast.error((result.data as { error?: string })?.error ?? '답변 저장 실패')
          }
        }
      }}
    >
      <input type="hidden" name="post_id" value={post.id} />
      <textarea
        name="response"
        class="reply-textarea"
        placeholder="답변 내용을 입력하세요"
        rows="4"
        bind:value={responseText}
        required
      ></textarea>
      <div class="reply-actions">
        <label class="resolution-check">
          <input type="checkbox" bind:checked={isResolution} />
          <input type="hidden" name="is_resolution" value={isResolution ? 'true' : 'false'} />
          이 답변으로 종결
        </label>
        <button type="submit" class="btn-primary" disabled={isSaving || !responseText.trim()}>
          {isSaving ? '저장 중...' : '답변 저장'}
        </button>
      </div>
    </form>
  {/if}
</div>

<style>
  .reply-form {
    height: 100%;
    overflow-y: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .reply-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
  }

  .post-card {
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .post-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .post-category {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    background: rgba(59,47,138,0.10);
    color: var(--cs-purple);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }

  .post-status {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }

  .post-date {
    margin-left: auto;
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }

  .post-title {
    font: var(--text-pc-title-16);
    font-weight: 700;
    color: var(--cs-text);
    margin: 0;
  }

  .post-content {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    margin: 0;
    white-space: pre-wrap;
  }

  .section-title {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
  }

  .reply-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .reply-item {
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-sm);
    padding: 12px 14px;
  }

  .reply-text {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    margin: 0 0 6px;
    white-space: pre-wrap;
  }

  .reply-footer {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .resolution-tag {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    background: rgba(16,185,129,0.12);
    color: var(--cs-success-light);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }

  .reply-date {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }

  .reply-textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    padding: 12px 14px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    resize: vertical;
  }
  .reply-textarea:focus {
    outline: none;
    border-color: var(--cs-purple);
  }

  .reply-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 10px;
  }

  .resolution-check {
    display: flex;
    align-items: center;
    gap: 6px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    cursor: pointer;
  }

  /* CMS 표준 CTA 버튼(.btn-primary) 스펙: height 44px, radius-md 15px */
  .btn-primary {
    display: inline-flex;
    align-items: center;
    height: 44px;
    padding: 0 30px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-md);
    font: var(--text-pc-body-14);
    font-weight: 700;
    letter-spacing: -0.5px;
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-primary:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .btn-primary:disabled { background: var(--cs-disabled-button, var(--cs-text-light)); cursor: not-allowed; }
</style>
