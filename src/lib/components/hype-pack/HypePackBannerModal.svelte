<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'
  import { validateUploadFile, getMimeExtension } from '$lib/utils/fileValidation'
  import { matchesSearch } from '$lib/utils/chosungSearch'

  interface BannerItem {
    product_id: string
    subtitle: string
    order: number
    pc_image_url: string | null
    mobile_image_url: string | null
  }

  interface ProductItem {
    id: string
    name: string
    image_urls: string[] | null
    base_price_daily: number
  }

  type BannerVariant = 'pc' | 'mobile'

  interface SelectedItem extends ProductItem {
    subtitle: string
    pc_image_url: string | null
    mobile_image_url: string | null
    _pcPreview: string | null
    _pcFile: File | null
    _mobilePreview: string | null
    _mobileFile: File | null
  }

  interface InitialSettings {
    mode: 'random' | 'fixed'
    items: BannerItem[]
    keywords: string[]
  }

  interface Props {
    initialSettings: InitialSettings
    /** code_mapping_groups(조합코드그룹) SSOT에서 조회한 "패키지" 카테고리 키 — 상품 검색을
     * 이 카테고리로 잠그는 데 사용. 조회 실패 시 'hypepack' 리터럴로 폴백 */
    packageCategoryKey?: string | null
    onclose: () => void
  }

  let { initialSettings, packageCategoryKey = null, onclose }: Props = $props()
  const searchCategory = packageCategoryKey ?? 'hypepack'

  let mode             = $state<'random' | 'fixed'>(initialSettings.mode ?? 'fixed')
  let selected         = $state<SelectedItem[]>([])
  let searchResults    = $state<ProductItem[]>([])
  let isLoadingInitial = $state(false)
  let isSearching      = $state(false)
  let isSaving         = $state(false)
  let error            = $state<string | null>(null)
  let debounceTimer    = $state<ReturnType<typeof setTimeout> | null>(null)
  let pickerSelectedId = $state<string | null>(null)

  // Keyword state — SuggestPicker 연동(상품명 검색 제안 + 자유 입력 둘 다 허용)
  let selectedKeywords    = $state<string[]>(initialSettings.keywords ?? [])
  let kwPickerSelectedId  = $state<string | null>(null)
  let kwSearchResults     = $state<string[]>([])
  let kwDebounceTimer     = $state<ReturnType<typeof setTimeout> | null>(null)

  const MAX_ITEMS    = 6
  const MAX_KEYWORDS = 10

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

  const kwPickerOptions = $derived<SuggestPickerOption[]>(
    kwSearchResults
      .filter((name) => !selectedKeywords.includes(name))
      .map((name) => ({ id: name, label: name }))
  )

  function formatPrice(n: number): string {
    return n.toLocaleString('ko-KR')
  }

  // Load initial products
  $effect(() => {
    const ids = (initialSettings.items ?? [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((i) => i.product_id)
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
        const itemMap = new Map(initialSettings.items.map((i) => [i.product_id, i]))
        selected = ids
          .map((id): SelectedItem | null => {
            const prod = map.get(id)
            if (!prod) return null
            const raw = itemMap.get(id)
            return {
              ...prod,
              subtitle:         raw?.subtitle ?? '',
              pc_image_url:     raw?.pc_image_url ?? null,
              mobile_image_url: raw?.mobile_image_url ?? null,
              _pcPreview:       null,
              _pcFile:          null,
              _mobilePreview:   null,
              _mobileFile:      null,
            }
          })
          .filter((x): x is SelectedItem => !!x)
        isLoadingInitial = false
      }
    )
  })

  // 카테고리가 잠겨있어 후보군이 소수라, 카테고리 전체를 1회만 가져와 캐시한 뒤
  // 매 입력마다 클라이언트에서 matchesSearch(부분일치+초성)로 필터링한다 — Postgres
  // FTS/trigram은 초성만 입력된 검색어("ㅇㄷ" 등)를 매칭하지 못하기 때문
  // (HypePackThemeGroupModal.svelte와 동일 패턴)
  let productCandidates = $state<ProductItem[]>([])
  let candidatesLoaded  = false

  async function loadProductCandidates() {
    if (candidatesLoaded) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('search_products', {
      p_query: '',
      p_category: searchCategory,
      p_page: 1,
      p_limit: 100,
      p_session_id: null,
      p_user_id: null,
    })
    productCandidates = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id:               String(r['product_id'] ?? r['id'] ?? ''),
      name:             String(r['name'] ?? ''),
      image_urls:       (r['image_urls'] as string[] | null) ?? null,
      base_price_daily: Number(r['price_min'] ?? r['base_price_daily'] ?? 0),
    }))
    candidatesLoaded = true
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

  async function doSearch(q: string) {
    isSearching = true
    await loadProductCandidates()
    searchResults = productCandidates.filter((p) => matchesSearch({ name: p.name, product_code: null }, q))
    isSearching = false
  }

  function addProduct(p: ProductItem) {
    if (selected.length >= MAX_ITEMS) return
    if (selected.some((s) => s.id === p.id)) return
    selected = [...selected, {
      ...p,
      subtitle:         '',
      pc_image_url:     null,
      mobile_image_url: null,
      _pcPreview:       null,
      _pcFile:          null,
      _mobilePreview:   null,
      _mobileFile:      null,
    }]
  }

  function removeProduct(id: string) {
    const item = selected.find((s) => s.id === id)
    if (item?._pcPreview) URL.revokeObjectURL(item._pcPreview)
    if (item?._mobilePreview) URL.revokeObjectURL(item._mobilePreview)
    selected = selected.filter((s) => s.id !== id)
  }

  function updateSubtitle(id: string, val: string) {
    selected = selected.map((s) => s.id === id ? { ...s, subtitle: val } : s)
  }

  function onBannerImageChange(id: string, variant: BannerVariant, e: Event) {
    const input = e.target as HTMLInputElement
    const file  = input.files?.[0]
    if (!file) return
    const check = validateUploadFile(file)
    if (!check.ok) { error = check.error ?? '파일 업로드 실패'; input.value = ''; return }
    const old = selected.find((s) => s.id === id)
    const previewKey = variant === 'pc' ? '_pcPreview' : '_mobilePreview'
    const fileKey     = variant === 'pc' ? '_pcFile'    : '_mobileFile'
    if (old?.[previewKey]) URL.revokeObjectURL(old[previewKey] as string)
    const preview = URL.createObjectURL(file)
    selected = selected.map((s) =>
      s.id === id ? { ...s, [previewKey]: preview, [fileKey]: file } : s
    )
  }

  async function uploadBannerImage(item: SelectedItem, variant: BannerVariant): Promise<string | null> {
    const file = variant === 'pc' ? item._pcFile : item._mobileFile
    if (!file) return variant === 'pc' ? item.pc_image_url : item.mobile_image_url
    const ext  = getMimeExtension(file.type)
    const path = `hype-pack-banner/${item.id}-${variant}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('cms-assets')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (upErr) throw new Error(`[${item.name}] ${variant === 'pc' ? 'PC' : '모바일'} 배너 이미지 업로드 실패: ${upErr.message}`)
    const { data } = supabase.storage.from('cms-assets').getPublicUrl(path)
    return data.publicUrl
  }

  // IME-SAFE-INPUT — add() 내부에서 항상 빈값·중복·최대치 방어 (core-rules.md)
  function addKeywordValue(val: string) {
    const kw = val.trim()
    if (!kw || selectedKeywords.includes(kw) || selectedKeywords.length >= MAX_KEYWORDS) return
    selectedKeywords = [...selectedKeywords, kw]
  }

  function removeKeyword(kw: string) {
    selectedKeywords = selectedKeywords.filter((k) => k !== kw)
  }

  function onKwPickerInput(val: string) {
    if (kwDebounceTimer) clearTimeout(kwDebounceTimer)
    if (!val.trim()) { kwSearchResults = []; return }
    kwDebounceTimer = setTimeout(() => doKwSearch(val.trim()), 280)
  }

  async function doKwSearch(q: string) {
    await loadProductCandidates()
    const names = productCandidates
      .filter((p) => matchesSearch({ name: p.name, product_code: null }, q))
      .map((p) => p.name)
      .filter(Boolean)
    kwSearchResults = Array.from(new Set(names)).slice(0, 8)
  }

  function onKwSelect(opt: SuggestPickerOption) {
    addKeywordValue(opt.label)
    setTimeout(() => { kwPickerSelectedId = null; kwSearchResults = [] }, 0)
  }

  // 자유 입력 Enter 추가 — SuggestPicker가 제안 항목을 선택 처리(preventDefault)하지 않은
  // 경우에만(= 하이라이트된 제안이 없는 경우) 입력한 텍스트 그대로 키워드로 추가한다
  function onKwFreeTextEnter(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.isComposing && !e.defaultPrevented) {
      e.preventDefault()
      addKeywordValue((e.target as HTMLInputElement).value)
      kwPickerSelectedId = null
      kwSearchResults = []
    }
  }

  async function save() {
    isSaving = true
    error = null
    try {
      const resolvedItems = await Promise.all(
        selected.map(async (s, i) => ({
          product_id:       s.id,
          subtitle:         s.subtitle,
          order:            i,
          pc_image_url:     await uploadBannerImage(s, 'pc'),
          mobile_image_url: await uploadBannerImage(s, 'mobile'),
        }))
      )
      const value: InitialSettings = {
        mode,
        items: resolvedItems,
        keywords: selectedKeywords,
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase.rpc as any)('upsert_product_page_setting', {
        p_key: 'hype_pack_banner',
        p_value: value,
      })
      if (err) {
        error = (err as { message: string }).message
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
<div class="modal-backdrop" onclick={onclose} role="presentation"></div>

<aside class="modal-panel" role="dialog" aria-modal="true" aria-label="배너 상품 설정">
  <div class="modal-header">
    <span class="modal-title">배너 상품 설정</span>
    <button class="modal-close" onclick={onclose} aria-label="닫기">✕</button>
  </div>

  <div class="modal-body">
    <!-- 노출 방식 -->
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

    <!-- 배너 상품 추가 -->
    <div class="section">
      <p class="section-label">배너 상품 <span class="count-badge">{selected.length}/{MAX_ITEMS}</span></p>
      <div class="search-wrap">
        {#if isLoadingInitial || isSearching}
          <p class="search-hint">{isLoadingInitial ? '저장된 상품 불러오는 중…' : '검색 중…'}</p>
        {/if}
        <SuggestPicker
          id="banner-product-search"
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
              class="f-input search-in"
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

    <!-- 선택된 상품 목록 -->
    {#if selected.length > 0}
      <div class="section">
        <p class="section-label">선택된 상품 (드래그로 순서 변경)</p>
        <CmsDragList bind:items={selected} itemKey={(item) => item.id}>
          {#snippet renderItem(item)}
            <div class="selected-row">
              {#if item.image_urls?.[0]}
                <img src={item.image_urls[0]} alt="" class="selected-thumb" aria-hidden="true" />
              {/if}
              <div class="selected-info">
                <span class="selected-name">{item.name}</span>
                <input
                  type="text"
                  class="subtitle-input"
                  placeholder="서브 타이틀 (예: Analog Pack)"
                  value={item.subtitle}
                  oninput={(e) => updateSubtitle(item.id, (e.target as HTMLInputElement).value)}
                />
                <div class="banner-img-row">
                  <label class="banner-img-pick" title="PC 배너 이미지 선택">
                    <span class="banner-img-thumb">
                      {#if item._pcPreview}
                        <img src={item._pcPreview} alt="" aria-hidden="true" />
                      {:else if item.pc_image_url}
                        <img src={item.pc_image_url} alt="" aria-hidden="true" />
                      {/if}
                    </span>
                    <span class="banner-img-label">PC 배너</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/heif,image/heic,application/pdf"
                      class="sr-only"
                      onchange={(e) => onBannerImageChange(item.id, 'pc', e)}
                    />
                  </label>
                  <label class="banner-img-pick" title="모바일 배너 이미지 선택">
                    <span class="banner-img-thumb">
                      {#if item._mobilePreview}
                        <img src={item._mobilePreview} alt="" aria-hidden="true" />
                      {:else if item.mobile_image_url}
                        <img src={item.mobile_image_url} alt="" aria-hidden="true" />
                      {/if}
                    </span>
                    <span class="banner-img-label">모바일 배너</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/heif,image/heic,application/pdf"
                      class="sr-only"
                      onchange={(e) => onBannerImageChange(item.id, 'mobile', e)}
                    />
                  </label>
                </div>
                <p class="banner-img-hint">미선택 시 상품 대표이미지가 자동 적용됩니다.</p>
              </div>
              <button class="remove-btn" onclick={() => removeProduct(item.id)} aria-label="{item.name} 제거">✕</button>
            </div>
          {/snippet}
        </CmsDragList>
      </div>
    {:else}
      <p class="empty-msg">위 검색창에서 상품을 추가하세요.</p>
    {/if}

    <!-- 모바일 키워드 칩 설정 -->
    <div class="section">
      <p class="section-label">모바일 키워드 칩 <span class="count-badge">{selectedKeywords.length}/{MAX_KEYWORDS}</span></p>
      <p class="section-hint">모바일 화면 상단에 노출될 키워드입니다. 상품명 검색으로 제안받거나 직접 입력 후 Enter로 추가하세요.</p>
      {#if selectedKeywords.length < MAX_KEYWORDS}
        <div class="search-wrap">
          <SuggestPicker
            id="hype-banner-kw-search"
            bind:selectedId={kwPickerSelectedId}
            options={kwPickerOptions}
            noFilter
            placeholder="키워드 입력 후 추가 (상품명 검색 가능)"
            listLabel="키워드 제안"
            oninput={onKwPickerInput}
            onselect={onKwSelect}
          >
            {#snippet field(c)}
              <input
                type="text"
                class="f-input search-in kw-input"
                id={c.id}
                placeholder={c.placeholder}
                value={c.value}
                oninput={c.oninput}
                onkeydown={(e) => { c.onkeydown(e); onKwFreeTextEnter(e) }}
                onfocus={c.onfocus}
                onblur={c.onblur}
                aria-autocomplete={c.ariaAutocomplete}
                aria-expanded={c.ariaExpanded}
                aria-controls={c.ariaControls}
                autocomplete="off"
              />
            {/snippet}
          </SuggestPicker>
        </div>
      {:else}
        <p class="kw-max-hint">최대 {MAX_KEYWORDS}개 선택 완료</p>
      {/if}
      {#if selectedKeywords.length > 0}
        <div class="kw-chips">
          {#each selectedKeywords as kw}
            <span class="kw-chip">
              {kw}
              <button class="kw-chip-remove" onclick={() => removeKeyword(kw)} aria-label="{kw} 제거">✕</button>
            </span>
          {/each}
        </div>
      {/if}
    </div>

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
    width: 440px;
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
    padding: 18px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .modal-title {
    color: var(--cs-white);
    font-size: 15px;
    font-weight: 700;
  }

  .modal-close {
    background: none;
    border: none;
    color: rgba(255,255,255,0.7);
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
    line-height: 1;
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .section-label {
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-text);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .section-hint {
    font-size: 12px;
    color: var(--cs-text-mid, #666);
    margin: 0;
  }

  .count-badge {
    background: var(--cs-lilac);
    color: var(--cs-text);
    border-radius: 99px;
    padding: 1px 8px;
    font-size: 11px;
    font-weight: 600;
  }

  .radio-group {
    display: flex;
    gap: 16px;
  }

  .radio-opt {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    cursor: pointer;
  }

  .search-wrap { position: relative; }

  .search-hint {
    font-size: 12px;
    color: var(--cs-text-mid, #666);
    margin: 0 0 6px;
  }

  .f-input {
    width: 100%;
    min-height: 44px;
    padding: 0 16px;
    border: 1.5px solid var(--cs-border);
    border-radius: var(--radius-md);
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    box-sizing: border-box;
  }

  .f-input:focus { outline: none; border-color: var(--cs-purple); }
  .f-input:disabled { opacity: 0.5; }

  /* CMS 표준 검색 입력 (cms-uiux.md §7-7 .search-in) — 배너 상품 검색창 전용 */
  .search-in {
    background: var(--cs-white);
    border: 1px solid #ECEBF4;
    border-radius: var(--radius-sm);
    padding: 10px 20px;
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    min-height: 0;
  }
  .search-in::placeholder { color: var(--cs-text-light); }
  .search-in:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; border-color: var(--cs-purple); }

  .suggest-name { font-size: 13px; font-weight: 600; }
  .suggest-price { font-size: 12px; color: var(--cs-text-mid, #666); }

  .selected-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
  }

  .selected-thumb {
    width: 44px;
    height: 44px;
    object-fit: cover;
    border-radius: 8px;
    flex-shrink: 0;
  }

  .selected-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .banner-img-row {
    display: flex;
    gap: 8px;
  }

  .banner-img-pick {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 4px 4px;
    background: var(--cs-surface-gray, #f6f6f6);
    border: 1px solid var(--cs-lilac);
    border-radius: 8px;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s;
  }

  .banner-img-pick:hover {
    border-color: var(--cs-purple);
    background: rgba(59, 47, 138, 0.06);
  }

  .banner-img-thumb {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: 6px;
    background: var(--cs-lilac);
    overflow: hidden;
    display: flex;
  }

  .banner-img-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .banner-img-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--cs-text-mid, #666);
    white-space: nowrap;
  }

  .banner-img-hint {
    font-size: 11px;
    color: var(--cs-text-light, #999);
    margin: 0;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }

  .selected-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--cs-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .subtitle-input {
    width: 100%;
    height: 30px;
    border: 1px solid var(--cs-lilac);
    border-radius: 6px;
    padding: 0 8px;
    font-size: 12px;
    color: var(--cs-text);
    background: var(--cs-surface-gray, #f6f6f6);
    box-sizing: border-box;
  }

  .remove-btn {
    background: none;
    border: none;
    color: var(--cs-text-mid, #666);
    font-size: 14px;
    cursor: pointer;
    padding: 4px;
    flex-shrink: 0;
    line-height: 1;
  }

  .remove-btn:hover { color: var(--cs-red-badge, #FF3535); }

  .empty-msg {
    font-size: 13px;
    color: var(--cs-text-mid, #666);
    text-align: center;
    padding: 16px 0;
    margin: 0;
  }

  .kw-input { width: 100%; }

  .kw-max-hint {
    font-size: 12px;
    color: var(--cs-text-mid, #666);
    margin: 0;
  }

  .kw-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .kw-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--cs-lilac);
    color: var(--cs-text);
    border-radius: 99px;
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 600;
  }

  .kw-chip-remove {
    background: none;
    border: none;
    padding: 0;
    font-size: 11px;
    cursor: pointer;
    color: var(--cs-text-mid, #666);
    line-height: 1;
  }

  .kw-chip-remove:hover { color: var(--cs-red-badge, #FF3535); }

  .save-error {
    font-size: 13px;
    color: var(--cs-red-badge, #FF3535);
    margin: 0;
  }

  .modal-footer {
    padding: 16px 20px;
    border-top: 1px solid var(--cs-lilac);
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  .btn-cancel {
    height: 36px;
    padding: 0 18px;
    background: var(--cs-surface-gray, #f6f6f6);
    color: var(--cs-text);
    border: 1px solid var(--cs-lilac);
    border-radius: var(--radius-sm, 8px);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-save {
    height: 36px;
    padding: 0 20px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-sm, 8px);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .btn-save:disabled,
  .btn-cancel:disabled { opacity: 0.5; cursor: not-allowed; }

  @media (max-width: 460px) {
    .modal-panel { width: 100%; border-radius: var(--radius-2xl) var(--radius-2xl) 0 0; top: auto; bottom: 0; height: 90dvh; }
  }
</style>
