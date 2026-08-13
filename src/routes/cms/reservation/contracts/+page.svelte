<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation'
  import { page } from '$app/stores'
  import ContractTemplatePanel from '$lib/components/cms/ContractTemplatePanel.svelte'
  import CmsPagination from '$lib/components/cms/CmsPagination.svelte'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // 신규 작성 모드 (template=null로 패널 표시)
  let isNewMode = $state(false)

  // 검색
  let searchQuery = $state('')

  // 클라이언트 측 페이지네이션
  const PAGE_SIZE = 20
  let currentPage = $state(1)

  const filteredTemplates = $derived(
    searchQuery.trim()
      ? data.templates.filter((t) =>
          t.title.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : data.templates
  )

  const totalPages = $derived(Math.max(1, Math.ceil(filteredTemplates.length / PAGE_SIZE)))

  const pagedTemplates = $derived(
    filteredTemplates.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  )

  // 검색어 변경 시 첫 페이지로 리셋
  $effect(() => {
    void searchQuery
    currentPage = 1
  })

  const showPanel = $derived(isNewMode || (!!data.selectedId && !!data.selectedTemplate))

  function selectTemplate(id: string) {
    const params = new URLSearchParams($page.url.searchParams)
    params.set('selected', id)
    goto(`?${params.toString()}`, { replaceState: true, noScroll: true })
    isNewMode = false
  }

  function openNew() {
    const params = new URLSearchParams($page.url.searchParams)
    params.delete('selected')
    goto(`?${params.toString()}`, { replaceState: true, noScroll: true })
    isNewMode = true
  }

  function closePanel() {
    const params = new URLSearchParams($page.url.searchParams)
    params.delete('selected')
    goto(`?${params.toString()}`, { replaceState: true, noScroll: true })
    isNewMode = false
  }

  async function onSaved(id: string) {
    await invalidateAll()
    if (id) {
      isNewMode = false
      selectTemplate(id)
    } else {
      closePanel()
    }
  }

  function formatDate(dt: string): string {
    return dt.slice(0, 10)
  }

  const STATUS_LABEL: Record<string, string> = {
    active:   '활성',
    archived: '보관',
  }
</script>

<div class="contracts-page">
  <!-- 툴바 -->
  <div class="toolbar">
    <h2 class="page-title">계약서 양식</h2>
    <span class="count-badge">{data.templates.length}건</span>
    <div class="toolbar-right">
      <button class="cta-btn" onclick={openNew}>+ 작성</button>
    </div>
  </div>

  <!-- 메인 레이아웃: 좌측 목록 + 우측 에디터(에디터+필드패널 내장) -->
  <div class="main-layout">

    <!-- 좌측: 검색 + 목록 + 페이지네이션 -->
    <div class="list-pane">
      <div class="search-wrap">
        <input
          type="search"
          class="search-input"
          placeholder="양식 검색..."
          bind:value={searchQuery}
          aria-label="계약서 양식 검색"
        />
      </div>

      <div class="list-scroll">
        {#if filteredTemplates.length === 0}
          <div class="empty-state">
            {#if searchQuery}
              <p>검색 결과가 없습니다.</p>
            {:else}
              <p>등록된 계약서 양식이 없습니다.</p>
              <button class="cta-btn sm" onclick={openNew}>+ 첫 양식 작성</button>
            {/if}
          </div>
        {:else}
          {#each pagedTemplates as tpl (tpl.id)}
            {@const isSelected = !isNewMode && data.selectedId === tpl.id}
            <button
              type="button"
              class="tpl-card"
              class:selected={isSelected}
              onclick={() => selectTemplate(tpl.id)}
            >
              <span class="tpl-title">{tpl.title}</span>
              <div class="tpl-meta">
                <span class="status-badge" class:archived={tpl.status === 'archived'}>
                  {STATUS_LABEL[tpl.status] ?? tpl.status}
                </span>
                <span class="tpl-date">{formatDate(tpl.created_at)}</span>
              </div>
            </button>
          {/each}
        {/if}
      </div>

      {#if totalPages > 1}
        <div class="pagination-wrap">
          <CmsPagination
            page={currentPage}
            {totalPages}
            onpage={(p) => { currentPage = p }}
            variant="inline"
            ariaLabel="계약서 양식 목록 페이지"
          />
        </div>
      {/if}
    </div>

    <!-- 우측: 에디터 영역 — ContractTemplatePanel(내부에 에디터+필드패널 2열 포함) -->
    <div class="editor-area">
      {#if showPanel}
        {#if isNewMode}
          {#key '__new__'}
            <ContractTemplatePanel
              template={null}
              onclose={closePanel}
              onsaved={onSaved}
            />
          {/key}
        {:else if data.selectedTemplate}
          {#key data.selectedId}
            <ContractTemplatePanel
              template={data.selectedTemplate}
              onclose={closePanel}
              onsaved={onSaved}
            />
          {/key}
        {/if}
      {:else}
        <div class="editor-empty">
          <p>목록에서 양식을 선택하거나, 새 양식을 작성하세요.</p>
          <button class="cta-btn" onclick={openNew}>+ 새 양식 작성</button>
        </div>
      {/if}
    </div>

  </div>
</div>

<style>
  .contracts-page {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* 툴바 */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
    background: var(--cs-white);
  }
  .page-title {
    margin: 0;
    font: var(--text-pc-title-16);
    font-weight: 700;
    color: var(--cs-text);
  }
  .count-badge {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    background: var(--cs-surface-gray);
    padding: 2px 8px;
    border-radius: var(--radius-full);
  }
  .toolbar-right { margin-left: auto; }

  .cta-btn {
    height: 34px;
    padding: 0 16px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }
  .cta-btn:hover { background: var(--cs-purple-hover); }
  .cta-btn.sm { height: 30px; font: var(--text-pc-script-12); font-weight: 700; }

  /* 메인 3열 레이아웃:
     좌측 목록(280px) + 우측 에디터영역(flex:1)
     에디터영역 내부: ContractTemplatePanel이 에디터col(flex:1) + 필드패널col(220px) 2열 구성 */
  .main-layout {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* 좌측 목록 패널 */
  .list-pane {
    width: 280px;
    flex-shrink: 0;
    border-right: 1px solid var(--cs-lilac);
    background: var(--cs-white);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* 검색 */
  .search-wrap {
    padding: 10px 12px;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }
  .search-input {
    width: 100%;
    height: 32px;
    padding: 0 10px;
    border: 1px solid #DDDDDD;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    color: var(--cs-text);
    outline: none;
    background: var(--cs-surface-gray);
    transition: border-color 0.1s, background 0.1s;
    box-sizing: border-box;
  }
  .search-input:focus { border-color: var(--cs-purple); background: var(--cs-white); }

  /* 목록 스크롤 영역 */
  .list-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .tpl-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    padding: 12px 14px;
    border: none;
    border-bottom: 1px solid var(--cs-lilac);
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }
  .tpl-card:last-child { border-bottom: none; }
  .tpl-card:hover    { background: var(--cs-surface-gray); }
  .tpl-card.selected { background: var(--cs-purple-op10); }

  .tpl-title {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tpl-meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .status-badge {
    display: inline-block;
    padding: 1px 7px;
    border-radius: var(--radius-full);
    background: rgba(59,47,138,0.1);
    color: var(--cs-purple);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }
  .status-badge.archived {
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
  }
  .tpl-date {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  /* 페이지네이션 */
  .pagination-wrap {
    border-top: 1px solid var(--cs-lilac);
    padding: 6px 8px;
    flex-shrink: 0;
  }

  /* 우측: 에디터 영역 */
  .editor-area {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--cs-white);
  }

  /* 선택 없을 때 빈 상태 */
  .editor-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }
  .editor-empty p {
    margin: 0;
    color: var(--cs-text-mid);
    font: var(--text-pc-body-14);
  }

  /* 빈 목록 상태 */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    height: 200px;
    color: var(--cs-text-mid);
    font: var(--text-pc-body-14);
  }
  .empty-state p { margin: 0; }
</style>
