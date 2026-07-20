<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { SuggestPickerOption, SuggestPickerVariant } from '$lib/types/suggest-picker'

  export type { SuggestPickerFieldControl }

  export interface SuggestPickerFieldControl {
    id: string
    name: string
    placeholder: string
    required: boolean
    value: string
    oninput: (e: Event) => void
    onkeydown: (e: KeyboardEvent) => void
    onfocus: () => void
    onblur: () => void
    ariaAutocomplete: 'list'
    ariaExpanded: boolean
    ariaControls: string
  }

  const VARIANT_LABELS: Record<SuggestPickerVariant, string> = {
    category: '분류 목록',
    brand:    '브랜드·키워드 목록',
    generic:  '목록 제안',
  }

  interface Props {
    selectedId?: string | null
    options?: SuggestPickerOption[]
    id?: string
    name?: string
    placeholder?: string
    required?: boolean
    minChars?: number
    listLabel?: string
    variant?: SuggestPickerVariant
    /** true: options가 이미 외부에서 필터링된 경우 내부 필터 건너뜀 (비동기 검색용) */
    noFilter?: boolean
    oninput?: (value: string) => void
    onselect?: (option: SuggestPickerOption, previousId: string | null) => void
    field: Snippet<[SuggestPickerFieldControl]>
    /** 커스텀 아이템 렌더링 스니펫. 미제공 시 기본 label+meta 레이아웃 사용 */
    renderItem?: Snippet<[SuggestPickerOption, number, boolean]>
    /** renderItem 사용 시 아이템 버튼 내부 flex 방향. 기본 column(label+meta 세로), 'row'는 좌우 배치용 */
    itemLayout?: 'column' | 'row'
  }

  let {
    selectedId = $bindable<string | null>(null),
    options = [],
    id = 'suggest-picker',
    name = '',
    placeholder = '',
    required = false,
    minChars = 0,
    listLabel,
    variant = 'generic',
    noFilter = false,
    oninput,
    onselect,
    field,
    renderItem,
    itemLayout = 'column',
  }: Props = $props()

  const resolvedListLabel = $derived(listLabel ?? VARIANT_LABELS[variant])

  let query = $state('')
  let suggestions = $state<SuggestPickerOption[]>([])
  let suggestOpen = $state(false)
  let suggestIdx = $state(-1)
  let isFocused = $state(false)

  const listboxId = $derived(`${id}-suggest-list`)

  function filterOptions(kw: string): SuggestPickerOption[] {
    if (noFilter) return options
    const needle = kw.trim().toLowerCase()
    if (!needle) return options
    return options.filter((opt) => {
      if (opt.label.toLowerCase().includes(needle)) return true
      return opt.meta?.some((m) => m.toLowerCase().includes(needle)) ?? false
    })
  }

  function refreshSuggestions(): void {
    const kw = query.trim()
    if (!noFilter && kw.length < minChars) {
      suggestions = minChars === 0 ? options : []
      suggestOpen = isFocused && suggestions.length > 0
      suggestIdx = -1
      return
    }
    suggestions = filterOptions(kw)
    suggestOpen = suggestions.length > 0
    suggestIdx = -1
  }

  function closeSuggest(): void {
    suggestOpen = false
    suggestIdx = -1
    isFocused = false
    syncQueryFromSelection()
  }

  function syncQueryFromSelection(): void {
    if (!selectedId) {
      if (!isFocused) query = ''
      return
    }
    const selected = options.find((o) => o.id === selectedId)
    if (selected) query = selected.label
  }

  $effect(() => {
    if (isFocused) {
      void options   // 비동기 결과 갱신 시 포커스 중이면 드롭다운 새로고침
      refreshSuggestions()
    } else {
      // syncQueryFromSelection 내부에서 selectedId·options를 읽으므로 자동 추적
      syncQueryFromSelection()
    }
  })

  function handleNativeInput(e: Event): void {
    query = (e.currentTarget as HTMLInputElement).value
    const exact = options.find((o) => o.label === query.trim())
    if (!exact) selectedId = null
    else if (selectedId !== exact.id) selectedId = exact.id
    refreshSuggestions()
    oninput?.(query)
  }

  function selectOption(option: SuggestPickerOption): void {
    const previousId = selectedId
    selectedId = option.id
    query = option.label
    closeSuggest()
    onselect?.(option, previousId)
    oninput?.(query)
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (!suggestOpen || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      suggestIdx = (suggestIdx + 1) % suggestions.length
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      suggestIdx = suggestIdx <= 0 ? suggestions.length - 1 : suggestIdx - 1
    } else if (e.key === 'Enter' && suggestIdx >= 0) {
      e.preventDefault()
      const item = suggestions[suggestIdx]
      if (item) selectOption(item)
    } else if (e.key === 'Escape') {
      closeSuggest()
    }
  }

  const fieldControl = $derived({
    id,
    name,
    placeholder,
    required,
    value: query,
    oninput: handleNativeInput,
    onkeydown: handleKeydown,
    onfocus: () => {
      isFocused = true
      refreshSuggestions()
    },
    onblur: () => {
      setTimeout(closeSuggest, 150)
    },
    ariaAutocomplete: 'list' as const,
    ariaExpanded: suggestOpen,
    ariaControls: listboxId,
  })
</script>

<div class="suggest-picker">
  {@render field(fieldControl)}
  {#if suggestOpen}
    <div class="suggest-picker-layer" id={listboxId} role="listbox" aria-label={resolvedListLabel}>
      {#each suggestions as item, i (item.id)}
        {@const isSelected = suggestIdx === i || selectedId === item.id}
        <button
          type="button"
          class="suggest-picker-item"
          class:selected={isSelected}
          class:row={itemLayout === 'row'}
          role="option"
          aria-selected={isSelected}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => selectOption(item)}
        >
          {#if renderItem}
            {@render renderItem(item, i, isSelected)}
          {:else}
            <span class="suggest-picker-text">{item.label}</span>
            {#if item.meta && item.meta.length > 0}
              <span class="suggest-picker-meta">
                {#each item.meta as meta, mi (mi)}
                  <span>{meta}</span>
                {/each}
              </span>
            {/if}
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .suggest-picker {
    position: relative;
    display: block;
    width: 100%;
    min-width: 0;
  }
  .suggest-picker-layer {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    max-height: 280px;
    overflow-y: auto;
    background: var(--cs-white);
    border: 1.5px solid rgba(59, 47, 138, 0.2);
    border-radius: var(--radius-sm);
    box-shadow: 0 8px 24px rgba(16, 11, 50, 0.12);
  }
  .suggest-picker-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    width: 100%;
    padding: 10px 16px;
    border: none;
    border-bottom: 1px solid var(--cs-lilac);
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }
  .suggest-picker-item.row {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  .suggest-picker-item:last-child { border-bottom: none; }
  .suggest-picker-item:hover,
  .suggest-picker-item.selected {
    background: var(--cs-purple-op10);
  }
  .suggest-picker-text {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    line-height: 1.35;
  }
  .suggest-picker-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }
</style>
