<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { SuggestPickerOption } from '$lib/types/cms-suggest-picker'

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

  interface Props {
    selectedId?: string | null
    options?: SuggestPickerOption[]
    id?: string
    name?: string
    placeholder?: string
    required?: boolean
    minChars?: number
    listLabel?: string
    oninput?: (value: string) => void
    onselect?: (option: SuggestPickerOption, previousId: string | null) => void
    field: Snippet<[SuggestPickerFieldControl]>
  }

  let {
    selectedId = $bindable<string | null>(null),
    options = [],
    id = 'suggest-picker',
    name = '',
    placeholder = '',
    required = false,
    minChars = 0,
    listLabel = '목록 제안',
    oninput,
    onselect,
    field,
  }: Props = $props()

  let query = $state('')
  let suggestions = $state<SuggestPickerOption[]>([])
  let suggestOpen = $state(false)
  let suggestIdx = $state(-1)
  let isFocused = $state(false)

  const listboxId = $derived(`${id}-suggest-list`)

  function filterOptions(kw: string): SuggestPickerOption[] {
    const needle = kw.trim().toLowerCase()
    if (!needle) return options
    return options.filter((opt) => {
      if (opt.label.toLowerCase().includes(needle)) return true
      return opt.meta?.some((m) => m.toLowerCase().includes(needle)) ?? false
    })
  }

  function refreshSuggestions(): void {
    const kw = query.trim()
    if (kw.length < minChars) {
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
    void options
    if (!isFocused) syncQueryFromSelection()
  })

  $effect(() => {
    void selectedId
    if (!isFocused) syncQueryFromSelection()
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

<div class="cms-suggest-picker">
  {@render field(fieldControl)}
  {#if suggestOpen}
    <div class="cms-suggest-picker-layer" id={listboxId} role="listbox" aria-label={listLabel}>
      {#each suggestions as item, i (item.id)}
        <button
          type="button"
          class="cms-suggest-picker-item"
          class:selected={suggestIdx === i || selectedId === item.id}
          role="option"
          aria-selected={suggestIdx === i || selectedId === item.id}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => selectOption(item)}
        >
          <span class="cms-suggest-picker-text">{item.label}</span>
          {#if item.meta && item.meta.length > 0}
            <span class="cms-suggest-picker-meta">
              {#each item.meta as meta, mi (mi)}
                <span>{meta}</span>
              {/each}
            </span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .cms-suggest-picker {
    position: relative;
    display: block;
    width: 100%;
    min-width: 0;
  }
  .cms-suggest-picker-layer {
    position: relative;
    top: auto;
    left: auto;
    right: auto;
    z-index: 1;
    margin-top: 4px;
    display: flex;
    flex-direction: column;
    max-height: 280px;
    overflow-y: auto;
    background: var(--cs-white);
    border: 1.5px solid rgba(59, 47, 138, 0.2);
    border-radius: var(--cms-radius-sm);
    box-shadow: 0 8px 24px rgba(16, 11, 50, 0.12);
  }
  .cms-suggest-picker-item {
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
  .cms-suggest-picker-item:last-child { border-bottom: none; }
  .cms-suggest-picker-item:hover,
  .cms-suggest-picker-item.selected {
    background: var(--cs-purple-op10);
  }
  .cms-suggest-picker-text {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    line-height: 1.35;
  }
  .cms-suggest-picker-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }
</style>
