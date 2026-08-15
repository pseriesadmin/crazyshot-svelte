<script lang="ts">
  // /cms/chat/qna — 빠른답변(QnA) 관리 화면
  // master-detail 구조: /cms/reservation/contracts 패턴 참고
  import { goto, invalidateAll } from '$app/navigation'
  import { enhance } from '$app/forms'
  import { page } from '$app/state'
  import CannedResponsePanel from '$lib/components/cms/CannedResponsePanel.svelte'
  import { csToast } from '$lib/utils/toast'
  import { CANNED_RESPONSE_CATEGORIES, getCategoryLabel } from '$lib/constants/cannedResponseCategories'
  import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
  import type { PageData } from './$types'
  import type { CannedResponseRow, SynonymCandidateRow } from './+page.server'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // 탭 상태 — 빠른답변(qna) | 동의어 후보(candidates)
  type ActiveTab = 'qna' | 'candidates'
  let activeTab = $state<ActiveTab>('qna')

  // 로컬 UI 상태
  let showNew      = $state(false)
  let searchQuery  = $state('')
  let filterCat    = $state<string | null>(null)
  type SortKey = 'usage' | 'title' | 'newest'
  let sortKey      = $state<SortKey>('usage')
  let autoReply    = $state(data.autoReplyEnabled)
  let isTogglingAR = $state(false)

  // §D-2: 병기패턴 재스캔 상태
  let isRescanning = $state(false)
  // §G-3: 재검색패턴 재스캔 상태
  let isReformulationScanning = $state(false)

  // autoReply를 data 갱신과 동기화
  $effect(() => { autoReply = data.autoReplyEnabled })

  const canManageAR = $derived(hasSettingsAccess(data.cmsRole ?? ''))
  const canManageCandidates = $derived(hasSettingsAccess(data.cmsRole ?? ''))

  // 필터·검색·정렬된 목록
  const filteredItems = $derived.by<CannedResponseRow[]>(() => {
    let list = data.items as CannedResponseRow[]
    if (filterCat) list = list.filter((i) => i.category === filterCat)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.shortcut ?? '').toLowerCase().includes(q) ||
          i.content.toLowerCase().includes(q),
      )
    }
    list = [...list].sort((a, b) => {
      if (sortKey === 'usage')  return b.usage_count - a.usage_count || a.title.localeCompare(b.title, 'ko')
      if (sortKey === 'title')  return a.title.localeCompare(b.title, 'ko')
      if (sortKey === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      return 0
    })
    return list
  })

  function selectItem(id: string): void {
    showNew = false
    const params = new URLSearchParams(page.url.searchParams)
    params.set('selected', id)
    goto(`?${params.toString()}`, { replaceState: true, noScroll: true })
  }

  function closePanel(): void {
    showNew = false
    const params = new URLSearchParams(page.url.searchParams)
    params.delete('selected')
    goto(`?${params.toString()}`, { replaceState: true, noScroll: true })
  }

  function openNew(): void {
    const params = new URLSearchParams(page.url.searchParams)
    params.delete('selected')
    goto(`?${params.toString()}`, { replaceState: true, noScroll: true })
    showNew = true
  }

  async function handleCreated(id: string): Promise<void> {
    await invalidateAll()
    selectItem(id)
    showNew = false
  }

  async function toggleAutoReply(): Promise<void> {
    if (!canManageAR || isTogglingAR) return
    isTogglingAR = true
    try {
      const res = await fetch('/api/cms/auto-reply-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !autoReply }),
      })
      if (res.ok) {
        autoReply = !autoReply
        csToast.success(`자동답변 ${autoReply ? 'ON' : 'OFF'}`)
        await invalidateAll()
      } else if (res.status === 403) {
        csToast.error('매니저 이상만 자동답변 스위치를 변경할 수 있습니다.')
      } else if (res.status === 404) {
        csToast.error('자동답변 설정 테이블이 아직 준비되지 않았습니다. (마이그레이션 적용 필요)')
      } else {
        const d = await res.json().catch(() => ({})) as { error?: string }
        csToast.error(d.error ?? '저장 실패')
      }
    } finally {
      isTogglingAR = false
    }
  }

  function formatDate(iso: string): string {
    return iso.slice(0, 10)
  }

  // §D-2: 병기패턴 재스캔 — backfill API 호출
  async function rescanCrossLingual(): Promise<void> {
    if (isRescanning) return
    isRescanning = true
    try {
      const res = await fetch('/api/cms/synonyms/backfill-cross-lingual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const d = await res.json().catch(() => ({})) as {
        pairsRegistered?: number
        timed_out?: boolean
        message?: string
        error?: string
      }
      if (!res.ok) {
        csToast.error(d.error ?? '재스캔 실패')
        return
      }
      const pairs = d.pairsRegistered ?? 0
      const note = d.timed_out ? ' (시간 초과 — 부분 완료)' : ''
      csToast.success(`병기패턴 재스캔 완료: ${pairs}건 등록${note}`)
      await invalidateAll()
    } catch {
      csToast.error('네트워크 오류')
    } finally {
      isRescanning = false
    }
  }

  // §G-3: 재검색패턴 재스캔 — scan-reformulations API 호출
  async function rescanReformulation(): Promise<void> {
    if (isReformulationScanning) return
    isReformulationScanning = true
    try {
      const res = await fetch('/api/cms/synonyms/scan-reformulations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const d = await res.json().catch(() => ({})) as {
        totalPairs?: number
        registeredPairs?: number
        elapsed_s?: number
        message?: string
        error?: string
      }
      if (!res.ok) {
        csToast.error(d.error ?? '재스캔 실패')
        return
      }
      const registered = d.registeredPairs ?? 0
      csToast.success(`재검색패턴 재스캔 완료: ${registered}건 등록`)
      await invalidateAll()
    } catch {
      csToast.error('네트워크 오류')
    } finally {
      isReformulationScanning = false
    }
  }

  // §G-4: 출처 배지 라벨 — 4종 전부 표시
  function sourceLabel(source: string): string {
    if (source === 'cross_lingual_pattern') return '병기패턴'
    if (source === 'query_reformulation') return '재검색패턴'
    if (source === 'learned') return '학습'
    if (source === 'seed') return '시드'
    return source
  }

  function statusLabel(status: string): string {
    if (status === 'pending') return '대기'
    if (status === 'confirmed') return '확정'
    if (status === 'rejected') return '거부'
    return status
  }
</script>

<svelte:head><title>QnA — CrazyShot CMS</title></svelte:head>

<div class="qna-page">
  <div class="qna-card">

  <!-- §D-2: 탭 스위처 — 빠른답변 | 동의어 후보 -->
  <div class="tab-bar-nav" role="tablist" aria-label="QnA 탭">
    <button
      class="tab-nav-btn"
      class:tab-active={activeTab === 'qna'}
      role="tab"
      aria-selected={activeTab === 'qna'}
      onclick={() => { activeTab = 'qna'; showNew = false }}
    >빠른답변 <span class="tab-count">{data.items.length}</span></button>
    <button
      class="tab-nav-btn"
      class:tab-active={activeTab === 'candidates'}
      role="tab"
      aria-selected={activeTab === 'candidates'}
      onclick={() => { activeTab = 'candidates'; showNew = false }}
    >동의어 후보 <span class="tab-count">{data.synonymCandidates.length}</span></button>
  </div>

  {#if activeTab === 'qna'}
  <!-- 툴바 -->
  <div class="toolbar">
      <div class="toolbar-left">
        <h2 class="page-title">빠른답변</h2>
        <span class="count-badge">{data.items.length}건</span>
      </div>
      <div class="toolbar-right">
        <!-- 검색 -->
        <div class="search-wrap">
          <span class="search-icon" aria-hidden="true">🔍</span>
          <input
            type="text"
            class="search-input"
            placeholder="제목·단축키·내용 검색"
            bind:value={searchQuery}
            aria-label="검색"
          />
          {#if searchQuery}
            <button class="search-clear" onclick={() => searchQuery = ''} aria-label="검색어 지우기">✕</button>
          {/if}
        </div>

        <!-- 카테고리 필터 -->
        <div class="filter-pills" role="group" aria-label="카테고리 필터">
          <button
            class="filter-pill"
            class:active={filterCat === null}
            onclick={() => filterCat = null}
          >전체</button>
          {#each CANNED_RESPONSE_CATEGORIES as cat}
            <button
              class="filter-pill"
              class:active={filterCat === cat.value}
              onclick={() => filterCat = cat.value}
            >{cat.label}</button>
          {/each}
        </div>

        <!-- 정렬 -->
        <div class="sort-wrap">
          <button
            class="sort-btn"
            class:active={sortKey === 'usage'}
            onclick={() => sortKey = 'usage'}
            title="사용횟수 높은 순"
          >사용순</button>
          <button
            class="sort-btn"
            class:active={sortKey === 'title'}
            onclick={() => sortKey = 'title'}
            title="제목 가나다순"
          >제목순</button>
          <button
            class="sort-btn"
            class:active={sortKey === 'newest'}
            onclick={() => sortKey = 'newest'}
            title="최신 등록순"
          >최신순</button>
        </div>

        <!-- 자동답변 ON/OFF 토글 -->
        <div class="ar-toggle-wrap">
          <span class="ar-label">자동답변</span>
          <button
            class="ar-toggle"
            class:ar-on={autoReply}
            onclick={toggleAutoReply}
            disabled={!canManageAR || isTogglingAR}
            title={canManageAR ? (autoReply ? 'OFF로 끄기' : 'ON으로 켜기') : '매니저 이상만 변경 가능'}
            aria-pressed={autoReply}
            aria-label="자동답변 {autoReply ? 'ON' : 'OFF'}"
          >
            <span class="ar-thumb"></span>
            <span class="ar-text">{autoReply ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        <!-- 신규 등록 -->
        {#if !showNew}
          <button class="cta-btn" onclick={openNew}>+ 신규 등록</button>
        {:else}
          <button class="cancel-btn" onclick={closePanel}>목록으로</button>
        {/if}
      </div>
  </div>

  <!-- master-detail -->
  <div class="master-detail">
    <!-- 좌측 목록 -->
    <div class="list-pane">
      {#if filteredItems.length === 0}
        <div class="empty-list">
          {#if searchQuery || filterCat}
            <p>검색 결과가 없습니다.</p>
          {:else}
            <p>빠른답변이 없습니다.</p>
            <p class="empty-sub">+ 신규 등록으로 추가하세요.</p>
          {/if}
        </div>
      {:else}
        {#each filteredItems as item (item.id)}
          <button
            class="item-card"
            class:selected={data.selectedId === item.id}
            onclick={() => selectItem(item.id)}
          >
            <div class="ic-top">
              <span class="ic-title">{item.title}</span>
              {#if item.category}
                <span class="ic-cat">{getCategoryLabel(item.category)}</span>
              {/if}
            </div>
            <div class="ic-mid">
              <span class="ic-content">{item.content.slice(0, 60)}{item.content.length > 60 ? '…' : ''}</span>
            </div>
            <div class="ic-foot">
              {#if item.shortcut}
                <span class="ic-shortcut">/{item.shortcut}</span>
              {/if}
              <span class="ic-usage">{item.usage_count}회</span>
              <span class="ic-date">{formatDate(item.created_at)}</span>
            </div>
          </button>
        {/each}
      {/if}
    </div>

    <!-- 우측 상세 패널 -->
    <div class="detail-pane">
      {#if showNew}
        <CannedResponsePanel item={null} onclose={closePanel} oncreated={handleCreated} />
      {:else if data.selectedItem}
        {#key data.selectedId}
          <CannedResponsePanel
            item={data.selectedItem}
            onclose={closePanel}
            oncreated={handleCreated}
          />
        {/key}
      {:else}
        <div class="no-selection">
          <p>항목을 선택하거나<br/>+ 신규 등록으로 추가하세요.</p>
        </div>
      {/if}
    </div>
  </div>
  {/if}

  {#if activeTab === 'candidates'}
  <!-- §D-2: 동의어 후보 관리 탭 -->
  <div class="cand-toolbar">
    <div class="toolbar-left">
      <h2 class="page-title">동의어 후보</h2>
      <span class="count-badge">{data.synonymCandidates.length}건</span>
    </div>
    <div class="toolbar-right">
      <!-- §G-6: 재검색패턴 재스캔 — 매일 새벽 3시 자동 실행, 수동 즉시 트리거 가능 -->
      <div class="scan-group">
        <span class="scan-auto-label">매일 새벽 3시 자동 스캔</span>
        <button
          class="cta-btn cta-secondary"
          onclick={rescanReformulation}
          disabled={isReformulationScanning || isRescanning}
          title="search_logs에서 '원 검색 0건→재검색 성공' 쌍을 추출합니다 (자동: 매일 새벽 3시)"
        >{isReformulationScanning ? '스캔 중…' : '지금 바로 재검색패턴 재스캔'}</button>
      </div>
      <!-- 병기패턴 재스캔 -->
      <button
        class="cta-btn"
        onclick={rescanCrossLingual}
        disabled={isRescanning || isReformulationScanning}
        title="상품·채팅·CS 기록에서 이중언어 병기패턴을 다시 스캔합니다"
      >{isRescanning ? '스캔 중…' : '병기패턴 재스캔'}</button>
    </div>
  </div>

  <div class="cand-body">
    {#if data.synonymCandidates.length === 0}
      <div class="cand-empty">
        <p>아직 등록된 동의어 후보가 없습니다.</p>
        <p class="cand-empty-sub">"병기패턴 재스캔" 또는 "재검색패턴 재스캔" 버튼을 누르거나, 상품 등록·채팅 발송 후 자동으로 수집됩니다.</p>
      </div>
    {:else}
      <div class="cand-table-wrap">
        <table class="cand-table">
          <thead>
            <tr>
              <th>동의어 그룹</th>
              <th>후보어</th>
              <th>출처</th>
              <th>발생</th>
              <th>상태</th>
              <th>등록일</th>
              {#if canManageCandidates}<th>액션</th>{/if}
            </tr>
          </thead>
          <tbody>
            {#each data.synonymCandidates as row (row.id)}
              <tr class="cand-row" class:cand-confirmed={row.status === 'confirmed'}>
                <td class="cand-group">{row.canonical_term}</td>
                <td class="cand-term">{row.term}</td>
                <td>
                  <span class="src-badge src-{row.source}">
                    {sourceLabel(row.source)}
                  </span>
                </td>
                <td class="cand-count">{row.occurrence_count}</td>
                <td>
                  <span class="status-badge status-{row.status}">
                    {statusLabel(row.status)}
                  </span>
                </td>
                <td class="cand-date">{formatDate(row.created_at)}</td>
                {#if canManageCandidates}
                  <td class="cand-actions">
                    {#if row.status !== 'confirmed'}
                      <form
                        method="POST"
                        action="?/promoteCandidate"
                        use:enhance={() => {
                          return async ({ result, update }) => {
                            if (result.type === 'success') {
                              csToast.success(`"${row.term}" 확정 완료`)
                              await invalidateAll()
                            } else {
                              csToast.error('승급 실패')
                            }
                            await update()
                          }
                        }}
                      >
                        <input type="hidden" name="id" value={row.id} />
                        <button type="submit" class="act-confirm-btn" title="confirmed로 승급">확정</button>
                      </form>
                    {/if}
                    <form
                      method="POST"
                      action="?/deleteCandidateMember"
                      use:enhance={() => {
                        return async ({ result, update }) => {
                          if (result.type === 'success') {
                            csToast.success(`"${row.term}" 삭제`)
                            await invalidateAll()
                          } else {
                            csToast.error('삭제 실패')
                          }
                          await update()
                        }
                      }}
                    >
                      <input type="hidden" name="id" value={row.id} />
                      <button type="submit" class="act-del" title="후보 삭제" aria-label="삭제">✕</button>
                    </form>
                  </td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
  {/if}

  </div>
</div>

<style>
  /* /cms/chat(채팅) 화면(AdminChatPanel.svelte .admin-panel)과 동일한 가로폭 규격:
     페이지 배경은 lilac + 16px 여백, 실제 콘텐츠는 그 안의 흰색 rounded 카드 하나.
     max-width로 억지로 좁히는 대신 카드 여백 자체가 "가장자리에 안 붙는" 느낌을 만든다. */
  .qna-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--cs-lilac);
    padding: 16px;
  }

  .qna-card {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg, 16px);
  }

  /* ── 툴바 ── */
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    padding: 16px 24px 12px;
    flex-shrink: 0;
    background: var(--cs-white);
    border-bottom: 1px solid var(--cs-lilac);
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .page-title {
    font: var(--text-pc-title-18, 700 18px/1.4 'Noto Sans KR', sans-serif);
    color: var(--cs-dark);
    margin: 0;
  }

  .count-badge {
    height: 22px;
    padding: 0 8px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border-radius: var(--radius-full, 99px);
    font: 700 11px/22px 'Noto Sans KR', sans-serif;
  }

  /* 검색 */
  .search-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--cs-surface-gray, #f6f6f6);
    border-radius: var(--radius-sm);
    padding: 0 10px;
    border: 1.5px solid var(--cs-lilac);
    transition: border-color 0.15s;
    min-width: 180px;
  }
  .search-wrap:focus-within { border-color: var(--cs-purple); }

  .search-icon { font-size: 13px; flex-shrink: 0; }

  .search-input {
    flex: 1;
    border: none;
    background: transparent;
    padding: 8px 0;
    font: 400 13px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-dark);
    min-width: 120px;
  }
  .search-input:focus { outline: none; }

  .search-clear {
    background: none;
    border: none;
    color: var(--cs-text-light, #aaa);
    font-size: 12px;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;
    min-height: 24px;
    transition: color 0.15s;
  }
  .search-clear:hover { color: var(--cs-dark); }

  /* 카테고리 필터 */
  .filter-pills {
    display: flex;
    gap: 4px;
  }

  .filter-pill {
    height: 30px;
    padding: 0 12px;
    border-radius: var(--radius-xl, 30px);
    border: 1.5px solid #DCDCDC;
    background: var(--cs-white);
    font: 700 12px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    cursor: pointer;
    transition: all 0.15s;
  }
  .filter-pill.active {
    background: var(--cs-purple);
    border-color: var(--cs-purple);
    color: var(--cs-white);
  }
  .filter-pill:hover:not(.active) { border-color: var(--cs-purple); color: var(--cs-purple); }

  /* 정렬 */
  .sort-wrap {
    display: flex;
    gap: 2px;
    background: var(--cs-surface-gray, #f6f6f6);
    border-radius: var(--radius-sm);
    padding: 3px;
    border: 1px solid var(--cs-lilac);
  }

  .sort-btn {
    height: 26px;
    padding: 0 10px;
    border-radius: 6px;
    border: none;
    background: transparent;
    font: 700 12px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    cursor: pointer;
    transition: all 0.15s;
  }
  .sort-btn.active {
    background: var(--cs-white);
    color: var(--cs-purple);
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }

  /* 자동답변 토글 */
  .ar-toggle-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--cs-surface-gray, #f6f6f6);
    border-radius: var(--radius-sm);
    border: 1px solid var(--cs-lilac);
  }

  .ar-label {
    font: 700 12px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    user-select: none;
  }

  .ar-toggle {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 10px;
    border-radius: 13px;
    border: none;
    background: #DCDCDC;
    cursor: pointer;
    transition: background 0.2s;
    position: relative;
  }
  .ar-toggle.ar-on { background: var(--cs-purple); }
  .ar-toggle:disabled { opacity: 0.5; cursor: not-allowed; }

  .ar-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--cs-white);
    flex-shrink: 0;
  }

  .ar-text {
    font: 700 11px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-white);
  }
  .ar-toggle:not(.ar-on) .ar-text { color: var(--cs-text-mid, #666); }

  /* CTA 버튼 */
  .cta-btn {
    height: 36px;
    padding: 0 18px;
    background: var(--cs-purple);
    border: none;
    border-radius: var(--radius-md, 15px);
    font: 700 13px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-white);
    cursor: pointer;
    transition: background 0.15s;
    flex-shrink: 0;
  }
  .cta-btn:hover { background: var(--cs-purple-hover, #2e2468); }
  /* 보조 CTA: 테두리형 */
  .cta-btn.cta-secondary {
    background: var(--cs-white);
    border: 1.5px solid var(--cs-purple);
    color: var(--cs-purple);
  }
  .cta-btn.cta-secondary:hover { background: rgba(59,47,138,0.06); }
  .cta-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .cancel-btn {
    height: 36px;
    padding: 0 18px;
    background: var(--cs-lilac);
    border: none;
    border-radius: var(--radius-md, 15px);
    font: 700 13px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    cursor: pointer;
    flex-shrink: 0;
  }

  /* ── master-detail ── */
  .master-detail {
    display: flex;
    flex: 1;
    overflow: hidden;
    gap: 0;
  }

  .list-pane {
    width: 320px;
    flex-shrink: 0;
    overflow-y: auto;
    border-right: 1px solid var(--cs-lilac);
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 8px;
    background: var(--cs-surface-gray, #f6f6f6);
  }

  .detail-pane {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 8px;
    background: var(--cs-surface-gray, #f6f6f6);
  }

  /* 목록 빈 상태 */
  .empty-list {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: 40px 20px;
    text-align: center;
    min-height: 200px;
  }
  .empty-list p {
    font: 700 14px/1.5 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    margin: 0;
  }
  .empty-sub {
    font: 400 13px/1.5 'Noto Sans KR', sans-serif !important;
    color: var(--cs-text-light, #aaa) !important;
    margin-top: 4px !important;
  }

  /* 아이템 카드 */
  .item-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px;
    background: var(--cs-white);
    border: 1.5px solid transparent;
    border-radius: var(--radius-sm);
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    width: 100%;
    box-sizing: border-box;
  }
  .item-card:hover { border-color: rgba(59,47,138,0.3); }
  .item-card.selected {
    border-color: var(--cs-purple);
    background: rgba(59,47,138,0.04);
  }

  .ic-top {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .ic-title {
    font: 700 14px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-dark);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ic-cat {
    height: 20px;
    padding: 0 8px;
    background: rgba(59,47,138,0.08);
    border-radius: var(--radius-full, 99px);
    font: 700 11px/20px 'Noto Sans KR', sans-serif;
    color: var(--cs-purple);
    flex-shrink: 0;
  }

  .ic-mid {
    font: 400 12px/1.5 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    word-break: break-all;
  }

  .ic-content {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ic-foot {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .ic-shortcut {
    font: 700 11px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-purple);
    background: rgba(59,47,138,0.08);
    padding: 2px 6px;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .ic-usage {
    font: 400 11px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-light, #aaa);
    margin-left: auto;
  }

  .ic-date {
    font: 400 11px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-light, #aaa);
    flex-shrink: 0;
  }

  /* 미선택 상태 */
  .no-selection {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    text-align: center;
    padding: 40px;
  }
  .no-selection p {
    font: 400 14px/1.7 'Noto Sans KR', sans-serif;
    color: var(--cs-text-light, #aaa);
    margin: 0;
  }

  /* ── §D-2: 탭 스위처 ── */
  .tab-bar-nav {
    display: flex;
    gap: 0;
    border-bottom: 2px solid var(--cs-lilac);
    flex-shrink: 0;
    background: var(--cs-white);
    padding: 0 20px;
  }

  .tab-nav-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 46px;
    padding: 0 18px;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    background: transparent;
    font: 700 14px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }
  .tab-nav-btn:hover { color: var(--cs-purple); }
  .tab-nav-btn.tab-active {
    color: var(--cs-purple);
    border-bottom-color: var(--cs-purple);
  }

  .tab-count {
    height: 18px;
    padding: 0 6px;
    background: var(--cs-lilac);
    border-radius: var(--radius-full, 99px);
    font: 700 10px/18px 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
  }
  .tab-nav-btn.tab-active .tab-count {
    background: rgba(59,47,138,0.12);
    color: var(--cs-purple);
  }

  /* §G-6: 재검색패턴 자동 스캔 안내 그룹 */
  .scan-group {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
  }

  .scan-auto-label {
    font: 400 11px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-light, #aaa);
    white-space: nowrap;
  }

  /* ── §D-2: 동의어 후보 탭 ── */
  .cand-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 14px 24px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--cs-lilac);
    background: var(--cs-white);
  }

  .cand-body {
    flex: 1;
    overflow: auto;
    padding: 16px 24px;
    background: var(--cs-surface-gray, #f6f6f6);
  }

  .cand-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    text-align: center;
  }
  .cand-empty p {
    font: 700 14px/1.5 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    margin: 0;
  }
  .cand-empty-sub {
    font: 400 13px/1.6 'Noto Sans KR', sans-serif !important;
    color: var(--cs-text-light, #aaa) !important;
    margin-top: 6px !important;
  }

  .cand-table-wrap {
    background: var(--cs-white);
    border-radius: var(--radius-sm);
    border: 1px solid var(--cs-lilac);
    overflow: auto;
  }

  .cand-table {
    width: 100%;
    border-collapse: collapse;
    font: 400 13px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
  }

  .cand-table th {
    padding: 10px 14px;
    background: var(--cs-surface-gray, #f6f6f6);
    font: 700 12px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    text-align: left;
    border-bottom: 1px solid var(--cs-lilac);
    white-space: nowrap;
  }

  .cand-table td {
    padding: 10px 14px;
    border-bottom: 1px solid var(--cs-lilac);
    vertical-align: middle;
  }

  .cand-row:last-child td { border-bottom: none; }
  .cand-row:hover td { background: rgba(59,47,138,0.02); }
  .cand-confirmed td { opacity: 0.6; }

  .cand-group {
    font: 700 13px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-dark);
  }

  .cand-term {
    font: 400 13px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
  }

  .cand-count {
    text-align: center;
    font: 700 13px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-purple);
  }

  .cand-date {
    font: 400 12px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-light, #aaa);
    white-space: nowrap;
  }

  /* 출처 배지 */
  .src-badge {
    display: inline-block;
    height: 20px;
    padding: 0 8px;
    border-radius: var(--radius-full, 99px);
    font: 700 11px/20px 'Noto Sans KR', sans-serif;
    white-space: nowrap;
  }
  .src-cross_lingual_pattern {
    background: rgba(59,47,138,0.10);
    color: var(--cs-purple);
  }
  .src-query_reformulation {
    background: rgba(255,69,0,0.10);
    color: var(--cs-orange, #FF4500);
  }
  /* §G-4: learned·seed 출처 배지 */
  .src-learned {
    background: rgba(40,167,69,0.10);
    color: #228b3b;
  }
  .src-seed {
    background: rgba(100,100,100,0.10);
    color: var(--cs-text-mid, #666);
  }

  /* 상태 배지 */
  .status-badge {
    display: inline-block;
    height: 20px;
    padding: 0 8px;
    border-radius: var(--radius-full, 99px);
    font: 700 11px/20px 'Noto Sans KR', sans-serif;
    white-space: nowrap;
  }
  .status-pending {
    background: rgba(220,220,220,0.5);
    color: var(--cs-text-mid, #666);
  }
  .status-confirmed {
    background: rgba(40,167,69,0.12);
    color: #228b3b;
  }
  .status-rejected {
    background: rgba(220,53,69,0.10);
    color: #c0392b;
  }

  /* 액션 버튼 */
  .cand-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .act-confirm-btn {
    height: 26px;
    padding: 0 10px;
    background: var(--cs-purple);
    border: none;
    border-radius: var(--radius-sm);
    font: 700 11px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-white);
    cursor: pointer;
    transition: background 0.15s;
  }
  .act-confirm-btn:hover { background: var(--cs-purple-hover, #2e2468); }

  /* CMS 표준 삭제 아이콘 버튼 (act-del) */
  .act-del {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    font: 700 12px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    min-width: 26px;
    min-height: 26px;
  }
  .act-del:hover {
    background: rgba(220,53,69,0.10);
    color: var(--cs-red-badge, #FF3535);
  }
</style>
