<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation'
  import { page } from '$app/stores'
  import ContractTemplatePanel from '$lib/components/cms/ContractTemplatePanel.svelte'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const panelOpen    = $derived(!!data.selectedId && !!data.selectedTemplate)
  let showNewEditor  = $state(false)

  function selectTemplate(id: string) {
    const params = new URLSearchParams($page.url.searchParams)
    params.set('selected', id)
    goto(`?${params.toString()}`, { replaceState: true, noScroll: true })
    showNewEditor = false
  }

  function closePanel() {
    const params = new URLSearchParams($page.url.searchParams)
    params.delete('selected')
    goto(`?${params.toString()}`, { replaceState: true, noScroll: true })
  }

  async function onSaved(id: string) {
    await invalidateAll()
    if (id) {
      selectTemplate(id)
    } else {
      closePanel()
      showNewEditor = false
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
  <div class="toolbar">
    <h2 class="page-title">계약서 양식</h2>
    <span class="count-badge">{data.templates.length}건</span>
    <div class="toolbar-right">
      {#if !showNewEditor}
        <button class="cta-btn" onclick={() => { showNewEditor = true; closePanel() }}>
          + 작성
        </button>
      {:else}
        <button class="cancel-btn" onclick={() => { showNewEditor = false }}>
          목록으로
        </button>
      {/if}
    </div>
  </div>

  {#if showNewEditor}
    <div class="editor-full">
      <ContractTemplatePanel
        template={null}
        onclose={() => { showNewEditor = false }}
        onsaved={onSaved}
      />
    </div>
  {:else}
    <div class="master-detail" class:panel-open={panelOpen}>
      <!-- 목록 패널 -->
      <div class="list-pane">
        {#if data.templates.length === 0}
          <div class="empty-state">
            <p>등록된 계약서 양식이 없습니다.</p>
            <button class="cta-btn sm" onclick={() => { showNewEditor = true }}>+ 첫 양식 작성</button>
          </div>
        {:else}
          {#each data.templates as tpl (tpl.id)}
            {@const isSelected = data.selectedId === tpl.id}
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

      <!-- 상세 패널 -->
      {#if panelOpen && data.selectedTemplate}
        <div class="detail-pane">
          {#key data.selectedId}
            <ContractTemplatePanel
              template={data.selectedTemplate}
              onclose={closePanel}
              onsaved={onSaved}
            />
          {/key}
        </div>
      {:else}
        <div class="detail-pane detail-empty">
          <p>목록에서 양식을 선택하세요.</p>
        </div>
      {/if}
    </div>
  {/if}
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

  .cancel-btn {
    height: 34px;
    padding: 0 16px;
    background: var(--cs-surface-gray);
    color: var(--cs-text);
    border: 1px solid #DDDDDD;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.12s;
  }
  .cancel-btn:hover { background: var(--cs-lilac); }

  /* 풀 에디터 (신규 작성) */
  .editor-full {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: var(--cs-white);
    display: flex;
    flex-direction: column;
  }

  /* 마스터-디테일 레이아웃 */
  .master-detail {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .list-pane {
    width: 320px;
    flex-shrink: 0;
    overflow-y: auto;
    border-right: 1px solid var(--cs-lilac);
    background: var(--cs-white);
    padding: 12px 0;
  }

  .panel-open .list-pane { width: 280px; }

  .tpl-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    padding: 12px 16px;
    border: none;
    border-bottom: 1px solid var(--cs-lilac);
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }
  .tpl-card:last-child { border-bottom: none; }
  .tpl-card:hover   { background: var(--cs-surface-gray); }
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

  /* 상세 패널 */
  .detail-pane {
    flex: 1;
    overflow: hidden;
    background: var(--cs-white);
  }
  .detail-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--cs-text-light);
    font: var(--text-pc-body-14);
  }

  /* 빈 목록 */
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
