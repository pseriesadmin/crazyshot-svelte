<script lang="ts">
  import { supabase } from '$lib/services/supabase'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const post = data.post
  const YOUTUBE_VIDEO_ID = post?.youtubeVideoId ?? null

  let showModal = $state(false)
  let liked    = $state(false)
  let showDeleteConfirm = $state(false)
  let adminBusy = $state(false)
  let adminError = $state<string | null>(null)

  function formatDate(iso: string): string {
    const d = new Date(iso)
    return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}`
  }

  function formatCommentDate(iso: string): string {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    const month = d.getMonth() + 1
    const day = d.getDate()
    let rel: string
    if (diffMin < 1) {
      rel = '지금'
    } else if (diffMin < 60) {
      rel = `${diffMin}분전`
    } else if (diffMin < 60 * 24 * 30) {
      rel = `${Math.floor(diffMin / (60 * 24))}일전`
    } else {
      rel = `${Math.floor(diffMin / (60 * 24 * 30))}달전`
    }
    return `${month}/${day} ${rel}`
  }

  type TextBlock  = { type: 'text';  html: string }
  type ImageItem  = { url: string;   alt: string; isHead?: boolean }
  type ImageBlock = { type: 'image'; layout: string; images: ImageItem[] }
  type Block = TextBlock | ImageBlock

  function getBlocks(): Block[] {
    if (!post?.contentBlocks) return []
    return post.contentBlocks as Block[]
  }

  async function handleAdminStatus(status: string) {
    if (!data?.postId) return
    adminBusy = true
    adminError = null
    try {
      if (status === 'deleted' && data?.isOwner && !data?.isAdmin) {
        // 작성자 본인 삭제 — delete_own_post RPC
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.rpc as any)('delete_own_post', { p_id: data.postId })
        if (error) throw new Error(error.message)
      } else {
        // 관리자 상태 변경 (보류/공개/삭제) — is_cms_user() 필요
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.rpc as any)('update_post_status', {
          p_id: data.postId,
          p_status: status,
        })
        if (error) throw new Error(error.message)
      }

      showDeleteConfirm = false
      history.back()
    } catch (e) {
      adminError = e instanceof Error ? e.message : '처리 중 오류가 발생했습니다.'
    } finally {
      adminBusy = false
    }
  }

  const PC_SVG = {
    backArrow:  'M19.8844 8.5707L1.5 8.57107M8.57107 1.5L1.5 8.57107L8.57107 15.6421',
    goArrow:    'M14.4996 0C15.3281 1.64973e-05 15.9996 0.671583 15.9996 1.5V11.5C15.9992 12.328 15.3278 13 14.4996 13C13.6717 12.9998 13.0001 12.3279 12.9996 11.5V5.12109L10.5602 7.56055L2.5602 15.5596C1.97438 16.1449 1.02473 16.1451 0.439102 15.5596C-0.146507 14.9739 -0.146228 14.0243 0.439102 13.4385L10.8776 3H4.49965C3.67171 2.99979 3.00014 2.32788 2.99965 1.5C2.99965 0.671704 3.6714 0.000212116 4.49965 0H14.4996Z',
    dots:       'M5.5 9.5C6.32843 9.5 7 10.1716 7 11C7 11.8284 6.32843 12.5 5.5 12.5C4.67157 12.5 4 11.8284 4 11C4 10.1716 4.67157 9.5 5.5 9.5ZM11 9.5C11.8284 9.5 12.5 10.1716 12.5 11C12.5 11.8284 11.8284 12.5 11 12.5C10.1716 12.5 9.5 11.8284 9.5 11C9.5 10.1716 10.1716 9.5 11 9.5ZM16.5 9.5C17.3284 9.5 18 10.1716 18 11C18 11.8284 17.3284 12.5 16.5 12.5C15.6716 12.5 15 11.8284 15 11C15 10.1716 15.6716 9.5 16.5 9.5Z',
    playTri:    'M65.6185 44.2601C69.7337 46.636 69.7337 52.5758 65.6185 54.9517L46.23 66.1457C42.1148 68.5216 36.9708 65.5517 36.9708 60.7999L36.9708 38.412C36.9708 33.6602 42.1148 30.6903 46.23 33.0662L65.6185 44.2601Z',
    playCircle: 'M100 50C100 94.1177 95.4249 100 50 100C5.88235 100 0 94.1177 0 50C0 4.57516 5.88235 0 50 0C95.4249 0 100 4.57516 100 50Z',
  }

  const MOB_SVG = {
    back:       'M16 6.00001H1M5.61549 1.00001L1 6.00001L5.61549 11',
    heart:      'M19.7556 0C24.6867 0 28 4.56312 28 8.82C28 17.4409 14.2489 24.5 14 24.5C13.7511 24.5 0 17.4409 0 8.82C0 4.56312 3.31333 0 8.24444 0C11.0756 0 12.9267 1.39344 14 2.61844C15.0733 1.39344 16.9244 0 19.7556 0Z',
    burgerTop:  'M18.5 14C19.1904 14 19.75 14.5596 19.75 15.25C19.75 15.9404 19.1904 16.5 18.5 16.5H1.5C0.809644 16.5 0.25 15.9404 0.25 15.25C0.25 14.5596 0.809644 14 1.5 14H18.5ZM18.5 0C19.1904 0 19.75 0.559644 19.75 1.25C19.75 1.94036 19.1904 2.5 18.5 2.5H1.5C0.809644 2.5 0.25 1.94036 0.25 1.25C0.25 0.559644 0.809644 0 1.5 0H18.5Z',
    burgerMid:  'M18.5 6.75C19.3284 6.75 20 7.42157 20 8.25C20 9.07843 19.3284 9.75 18.5 9.75H1.5C0.671573 9.75 0 9.07843 0 8.25C0 7.42157 0.671573 6.75 1.5 6.75H18.5Z',
    dots:       'M5.5 9.5C6.32843 9.5 7 10.1716 7 11C7 11.8284 6.32843 12.5 5.5 12.5C4.67157 12.5 4 11.8284 4 11C4 10.1716 4.67157 9.5 5.5 9.5ZM11 9.5C11.8284 9.5 12.5 10.1716 12.5 11C12.5 11.8284 11.8284 12.5 11 12.5C10.1716 12.5 9.5 11.8284 9.5 11C9.5 10.1716 10.1716 9.5 11 9.5ZM16.5 9.5C17.3284 9.5 18 10.1716 18 11C18 11.8284 17.3284 12.5 16.5 12.5C15.6716 12.5 15 11.8284 15 11C15 10.1716 15.6716 9.5 16.5 9.5Z',
    playTri:    'M65.6185 44.2601C69.7337 46.636 69.7337 52.5758 65.6185 54.9517L46.23 66.1457C42.1148 68.5216 36.9708 65.5517 36.9708 60.7999L36.9708 38.412C36.9708 33.6602 42.1148 30.6903 46.23 33.0662L65.6185 44.2601Z',
    playCircle: 'M100 50C100 94.1177 95.4249 100 50 100C5.88235 100 0 94.1177 0 50C0 4.57516 5.88235 0 50 0C95.4249 0 100 4.57516 100 50Z',
  }

  let writeCardVisible = $state(true)

  // ── 댓글 상태 ─────────────────────────────────────────
  type Comment = { id: string; authorName: string; content: string; createdAt: string }
  let comments    = $state<Comment[]>((data.comments ?? []) as Comment[])
  let commentText = $state('')
  let commentBusy = $state(false)
  let commentError = $state<string | null>(null)

  async function handleCommentSubmit() {
    const content = commentText.trim()
    if (!content || commentBusy) return
    if (!data.isLoggedIn) { commentError = '댓글은 로그인 후 작성할 수 있습니다.'; return }
    commentBusy = true
    commentError = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: newId, error } = await (supabase as any).rpc('create_post_comment', {
        p_post_id: data.postId,
        p_content: content,
      })
      if (error) throw new Error(error.message)
      if (newId) {
        const now = new Date().toISOString()
        comments = [...comments, { id: newId, authorName: '나', content, createdAt: now }]
        commentText = ''
      }
    } catch (e) {
      commentError = e instanceof Error ? e.message : '댓글 등록 중 오류가 발생했습니다.'
    } finally {
      commentBusy = false
    }
  }

  function onCommentKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCommentSubmit() }
  }
  // ─────────────────────────────────────────────────────

  $effect(() => {
    document.body.classList.add('crazylog-view')
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') showModal = false }
    document.addEventListener('keydown', onKey)

    let lastY = window.scrollY
    function onScroll() {
      const currentY = window.scrollY
      writeCardVisible = currentY <= lastY  // 다운스크롤(올라갈 때) = 노출, 업스크롤 = 숨김
      lastY = currentY
    }
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      document.body.classList.remove('crazylog-view')
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll)
    }
  })
</script>

<svelte:head>
  <style>
    body.crazylog-view .gnb-mobile-wrap { display: none !important; }
    @media (max-width: 1023px) {
      body.crazylog-view .site-footer { display: none !important; }
    }

    /* YouTube 영상 있을 때만 클릭 커서 */
    [data-name="Posts-eng"] [data-name="img"].d-hero--clickable,
    [data-name="Posts-eng"] [data-name="img"].m-hero--clickable { cursor: pointer; }

    /* 호버 다크 오버레이 — YouTube 있을 때만 */
    [data-name="Posts-eng"] [data-name="img"].d-hero--clickable::after,
    [data-name="Posts-eng"] [data-name="img"].m-hero--clickable::after {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(16,11,50,0);
      transition: background 0.4s ease;
      z-index: 1;
      pointer-events: none;
      border-radius: inherit;
    }
    [data-name="Posts-eng"] [data-name="img"].d-hero--clickable:hover::after,
    [data-name="Posts-eng"] [data-name="img"].m-hero--clickable:hover::after {
      background: rgba(16,11,50,0.35);
    }

    /* 호버 "▶ 영상 재생" 레이블 — YouTube 있을 때만 */
    [data-name="Posts-eng"] [data-name="img"].d-hero--clickable::before,
    [data-name="Posts-eng"] [data-name="img"].m-hero--clickable::before {
      content: '▶  영상 재생';
      position: absolute;
      bottom: 36px;
      left: 50%;
      transform: translateX(-50%) translateY(14px);
      background: rgba(16,11,50,0.76);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: var(--cs-white);
      padding: 9px 26px;
      border-radius: 99px;
      border: 1px solid rgba(255,255,255,0.14);
      font-size: 13px;
      font-weight: 700;
      font-family: 'Noto Sans KR', sans-serif;
      letter-spacing: -0.3px;
      opacity: 0;
      transition: opacity 0.3s ease, transform 0.4s cubic-bezier(0.34,1.3,0.64,1);
      z-index: 3;
      white-space: nowrap;
      pointer-events: none;
    }
    [data-name="Posts-eng"] [data-name="img"].d-hero--clickable:hover::before,
    [data-name="Posts-eng"] [data-name="img"].m-hero--clickable:hover::before {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }

    /* play 버튼 위치 · hover 애니메이션 */
    [data-name="Posts-eng"] [data-name="img"] .d-play-btn,
    [data-name="Posts-eng"] [data-name="img"] .m-play-btn {
      position: absolute;
      top: 50%;
      left: 50%;
      z-index: 2;
      transform: translate(-50%, -50%) scale(1);
      transition: transform 0.4s cubic-bezier(0.34,1.56,0.64,1), filter 0.4s ease;
    }
    [data-name="Posts-eng"] [data-name="img"].d-hero--clickable:hover .d-play-btn,
    [data-name="Posts-eng"] [data-name="img"].m-hero--clickable:hover .m-play-btn {
      transform: translate(-50%, -50%) scale(1.4);
      filter: drop-shadow(0 0 32px rgba(255,53,53,0.9)) drop-shadow(0 0 12px rgba(59,47,138,0.55));
    }

    /* play 버튼 펄스 애니메이션 */
    [data-name="Posts-eng"] [data-name="img"] .d-play-btn::after,
    [data-name="Posts-eng"] [data-name="img"] .m-play-btn::after {
      content: '';
      position: absolute;
      inset: -10px;
      border-radius: 50%;
      border: 2px solid rgba(255,53,53,0.38);
      animation: cs-hero-pulse 2.8s ease-in-out infinite;
      pointer-events: none;
    }
    @keyframes cs-hero-pulse {
      0%, 100% { transform: scale(0.86); opacity: 0; }
      50%       { transform: scale(1.12); opacity: 1; }
    }
    [data-name="Posts-eng"] [data-name="img"].d-hero--clickable:hover .d-play-btn::after,
    [data-name="Posts-eng"] [data-name="img"].m-hero--clickable:hover .m-play-btn::after {
      animation: none;
      opacity: 0;
    }

    /* YouTube 배지 — YouTube 있을 때만 */
    [data-name="Posts-eng"] [data-name="img"].d-hero--clickable > div:first-child::after,
    [data-name="Posts-eng"] [data-name="img"].m-hero--clickable > div:first-child::after {
      content: 'YouTube';
      position: absolute;
      top: 16px;
      right: 16px;
      display: flex;
      align-items: center;
      gap: 5px;
      background: rgba(16,11,50,0.72);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      font-family: 'Noto Sans KR', sans-serif;
      letter-spacing: 0.3px;
      padding: 5px 10px 5px 8px;
      border-radius: 99px;
      border: 1px solid rgba(255,255,255,0.12);
      opacity: 0;
      transform: translateY(-4px);
      transition: opacity 0.3s ease, transform 0.3s ease;
      z-index: 3;
      pointer-events: none;
    }
    [data-name="Posts-eng"] [data-name="img"].d-hero--clickable:hover > div:first-child::after,
    [data-name="Posts-eng"] [data-name="img"].m-hero--clickable:hover > div:first-child::after {
      opacity: 1;
      transform: translateY(0);
    }
  </style>
</svelte:head>

<!-- ══════════════════════════════════
     PC LAYOUT (≥ 1024px)
══════════════════════════════════ -->
<div class="d-view">
  <div class="d-body">

    <!-- 1. Navi-bar -->
    <div class="d-navi-bar">
      <button class="d-back-btn" onclick={() => history.back()} aria-label="뒤로 가기">
        <svg width="21.38" height="17.14" viewBox="0 0 21.3844 17.1421" fill="none">
          <path d={PC_SVG.backArrow} stroke="#100B32" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Back</span>
      </button>
      <span class="d-navi-title">{post?.logType ?? ''}</span>
      <div class="d-navi-actions">
        {#if data?.isAdmin}
          {#if data?.postStatus === 'hidden'}
            <button class="admin-btn admin-btn-publish" disabled={adminBusy}
              onclick={() => handleAdminStatus('published')}>공개</button>
          {:else}
            <button class="admin-btn admin-btn-hold" disabled={adminBusy}
              onclick={() => handleAdminStatus('hidden')}>보류 처리</button>
          {/if}
        {/if}
      </div>
    </div>

    <!-- 2. PostsEng (본문 카드) -->
    <div class="d-posts-eng" data-name="Posts-eng">
      <!-- Img() -->
      <div
        class="d-hero"
        class:d-hero--clickable={!!YOUTUBE_VIDEO_ID}
        data-name="img"
        onclick={() => YOUTUBE_VIDEO_ID && (showModal = true)}
        role={YOUTUBE_VIDEO_ID ? 'button' : undefined}
        tabindex={YOUTUBE_VIDEO_ID ? 0 : undefined}
        onkeydown={(e) => YOUTUBE_VIDEO_ID && e.key === 'Enter' && (showModal = true)}
        aria-label={YOUTUBE_VIDEO_ID ? '영상 재생' : undefined}
      >
        <!-- first child (background layer) — YouTube badge target -->
        <div class="d-hero-img-wrap">
          <img
            src={post?.thumbnailUrl ?? '/crazylog/content-hero-desktop.png'}
            alt={post?.title ?? '포스트 썸네일'}
            loading="eager"
            class="d-hero-img"
          />
        </div>
        <!-- last child (play button) — YouTube 영상 있을 때만 표시 -->
        {#if YOUTUBE_VIDEO_ID}
          <div class="d-play-btn" aria-hidden="true">
            <svg width="100" height="100" viewBox="0 0 100 100" fill="none">
              <defs>
                <linearGradient id="d-play-grad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#3B2F8A"/>
                  <stop offset="100%" stop-color="#FF3535"/>
                </linearGradient>
              </defs>
              <path d={PC_SVG.playCircle} fill="url(#d-play-grad)"/>
              <path d={PC_SVG.playTri} fill="white"/>
            </svg>
          </div>
        {/if}
      </div>

      <!-- Writing() -->
      <div class="d-writing">
        <p class="d-author">{post?.author ?? ''} • {post ? formatDate(post.createdAt) : ''}</p>
        <h1 class="d-title">{post?.title ?? ''}</h1>

        <div class="d-article">
          {#each getBlocks() as block}
            {#if block.type === 'text'}
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html block.html}
            {:else if block.type === 'image'}
              <div class="d-content-images d-content-images--{block.layout}">
                {#each block.images.filter(img => !img.isHead) as img}
                  <img src={img.url} alt={img.alt} loading="lazy" class="d-content-img" />
                {/each}
              </div>
            {/if}
          {/each}
          {#if !post}
            <p class="d-article-empty">포스트를 불러올 수 없습니다.</p>
          {/if}
        </div>
      </div>
    </div>

    <!-- 3. Comments -->
    <div class="d-comments">

      <!-- Title bar -->
      <div class="d-comments-bar">
        <span class="d-comments-label">댓글</span>
        <span class="d-comments-count">{String(comments.length).padStart(2, '0')}</span>
      </div>

      <!-- 댓글 목록 -->
      <div class="d-comments-list">
        {#each comments as c (c.id)}
          <div class="d-comment-item">
            <div class="d-comment-meta">
              <span class="d-comment-author">{c.authorName}</span>
              <span class="d-comment-date">{formatCommentDate(c.createdAt)}</span>
            </div>
            <span class="d-comment-content">{c.content}</span>
          </div>
        {/each}
        {#if commentError}
          <p class="d-comment-error" role="alert">{commentError}</p>
        {/if}
      </div><!-- /d-comments-list -->

      <!-- Comment input form -->
      <div class="d-comment-form">
        <input
          class="d-comment-input"
          type="text"
          placeholder={data.isLoggedIn ? '후기 입력...' : '로그인 후 댓글을 작성할 수 있습니다.'}
          aria-label="후기 입력"
          value={commentText}
          oninput={(e) => { commentText = (e.target as HTMLInputElement).value }}
          onkeydown={onCommentKeydown}
          disabled={commentBusy || !data.isLoggedIn}
        />
        <button class="d-comment-send" aria-label="등록"
          onclick={handleCommentSubmit}
          disabled={commentBusy || !data.isLoggedIn}>
          <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
            <path d="M16 6.00001H1M5.61549 1.00001L1 6.00001L5.61549 11" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

    </div><!-- /d-comments -->

  </div>
</div>

<!-- ══════════════════════════════════
     MOBILE LAYOUT (< 1024px)
══════════════════════════════════ -->
<div class="m-view">

  <!-- 1. TopThumbView: pt-[40px] px-[25px] -->
  <div class="m-top">
    <div class="m-nav-pill">
      <button class="m-back" onclick={() => history.back()} aria-label="뒤로 가기">
        <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
          <path d={MOB_SVG.back} stroke="#444444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <span class="m-nav-title">{post?.logType ?? ''}</span>
      <!-- Single SVG: viewBox="0 0 20 16.5", both bars in one <g> -->
      <button class="m-hamburger" aria-label="메뉴">
        <div class="m-hamburger-icon">
          <svg width="20" height="16.5" viewBox="0 0 20 16.5" fill="none" style="width:20px;height:16.5px;">
            <g>
              <path d={MOB_SVG.burgerMid} fill="#CF0000" />
              <path d={MOB_SVG.burgerTop} fill="#201857" />
            </g>
          </svg>
        </div>
      </button>
    </div>
  </div>

  <!-- 2. Body: pt-[50px] -->
  <div class="m-body">

    <!-- PostsEng — bg-white rounded-tl-[50px] rounded-tr-[50px] -->
    <div class="m-posts-eng" data-name="Posts-eng">

      <!-- Img() — h-[450px], play button centered -->
      <div
        class="m-hero"
        class:m-hero--clickable={!!YOUTUBE_VIDEO_ID}
        data-name="img"
        onclick={() => YOUTUBE_VIDEO_ID && (showModal = true)}
        role={YOUTUBE_VIDEO_ID ? 'button' : undefined}
        tabindex={YOUTUBE_VIDEO_ID ? 0 : undefined}
        onkeydown={(e) => YOUTUBE_VIDEO_ID && e.key === 'Enter' && (showModal = true)}
        aria-label={YOUTUBE_VIDEO_ID ? '영상 재생' : undefined}
      >
        <!-- first child: image wrapper (YouTube badge target) -->
        <div class="m-hero-img-wrap">
          <img
            src={post?.thumbnailUrl ?? '/crazylog/content-hero.png'}
            alt={post?.title ?? '포스트 썸네일'}
            loading="eager"
            class="m-hero-img"
          />
        </div>
        <!-- last child: play button — YouTube 영상 있을 때만 표시 -->
        {#if YOUTUBE_VIDEO_ID}
          <div class="m-play-btn" aria-hidden="true">
            <svg width="100" height="100" viewBox="0 0 100 100" fill="none">
              <defs>
                <linearGradient id="m-play-grad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#3B2F8A"/>
                  <stop offset="100%" stop-color="#FF3535"/>
                </linearGradient>
              </defs>
              <path d={MOB_SVG.playCircle} fill="url(#m-play-grad)"/>
              <path d={MOB_SVG.playTri} fill="white"/>
            </svg>
          </div>
        {/if}
      </div>

      <!-- Writing(): pb-[100px] pt-[50px] px-[25px] gap-[30px] -->
      <div class="m-writing">

        <!-- Frame2: author + wish -->
        <div class="m-frame2">
          <div class="m-author">
            <span>{post?.author ?? ''} </span><span>• {post ? formatDate(post.createdAt) : ''}</span>
          </div>
          <button
            class="m-wish"
            onclick={() => liked = !liked}
            aria-label={liked ? '좋아요 취소' : '좋아요'}
            aria-pressed={liked}
          >
            <div class="m-wish-icon" aria-hidden="true">
              {#if !liked}
                <svg class="m-wish-svg" fill="none" viewBox="0 0 28 24.5" preserveAspectRatio="none">
                  <path d={MOB_SVG.heart} fill="#AAAAAA"/>
                </svg>
                <span class="m-wish-count m-wish-count-off">0</span>
              {:else}
                <svg class="m-wish-svg" fill="none" viewBox="0 0 28 24.5" preserveAspectRatio="none">
                  <path d={MOB_SVG.heart} fill="#553FE0"/>
                </svg>
                <span class="m-wish-count m-wish-count-on">3</span>
              {/if}
            </div>
          </button>
        </div>

        <!-- Title -->
        <h1 class="m-title">{post?.title ?? ''}</h1>

        <!-- Body -->
        <div class="m-article">
          {#each getBlocks() as block}
            {#if block.type === 'text'}
              {@html block.html}
            {:else if block.type === 'image'}
              <div class="article-images article-images--{block.layout}">
                {#each block.images.filter(img => !img.isHead) as img}
                  <img src={img.url} alt={img.alt} loading="lazy" class="m-article-img" />
                {/each}
              </div>
            {/if}
          {/each}
        </div>

      </div>
      {#if data?.isAdmin}
        <div class="m-admin-bar">
          {#if adminError}
            <p class="m-admin-error" role="alert">{adminError}</p>
          {/if}
          <div class="m-admin-btns">
            {#if data?.postStatus === 'hidden'}
              <button class="admin-btn admin-btn-publish" disabled={adminBusy}
                onclick={() => handleAdminStatus('published')}>공개</button>
            {:else}
              <button class="admin-btn admin-btn-hold" disabled={adminBusy}
                onclick={() => handleAdminStatus('hidden')}>보류 처리</button>
            {/if}
          </div>
        </div>
      {/if}

    </div><!-- /m-posts-eng -->

    <!-- 후기 div — w-[390px] px-[25px] pb-[100px] on #ecebf4 background -->
    <div class="m-huri">

      <!-- 댓글 title bar: flex justify-between -->
      <div class="m-huri-bar">
        <span class="m-huri-label">댓글</span>
        <span class="m-huri-count">{String(comments.length).padStart(2, '0')}</span>
      </div>

      <!-- Frame1: gap-[30px] pb-[50px] -->
      <div class="m-frame1">
        {#each comments as c (c.id)}
          <div class="m-comment-item">
            <div class="m-comment-meta">
              <span class="m-comment-author">{c.authorName}</span>
              <span class="m-comment-date">{formatCommentDate(c.createdAt)}</span>
            </div>
            <span class="m-comment-content">{c.content}</span>
          </div>
        {/each}
        {#if commentError}
          <p class="m-comment-error" role="alert">{commentError}</p>
        {/if}
      </div><!-- /m-frame1 -->

      <!-- Component: comment input form -->
      <div class="m-comment-form">
        <input
          class="m-comment-input"
          type="text"
          placeholder="후기를 등록해 주세요."
          aria-label="후기 입력"
          value={commentText}
          oninput={(e) => { commentText = (e.target as HTMLInputElement).value }}
          onkeydown={onCommentKeydown}
          disabled={commentBusy || !data.isLoggedIn}
        />
        <button class="m-send-btn" aria-label="등록"
          onclick={handleCommentSubmit}
          disabled={commentBusy || !data.isLoggedIn}>
          <div style="transform: rotate(90deg); display:flex; align-items:center; justify-content:center; width:15px; height:10px;">
            <svg width="17" height="12" viewBox="0 0 17 12" fill="none" style="width:17px;height:12px;">
              <path d={MOB_SVG.back} stroke="#100B32" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </button>
      </div>

    </div><!-- /m-huri -->

  </div><!-- /m-body -->

</div><!-- /m-view -->

<!-- ══════════════════════════════════
     ADMIN: 삭제 확인 모달
══════════════════════════════════ -->
{#if showDeleteConfirm}
  <div class="yt-overlay" onclick={() => showDeleteConfirm = false} role="presentation">
    <div class="admin-confirm-dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="포스트 삭제 확인">
      <p class="admin-confirm-msg">이 포스트를 삭제하시겠습니까?</p>
      <p class="admin-confirm-sub">삭제된 포스트는 복구할 수 없습니다.</p>
      {#if adminError}
        <p class="admin-confirm-error" role="alert">{adminError}</p>
      {/if}
      <div class="admin-confirm-actions">
        <button class="admin-btn admin-btn-hold" onclick={() => showDeleteConfirm = false} disabled={adminBusy}>취소</button>
        <button class="admin-btn admin-btn-delete" onclick={() => handleAdminStatus('deleted')} disabled={adminBusy}>
          {adminBusy ? '처리 중...' : '삭제'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ══════════════════════════════════
     YOUTUBE MODAL
══════════════════════════════════ -->
{#if showModal}
  <div class="yt-overlay" onclick={() => showModal = false} role="presentation">
    <div class="yt-dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="경복궁 한복 체험 영상">
      <button class="yt-close" onclick={() => showModal = false}>
        <span>닫기</span>
        <span class="yt-close-x">✕</span>
      </button>
      <div class="yt-player">
        <iframe
          src="https://www.youtube.com/embed/{YOUTUBE_VIDEO_ID}?autoplay=1&rel=0&modestbranding=1&color=white"
          title="Gyeongbokgung Hanbok Experience · K-Trail log"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
        ></iframe>
      </div>
      <div class="yt-caption">
        <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
          <rect width="16" height="11" rx="2.5" fill="#FF3535"/>
          <path d="M6.5 3L10.5 5.5L6.5 8V3Z" fill="white"/>
        </svg>
        <p>경복궁 한복 체험 · K-Trail log</p>
      </div>
    </div>
  </div>
{/if}

<!-- ══════════════════════════════════
     FLOATING WRITE CARD (로그인 상태에 따라 분기)
══════════════════════════════════ -->
<div class="write-card" class:write-card-hidden={!writeCardVisible} aria-label="내 로그 작성" role="complementary">
  {#if data.isLoggedIn && data.currentUser}
    <!-- 로그인 상태 -->
    <div class="wc-user">
      <div class="wc-avatar">
        {#if data.currentUser.avatarUrl}
          <img src={data.currentUser.avatarUrl} alt={data.currentUser.displayName} class="wc-avatar-img" />
        {:else}
          {data.currentUser.displayName[0] ?? '?'}
        {/if}
      </div>
      <div class="wc-info">
        <span class="wc-name">{data.currentUser.displayName}</span>
        {#if data.currentUser.membershipGrade}
          <span class="wc-badge wc-badge-c" aria-label="{data.currentUser.membershipGrade} 멤버십">{data.currentUser.membershipGrade[0]}</span>
        {/if}
        <span class="wc-level">{data.currentUser.level}</span>
      </div>
    </div>
    <div class="wc-actions">
      <a href="/crazylog/new" class="wc-write-btn" aria-label="로그 작성하기">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M1 13L5 9M9.5 1.5L12.5 4.5L5 12H2V9L9.5 1.5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        쓰기
      </a>
      {#if data?.isOwner}
        <a href="/crazylog/{data.postId}" class="wc-edit-btn" aria-label="이 로그 수정">수정</a>
        <button class="wc-delete-btn" disabled={adminBusy}
          onclick={() => showDeleteConfirm = true} aria-label="이 로그 삭제">삭제</button>
      {/if}
    </div>
  {:else}
    <!-- 비로그인 상태 -->
    <div class="wc-user">
      <div class="wc-avatar wc-avatar-guest">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.8"/>
          <path d="M4 20c0-4 3.582-7 8-7s8 3 8 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="wc-info">
        <span class="wc-name wc-guest-msg">로그인해 로그 작성해주세요.</span>
      </div>
    </div>
  {/if}
</div>

<style>
  /* ══════════════════════════════════
     FLOATING WRITE CARD
  ══════════════════════════════════ */
  /* 모바일: 좌우 여백만 두고 가득 채움 */
  .write-card {
    position: fixed;
    bottom: 24px;
    left: 24px;
    right: 24px;
    width: auto;
    transform: translateY(0);
    z-index: 100;
    display: flex;
    align-items: center;
    gap: 16px;
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    padding: 12px 16px 12px 20px;
    box-shadow: 0 4px 24px rgba(16, 11, 50, 0.14);
    min-height: 64px;
    transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                opacity  0.35s cubic-bezier(0.4, 0, 0.2, 1);
    opacity: 1;
    pointer-events: auto;
  }

  .write-card-hidden {
    transform: translateY(calc(100% + 32px));
    opacity: 0;
    pointer-events: none;
  }

  /* PC: 중앙 고정 + 고정 폭 */
  @media (min-width: 640px) {
    .write-card {
      left: 50%;
      right: auto;
      width: auto;
      min-width: 460px;
      max-width: 700px;
      transform: translateX(-50%) translateY(0);
      white-space: nowrap;
    }
    .write-card-hidden {
      transform: translateX(-50%) translateY(calc(100% + 32px));
    }
  }

  /* ── write-card 내부: 사용자 정보 ── */
  .wc-user {
    display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;
  }
  .wc-avatar {
    width: 38px; height: 38px; border-radius: 50%;
    background: linear-gradient(135deg, var(--cs-purple) 0%, var(--cs-red-badge) 100%);
    display: flex; align-items: center; justify-content: center;
    font-size: 15px; font-weight: 900; color: var(--cs-white); flex-shrink: 0; overflow: hidden;
  }
  .wc-avatar-img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
  .wc-info { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
  .wc-name { font: var(--text-pc-body-14); color: var(--cs-text); letter-spacing: -0.5px; }
  .wc-avatar-guest { background: var(--cs-surface-gray); color: var(--cs-text-light); }
  .wc-guest-msg { color: var(--cs-text-mid); font: var(--text-pc-script-12); letter-spacing: -0.3px; }
  .wc-badge {
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border-radius: 6px;
    font-size: 11px; font-weight: 900; color: var(--cs-white);
    flex-shrink: 0; letter-spacing: 0; line-height: 1;
  }
  .wc-badge-e { background: var(--cs-text-mid); }
  .wc-badge-p { background: var(--cs-purple); }
  .wc-badge-c { background: var(--cs-orange); }
  .wc-level {
    font-size: 11px; font-weight: 500; color: var(--cs-purple-light);
    background: var(--cs-purple-op10); padding: 2px 8px; border-radius: var(--radius-full);
  }
  .wc-write-btn {
    display: inline-flex; align-items: center; gap: 6px; padding: 0 20px; height: 40px;
    background: var(--cs-red-badge); color: var(--cs-white);
    border-radius: var(--radius-xl); font: var(--text-pc-body-14); font-weight: 700;
    letter-spacing: -0.3px; text-decoration: none; flex-shrink: 0; transition: background 0.15s;
  }
  .wc-write-btn:hover { background: var(--cs-red); }
  .wc-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .wc-edit-btn {
    display: inline-flex; align-items: center; height: 40px; padding: 0 16px;
    background: var(--cs-surface-gray); color: var(--cs-text);
    border-radius: var(--radius-xl); font: var(--text-pc-body-14); font-weight: 700;
    letter-spacing: -0.3px; text-decoration: none; flex-shrink: 0; transition: background 0.15s;
  }
  .wc-edit-btn:hover { background: var(--cs-border); }
  .wc-delete-btn {
    display: inline-flex; align-items: center; height: 40px; padding: 0 16px;
    background: var(--cs-chat-in-bg); color: var(--cs-red-badge); border: none;
    border-radius: var(--radius-xl); font: var(--text-pc-body-14); font-weight: 700;
    letter-spacing: -0.3px; cursor: pointer; flex-shrink: 0; transition: background 0.15s;
  }
  .wc-delete-btn:hover:not(:disabled) { background: var(--cs-red-light); }
  .wc-delete-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ══ 레이아웃 분기 (1024px) ════════════════════════ */
  .d-view { display: none; }
  .m-view { display: block; }
  @media (min-width: 1024px) {
    .d-view { display: block; }
    .m-view { display: none; }
  }

  /* ══════════════════════════════════
     PC
  ══════════════════════════════════ */
  .d-body {
    background: var(--cs-lilac);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: calc(var(--layout-header-h, 100px) + 50px) 40px 50px;
    gap: 50px;
  }

  /* 1. Navi-bar */
  .d-navi-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    max-width: 1240px;
    background: rgba(225,222,243,0.4);
    border-radius: 25px;
    padding: 20px 40px;
  }
  .d-back-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    min-height: 44px;
    padding: 0;
    transition: opacity 0.15s;
  }
  .d-back-btn:hover { opacity: 0.7; }
  .d-navi-title {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 20px;
    font-weight: 400;
    color: var(--cs-purple-light);
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
  }
  .d-navi-bar { position: relative; }

  /* 2. PostsEng */
  .d-posts-eng {
    background: var(--cs-white);
    border-radius: 30px;
    overflow: hidden;
    width: 100%;
    max-width: 1240px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .d-hero {
    position: relative;
    aspect-ratio: 5 / 3;
    min-height: 480px;
    max-height: 960px;
    width: 100%;
    overflow: hidden;
    cursor: pointer;
  }
  .d-hero-img-wrap {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .d-hero-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    display: block;
  }
  .d-play-btn {
    width: 100px;
    height: 100px;
    flex-shrink: 0;
  }

  .d-writing {
    padding: 50px;
    display: flex;
    flex-direction: column;
    gap: 30px;
  }
  .d-author {
    font-size: 16px;
    font-weight: 400;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid);
    margin: 0;
  }
  .d-title {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 35px;
    font-weight: 400;
    color: var(--cs-text);
    margin: 0;
  }
  .d-article {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .d-section-title {
    font-size: 25px;
    font-weight: 900;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    margin: 8px 0 0;
  }
  .d-article p {
    font-size: 16px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-dark);
    margin: 0;
    line-height: 1.8;
  }

  /* 3. Comments */
  .d-comments {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
    max-width: 1240px;
  }
  .d-comments-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 40px;
  }
  .d-comments-label,
  .d-comments-count {
    font: var(--text-pc-title-18);
    color: var(--cs-text);
  }
  .d-comments-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .d-review-card {
    background: var(--cs-white);
    border-radius: 20px;
    overflow: hidden;
  }
  .d-review-header {
    background: var(--cs-purple-op10);
    padding: 16px 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }
  .d-review-title {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    margin: 0;
  }
  .d-review-date {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .d-review-body {
    padding: 20px 40px;
  }
  .d-review-body p {
    font: var(--text-pc-body-14);
    font-weight: 400;
    color: var(--cs-text-dark);
    margin: 0;
    line-height: 1.7;
  }
  .d-comment-form {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--cs-white);
    border-radius: 20px;
    padding: 16px 20px 16px 40px;
  }
  .d-comment-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font: var(--text-pc-body-14);
    font-weight: 400;
    color: var(--cs-text);
  }
  .d-comment-input::placeholder {
    color: var(--cs-text-light);
  }
  .d-comment-send {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    background: var(--cs-purple-op10);
    border: none;
    border-radius: 50%;
    cursor: pointer;
    transition: background 0.15s;
    transform: rotate(-45deg);
  }
  .d-comment-send:hover {
    background: var(--cs-purple);
  }
  .d-comment-send:disabled { opacity: 0.45; cursor: not-allowed; }
  .d-comment-input:disabled { opacity: 0.6; cursor: not-allowed; }

  .d-comment-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 0;
    border-bottom: 1px solid var(--cs-surface-gray);
  }
  .d-comment-meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .d-comment-author {
    font-size: 12px;
    font-weight: 700;
    color: var(--cs-purple);
  }
  .d-comment-date {
    font-size: 11px;
    color: var(--cs-text-light);
  }
  .d-comment-content {
    font-size: 14px;
    color: var(--cs-text);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .d-comment-error {
    font-size: 12px;
    color: var(--cs-error);
    margin: 6px 0 0;
  }

  /* ══════════════════════════════════
     MOBILE
  ══════════════════════════════════ */
  .m-view {
    background: var(--cs-lilac);
    flex-direction: column;
    align-items: center;
    width: 100%;
  }
  @media (max-width: 1023px) {
    .m-view { display: flex; }
  }

  /* 1. TopThumbView: pt-[40px] px-[25px] */
  .m-top {
    width: 100%;
    padding: 40px 25px 0;
  }
  .m-nav-pill {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--cs-purple-op10);
    border-radius: 20px;
    min-height: 60px;
    padding: 5px 20px;
    position: relative;
    width: 100%;
  }
  .m-back {
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
  }
  .m-nav-title {
    font-size: 16px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    text-align: center;
    line-height: 1.6;
    letter-spacing: -0.5px;
  }
  .m-hamburger {
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
  }
  .m-hamburger-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 16.5px;
  }

  /* 2. Body: pt-[50px] */
  .m-body {
    width: 100%;
    padding-top: 50px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  /* PostsEng — bg-white rounded-tl-[50px] rounded-tr-[50px] */
  .m-posts-eng {
    background: var(--cs-white);
    border-radius: 50px 50px 0 0;
    overflow: hidden;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  /* Img(): h-[450px] */
  .m-hero {
    position: relative;
    aspect-ratio: 9 / 15;
    min-height: 480px;
    max-height: 900px;
    width: 100%;
    overflow: hidden;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .m-hero-img-wrap {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .m-hero-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    display: block;
  }
  .m-play-btn {
    width: 100px;
    height: 100px;
    flex-shrink: 0;
  }

  /* Writing(): pb-[100px] pt-[50px] px-[25px] gap-[30px] */
  .m-writing {
    width: 100%;
    padding: 50px 25px 100px;
    display: flex;
    flex-direction: column;
    gap: 30px;
    align-items: flex-start;
    flex-shrink: 0;
  }

  /* Frame2: author + wish */
  .m-frame2 {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    flex-shrink: 0;
  }
  .m-author {
    font-size: 14px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-dark);
    letter-spacing: -0.5px;
    line-height: 2;
  }
  .m-author span:last-child { color: var(--cs-text-dark); }

  /* Wish: h-[25px] w-[28px] + count overlay */
  .m-wish {
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    flex-shrink: 0;
    transition: transform 0.15s;
  }
  .m-wish:hover { transform: scale(1.1); }
  .m-wish-icon {
    position: relative;
    width: 28px;
    height: 24.5px;
  }
  .m-wish-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .m-wish-count {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 500;
    font-family: 'Noto Sans KR', sans-serif;
    white-space: nowrap;
    pointer-events: none;
    letter-spacing: -0.5px;
    line-height: 1.6;
  }
  .m-wish-count-off {
    top: 6.86%;
    right: 35%;
    bottom: 17.14%;
    left: 40%;
    color: var(--cs-text-mid);
  }
  .m-wish-count-on {
    top: 9.43%;
    right: 35%;
    bottom: 14.57%;
    left: 40%;
    color: var(--cs-white);
  }

  /* Title */
  .m-title {
    font-size: 24px;
    font-weight: 900;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    margin: 0;
    line-height: 1.6;
    letter-spacing: -0.5px;
    word-break: keep-all;
    flex-shrink: 0;
  }

  /* Article body */
  .m-article {
    display: flex;
    flex-direction: column;
    gap: 0;
    width: 100%;
    min-width: 100%;
  }
  .m-article p, .m-article li {
    font-size: 14px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-dark);
    margin: 0;
    line-height: 2;
    letter-spacing: -0.5px;
  }
  .m-article ul {
    margin: 0;
    padding-left: 21px;
    list-style: disc;
  }
  .m-article li { margin-bottom: 0; }
  /* 본문 이미지 모바일 리사이징 */
  .article-images {
    width: 100%;
    max-width: 100%;
    overflow: hidden;
  }
  .m-article-img {
    width: 100%;
    max-width: 100%;
    height: auto;
    display: block;
    object-fit: contain;
  }

  /* 후기 div: px-[25px] pb-[100px] on #ecebf4 bg */
  .m-huri {
    width: 100%;
    padding: 0 25px 100px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    flex-shrink: 0;
  }

  /* 댓글 title bar: py-[40px] flex justify-between */
  .m-huri-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 40px 0;
    width: 100%;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    color: var(--cs-text);
    text-align: center;
    letter-spacing: -0.3px;
    line-height: 1.6;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .m-huri-label { font-size: 21px; }
  .m-huri-count { font-size: 18px; }

  /* Frame1: gap-[30px] pb-[50px] */
  .m-frame1 {
    display: flex;
    flex-direction: column;
    gap: 30px;
    padding-bottom: 50px;
    width: 100%;
    align-items: flex-start;
    flex-shrink: 0;
  }

  /* Review card: bg-white rounded-[30px] */
  .m-review-card {
    background: var(--cs-white);
    border-radius: 30px;
    overflow: hidden;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    flex-shrink: 0;
  }
  /* Title area: bg-[#e1def3] gap-[5px] flex-col px-[20px] py-[15px] */
  .m-review-header {
    background: var(--cs-purple-op10);
    padding: 15px 20px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
  }
  .m-review-title {
    font-size: 16px;
    font-weight: 500;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-dark);
    margin: 0;
    line-height: 1.6;
    letter-spacing: -0.5px;
  }
  .m-review-date {
    font-size: 12px;
    font-weight: 400;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-dark);
    margin: 0;
    line-height: normal;
    white-space: pre;
  }
  /* Body: bg-white rounded-bl-[30px] rounded-br-[30px] px-[20px] py-[15px] */
  .m-review-body {
    background: var(--cs-white);
    padding: 15px 20px;
    width: 100%;
  }
  .m-review-body p {
    font-size: 14px;
    font-weight: 500;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-dark);
    margin: 0;
    line-height: 1.6;
    letter-spacing: -0.5px;
  }

  /* Comment form: bg-white h-[70px] rounded-[25px] */
  .m-comment-form {
    background: var(--cs-white);
    height: 70px;
    border-radius: 25px;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 15px 20px;
    flex-shrink: 0;
    gap: 10px;
  }
  .m-comment-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 14px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-dark);
    letter-spacing: -0.5px;
  }
  .m-comment-input::placeholder {
    color: var(--cs-text-mid);
    opacity: 0.6;
    text-align: left;
  }
  /* Send button: bg-[#e1def3] rounded-[30px] size-[35px] */
  .m-send-btn {
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    border-radius: 30px;
    background: var(--cs-purple-op10);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    transition: background 0.15s;
  }
  .m-send-btn:hover { background: var(--cs-purple-pale); }
  .m-send-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .m-comment-input:disabled { opacity: 0.6; cursor: not-allowed; }

  .m-comment-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 0;
    border-bottom: 1px solid var(--cs-border);
  }
  .m-comment-meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .m-comment-author {
    font-size: 12px;
    font-weight: 700;
    color: var(--cs-purple);
  }
  .m-comment-date {
    font-size: 11px;
    color: var(--cs-text-light);
  }
  .m-comment-content {
    font-size: 14px;
    color: var(--cs-text);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .m-comment-error {
    font-size: 12px;
    color: var(--cs-error);
    margin: 6px 0 0;
  }

  /* ══ YouTube Modal ════════════════════════════════ */
  .yt-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(16,11,50,0.93);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
  @media (min-width: 1024px) {
    .yt-overlay { padding: 40px; }
  }
  .yt-dialog {
    position: relative;
    width: 100%;
    max-width: 900px;
  }
  .yt-close {
    position: absolute;
    top: -44px;
    right: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    background: none;
    border: none;
    cursor: pointer;
    color: rgba(255,255,255,0.5);
    font-size: 12px;
    font-family: 'Noto Sans KR', sans-serif;
    transition: color 0.2s;
    min-height: 44px;
    padding: 0;
  }
  .yt-close:hover { color: var(--cs-white); }
  .yt-close-x { font-size: 20px; line-height: 1; }
  .yt-player {
    aspect-ratio: 16 / 9;
    width: 100%;
    overflow: hidden;
    border-radius: 16px;
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.08),
      0 0 80px rgba(255,53,53,0.22),
      0 40px 80px rgba(0,0,0,0.6);
  }
  .yt-player iframe {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
  }
  .yt-caption {
    margin-top: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    opacity: 0.4;
  }
  .yt-caption p {
    color: var(--cs-white);
    font-size: 12px;
    font-family: 'Noto Sans KR', sans-serif;
    margin: 0;
  }

  /* ══════════════════════════════════
     ADMIN BUTTONS
  ══════════════════════════════════ */
  .d-navi-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 80px;
    justify-content: flex-end;
  }

  .admin-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 40px;
    padding: 0 20px;
    border-radius: var(--radius-xl);
    font-size: 13px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    letter-spacing: -0.3px;
    white-space: nowrap;
    cursor: pointer;
    border: none;
    transition: opacity 0.15s, background 0.15s;
    min-height: 44px;
  }
  .admin-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  /* 공개: primary (보라) */
  .admin-btn-publish {
    background: var(--cs-purple);
    color: var(--cs-white);
  }
  .admin-btn-publish:hover:not(:disabled) { background: var(--cs-purple-hover); }

  /* 보류 처리: ghost (보라 테두리) */
  .admin-btn-hold {
    background: transparent;
    color: var(--cs-purple);
    border: 2px solid var(--cs-purple);
  }
  .admin-btn-hold:hover:not(:disabled) { background: var(--cs-purple); color: var(--cs-white); }

  /* 삭제: 위험 (빨강) */
  .admin-btn-delete {
    background: var(--cs-chat-in-bg);
    color: var(--cs-red-badge);
  }
  .admin-btn-delete:hover:not(:disabled) { background: var(--cs-red-light); }

  /* 수정: 본인 소유 편집 링크 */
  .admin-btn-edit {
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .admin-btn-edit:hover { background: var(--cs-purple); color: var(--cs-white); }

  /* 관리자 모바일 바 */
  .m-admin-bar {
    width: 100%;
    padding: 0 25px 30px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .m-admin-btns {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .m-admin-error {
    font-size: 12px;
    color: var(--cs-red-badge);
    margin: 0;
    font-family: 'Noto Sans KR', sans-serif;
  }

  /* 삭제 확인 모달 */
  .admin-confirm-dialog {
    background: var(--cs-white);
    border-radius: var(--radius-2xl);
    padding: 32px 36px;
    min-width: 300px;
    max-width: 420px;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
    text-align: center;
  }
  .admin-confirm-msg {
    font-size: 18px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    margin: 0;
  }
  .admin-confirm-sub {
    font-size: 14px;
    font-weight: 400;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid);
    margin: 0;
  }
  .admin-confirm-error {
    font-size: 12px;
    color: var(--cs-red-badge);
    margin: 0;
    font-family: 'Noto Sans KR', sans-serif;
  }
  .admin-confirm-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
    margin-top: 8px;
  }
</style>
