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
    /** true: 선택 즉시 onselect로 통지 후 입력창을 비움 — "검색→목록에 추가→다시 검색"을
     *  반복하는 UX 전용. 기본값 false(기존 동작 유지) — 선택한 라벨을 입력창에 남겨두는
     *  단일값 선택기(카테고리/등급 등 <select> 대체용)에는 절대 true로 바꾸지 말 것. */
    clearOnSelect?: boolean
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
    clearOnSelect = false,
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
    // next를 먼저 계산 후 한번에 할당 — suggestions 쓰고 바로 읽으면
    // Svelte 5 $effect가 suggestions를 의존성으로 추적 → effect 재실행 무한 루프
    let next: SuggestPickerOption[]
    if (!noFilter && kw.length < minChars) {
      next = minChars === 0 ? options : []
      suggestOpen = isFocused && next.length > 0
    } else {
      next = filterOptions(kw)
      suggestOpen = next.length > 0
    }
    suggestions = next
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
    if (clearOnSelect) {
      // 반복 검색+추가 UX: 선택한 라벨을 입력창에 남기지 않고 즉시 비움 — 다음 검색을
      // 바로 이어서 입력할 수 있게 함(선택할 때마다 직접 지워야 하는 불편 제거)
      selectedId = null
      query = ''
    } else {
      selectedId = option.id
      query = option.label
    }
    // closeSuggest()가 아니라 드롭다운만 닫는다 — 옵션 클릭 시 onmousedown에서
    // preventDefault로 실제 DOM 포커스는 입력창에 그대로 남아있는데, closeSuggest()는
    // isFocused까지 강제로 false로 만들어버려 "실제 포커스 상태"와 어긋난다. 그 결과
    // 이후 비동기 검색 결과(options prop 갱신)가 도착해도 $effect의 isFocused 분기가
    // else로 빠져 드롭다운이 다시 열리지 않는 버그(연속 검색·추가 불가) 발생.
    suggestOpen = false
    suggestIdx = -1
    onselect?.(option, previousId)
    // oninput?.(query)는 호출하지 않는다 — 선택 직후 query가 "선택한 항목의 label"로
    // 채워진 채 부모의 검색 콜백(외부 RPC 디바운스 검색)을 다시 트리거하면, 방금 고른
    // 상품명 그대로 재검색이 발생해 유사 상품이 뜬금없이 드롭다운에 다시 나타난다
    // ("검색 한 번에 다른 상품이 줄줄이 딸려오는" 것처럼 보이는 원인). oninput은 실제
    // 사용자가 타이핑할 때(handleNativeInput)만 호출하면 충분 — 선택 결과 통지는
    // onselect만으로 이미 충분하다.
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
