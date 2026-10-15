<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import { page } from '$app/stores'
  import ContractTemplatePanel from '$lib/components/cms/ContractTemplatePanel.svelte'
  import CmsPagination from '$lib/components/cms/CmsPagination.svelte'
  import CmsDeleteButton from '$lib/components/cms/CmsDeleteButton.svelte'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // 신규 작성 모드 (template=null로 패널 표시)
  let isNewMode = $state(false)
  // 매 "+ 작성" 클릭마다 고유값을 보장하는 카운터 — isNewMode가 이미 true여도 강제 재마운트
  let newSessionNonce = $state(0)

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

  // 좌측 양식 목록 접기/펼치기 — 문서 뷰어 영역을 넓게 쓰기 위함(2026-10-15). 선택은 브라우저에 기억.
  const LIST_OPEN_KEY = 'cs-contracts-list-open'
  let listOpen = $state(true)
  $effect(() => {
    try { if (localStorage.getItem(LIST_OPEN_KEY) === '0') listOpen = false } catch { /* 저장소 접근 불가 시 기본값 */ }
  })
  function toggleList() {
    listOpen = !listOpen
    try { localStorage.setItem(LIST_OPEN_KEY, listOpen ? '1' : '0') } catch { /* 저장 실패 무시 */ }
  }

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
    newSessionNonce += 1   // 매 클릭마다 증가 — 이미 isNewMode=true여도 ContractTemplatePanel 강제 재마운트
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

  // 목록 카드 우측 삭제 아이콘 버튼 전용(2026-09-08 신규) — 지금 열려있는 패널이 방금 삭제한
  // 그 양식이었으면 패널을 닫는다(존재하지 않는 템플릿을 계속 편집 화면에 띄워두지 않기 위함).
  async function handleDeleted(deletedId: string) {
    await invalidateAll()
    if (data.selectedId === deletedId) closePanel()
  }

  function formatDate(dt: string): string {
    return dt.slice(0, 10)
  }

  const STATUS_LABEL: Record<string, string> = {
    active:   '활성',
    archived: '보관',
  }

  // 2026-08-16 편집 메뉴 UI 통일(Stephen 요청) — 양식목록 카드에 작성모드 배지 추가.
  // authoring_mode가 null/undefined인 레거시 템플릿은 'flow'와 동일하게 문서형 처리
  // (contract-template.ts ContractTemplate.authoring_mode 주석 규칙과 동일).
  const MODE_LABEL: Record<string, string> = {
    flow:        '문서형',
    canvas:      '캔버스형',
    spreadsheet: '스프레드시트형',
    html:        'HTML형',
  }
  function modeLabel(mode: string | null | undefined): string {
    return MODE_LABEL[mode ?? 'flow'] ?? MODE_LABEL.flow
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
    <div class="list-pane" class:collapsed={!listOpen}>
      <div class="list-pane-head">
        <button type="button" class="close-btn" onclick={toggleList} aria-expanded={listOpen} aria-label={listOpen ? '양식 목록 닫기' : '양식 목록 펼치기'} title={listOpen ? '양식 목록 닫기' : '양식 목록 펼치기'}>
          {#if listOpen}✕{:else}<ChevronIcon direction="right" size={10} color="currentColor" />{/if}
        </button>
      </div>
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
            <!-- 삭제 아이콘 버튼(CmsDeleteButton)은 자기 자신의 <form>을 렌더링하므로
                 카드 전체를 <button>으로 두면 form-in-button(무효 HTML)이 된다 —
                 선택 클릭은 내부 <button class="tpl-card">가 전담하고, 삭제 버튼은
                 그 형제(sibling)로 행 오른쪽 끝에 배치(2026-09-08, ContractTemplatePanel.svelte
                 panel-actions의 CmsDeleteButton 형제배치 원칙과 동일). -->
            <div class="tpl-card-row" class:selected={isSelected}>
              <button
                type="button"
                class="tpl-card"
                onclick={() => selectTemplate(tpl.id)}
              >
                <span class="tpl-title">{tpl.title}</span>
                <div class="tpl-meta">
                  <span class="status-badge" class:archived={tpl.status === 'archived'}>
                    {STATUS_LABEL[tpl.status] ?? tpl.status}
                  </span>
                  <span class="mode-badge" class:spreadsheet={(tpl.authoring_mode ?? 'flow') === 'spreadsheet'} class:canvas={tpl.authoring_mode === 'canvas'} class:html={tpl.authoring_mode === 'html'}>
                    {modeLabel(tpl.authoring_mode)}
                  </span>
                  {#if tpl.auto_issue_default}
                    <span class="mode-badge auto-issue" title="예약승인 시 이 양식으로 전자계약이 자동 발행됩니다">자동발행</span>
                  {/if}
                  <span class="tpl-date">{formatDate(tpl.created_at)}</span>
                </div>
              </button>
              <CmsDeleteButton
                action="?/delete"
                id={tpl.id}
                warnMessage="한번 더 클릭 시 이 양식이 삭제됩니다."
                successMessage="양식이 삭제되었습니다."
                onsuccess={() => handleDeleted(tpl.id)}
              />
            </div>
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
          {#key '__new__:' + newSessionNonce}
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
              onautoissuechange={() => invalidateAll()}
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
    /* 2026-10-15: 삭제 버튼을 카드 안(우상단)으로 합쳐 별도 열이 사라짐 → 배지 3개 + 날짜가 한 줄에 들어가는 최소 폭 */
    width: 290px;
    flex-shrink: 0;
    border-right: 1px solid var(--cs-lilac);
    background: var(--cs-white);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .list-pane-head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    padding: 4px 8px 0;
  }
  .list-pane-head .close-btn {
    width: 28px; height: 28px; min-height: 28px;
    display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: var(--radius-sm);
    color: var(--cs-text-light); font-size: 14px; cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .list-pane-head .close-btn:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }
  .list-pane { transition: width 0.2s ease; }
  .list-pane.collapsed {
    width: 36px;
  }
  .list-pane.collapsed > :not(.list-pane-head) { display: none; }
  .list-pane.collapsed .list-pane-head { justify-content: center; padding: 4px 0 0; }
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

  /* 카드 행 컨테이너(2026-09-08 신규) — 선택용 .tpl-card 버튼 + 삭제 아이콘 버튼을
     형제로 감싼다. 보더·호버·선택 배경은 전부 이 행 단위로 옮겨왔다(예전엔 .tpl-card
     자신이 <button> 전체였을 때 가지고 있던 스타일). */
  .tpl-card-row {
    position: relative;
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--cs-lilac);
    transition: background 0.1s;
  }
  .tpl-card-row:last-child { border-bottom: none; }
  .tpl-card-row:hover      { background: var(--cs-surface-gray); }
  .tpl-card-row.selected   { background: var(--cs-purple-op10); }

  .tpl-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 0;
    padding: 12px 14px;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  /* CmsDeleteButton(.act-del) — 2026-10-15: 카드와 별도 열을 차지하지 않고 카드 우상단(제목 줄)에 겹쳐 배치 → 가로폭 절약 */
  .tpl-card-row :global(form) {
    position: absolute;
    top: 8px;
    right: 8px;
  }
  .tpl-card-row :global(.act-del) {
    flex-shrink: 0;
  }
  .tpl-title { padding-right: 28px; }

  .tpl-title {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* 2026-10-15 — '자동발행' 배지가 늘어나 카드 폭(약 280px)에서 배지 글자가 줄바꿈("자동발/행")되던 문제:
     배지 폰트 토큰을 두 단계 낮추고(--text-pc-script-12 → --text-pc-descript-10), 배지는 줄바꿈 없이 한 줄로 고정,
     공간이 모자라면 배지 글자가 아니라 날짜가 다음 줄로 내려가게 재배열(날짜는 오른쪽 정렬). */
  .tpl-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
  }
  .status-badge {
    display: inline-block;
    flex-shrink: 0;
    white-space: nowrap;
    padding: 1px 7px;
    border-radius: var(--radius-full);
    background: rgba(59,47,138,0.1);
    color: var(--cs-purple);
    font: var(--text-pc-descript-10);
    font-weight: 700;
  }
  .status-badge.archived {
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
  }
  /* 2026-08-16 편집 메뉴 UI 통일(Stephen 요청) — 클릭해 열어보기 전에도 작성모드를
     알 수 있도록 양식목록 카드에 배지 추가. 기본(문서형)은 .status-badge.archived와
     동일한 중립 톤, 캔버스형/스프레드시트형만 구분되는 톤을 준다. */
  .mode-badge {
    display: inline-block;
    flex-shrink: 0;
    white-space: nowrap;
    padding: 1px 7px;
    border-radius: var(--radius-full);
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    font: var(--text-pc-descript-10);
    font-weight: 700;
  }
  .mode-badge.canvas {
    background: rgba(16, 11, 50, 0.07);
    color: var(--cs-text);
  }
  .mode-badge.spreadsheet {
    background: rgba(59, 47, 138, 0.1);
    color: var(--cs-purple);
  }
  .mode-badge.auto-issue {
    background: var(--cs-purple);
    color: var(--cs-white);
  }
  .mode-badge.html {
    background: rgba(14, 165, 233, 0.1);
    color: var(--cs-info);
  }
  .tpl-date {
    margin-left: auto;
    white-space: nowrap;
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
