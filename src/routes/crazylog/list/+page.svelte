<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import type { PageData } from './$types'
  import CrazylogWriteCard from '$lib/components/common/CrazylogWriteCard.svelte'
  import SubGnb from '$lib/components/common/SubGnb.svelte'
  import DeleteIconButton from '$lib/components/common/DeleteIconButton.svelte'
  import { supabase } from '$lib/services/supabase'
  import { invalidateAll } from '$app/navigation'
  import { createDeleteSafetyToast } from '$lib/utils/deleteSafetyToast.svelte'
  import { csToast } from '$lib/utils/toast'
  import { describePostActionError } from '$lib/utils/crazylogPostPermissions'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const TABS = ['상품리뷰', '일상공유', '채널홍보', '전체'] as const
  type Tab = typeof TABS[number]

  const initialTab = data.activeTab
  let activeTab = $state<Tab>(
    (TABS as readonly string[]).includes(initialTab) ? (initialTab as Tab) : '전체'
  )

  const BAR_COLORS: Record<string, string> = {
    '상품리뷰': '#ff3535',
    '일상공유': '#553fe0',
    '채널홍보': '#3b2f8a',
  }

  function barColor(logType: string): string {
    return BAR_COLORS[logType] ?? '#3b2f8a'
  }

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime()
    const mins  = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days  = Math.floor(diff / 86400000)
    if (mins  <  1) return '방금 전'
    if (hours <  1) return `${mins}분 전`
    if (days  <  1) return `${hours}시간 전`
    if (days  < 30) return `${days}일 전`
    return new Date(iso).toLocaleDateString('ko-KR')
  }

  function onTabClick(tab: Tab) {
    activeTab = tab
    // 검색 중이면 탭만 바꾸고 URL 이동 없음 — 검색 API에서 log_type으로 필터
    if (!searchQuery.trim()) {
      goto(`?tab=${tab}`, { replaceState: true })
    } else {
      triggerSearch(searchQuery, tab)
    }
  }

  const PC_STAT_TABS: { label: string; tab: Tab; countKey: 'review' | 'share' | 'promo' }[] = [
    { label: '상품리뷰', tab: '상품리뷰', countKey: 'review' },
    { label: '일상공유', tab: '일상공유', countKey: 'share'  },
    { label: '채널홍보', tab: '채널홍보', countKey: 'promo'  },
  ]

  let writeCardVisible = $state(true)

  $effect(() => {
    let lastY = window.scrollY
    function onScroll() {
      const currentY = window.scrollY
      writeCardVisible = currentY <= lastY
      lastY = currentY
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  })

  // ── 검색 상태 ─────────────────────────────────────────────────────────────
  // data.posts와 동일한 shape으로 정규화해 템플릿을 공유한다

  interface ApiSearchResult {
    id: string
    title: string
    category: string
    author: string
    thumbnail_url: string | null
    created_at: string
  }

  // 검색 화면(/products/search)의 "더보기" 링크로 ?q= 가 오면 입력창을 채우고 한 번 검색한다(2026-10-06)
  let searchQuery   = $state($page.url.searchParams.get('q')?.trim() ?? '')
  let isSearching   = $state(false)
  // data.posts와 동일 타입으로 정규화된 검색 결과 저장
  let searchResults = $state<typeof data.posts>([])
  let searchError   = $state(false)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  // ── 관리자 행 조작(2026-10-05): 비공개 토글·삭제 — 서버 재조회(invalidateAll) 전까지 즉시 반영용 로컬 상태
  let publicOverride = $state<Record<string, boolean>>({})
  let removedIds     = $state<Record<string, true>>({})
  let privacyBusyId  = $state<string | null>(null)

  type ListPost = (typeof data.posts)[number]

  // 검색 중이면 서버 데이터 대신 검색 결과 표시 — 방금 삭제한 글은 제외, 방금 바꾼 공개 여부는 즉시 반영
  const displayPosts = $derived(
    (searchQuery.trim() ? searchResults : data.posts)
      .filter((p) => !removedIds[p.id])
      .map((p) => (p.id in publicOverride ? { ...p, isPublic: publicOverride[p.id] } : p))
  )

  /** 비공개(is_public=false) 글은 작성자 본인·관리자에게만 보이며 50% 흐리게 표시한다 */
  function isDimmed(post: ListPost): boolean {
    return post.isPublic === false
  }

  async function togglePublic(post: ListPost) {
    if (privacyBusyId) return
    privacyBusyId = post.id
    const next = !(post.isPublic !== false)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)('set_post_public', { p_id: post.id, p_public: next })
      if (error) throw new Error(error.message)
      publicOverride = { ...publicOverride, [post.id]: next }
      csToast.success(next ? '공개로 전환했습니다.' : '비공개로 전환했습니다.')
      void invalidateAll()
    } catch (e) {
      csToast.error(`처리하지 못했습니다.${e instanceof Error && e.message ? ` (${e.message})` : ''}`)
    } finally {
      privacyBusyId = null
    }
  }

  // 관리자 삭제 = 소프트 삭제(status='deleted', 복구 가능) — update_post_status는 관리자 전용이며 사용자 글 삭제는 매니저 이상(Migration #647). 2단계 확인은 삭제 안전 토스트 재사용
  const deleteSafety = createDeleteSafetyToast({
    successMessage: '로그가 삭제됐습니다.',
    errorMessage: '로그 삭제에 실패했습니다.',
  })

  async function deletePost(post: ListPost): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('update_post_status', { p_id: post.id, p_status: 'deleted' })
    if (error) throw new Error(describePostActionError(error.message))
    removedIds = { ...removedIds, [post.id]: true }
    void invalidateAll()
    return true
  }

  function onSearchInput(e: Event) {
    const val = (e.target as HTMLInputElement).value
    searchQuery = val
    if (debounceTimer) clearTimeout(debounceTimer)
    if (!val.trim()) {
      searchResults = []
      searchError = false
      return
    }
    debounceTimer = setTimeout(() => triggerSearch(val.trim(), activeTab), 280)
  }

  async function triggerSearch(q: string, tab: Tab) {
    isSearching = true
    searchError = false
    try {
      const logType = tab !== '전체' ? tab : null
      const params  = new URLSearchParams({ q, limit: '30' })
      if (logType) params.set('log_type', logType)

      const res  = await fetch(`/api/search/crazylog?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json() as { results: ApiSearchResult[] }

      // API 응답(snake_case)을 data.posts 형태(camelCase)로 정규화 — 템플릿 공유
      searchResults = (body.results ?? []).map((r) => ({
        id:           r.id,
        title:        r.title,
        logType:      r.category,
        createdAt:    r.created_at,
        author:       r.author,
        thumbnailUrl: r.thumbnail_url ?? null,
        isPublic:     true, // 검색 API는 공개 글만 반환
        isMine:       false,
        // 검색 응답엔 작성자 역할 정보가 없다 — 목록에 같은 글이 있으면 그 판정을 쓰고, 없으면 매니저 이상만 삭제 아이콘 노출(최종 집행은 DB)
        canDelete:    data.posts.find((p) => p.id === r.id)?.canDelete ?? data.isManager,
      }))
    } catch {
      searchError   = true
      searchResults = []
    } finally {
      isSearching = false
    }
  }

  let initialSearchDone = false
  $effect(() => {
    if (initialSearchDone) return
    initialSearchDone = true
    const q = searchQuery.trim()
    if (q) triggerSearch(q, activeTab)
  })

  function clearSearch() {
    searchQuery   = ''
    searchResults = []
    searchError   = false
    if (debounceTimer) clearTimeout(debounceTimer)
  }
</script>

<svelte:head>
  <title>크레이지로그 목록 — CRAZYSHOT</title>
</svelte:head>

<!-- ══════════════════════════════════════════════════════════════
     Crazylog 목록 리스트 — 퍼블리싱 소스: Publish Crazylog list Design/App.tsx
══════════════════════════════════════════════════════════════ -->
<SubGnb title="모든 로그" noGnbOffset />

<div class="list-root">
  <div class="list-wrap">

    <!-- ② 공통: TabMenu + 검색창 ───────────────────────────── -->
    <div class="tab-section">
      <div class="tab-inner">
        {#each TABS as tab}
          <button
            class="tab-btn"
            class:tab-btn-active={activeTab === tab}
            onclick={() => onTabClick(tab)}
          >
            {tab}
          </button>
        {/each}
      </div>
      <!-- 검색 입력 (모바일 전용: tab-section 내, PC는 pc-search-wrap에서 별도 노출)
           2026-10-05(Stephen 지시): 콘텐츠 검색은 통합 검색 화면에서 통합 제공 예정 — 통합 검색 구현 전까지 이 목록 화면의 검색창은 관리자 계정에만 노출 -->
      {#if data.isAdmin}
      <div class="search-wrap">
        <div class="search-bar">
          <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
            <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <input
            type="search"
            class="search-input"
            placeholder="로그 검색..."
            value={searchQuery}
            oninput={onSearchInput}
            aria-label="크레이지로그 검색"
          />
          {#if searchQuery}
            <button class="search-clear" onclick={clearSearch} aria-label="검색어 지우기">✕</button>
          {/if}
        </div>
        {#if isSearching}
          <p class="search-status">검색 중...</p>
        {:else if searchQuery && searchResults.length === 0 && !searchError}
          <p class="search-status">"{searchQuery}"에 대한 결과가 없습니다.</p>
        {:else if searchError}
          <p class="search-status search-status-error">검색 중 오류가 발생했습니다.</p>
        {/if}
      </div>
      {/if}
    </div>

    <!-- ③ 모바일 전용: WriteCtaCard ─────────────────────────── -->
    <div class="m-write-cta">
      <div class="m-cta-card">
        <div class="m-cta-text">
          <p class="m-cta-title">내로그 등록</p>
          <p class="m-cta-sub">멋진 로그로 <span class="m-cta-accent">내 채널</span> 알리기</p>
        </div>
        <a href="/crazylog/new" class="m-write-btn" aria-label="로그 작성하기">
          <svg width="25" height="27" viewBox="0 0 25 27" fill="none" aria-hidden="true">
            <path fill-rule="evenodd" clip-rule="evenodd"
              d="M17.5 2.5L22.5 7.5L8.5 21.5H3.5V16.5L17.5 2.5ZM17.5 5.33L19.67 7.5L7.5 19.67V18.5H6.33L17.5 5.33ZM3.5 23.5H21.5V25.5H3.5V23.5Z"
              fill="white"/>
          </svg>
        </a>
      </div>
    </div>

    <!-- ④ 모바일 전용: MobileContentList ────────────────────── -->
    <div class="m-content">
      <div class="m-posts">
        {#if displayPosts.length === 0 && !isSearching}
          <p class="m-empty">{searchQuery ? '검색 결과가 없습니다.' : '아직 등록된 로그가 없습니다.'}</p>
        {:else}
          {#each displayPosts as post (post.id)}
            <div class="row-wrap" class:row-dim={isDimmed(post)}>
              <a href="/crazylog/view/{post.id}" class="m-post-card" aria-label={data.isAdmin ? undefined : post.title}>
                {#if post.thumbnailUrl}
                  <img src={post.thumbnailUrl} alt="" loading="lazy" class="m-post-bg" aria-hidden="true" />
                {:else}
                  <div class="m-post-bg m-post-bg-empty" aria-hidden="true"></div>
                {/if}
                <div class="m-post-overlay" aria-hidden="true"></div>
                <div class="m-post-content">
                  <span class="m-post-date">{post.logType} · {relativeTime(post.createdAt)}</span>
                  <p class="m-post-title">{post.title}</p>
                  <div class="meta-row">
                    <p class="m-post-meta">by {post.author}</p>
                    {#if data.isAdmin}{@render RowActions(post)}{/if}
                  </div>
                </div>
              </a>
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <!-- ⑤ PC 전용: PcContentList ───────────────────────────── -->
    <div class="pc-content">
      <div class="pc-inner">

        <!-- PcIndexBar + PC 검색창 -->
        <div class="pc-top-bar">
          <!-- PC 전용 검색창 — 탭 필 위 단독 행, 가로폭 100%(2026-10-05, Stephen 지시: 인덱스 바 우측 끝 → 상위 단독 행) -->
          {#if data.isAdmin}
          <div class="pc-search-wrap">
            <div class="search-bar pc-search-bar">
              <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
                <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <input
                type="search"
                class="search-input"
                placeholder="로그 검색..."
                value={searchQuery}
                oninput={onSearchInput}
                aria-label="크레이지로그 검색"
              />
              {#if searchQuery}
                <button class="search-clear" onclick={clearSearch} aria-label="검색어 지우기">✕</button>
              {/if}
            </div>
            {#if isSearching}
              <p class="search-status">검색 중...</p>
            {:else if searchQuery && searchResults.length === 0 && !searchError}
              <p class="search-status">"{searchQuery}"에 대한 결과가 없습니다.</p>
            {:else if searchError}
              <p class="search-status search-status-error">검색 중 오류가 발생했습니다.</p>
            {/if}
          </div>
          {/if}
          <div class="pc-index-bar">
            {#each PC_STAT_TABS as stat}
              <button
                class="pc-stat-pill"
                class:pc-stat-pill-active={activeTab === stat.tab}
                onclick={() => onTabClick(stat.tab)}
              >
                <span class="pc-stat-label">{stat.label}</span>
                <span class="pc-stat-count-pill">{data.counts[stat.countKey]}</span>
              </button>
            {/each}
          </div>
        </div>

        <!-- PC 포스트 목록 -->
        <div class="pc-posts">
          {#if displayPosts.length === 0 && !isSearching}
            <p class="pc-empty">{searchQuery ? '검색 결과가 없습니다.' : '아직 등록된 로그가 없습니다.'}</p>
          {:else}
            {#each displayPosts as post (post.id)}
              <div class="row-wrap" class:row-dim={isDimmed(post)}>
                <a href="/crazylog/view/{post.id}" class="pc-post">
                  <div class="pc-bar" style="background: {barColor(post.logType)}"></div>
                  <div class="pc-text">
                    <span class="pc-log-type">{post.logType}</span>
                    <p class="pc-title">{post.title}</p>
                    <div class="meta-row">
                      <p class="pc-meta">{relativeTime(post.createdAt)}·by {post.author}</p>
                      {#if data.isAdmin}{@render RowActions(post)}{/if}
                    </div>
                  </div>
                  <div class="pc-thumb">
                    <img
                      src={post.thumbnailUrl ?? '/crazylog/content-hero.png'}
                      alt={post.title}
                      loading="lazy"
                      class="pc-thumb-img"
                    />
                  </div>
                </a>
              </div>
            {/each}
          {/if}
        </div>

      </div>
    </div>

  </div>
</div>

<!-- 관리자 행 우측 조작(2026-10-05): 비공개 콤보 버튼(켜짐=비공개) + 삭제 아이콘(front-uiux §16 콤보·§25 삭제 표준) -->
{#snippet RowActions(post: ListPost)}
  <!-- 카드 링크 안쪽(작성자·날짜 줄 우측)에 있으므로 조작 버튼 클릭이 상세 이동으로 이어지지 않게 이 래퍼에서 기본 동작(링크 이동)을 막는다 -->
  <div class="row-actions" role="presentation" onclick={(e) => e.preventDefault()}>
    <button
      type="button"
      class="priv-btn"
      class:priv-btn-on={post.isPublic === false}
      aria-pressed={post.isPublic === false}
      disabled={privacyBusyId === post.id}
      onclick={() => togglePublic(post)}
    >비공개</button>
    {#if post.canDelete}
      <DeleteIconButton
        ariaLabel="로그 삭제"
        confirming={deleteSafety.pendingKey === post.id}
        disabled={deleteSafety.busyKey === post.id}
        onclick={() => deleteSafety.handleAction(post.id, () => deletePost(post))}
      />
    {/if}
  </div>
{/snippet}

<CrazylogWriteCard
  currentUser={data.currentUser}
  isLoggedIn={data.isLoggedIn}
  visible={writeCardVisible}
/>

<style>
  /* ── 관리자 행 조작 / 비공개 흐림(2026-10-05) ──────────────────── */
  /* 비공개 글: 카드 내용만 50% 흐리게(조작 버튼은 정상 노출) — 조작 버튼이 카드 링크 안(작성자·날짜 줄 우측)에 있어 카드 전체 opacity를 쓰지 않는다 */
  .row-dim .pc-post { background: color-mix(in srgb, var(--cs-white) 50%, transparent); }
  /* 모바일 이미지 카드: 어두운 카드 바탕 위에서 사진·글자만 흐리게(조작 버튼은 정상 노출) */
  .row-dim :is(.m-post-bg, .m-post-date, .m-post-title, .m-post-meta) { opacity: 0.5; }
  .row-dim :is(.pc-bar, .pc-thumb, .pc-log-type, .pc-title, .pc-meta) { opacity: 0.5; }
  /* 작성자·날짜 줄 + 우측 끝 관리자 조작 */
  .meta-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .row-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  /* 비공개 콤보 버튼 — front-uiux §16 (PC 9px 16px / 모바일 8px 12px, 라벨 13px/12px Bold, 반경 30px). 비선택=lilac 면, 선택=purple 채움 */
  .priv-btn {
    padding: 9px 16px;
    border: none;
    border-radius: var(--radius-xl, 30px);
    background: var(--cs-lilac);
    color: var(--cs-text);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
  }
  .priv-btn:hover:not(:disabled) { background: var(--cs-purple-op10); }
  .priv-btn-on { background: var(--cs-purple); color: #fff; }
  .priv-btn-on:hover:not(:disabled) { background: var(--cs-purple-light, #553FE0); }
  .priv-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  @media (max-width: 640px) {
    .priv-btn { padding: 8px 12px; font-size: 12px; }
  }

  /* ── 루트 컨테이너 ─────────────────────────────────────────── */
  .list-root {
    background: var(--cs-lilac);
    min-height: 100dvh; /* 100vh 툴바 재계산 잔떨림 방지 — 되돌리지 말 것(front-uiux §19) */
    width: 100%;
  }
  .list-wrap {
    width: 100%;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
  }


  /* ── TabMenu (모바일 전용) ────────────────────────────────── */
  .tab-section {
    width: 100%;
    padding: 50px 25px 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  @media (min-width: 768px) {
    .tab-section { display: none; }
  }
  .tab-inner {
    display: flex;
    align-items: center;
    max-width: 1240px;
    margin: 0 auto;
    width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tab-inner::-webkit-scrollbar { display: none; }
  .tab-btn {
    flex-shrink: 0;
    padding: 10px 30px;
    border-radius: var(--radius-xl);
    border: none;
    cursor: pointer;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 16px;
    letter-spacing: -0.5px;
    line-height: 1.6;
    background: transparent;
    color: var(--cs-text);
    min-height: 44px;
    transition: background 0.15s, color 0.15s;
  }
  .tab-btn-active {
    background: var(--cs-purple-dark);
    color: var(--cs-white);
  }

  /* ── 검색창 공통 ──────────────────────────────────────────── */
  .search-wrap {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .search-bar {
    display: flex;
    align-items: center;
    background: var(--cs-white);
    border: 1.5px solid var(--cs-lilac);
    border-radius: var(--radius-xl);
    padding: 0 16px;
    gap: 8px;
    height: 44px;
    transition: border-color 0.15s;
  }
  .search-bar:focus-within {
    border-color: var(--cs-purple);
  }
  .search-icon {
    color: var(--cs-text-mid);
    flex-shrink: 0;
  }
  .search-input {
    flex: 1;
    border: none;
    outline: none;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    color: var(--cs-text);
    background: transparent;
    min-width: 0;
  }
  .search-input::placeholder {
    color: var(--cs-text-light);
  }
  /* native search clear 버튼 숨김 */
  .search-input::-webkit-search-cancel-button { display: none; }
  .search-clear {
    flex-shrink: 0;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--cs-text-mid);
    font-size: 12px;
    padding: 4px;
    min-height: 24px;
    min-width: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .search-status {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    color: var(--cs-text-mid);
    margin: 0;
    padding: 0 4px;
  }
  .search-status-error {
    color: var(--cs-error, #e53e3e);
  }

  /* ── WriteCtaCard (모바일 전용) ───────────────────────────── */
  .m-write-cta {
    width: 100%;
    padding: 50px 25px 30px;
  }
  .m-cta-card {
    background: var(--cs-white);
    border-radius: var(--radius-md);  /* card.mobile = 15px (front design system) */
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 30px;
  }
  .m-cta-text {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .m-cta-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 18px;
    color: var(--cs-text);
    letter-spacing: -0.3px;
    line-height: 1.6;
    margin: 0;
  }
  .m-cta-sub {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 500;
    font-size: 14px;
    color: var(--cs-text-dark);
    letter-spacing: -0.5px;
    line-height: 1.6;
    margin: 0;
  }
  .m-cta-accent {
    color: var(--cs-purple-light);
  }
  .m-write-btn {
    background: var(--cs-purple-light);
    border-radius: 25px;
    width: 70px;
    height: 70px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    cursor: pointer;
    transition: filter 0.15s;
    text-decoration: none;
  }
  .m-write-btn:hover { filter: brightness(1.1); }

  /* ── MobileContentList (모바일 전용) ─────────────────────── */
  .m-content {
    width: 100%;
    border-radius: 0 50px 0 50px;
    padding: 70px 25px 100px; /* 하단 100px = 화면 하단 고정 글쓰기 카드(bottom 24px + 높이)가 마지막 카드를 가리지 않게 확보 */
    background: linear-gradient(
      to bottom,
      rgba(225, 222, 243, 0.95) 0%,
      rgba(225, 222, 243, 0.8) 26%,
      rgba(225, 222, 243, 0) 50.5%
    );
  }
  .m-posts {
    display: flex;
    flex-direction: column;
    gap: 50px;
    width: 100%;
  }
  /* 모바일 콘텐츠 카드 — 크레이지로그 홈(.m-article-card)과 같은 BG 이미지 + 오버레이 + 흰 텍스트 */
  .m-post-card {
    position: relative;
    display: block;
    width: 100%;
    height: 264px;
    border-radius: 30px;
    overflow: hidden;
    background: var(--cs-dark);
    text-decoration: none;
    color: inherit;
  }
  .m-post-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  .m-post-bg-empty { background: var(--cs-dark); }
  .m-post-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to top,
      rgba(16, 11, 50, 0.82) 0%,
      rgba(16, 11, 50, 0.30) 60%,
      rgba(16, 11, 50, 0.05) 100%
    );
  }
  .m-post-content {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 18px 22px 20px;
    gap: 4px;
  }
  .m-post-date {
    font: var(--text-m-script-12);
    color: rgba(255, 255, 255, 0.65);
    letter-spacing: 0.2px;
  }
  .m-empty {
    text-align: center;
    color: var(--cs-text-light);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    padding: 40px 0;
    margin: 0;
  }
  .m-post-title {
    font: var(--text-m-ad-kr-18);
    color: var(--cs-white);
    margin: 0;
    line-height: 1.4;
    letter-spacing: -0.3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .m-post-meta {
    font: var(--text-m-script-14B);
    color: rgba(255, 255, 255, 0.70);
    letter-spacing: -0.3px;
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── PcContentList (PC 전용) ──────────────────────────────── */
  .pc-content {
    width: 100%;
    border-radius: 0 50px 0 50px;
    padding: 60px 25px 100px; /* sub-GNB만 — main GNB 미렌더(+layout) */
    background: linear-gradient(
      to bottom,
      rgba(225, 222, 243, 0.95) 0%,
      rgba(225, 222, 243, 0.8) 26%,
      rgba(225, 222, 243, 0) 50.5%
    );
  }
  .pc-inner {
    max-width: 1240px;
    margin: 0 auto;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 50px;
  }

  /* PC 상단 바 (인덱스 + 검색창) */
  /* 검색창(위 단독 행, 100%) → 탭 필 줄 순서로 세로 배치(2026-10-05) */
  .pc-top-bar {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
  }
  .pc-search-wrap {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
  }
  .pc-search-bar {
    height: 44px;
  }

  /* PcIndexBar */
  .pc-index-bar {
    flex: 1;
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  .pc-stat-pill {
    background: var(--cs-purple);
    flex: 1;
    border-radius: var(--radius-xl);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 27px 40px;
    border: none;
    cursor: pointer;
    transition: background 0.2s, transform 0.2s, box-shadow 0.2s;
    min-height: 44px;
  }
  .pc-stat-pill-active {
    background: var(--cs-purple);
  }
  .pc-stat-pill:hover:not(.pc-stat-pill-active) {
    background: var(--cs-purple-light);
    transform: translateY(-3px);
    box-shadow: 0 8px 28px rgba(85,63,224,0.45);
  }
  .pc-stat-label {
    font-family: 'Tilt Warp', sans-serif;
    font-size: 20px;
    color: var(--cs-white);
    letter-spacing: -0.5px;
    line-height: 1.6;
  }
  .pc-stat-count-pill {
    background: rgba(255,255,255,0.15);
    border-radius: 9999px;
    padding: 2px 12px;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 16px;
    color: var(--cs-white);
    line-height: 2;
  }

  /* PC 포스트 목록 */
  .pc-posts {
    display: flex;
    flex-direction: column;
    gap: 20px;          /* 50px → 20px: 카드 간 여백 축소 */
    width: 100%;
  }
  .pc-post {
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    overflow: hidden;
    display: flex;
    align-items: stretch;
    width: 100%;
    height: 180px;
    text-decoration: none;
    color: inherit;
  }
  .pc-bar {
    width: 15px;
    flex-shrink: 0;
  }
  .pc-text {
    flex: 7;            /* 70% */
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 12px;
    padding: 24px 30px; /* 40px → 24px 30px */
  }
  .pc-title {
    font: var(--text-pc-title-16);
    color: var(--cs-text-dark);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin: 0;
  }
  .pc-log-type {
    font: var(--text-pc-tag-11);
    color: var(--cs-purple);
    letter-spacing: 0.3px;
    text-transform: uppercase;
    margin: 0 0 4px;
    display: block;
  }
  .pc-meta {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    letter-spacing: -0.3px;
    margin: 0;
  }
  .pc-thumb {
    flex: 3;               /* 30% */
    flex-shrink: 0;
    overflow: hidden;
    border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
    background: var(--cs-lilac);
  }
  .pc-thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .pc-empty {
    text-align: center;
    color: var(--cs-text-light);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    padding: 40px 0;
    margin: 0;
  }

  /* ── 반응형 ───────────────────────────────────────────────── */
  @media (max-width: 767px) {
    .list-wrap  { max-width: 430px; }
    .pc-content { display: none; }
  }

  @media (min-width: 768px) {
    .list-wrap  { max-width: 1600px; }
    .m-write-cta,
    .m-content  { display: none; }
    /* sub-GNB만 — main GNB 미렌더(+layout) */
    .tab-section { padding-top: 50px; }
  }
</style>
