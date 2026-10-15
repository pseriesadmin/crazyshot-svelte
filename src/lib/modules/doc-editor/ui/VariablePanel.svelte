<script lang="ts">
  /**
   * VariablePanel.svelte — 변수 칩 패널 (doc-editor ui, 이식형)
   *
   * 이관 원본: contract-editor/ContractFieldPanel.svelte 의 변수 탭·칩 부분(원본은 무변경 유지).
   * 변수 목록은 하드코딩하지 않고 호스트가 catalog로 주입한다.
   * 호스트 고유 탭(예: 특약 관리)은 extraTabs + extra 스니펫으로 끼워 넣는다.
   * 탭·칩 버튼의 mousedown은 preventDefault+stopPropagation — 편집기 선택(커서·셀 선택)이 풀리지 않게 한다.
   */
  import type { Snippet } from 'svelte'
  import type { MergeFieldAttrs, VariableCatalog } from '../core/types'

  interface ExtraTab {
    key: string
    label: string
  }

  interface Props {
    /** 변수 카탈로그 — 그룹마다 탭 1개 */
    catalog: VariableCatalog
    /** 칩 클릭 시 호출 (보통 editor.insertVariable) */
    onInsert: (attrs: MergeFieldAttrs) => void
    /** 호스트 고유 탭 목록(카탈로그 탭 뒤에 붙는다) */
    extraTabs?: ExtraTab[]
    /** extraTabs 탭이 활성일 때 본문을 그리는 스니펫(인자: 활성 탭 key) */
    extra?: Snippet<[string]>
    /** 처음 열 탭 key (기본: 첫 번째 탭) */
    initialTab?: string
    /** 안내 문구 */
    hint?: string
    /** 검색 입력창 표시(그룹 항목이 많을 때) */
    searchable?: boolean
  }

  let {
    catalog,
    onInsert,
    extraTabs = [],
    extra,
    initialTab,
    hint = '클릭하면 커서 위치에 변수가 삽입됩니다.',
    searchable = false,
  }: Props = $props()

  const tabs = $derived([
    ...catalog.map((g) => ({ key: g.key, label: g.label })),
    ...extraTabs,
  ])

  let picked = $state<string | null>(null)
  const activeTab = $derived(
    picked && tabs.some((t) => t.key === picked) ? picked : (initialTab && tabs.some((t) => t.key === initialTab) ? initialTab : (tabs[0]?.key ?? '')),
  )
  const activeGroup = $derived(catalog.find((g) => g.key === activeTab) ?? null)

  let query = $state('')
  const items = $derived(
    (activeGroup?.items ?? []).filter((it) => {
      const q = query.trim().toLowerCase()
      if (!q) return true
      return it.label.toLowerCase().includes(q) || it.variable.toLowerCase().includes(q)
    }),
  )

  function keepSelection(e: MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
  }
</script>

<div class="dvp-wrap">
  <div class="dvp-tabs" role="tablist" aria-label="필드 카테고리">
    {#each tabs as tab (tab.key)}
      <button
        type="button"
        role="tab"
        class="dvp-tab"
        class:active={activeTab === tab.key}
        aria-selected={activeTab === tab.key}
        onmousedown={keepSelection}
        onclick={() => { picked = tab.key }}
      >{tab.label}</button>
    {/each}
  </div>

  <div class="dvp-body">
    {#if activeGroup}
      <p class="dvp-hint">{hint}</p>
      {#if searchable}
        <input class="dvp-search" type="search" placeholder="변수 검색" bind:value={query} aria-label="변수 검색" />
      {/if}
      <div class="dvp-chips">
        {#each items as field (field.variable)}
          <button
            type="button"
            class="dvp-chip"
            onmousedown={keepSelection}
            onclick={() => onInsert({ variable: field.variable, label: field.label })}
            title={`{{${field.variable}}} 삽입`}
          >
            <span class="dvp-chip-label">{field.label}</span>
            <span class="dvp-chip-var">{`{{${field.variable}}}`}</span>
          </button>
        {:else}
          <p class="dvp-hint">일치하는 변수가 없습니다.</p>
        {/each}
      </div>
    {:else if extra}
      {@render extra(activeTab)}
    {/if}
  </div>
</div>

<style>
  .dvp-wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    border: 1px solid var(--de-lilac, #ECEBF4);
    border-radius: var(--de-radius-sm, 10px);
    background: var(--de-white, #FFFFFF);
    overflow: hidden;
  }

  .dvp-tabs {
    display: flex;
    border-bottom: 1px solid var(--de-lilac, #ECEBF4);
    background: var(--de-surface, #F6F6F6);
    flex-shrink: 0;
  }

  .dvp-tab {
    flex: 1;
    height: 36px;
    padding: 0 4px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    font: var(--de-font-caption, 400 12px/200% sans-serif);
    font-weight: 700;
    color: var(--de-text-mid, #666666);
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s;
    white-space: nowrap;
  }
  .dvp-tab:hover { color: var(--de-purple, #3B2F8A); }
  .dvp-tab.active {
    color: var(--de-purple, #3B2F8A);
    border-bottom-color: var(--de-purple, #3B2F8A);
    background: var(--de-white, #FFFFFF);
  }

  .dvp-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .dvp-hint {
    margin: 0;
    font: var(--de-font-caption, 400 12px/200% sans-serif);
    color: var(--de-text-mid, #666666);
    line-height: 1.4;
  }

  .dvp-search {
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--de-border, #DDDDDD);
    border-radius: var(--de-radius-sm, 10px);
    font: var(--de-font-caption, 400 12px/200% sans-serif);
    color: var(--de-text, #100B32);
    outline: none;
    box-sizing: border-box;
    width: 100%;
  }
  .dvp-search:focus { border-color: var(--de-purple, #3B2F8A); }

  .dvp-chips { display: flex; flex-direction: column; gap: 6px; }

  .dvp-chip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--de-purple-line, rgba(59, 47, 138, 0.25));
    border-radius: var(--de-radius-sm, 10px);
    background: var(--de-white, #FFFFFF);
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
    text-align: left;
  }
  .dvp-chip:hover {
    background: var(--de-purple-wash, rgba(59, 47, 138, 0.06));
    border-color: var(--de-purple, #3B2F8A);
  }

  .dvp-chip-label {
    font: var(--de-font-caption, 400 12px/200% sans-serif);
    font-weight: 700;
    color: var(--de-text, #100B32);
    white-space: nowrap;
  }

  .dvp-chip-var {
    font: var(--de-font-caption, 400 12px/200% sans-serif);
    font-family: monospace;
    color: var(--de-purple, #3B2F8A);
    opacity: 0.7;
    font-size: 10px;
    white-space: nowrap;
  }
</style>
