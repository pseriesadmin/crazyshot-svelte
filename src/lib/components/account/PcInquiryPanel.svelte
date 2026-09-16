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

  /* 좌우 끝 들여쓰기 느낌(2026-09-17, 약간의 여백 추가) */
  .panel-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 4px;
    padding: 0 6px;
  }
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

  /* 목록 — 카드 간 여백 25px(2026-09-17) */
  .list-wrap { display: flex; flex-direction: column; gap: 25px; }

  .post-card {
    background: var(--cs-white);
    /* front-uiux.md §4 카드 반경 대/중 2단 체계 — 취소·대여 패널과 동일하게
       "중(medium)" 등급(PC 30px, --radius-xl)으로 통일(2026-09-17) */
    border-radius: var(--radius-xl);
    overflow: hidden;
  }
  .post-card.post-open { box-shadow: 0 2px 12px rgba(59,47,138,0.10); }

  /* position:relative는 카드 전체(.post-card)가 아니라 헤더 행(.post-head) 자체에 건다 —
     펼침(isOpen) 시 .post-body가 형제로 추가돼 .post-card 높이가 늘어나므로, 카드 기준으로
     걸면 top:50% 배지·화살표가 펼쳐진 본문 쪽으로 밀려 겹치는 결함이 있었다(2026-09-17,
     sp3-qa-agent GATE E B-1 발견·수정). .post-head는 헤더 콘텐츠만의 고정 높이라 안전함. */
  .post-head {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    /* 좌우 기준 여백 24px(2026-09-17, PcCancelPanel .cancel-card와 동일 값) — 좌측은
       status-chip 폭+간격, 우측은 chevron 폭+간격만큼 추가 확보.
       상하 패딩은 50% 증가(14px → 21px, 2026-09-17) */
    padding: 21px 48px 21px 94px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  /* 카드 bg 전체 높이 기준 수직 중앙정렬(2026-09-17) — post-head 행이 아니라 카드
     전체(펼침 시 post-body 포함)를 기준으로 위치 고정 */
  .status-chip {
    position: absolute;
    top: 50%;
    left: 24px;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    border-radius: var(--radius-xl);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
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
    position: absolute;
    top: 50%;
    right: 24px;
    transform: translateY(-50%);
    color: var(--cs-text-mid);
    transition: transform 0.2s;
  }
  .chevron.rotated { transform: translateY(-50%) rotate(180deg); }

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
