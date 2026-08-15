<script lang="ts">
  import type { Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { supabase } from '$lib/services/supabase'
  import type { SimilarNameItem, SimilarNameSource } from '$lib/types/cms-similar-name'

  export interface SimilarNameFieldControl {
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
    value?: string
    id?: string
    name?: string
    placeholder?: string
    required?: boolean
    minChars?: number
    debounceMs?: number
    limit?: number
    excludeId?: string | null
    source?: SimilarNameSource
    activeOnly?: boolean
    categoryLabels?: Record<string, string>
    listLabel?: string
    /** true: 툴바 등 인라인 — 제안 레이어 absolute 오버레이 (입력폼 높이·행 레이아웃 유지) */
    overlayLayer?: boolean
    oninput?: (value: string) => void
    onselect?: (item: SimilarNameItem, previousValue: string) => void
    field: Snippet<[SimilarNameFieldControl]>
  }

  let {
    value = $bindable(''),
    id = 'similar-name-input',
    name = '',
    placeholder = '',
    required = false,
    minChars = 2,
    debounceMs = 280,
    limit = $bindable(8),
    excludeId = null,
    source = 'product_name',
    activeOnly = false,
    categoryLabels = {},
    listLabel,
    overlayLayer = false,
    oninput,
    onselect,
    field,
  }: Props = $props()

  let suggestions = $state<SimilarNameItem[]>([])
  let suggestOpen = $state(false)
  let suggestLoading = $state(false)
  let suggestIdx = $state(-1)
  let suggestTimer: ReturnType<typeof setTimeout> | null = null
  // RTN-2: stale-response race 방지 — 진행 중인 fetch 취소용 AbortController
  let fetchController: AbortController | null = null

  const listboxId = $derived(`${id}-suggest-list`)
  const listAriaLabel = $derived(
    listLabel ??
      (source === 'brand'
        ? '유사 브랜드 제안'
        : source === 'product_search'
          ? '옵션 상품 검색 제안'
          : '유사 이름 제안')
  )

  function dedupeBrandRows(
    rows: { id: string; brand: string | null; category: string | null }[]
  ): SimilarNameItem[] {
    const seen = new Set<string>()
    const items: SimilarNameItem[] = []
    for (const row of rows) {
      const brand = row.brand?.trim()
      if (!brand) continue
      const key = brand.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        id: `brand-${row.id}`,
        name: brand,
        brand: null,
        category: row.category,
        product_code: null,
      })
      if (items.length >= limit) break
    }
    return items
  }

  // RTN-2: signal 파라미터로 stale-response 감지 (signal.aborted 시 상태 업데이트 생략)
  async function fetchSuggestions(kw: string, signal: AbortSignal): Promise<void> {
    if (source === 'brand') {
      const { data, error } = await supabase
        .from('products')
        .select('id, brand, category')
        .ilike('brand', `%${kw}%`)
        .not('brand', 'is', null)
        .is('deleted_at', null)
        .order('brand')
        .limit(limit * 4)

      if (signal.aborted) return  // 후속 요청이 있으면 stale 결과 버림
      if (error) {
        suggestions = []
        suggestOpen = false
        return
      }
      suggestions = dedupeBrandRows((data ?? []) as { id: string; brand: string | null; category: string | null }[])
      // 검색은 실행됐으므로(minChars 통과) 0건이어도 레이어를 열어 "검색 결과가 없습니다" 노출
      suggestOpen = true
      suggestIdx = -1
      return
    }

    if (source === 'product_search') {
      // K-2: /api/cms/products/search-suggestions API 호출 (하이브리드 ilike + MiniSearch)
      // AbortController signal을 fetch에 전달 — stale-response race 방지 (RTN-2 패턴 유지)
      const params = new URLSearchParams({ q: kw, limit: String(limit) })
      if (activeOnly) params.set('activeOnly', 'true')
      if (excludeId)  params.set('excludeId', excludeId)

      let fetched: SimilarNameItem[]
      try {
        const res = await fetch(`/api/cms/products/search-suggestions?${params}`, { signal })
        if (signal.aborted) return
        if (!res.ok) {
          suggestions = []
          suggestOpen = false
          return
        }
        fetched = await res.json() as SimilarNameItem[]
      } catch {
        if (signal.aborted) return // AbortError: 후속 요청에 의한 정상 취소 — 무시
        suggestions = []
        suggestOpen = false
        return
      }

      suggestions = fetched
      // 검색은 실행됐으므로(minChars 통과) 0건이어도 레이어를 열어 "검색 결과가 없습니다" 노출
      suggestOpen = true
      suggestIdx = -1
      return
    }

    let query = supabase
      .from('products')
      .select('id, name, brand, category, product_code')
      .ilike('name', `%${kw}%`)
      .is('deleted_at', null)
      .order('name')
      .limit(limit)

    if (excludeId) {
      query = query.neq('id', excludeId)
    }

    const { data, error } = await query
    if (signal.aborted) return
    if (error) {
      suggestions = []
      suggestOpen = false
      return
    }
    suggestions = (data ?? []) as SimilarNameItem[]
    // 검색은 실행됐으므로(minChars 통과) 0건이어도 레이어를 열어 "검색 결과가 없습니다" 노출
    suggestOpen = true
    suggestIdx = -1
  }

  function scheduleSuggest(): void {
    // RTN-2: 기존 타이머 취소 + 진행 중인 fetch abort (stale-response race 방지)
    if (suggestTimer) clearTimeout(suggestTimer)
    if (fetchController) {
      fetchController.abort()  // 이전 fetch의 signal.aborted = true → fetchSuggestions 내 체크로 결과 버림
      fetchController = null
    }
    const kw = value.trim()
    if (kw.length < minChars) {
      suggestions = []
      suggestOpen = false
      suggestLoading = false
      suggestIdx = -1
      return
    }
    suggestLoading = true
    suggestTimer = setTimeout(() => {
      const controller = new AbortController()
      fetchController = controller
      void fetchSuggestions(kw, controller.signal).finally(() => {
        // 이 fetch가 여전히 최신인 경우에만 로딩 상태 해제 (unhandled rejection 방지)
        if (fetchController === controller) {
          suggestLoading = false
          fetchController = null
        }
      })
    }, debounceMs)
  }

  // 호출부가 bind:limit으로 limit을 늘려 "더 많은 결과 보기"를 트리거할 때만 재검색
  // (마운트 시 최초 1회는 currentLimit === prevLimit이라 자연히 스킵됨 — 별도 플래그 불필요)
  let prevLimit = limit
  $effect(() => {
    const currentLimit = limit
    if (currentLimit === prevLimit) return
    prevLimit = currentLimit
    if (untrack(() => value.trim().length >= minChars)) scheduleSuggest()
  })

  function closeSuggest(): void {
    suggestOpen = false
    suggestIdx = -1
  }

  function handleNativeInput(e: Event): void {
    value = (e.currentTarget as HTMLInputElement).value
    scheduleSuggest()
    oninput?.(value)
  }

  function selectSuggestion(item: SimilarNameItem): void {
    const previousValue = value
    value = item.name
    closeSuggest()
    onselect?.(item, previousValue)
    oninput?.(value)
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
      if (item) selectSuggestion(item)
    } else if (e.key === 'Escape') {
      closeSuggest()
    }
  }

  function categoryLabel(cat: string): string {
    return categoryLabels[cat] ?? cat
  }

  const fieldControl = $derived({
    id,
    name,
    placeholder,
    required,
    value,
    oninput: handleNativeInput,
    onkeydown: handleKeydown,
    onfocus: () => {
      // 결과 0건이어도 재포커스 시 "검색 결과가 없습니다" 상태를 다시 보여줌
      if (value.trim().length >= minChars) suggestOpen = true
    },
    onblur: () => {
      setTimeout(closeSuggest, 150)
    },
    ariaAutocomplete: 'list' as const,
    ariaExpanded: suggestOpen,
    ariaControls: listboxId,
  })
</script>

<div class="cms-similar-name">
  {@render field(fieldControl)}
  {#if suggestOpen || suggestLoading}
    <div
      class="cms-similar-name-layer"
      class:cms-similar-name-layer-overlay={overlayLayer}
      id={listboxId}
      role="listbox"
      aria-label={listAriaLabel}
    >
      {#if suggestLoading && suggestions.length === 0}
        <p class="cms-similar-name-status">검색 중...</p>
      {:else if suggestions.length === 0}
        <p class="cms-similar-name-status">검색 결과가 없습니다</p>
      {:else}
        {#each suggestions as item, i (item.id)}
          <button
            type="button"
            class="cms-similar-name-item"
            class:selected={suggestIdx === i}
            role="option"
            aria-selected={suggestIdx === i}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => selectSuggestion(item)}
          >
            <span class="cms-similar-name-text">{item.name}</span>
            <span class="cms-similar-name-meta">
              {#if source === 'product_name'}
                {#if item.brand}<span>{item.brand}</span>{/if}
                {#if item.category}<span>{categoryLabel(item.category)}</span>{/if}
                {#if item.product_code}<span class="cms-similar-name-code">{item.product_code}</span>{/if}
              {:else if source === 'product_search'}
                {#if item.match_label}<span class="cms-similar-name-match">{item.match_label}</span>{/if}
                {#if item.brand}<span>{item.brand}</span>{/if}
                {#if item.category}<span>{categoryLabel(item.category)}</span>{/if}
                {#if item.product_code}<span class="cms-similar-name-code">{item.product_code}</span>{/if}
              {:else if item.category}
                <span>{categoryLabel(item.category)}</span>
              {/if}
            </span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .cms-similar-name {
    position: relative;
    display: block;
    width: 100%;
    min-width: 0;
  }
  .cms-similar-name-layer {
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
    border-radius: var(--cms-radius-sm);
    box-shadow: 0 8px 24px rgba(16, 11, 50, 0.12);
  }
  /* overlayLayer prop은 하위 호환성 유지 — 동작은 동일 */
  .cms-similar-name-layer-overlay {}
  .cms-similar-name-status {
    margin: 0;
    padding: 12px 16px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }
  .cms-similar-name-item {
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
  .cms-similar-name-item:last-child { border-bottom: none; }
  .cms-similar-name-item:hover,
  .cms-similar-name-item.selected {
    background: var(--cs-purple-op10);
  }
  .cms-similar-name-text {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    line-height: 1.35;
  }
  .cms-similar-name-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }
  .cms-similar-name-code {
    font-family: 'Courier New', monospace;
    color: var(--cs-purple-dark);
  }
  .cms-similar-name-match {
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(59, 47, 138, 0.1);
    color: var(--cs-purple-dark);
    font-weight: 700;
  }
</style>
