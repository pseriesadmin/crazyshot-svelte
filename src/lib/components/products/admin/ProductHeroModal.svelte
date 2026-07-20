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

  interface HeroSettings {
    products: { id: string; order: number }[]
    mode: 'random' | 'fixed'
  }

  interface Props {
    settingKey?: string
    initialSettings: HeroSettings
    onclose: () => void
  }

  let {
    settingKey = 'product_page_hero',
    initialSettings,
    onclose,
  }: Props = $props()

  let mode = $state<'random' | 'fixed'>(initialSettings.mode)
  let selected = $state<ProductItem[]>([])
  let searchResults = $state<ProductItem[]>([])
  let isSearching = $state(false)
  let isLoadingInitial = $state(false)
  let isSaving = $state(false)
  let error = $state<string | null>(null)
  let debounceTimer = $state<ReturnType<typeof setTimeout> | null>(null)
  let pickerSelectedId = $state<string | null>(null)

  const selectedIds = $derived(new Set(selected.map((s) => s.id)))

  const pickerOptions = $derived<SuggestPickerOption[]>(
    searchResults
      .filter((p) => !selectedIds.has(p.id))
      .map((p) => ({
        id:    p.id,
        label: p.name,
        meta:  [formatPrice(p.base_price_daily) + '원/일'],
      }))
  )

  const MAX_ITEMS = 10

  function formatPrice(n: number): string {
    return n.toLocaleString('ko-KR')
  }

  function onPickerInput(val: string) {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (!val.trim()) { searchResults = []; return }
    debounceTimer = setTimeout(() => doSearch(val.trim()), 280)
  }

  function onProductSelect(opt: SuggestPickerOption) {
    const product = searchResults.find((p) => p.id === opt.id)
    if (product) addProduct(product)
    setTimeout(() => { pickerSelectedId = null; searchResults = [] }, 0)
  }

  // Fix 1 — 초기 저장 상품 복원
  $effect(() => {
    const ids = initialSettings.products
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
          if (id) map.set(id, {
            id,
            name:             String(r['name'] ?? ''),
            image_urls:       (r['image_urls'] as string[] | null) ?? null,
            base_price_daily: Number(r['base_price_daily'] ?? 0),
          })
        }
        selected = ids.map((id) => map.get(id)).filter((x): x is ProductItem => !!x)
        isLoadingInitial = false
      }
    )
  })

  // Fix 2+3 — product_id→id, price_min→base_price_daily 정규화
  async function doSearch(q: string) {
    isSearching = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('search_products', {
      p_query: q,
      p_category: null,
      p_page: 1,
      p_limit: 10,
      p_session_id: null,
      p_user_id: null,
    })
    searchResults = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id:               String(r['product_id'] ?? r['id'] ?? ''),
      name:             String(r['name'] ?? ''),
      image_urls:       (r['image_urls'] as string[] | null) ?? null,
      base_price_daily: Number(r['price_min'] ?? r['base_price_daily'] ?? 0),
    }))
    isSearching = false
  }

  function addProduct(p: ProductItem) {
    if (selected.length >= MAX_ITEMS) return
    if (selected.some((s) => s.id === p.id)) return
    selected = [...selected, p]
  }

  function removeProduct(id: string) {
    selected = selected.filter((s) => s.id !== id)
  }

  async function save() {
    isSaving = true
    error = null
    const value: HeroSettings = {
      products: selected.map((p, i) => ({ id: p.id, order: i })),
      mode,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase.rpc as any)('upsert_product_page_setting', {
      p_key: settingKey,
      p_value: value,
    })
    if (err) {
      error = (err as { message: string }).message
    } else {
      await invalidateAll()
      onclose()
    }
    isSaving = false
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onclose} role="presentation"></div>

<aside class="modal-panel" role="dialog" aria-modal="true" aria-label="헤더 상품 설정">
  <div class="modal-header">
    <span class="modal-title">
      {settingKey === 'product_page_md_picks' ? 'MD 추천 픽 설정' : '헤더 슬라이드 상품 설정'}
    </span>
    <button class="modal-close" onclick={onclose} aria-label="닫기">✕</button>
  </div>

  <div class="modal-body">
    <!-- 모드 선택 -->
    <div class="section">
      <p class="section-label">노출 방식</p>
      <div class="radio-group">
        <label class="radio-opt">
          <input type="radio" name="mode" value="fixed" checked={mode === 'fixed'} onchange={() => (mode = 'fixed')} />
          <span>고정 순서</span>
        </label>
        <label class="radio-opt">
          <input type="radio" name="mode" value="random" checked={mode === 'random'} onchange={() => (mode = 'random')} />
          <span>랜덤 노출</span>
        </label>
      </div>
    </div>

    <!-- 상품 검색 -->
    <div class="section">
      <p class="section-label">상품 추가 <span class="count-badge">{selected.length}/{MAX_ITEMS}</span></p>
      <div class="search-wrap">
        {#if isLoadingInitial || isSearching}
          <p class="search-hint">{isLoadingInitial ? '저장된 상품 불러오는 중…' : '검색 중…'}</p>
        {/if}
        <SuggestPicker
          id="product-search"
          bind:selectedId={pickerSelectedId}
          options={pickerOptions}
          noFilter
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
              disabled={selected.length >= MAX_ITEMS}
            />
          {/snippet}
          {#snippet renderItem(item, _i, _sel)}
            <span class="suggest-name">{item.label}</span>
            <span class="suggest-price">{item.meta?.[0] ?? ''}</span>
          {/snippet}
        </SuggestPicker>
      </div>
    </div>

    <!-- 선택된 상품 목록 (드래그 순서) -->
    {#if selected.length > 0}
      <div class="section">
        <p class="section-label">선택된 상품 (드래그로 순서 변경)</p>
        <CmsDragList bind:items={selected} itemKey={(item) => item.id}>
          {#snippet renderItem(item)}
            <div class="selected-row">
              <span class="selected-name">{item.name}</span>
              <button class="remove-btn" onclick={() => removeProduct(item.id)} aria-label="{item.name} 제거">✕</button>
            </div>
          {/snippet}
        </CmsDragList>
      </div>
    {:else}
      <p class="empty-msg">위 검색창에서 상품을 추가하세요.</p>
    {/if}

    {#if error}
      <p class="save-error" role="alert">{error}</p>
    {/if}
  </div>

  <div class="modal-footer">
    <button class="btn-cancel" onclick={onclose} disabled={isSaving}>취소</button>
    <button class="btn-save" onclick={save} disabled={isSaving}>
      {isSaving ? '저장 중…' : '저장'}
    </button>
  </div>
</aside>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(16, 11, 50, 0.3);
  }

  .modal-panel {
    position: fixed;
    right: 0;
    top: 0;
    height: 100dvh;
    width: 420px;
    z-index: 201;
    background: var(--cs-white);
    border-radius: var(--radius-2xl) 0 0 var(--radius-2xl);
    box-shadow: -4px 0 24px rgba(16, 11, 50, 0.15);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    background: var(--cs-dark);
    padding: 20px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .modal-title {
    color: var(--cs-white);
    font: var(--text-pc-title-16);
  }

  .modal-close {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.7);
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
    min-height: 32px;
  }
  .modal-close:hover { color: var(--cs-white); }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .section { display: flex; flex-direction: column; gap: 8px; }

  .section-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .count-badge {
    background: rgba(59, 47, 138, 0.1);
    color: var(--cs-purple);
    border-radius: var(--radius-full);
    padding: 1px 8px;
    font-size: 11px;
  }

  .radio-group {
    display: flex;
    gap: 16px;
  }

  .radio-opt {
    display: flex;
    align-items: center;
    gap: 6px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    cursor: pointer;
  }

  .radio-opt input { accent-color: var(--cs-purple); }

  .search-wrap { position: relative; }

  /* f-input — 카테고리 모달 동일 규격 */
  .f-input {
    width: 100%;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: 10px;
    padding: 12px 16px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    min-height: 44px;
    box-sizing: border-box;
  }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
  .f-input:disabled { opacity: 0.5; cursor: not-allowed; }
  .f-input::placeholder { color: var(--cs-text-light); }

  .search-hint {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    margin: 0 0 4px;
  }

  /* SuggestPicker renderItem 스타일 — 이름(좌) + 가격(우) 행 레이아웃 */
  .suggest-name {
    flex: 1;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .suggest-price {
    font: var(--text-pc-script-12);
    color: var(--cs-purple);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .selected-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .selected-name {
    flex: 1;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .remove-btn {
    background: none;
    border: none;
    color: var(--cs-text-light);
    cursor: pointer;
    padding: 2px 6px;
    font-size: 14px;
    min-height: 32px;
    min-width: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    transition: background 0.12s, color 0.12s;
  }
  .remove-btn:hover { background: rgba(255, 53, 53, 0.08); color: var(--cs-red-badge); }

  .empty-msg {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    text-align: center;
    padding: 16px 0;
  }

  .save-error {
    font: var(--text-pc-script-12);
    color: var(--cs-red-badge);
    background: rgba(255, 53, 53, 0.08);
    border-radius: var(--radius-sm);
    padding: 8px 12px;
  }

  .modal-footer {
    flex-shrink: 0;
    padding: 16px 24px;
    display: flex;
    gap: 10px;
    border-top: 1px solid var(--cs-lilac);
  }

  .btn-cancel {
    flex: 1;
    height: 50px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    font: var(--text-pc-title-16);
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-cancel:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .btn-cancel:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .btn-save {
    flex: 1;
    height: 50px;
    background: var(--cs-red-badge);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    font: var(--text-pc-title-16);
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-save:hover:not(:disabled) { background: var(--cs-red); }
  .btn-save:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
</style>
