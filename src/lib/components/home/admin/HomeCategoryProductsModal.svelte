<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'

  interface ProductItem {
    id: string
    name: string
    image_urls: string[] | null
    base_price_daily: number
  }

  interface CatProductEntry {
    category_id: string
    products: { id: string; order: number }[]
    mode: 'random' | 'fixed'
  }

  interface AllSettings {
    items: CatProductEntry[]
  }

  interface Props {
    categoryId:   string
    categoryName: string
    allSettings:  AllSettings
    onclose:      () => void
  }

  let { categoryId, categoryName, allSettings, onclose }: Props = $props()

  // 이 카테고리의 기존 설정 — 마운트 시 1회 추출 (categoryId 변경 시 {#key}로 재마운트)
  const existingEntry = allSettings.items.find((it) => it.category_id === categoryId)

  let mode              = $state<'random' | 'fixed'>(existingEntry?.mode ?? 'fixed')
  let selected          = $state<ProductItem[]>([])
  let searchResults     = $state<ProductItem[]>([])
  let isLoadingInitial  = $state(false)
  let isSearching       = $state(false)
  let isSaving          = $state(false)
  let error             = $state<string | null>(null)
  let pickerSelectedId  = $state<string | null>(null)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  // I-3: 마지막 실제 검색어 추적 (초기 데이터 복원 시에는 빈 문자열 유지)
  let lastSearchQuery   = $state('')

  const MAX_ITEMS = 10
  const selectedIds = $derived(new Set(selected.map((s) => s.id)))

  const pickerOptions = $derived<SuggestPickerOption[]>(
    searchResults
      .filter((p) => !selectedIds.has(p.id))
      .map((p) => ({
        id:    p.id,
        label: p.name,
        meta:  [`${p.base_price_daily.toLocaleString('ko-KR')}원/1일`],
      }))
  )

  // 기존 저장된 상품 ID 로드
  $effect(() => {
    const ids = (existingEntry?.products ?? [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((p) => p.id)
      .filter(Boolean)
    if (!ids.length) return
    isLoadingInitial = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabase.rpc as any)('get_products_by_ids', { p_ids: ids }).then(
      ({ data }: { data: unknown[] | null }) => {
        if (!data) { isLoadingInitial = false; return }
        const map = new Map<string, ProductItem>()
        for (const r of data as Record<string, unknown>[]) {
          const id = String(r['id'] ?? '')
          if (id) {
            map.set(id, {
              id,
              name:             String(r['name'] ?? ''),
              image_urls:       (r['image_urls'] as string[] | null) ?? null,
              base_price_daily: Number(r['base_price_daily'] ?? 0),
            })
          }
        }
        selected = ids.map((id) => map.get(id)).filter((x): x is ProductItem => !!x)
        isLoadingInitial = false
      }
    )
  })

  function onPickerInput(val: string) {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (!val.trim()) { searchResults = []; return }
    debounceTimer = setTimeout(() => doSearch(val.trim()), 280)
  }

  function onProductSelect(opt: SuggestPickerOption) {
    const product = searchResults.find((p) => p.id === opt.id)
    if (product && selected.length < MAX_ITEMS && !selectedIds.has(product.id)) {
      selected = [...selected, product]
      // I-3: 실제 검색 후 선택한 경우에만 학습 신호 전송 (fire-and-forget)
      if (lastSearchQuery) {
        fetch('/api/cms/products/search-suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_id: product.id, search_term: lastSearchQuery, context: 'home_category_products' }),
        }).catch(() => {})
      }
    }
    setTimeout(() => { pickerSelectedId = null; searchResults = [] }, 0)
  }

  // H-4: search_products 직접 RPC → /api/cms/products/search-suggestions 서버라우트 전환
  // nlsearch.md §2 "브라우저 직접 RPC 호출 금지" 준수
  async function doSearch(q: string) {
    isSearching = true
    lastSearchQuery = q
    try {
      const res = await fetch(
        `/api/cms/products/search-suggestions?q=${encodeURIComponent(q)}&limit=10`,
      )
      if (res.ok) {
        const items = await res.json() as Array<{ id: string; name: string; image_url?: string | null; price_24h?: number | null }>
        searchResults = items
          .filter((r) => !!r.id)
          .map((r) => ({
            id:               r.id,
            name:             r.name,
            image_urls:       r.image_url ? [r.image_url] : null,
            base_price_daily: r.price_24h ?? 0,
          }))
      } else {
        searchResults = []
      }
    } catch {
      searchResults = []
    }
    isSearching = false
  }

  async function save() {
    isSaving = true
    error    = null
    try {
      const newEntry: CatProductEntry = {
        category_id: categoryId,
        products:    selected.map((p, i) => ({ id: p.id, order: i })),
        mode,
      }
      const otherItems   = allSettings.items.filter((it) => it.category_id !== categoryId)
      const updatedItems = [...otherItems, newEntry]

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)('upsert_product_page_setting', {
        p_key:   'home_category_products',
        p_value: { items: updatedItems },
      })
      if (rpcErr) {
        error = (rpcErr as { message: string }).message
      } else {
        await invalidateAll()
        onclose()
      }
    } catch (e) {
      error = e instanceof Error ? e.message : '저장 실패'
    }
    isSaving = false
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="hcp-backdrop" onclick={onclose} role="presentation"></div>

<aside class="hcp-panel" role="dialog" aria-modal="true" aria-label="{categoryName} 상품 큐레이션">
  <div class="hcp-header">
    <span class="hcp-title">{categoryName} 상품 큐레이션</span>
    <button class="hcp-close" onclick={onclose} aria-label="닫기">✕</button>
  </div>

  <div class="hcp-body">
    <!-- 노출 방식 -->
    <div class="hcp-section">
      <p class="hcp-label">노출 방식</p>
      <div class="hcp-radio-row">
        <label class="hcp-radio">
          <input type="radio" name="hcp-mode-{categoryId}" value="fixed"  checked={mode === 'fixed'}  onchange={() => (mode = 'fixed')}  />
          <span>고정 순서</span>
        </label>
        <label class="hcp-radio">
          <input type="radio" name="hcp-mode-{categoryId}" value="random" checked={mode === 'random'} onchange={() => (mode = 'random')} />
          <span>랜덤 노출</span>
        </label>
      </div>
    </div>

    <!-- 상품 검색 -->
    <div class="hcp-section">
      <p class="hcp-label">
        상품 추가
        <span class="hcp-count">{selected.length}/{MAX_ITEMS}</span>
      </p>
      {#if isLoadingInitial}
        <p class="hcp-hint">저장된 상품을 불러오는 중…</p>
      {/if}
      {#if selected.length < MAX_ITEMS}
        <div class="hcp-picker-wrap">
          <SuggestPicker
            id="hcp-search-{categoryId}"
            bind:selectedId={pickerSelectedId}
            options={pickerOptions}
            noFilter
            clearOnSelect
            itemLayout="row"
            placeholder="상품명으로 검색..."
            listLabel="상품 검색 결과"
            oninput={onPickerInput}
            onselect={onProductSelect}
          >
            {#snippet field(c)}
              <input
                type="text"
                class="f-input"
                id={c.id}
                placeholder={c.placeholder}
                value={c.value}
                oninput={c.oninput}
                onkeydown={c.onkeydown}
                onfocus={c.onfocus}
                onblur={c.onblur}
                aria-autocomplete={c.ariaAutocomplete}
                aria-expanded={c.ariaExpanded}
                aria-controls={c.ariaControls}
                autocomplete="off"
              />
            {/snippet}
            {#snippet renderItem(item, _i, _sel)}
              <span class="hcp-suggest-name">{item.label}</span>
              <span class="hcp-suggest-price">{item.meta?.[0] ?? ''}</span>
            {/snippet}
          </SuggestPicker>
          {#if isSearching}
            <p class="hcp-hint hcp-hint--searching">검색 중…</p>
          {/if}
        </div>
      {:else}
        <p class="hcp-hint hcp-hint--max">최대 {MAX_ITEMS}개 선택 완료. 아래 목록에서 불필요한 항목을 제거하세요.</p>
      {/if}
    </div>

    <!-- 선택 목록 -->
    {#if selected.length > 0}
      <div class="hcp-section">
        <p class="hcp-label">선택된 상품 <span class="hcp-drag-hint">드래그로 순서 변경</span></p>
        <CmsDragList bind:items={selected} itemKey={(item) => item.id}>
          {#snippet renderItem(item)}
            <div class="hcp-selected-row">
              <span class="hcp-selected-name">{item.name}</span>
              <button
                class="hcp-remove-btn"
                onclick={() => { selected = selected.filter((s) => s.id !== item.id) }}
                aria-label="{item.name} 제거"
              >✕</button>
            </div>
          {/snippet}
        </CmsDragList>
      </div>
    {:else if !isLoadingInitial}
      <p class="hcp-empty">위 검색창에서 상품을 검색해 추가하세요.</p>
    {/if}

    {#if error}
      <p class="hcp-error" role="alert">{error}</p>
    {/if}
  </div>

  <div class="hcp-footer">
    <button class="hcp-btn-cancel" onclick={onclose} disabled={isSaving}>취소</button>
    <button class="hcp-btn-save"   onclick={save}    disabled={isSaving}>
      {isSaving ? '저장 중…' : '저장'}
    </button>
  </div>
</aside>

<style>
  .hcp-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(16, 11, 50, 0.45);
    z-index: 200;
    backdrop-filter: blur(2px);
  }

  .hcp-panel {
    position: fixed;
    right: 0;
    top: 0;
    height: 100dvh;
    width: 420px;
    max-width: 100vw;
    background: #fff;
    border-radius: var(--radius-2xl) 0 0 var(--radius-2xl);
    z-index: 201;
    display: flex;
    flex-direction: column;
    box-shadow: -8px 0 40px rgba(16, 11, 50, 0.18);
  }

  .hcp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px 16px;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }

  .hcp-title {
    font: var(--text-pc-title-16);
    font-weight: 700;
    color: var(--cs-text);
  }

  .hcp-close {
    width: 28px;
    height: 28px;
    min-width: 28px;
    border: none;
    background: transparent;
    font-size: 16px;
    color: var(--cs-text-mid);
    cursor: pointer;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .hcp-close:hover { background: var(--cs-lilac); color: var(--cs-red-badge); }

  .hcp-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .hcp-section { display: flex; flex-direction: column; gap: 8px; }

  .hcp-label {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hcp-count {
    font-weight: 400;
    color: var(--cs-text-mid);
    font-size: 12px;
  }
  .hcp-drag-hint {
    font-size: 11px;
    font-weight: 400;
    color: var(--cs-text-light);
  }

  .hcp-radio-row {
    display: flex;
    gap: 16px;
  }
  .hcp-radio {
    display: flex;
    align-items: center;
    gap: 6px;
    font: var(--text-pc-script-12);
    color: var(--cs-text);
    cursor: pointer;
  }

  .hcp-picker-wrap { position: relative; }

  /* SuggestPicker 표준 입력 — cms-uiux.md §7-7/§12 정본(.f-input) 그대로 사용 */
  .f-input {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-sm);
    padding: 10px 16px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    width: 100%;
    box-sizing: border-box;
  }
  .f-input::placeholder { color: var(--cs-text-light); }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  .hcp-hint {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0;
  }
  .hcp-hint--searching { color: var(--cs-purple); }
  .hcp-hint--max      { color: var(--cs-text-light); }

  .hcp-suggest-name  { font: var(--text-pc-script-12); font-weight: 700; color: var(--cs-text); }
  .hcp-suggest-price { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin-left: 6px; }

  .hcp-selected-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: var(--cs-surface-gray);
    border-radius: var(--radius-sm);
    gap: 8px;
  }
  .hcp-selected-name {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hcp-remove-btn {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border: none;
    background: transparent;
    color: var(--cs-text-mid);
    cursor: pointer;
    font-size: 13px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .hcp-remove-btn:hover { background: var(--cs-lilac); color: var(--cs-red-badge); }

  .hcp-empty {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    text-align: center;
    padding: 20px 0;
    margin: 0;
  }
  .hcp-error {
    font: var(--text-pc-script-12);
    color: var(--cs-red-badge);
    margin: 0;
  }

  .hcp-footer {
    padding: 16px 24px 20px;
    border-top: 1px solid var(--cs-lilac);
    display: flex;
    gap: 10px;
    flex-shrink: 0;
  }
  .hcp-btn-cancel {
    flex: 1;
    height: 40px;
    border: 1.5px solid var(--cs-lilac);
    border-radius: var(--radius-md);
    background: #fff;
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
  }
  .hcp-btn-cancel:hover:not(:disabled) { border-color: var(--cs-purple); color: var(--cs-purple); }
  .hcp-btn-save {
    flex: 2;
    height: 40px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--cs-purple);
    color: #fff;
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
  }
  .hcp-btn-save:hover:not(:disabled) { background: var(--cs-purple-dark, #2d2370); }
  .hcp-btn-save:disabled,
  .hcp-btn-cancel:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
