<script lang="ts">
  import { enhance } from '$app/forms'
  import { supabase } from '$lib/services/supabase'
  import { csToast } from '$lib/utils/toast'
  import CmsSimilarNameInput from '$lib/components/cms/CmsSimilarNameInput.svelte'
  import CmsSuggestPicker from '$lib/components/cms/CmsSuggestPicker.svelte'
  import type { SimilarNameItem } from '$lib/types/cms-similar-name'
  import type { SuggestPickerOption } from '$lib/types/cms-suggest-picker'
  import { productSearchOrFilter } from '$lib/utils/similarNameSuggest'
  import { resizeProductImage } from '$lib/utils/imageResize'
  import { buildPreview, datePart } from '../../codes/_shared'
  import type { CodeFormat } from '../../codes/+page.server'
  import type { PageData, ActionData } from './$types'
  import type { MappingGroupSimple, MappingItemSimple, TaxonomyCodeSimple } from './+page.server'

  interface Props { data: PageData; form: ActionData }
  let { data, form }: Props = $props()

  type FormResult = { error?: string } | null

  const CATEGORIES = [
    { value: 'camera',     label: '카메라' },
    { value: 'lens',       label: '렌즈' },
    { value: 'camcorder',  label: '캠코더' },
    { value: 'action_cam', label: '액션캠' },
    { value: 'drone',      label: '드론' },
    { value: 'lighting',   label: '조명' },
    { value: 'audio',      label: '오디오' },
    { value: 'accessory',  label: '보조용품' },
    { value: 'package',    label: '패키지' },
  ]

  const CATEGORY_CODES: Record<string, string> = {
    camera: 'CAM', lens: 'LNS', camcorder: 'CMC', action_cam: 'ACT',
    drone: 'DRN', lighting: 'LGT', audio: 'AUD', accessory: 'ACC', package: 'PKG',
  }

  // ─── 옵션상품 ───────────────────────────────────────────────
  interface OptionSearchResult {
    id: string
    name: string
    price_24h: number
    stock_quantity: number
    image_url: string | null
  }
  interface SelectedOption {
    option_product_id: string
    name: string
    price_24h: number
    stock_quantity: number
    image_url: string | null
    is_required: boolean
    min_select_required: boolean
    delivery_rental_disabled: boolean
  }

  let optionKeyword = $state('')
  let showOptionModal = $state(false)
  let optionResults = $state<OptionSearchResult[]>([])
  let optionSearching = $state(false)
  let selectedOptions = $state<SelectedOption[]>([])
  let bulkRequired = $state(false)
  let bulkMinSelectRequired = $state(false)
  let bulkDeliveryDisabled = $state(false)

  interface ProductSearchRow {
    id: string
    name: string
    stock_quantity: number
    image_urls: string[]
    price_rules: { price: number; duration_type: string }[]
  }

  async function searchOptionProducts() {
    const kw = optionKeyword.trim()
    if (!kw) return
    optionSearching = true
    showOptionModal = true
    const { data, error: err } = await supabase
      .from('products')
      .select<string, ProductSearchRow>('id, name, stock_quantity, image_urls, price_rules(price, duration_type)')
      .or(productSearchOrFilter(kw))
      .eq('is_active', true)
      .is('deleted_at', null)
      .limit(20)
    optionSearching = false
    if (err) { csToast.error('상품 검색 중 오류가 발생했습니다.'); return }
    optionResults = (data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      stock_quantity: p.stock_quantity ?? 0,
      image_url: p.image_urls[0] ?? null,
      price_24h: p.price_rules.find((r) => r.duration_type === '24h')?.price ?? 0,
    }))
  }

  function onOptionSuggestSelect() {
    void searchOptionProducts()
  }

  function addOptionProduct(item: OptionSearchResult) {
    if (selectedOptions.some((o) => o.option_product_id === item.id)) {
      csToast.info('이미 추가된 상품입니다.')
      return
    }
    selectedOptions = [
      ...selectedOptions,
      {
        option_product_id: item.id,
        name: item.name,
        price_24h: item.price_24h,
        stock_quantity: item.stock_quantity,
        image_url: item.image_url,
        is_required: false,
        min_select_required: false,
        delivery_rental_disabled: false,
      },
    ]
    showOptionModal = false
    optionKeyword = ''
    optionResults = []
  }

  function removeOption(id: string) {
    selectedOptions = selectedOptions.filter((o) => o.option_product_id !== id)
  }

  function applyBulk() {
    selectedOptions = selectedOptions.map((o) => ({
      ...o,
      is_required: bulkRequired,
      min_select_required: bulkMinSelectRequired,
      delivery_rental_disabled: bulkDeliveryDisabled,
    }))
  }

  function serializeOptionLinks(): string {
    return JSON.stringify(
      selectedOptions.map((o, i) => ({
        option_product_id: o.option_product_id,
        is_required: o.is_required,
        min_select_required: o.min_select_required,
        delivery_rental_disabled: o.delivery_rental_disabled,
        display_order: i,
      }))
    )
  }
  // ────────────────────────────────────────────────────────────

  // ── 조합그룹 / 콤보 선택 ─────────────────────────────────────────────────
  interface ComboRow {
    combo_row_id: string
    combo_name: string | null
    date_option: 'none' | 'ym' | 'ymd'
    max_sequence: number
    codes: TaxonomyCodeSimple[]
  }

  let selectedGroupId    = $state<string | null>(null)
  let selectedComboRowId = $state<string | null>(null)
  let comboNameByRowId   = $state<Record<string, string | null>>({})

  const DEFAULT_CODE_FORMAT: CodeFormat = {
    prefix: 'CS',
    date_format: 'YYMM',
    seq_digits: 3,
    reset_monthly: true,
    suffix: '',
  }
  let codeFormat = $state<CodeFormat>(DEFAULT_CODE_FORMAT)
  let codeRuleById = $state<Record<string, Record<string, unknown> | null>>({})

  $effect(() => {
    const codeIds = [...new Set((data.mappingItems as MappingItemSimple[]).map((i) => i.taxonomy_code_id))]
    void (async () => {
      try {
        type CodeRuleRow = { id: string; code_rule: Record<string, unknown> | null }
        type SettingRow = { value: unknown } | null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fmtPromise = (supabase as any).from('cms_settings').select('value').eq('key', 'reservation_code_format').maybeSingle() as Promise<{ data: SettingRow; error: unknown }>
        const codesPromise: Promise<{ data: CodeRuleRow[] | null; error: unknown }> = codeIds.length > 0
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? (supabase as any).from('product_category_codes').select('id, code_rule').in('id', codeIds)
          : Promise.resolve({ data: [] as CodeRuleRow[], error: null })
        const [{ data: fmtRow }, codesRes] = await Promise.all([fmtPromise, codesPromise])
        if (fmtRow?.value && typeof fmtRow.value === 'object') {
          codeFormat = { ...DEFAULT_CODE_FORMAT, ...(fmtRow.value as CodeFormat) }
        }
        const map: Record<string, Record<string, unknown> | null> = {}
        for (const row of codesRes.data ?? []) {
          map[row.id] = row.code_rule
        }
        codeRuleById = map
      } catch {
        /* 기본 포맷 유지 */
      }
    })()
  })

  $effect(() => {
    const items = data.mappingItems as MappingItemSimple[]
    const rowIds = [...new Set(items.map((i) => i.combo_row_id))]
    if (rowIds.length === 0) {
      comboNameByRowId = {}
      return
    }
    void (async () => {
      try {
        type ComboNameRow = { combo_row_id: string; combo_name: string | null }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rows } = await (supabase as any)
          .from('code_mapping_items')
          .select('combo_row_id, combo_name')
          .in('combo_row_id', rowIds) as { data: ComboNameRow[] | null }
        const map: Record<string, string | null> = {}
        for (const row of rows ?? []) {
          if (!(row.combo_row_id in map)) {
            map[row.combo_row_id] = row.combo_name
          }
        }
        comboNameByRowId = map
      } catch {
        comboNameByRowId = {}
      }
    })()
  })

  function comboCatCodeStr(codes: TaxonomyCodeSimple[]): string {
    return codes
      .map((c) => c.code)
      .filter(Boolean)
      .join('')
      .toUpperCase()
  }

  function comboPreviewFmt(combo: ComboRow): CodeFormat {
    const root = combo.codes.find((c) => c.depth === 0) ?? combo.codes[0]
    const rootRule = root ? codeRuleById[root.id] : null
    let date_format: CodeFormat['date_format'] = codeFormat.date_format ?? 'YYMM'
    if (combo.date_option === 'none') date_format = 'NONE'
    else if (combo.date_option === 'ym') date_format = codeFormat.date_format ?? 'YYMM'
    else if (combo.date_option === 'ymd') date_format = 'YYYYMMDD'
    return {
      ...codeFormat,
      ...(rootRule?.prefix ? { prefix: rootRule.prefix as string } : {}),
      date_format,
      seq_digits: combo.max_sequence ? String(combo.max_sequence).length : (codeFormat.seq_digits ?? 3),
    }
  }

  function buildComboPreview(combo: ComboRow): string {
    const catCode = comboCatCodeStr(combo.codes)
    if (!catCode) return '—'
    const fmt = comboPreviewFmt(combo)
    if (combo.date_option === 'ymd') {
      const now = new Date()
      const yyyy = String(now.getFullYear())
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const dd = String(now.getDate()).padStart(2, '0')
      const prefix = (fmt.prefix ?? 'CS').trim().toUpperCase()
      const seqDigits = fmt.seq_digits ?? 3
      const suffix = (fmt.suffix ?? '').trim().toUpperCase()
      const s = '1'.padStart(seqDigits, '0')
      return `${prefix || 'CS'}${catCode}${yyyy}${mm}${dd}${s}${suffix}`
    }
    return buildPreview(catCode, fmt)
  }

  function comboPrefix(combo: ComboRow): string {
    return (comboPreviewFmt(combo).prefix ?? 'CS').trim().toUpperCase() || 'CS'
  }

  function comboDatePart(combo: ComboRow): string | null {
    if (combo.date_option === 'none') return null
    const fmt = comboPreviewFmt(combo)
    if (combo.date_option === 'ymd') {
      const now = new Date()
      return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    }
    const df = fmt.date_format ?? 'YYMM'
    if (df === 'YYYYMMDD') {
      const now = new Date()
      return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    }
    return datePart(df === 'YYYYMM' ? 'YYYYMM' : 'YYMM')
  }

  function comboSeqMax(combo: ComboRow): string {
    const digits = String(combo.max_sequence).length || 3
    return String(combo.max_sequence).padStart(digits, '0')
  }

  let combosForGroup = $derived<ComboRow[]>(
    selectedGroupId
      ? (() => {
          const items = (data.mappingItems as MappingItemSimple[]).filter(i => i.group_id === selectedGroupId)
          const rowIds = [...new Set(items.map(i => i.combo_row_id))]
          return rowIds.map(rid => {
            const rowItems = items.filter(i => i.combo_row_id === rid)
            const first = rowItems[0]
            const codes = rowItems
              .map(i => (data.taxonomyCodes as TaxonomyCodeSimple[]).find(tc => tc.id === i.taxonomy_code_id))
              .filter((tc): tc is TaxonomyCodeSimple => tc !== undefined)
              .sort((a, b) => a.depth - b.depth)
            return {
              combo_row_id: rid,
              combo_name: comboNameByRowId[rid] ?? null,
              date_option: first.date_option,
              max_sequence: first.max_sequence,
              codes,
            }
          })
        })()
      : []
  )

  function onGroupChange() {
    selectedComboRowId = null
    category = ''
  }

  const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
    CATEGORIES.map((c) => [c.value, c.label])
  )

  let groupPickerOptions = $derived<SuggestPickerOption[]>(
    (data.mappingGroups as MappingGroupSimple[]).map((mg) => ({
      id: mg.id,
      label: mg.name,
      meta: [
        mg.description,
        mg.default_category ? (CATEGORY_LABELS[mg.default_category] ?? mg.default_category) : null,
      ].filter((v): v is string => Boolean(v)),
    }))
  )

  function onGroupPickerSelect(opt: SuggestPickerOption, previousId: string | null) {
    if (opt.id !== previousId) onGroupChange()
  }

  function onGroupPickerInput(val: string) {
    if (!val.trim() && selectedGroupId) {
      selectedGroupId = null
      onGroupChange()
    }
  }

  function selectCombo(combo: ComboRow) {
    selectedComboRowId = combo.combo_row_id
    const codeWithCat = combo.codes.find(tc => tc.product_category)
    const cat = codeWithCat?.product_category ?? ''
    if (cat) {
      category = cat
      if (nameVal) slugVal = autoSlug(nameVal, cat)
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  let isLoading = $state(false)
  let isActive = $state(true)
  let category = $state('')
  let nameVal = $state('')
  let brandVal = $state('')
  let slugVal = $state('')
  let imageUrls = $state<string[]>([])
  const tempId = globalThis.crypto.randomUUID()
  let isUploading = $state(false)
  let uploadError = $state<string | null>(null)
  let isDragging = $state(false)
  let dragCounter = $state(0)
  let showUrlInput = $state(false)
  let urlInputVal = $state('')
  let fileInputEl = $state<HTMLInputElement | null>(null)
  let lightboxUrl = $state<string | null>(null)
  let specs = $state<{ key: string; value: string }[]>([{ key: '', value: '' }])

  let result = $derived(form as FormResult)

  $effect(() => {
    if (result?.error) csToast.error(result.error)
  })

  function autoSlug(name: string, cat: string): string {
    const catCode = CATEGORY_CODES[cat]?.toLowerCase() ?? ''
    const cleaned = name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
    const ym = new Date().toISOString().slice(2, 7).replace('-', '')
    const parts = [catCode, cleaned, ym].filter(Boolean)
    return parts.join('-').slice(0, 200)
  }

  function onNameInput(val: string) {
    if (!slugVal || slugVal === autoSlug(val.slice(0, -1), category)) {
      slugVal = autoSlug(val, category)
    }
  }

  function onNameSelect(item: SimilarNameItem, previousValue: string) {
    const prevAuto = autoSlug(previousValue, category)
    if (!slugVal || slugVal === prevAuto) {
      slugVal = autoSlug(item.name, category)
    }
  }
  function onCategoryChange() {
    if (nameVal) slugVal = autoSlug(nameVal, category)
  }

  async function uploadFile(file: File): Promise<string | null> {
    isUploading = true
    uploadError = null
    try {
      const { thumb, large } = await resizeProductImage(file)
      const fd = new FormData()
      fd.append('product_id', 'temp/' + tempId) // '/' 포함 → append_product_image_url RPC 스킵
      fd.append('thumb', new File([thumb], 'thumb.webp', { type: 'image/webp' }))
      fd.append('large', new File([large], 'large.webp', { type: 'image/webp' }))
      const res = await fetch('/api/cms/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        uploadError = (err as { message?: string }).message ?? '업로드 실패'
        return null
      }
      const data = await res.json() as { largeUrl: string }
      return data.largeUrl
    } catch (e) {
      uploadError = e instanceof Error ? e.message : '업로드 실패'
      return null
    } finally {
      isUploading = false
    }
  }

  async function handleFilesUpload(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (imageUrls.filter(Boolean).length >= 8) break
      const url = await uploadFile(file)
      if (url) imageUrls = [...imageUrls.filter(Boolean), url]
    }
  }

  function handleDragEnter(e: DragEvent) { e.preventDefault(); dragCounter++; isDragging = true }
  function handleDragLeave() { dragCounter--; if (dragCounter <= 0) { dragCounter = 0; isDragging = false } }
  function handleDragOver(e: DragEvent) { e.preventDefault() }
  function handleDrop(e: DragEvent) {
    e.preventDefault(); dragCounter = 0; isDragging = false
    const files = e.dataTransfer?.files
    if (files?.length) handleFilesUpload(files)
  }
  function triggerFileInput(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.dz-url-btn')) return
    fileInputEl?.click()
  }
  function handleFileSelect(e: Event) {
    const files = (e.target as HTMLInputElement).files
    if (files?.length) handleFilesUpload(files)
    ;(e.target as HTMLInputElement).value = ''
  }
  function toggleUrlInput(e: MouseEvent) { e.stopPropagation(); showUrlInput = !showUrlInput; urlInputVal = '' }
  function addByUrl() {
    const url = urlInputVal.trim()
    if (!url || imageUrls.filter(Boolean).length >= 8) return
    imageUrls = [...imageUrls.filter(Boolean), url]
    urlInputVal = ''
    showUrlInput = false
  }
  function removeImage(i: number) {
    const list = imageUrls.filter(Boolean)
    const removed = list[i]
    imageUrls = list.filter((_, idx) => idx !== i)
    if (removed) {
      fetch('/api/cms/upload', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ largeUrl: removed }),
      }).catch(() => {})
    }
  }
  function openLightbox(url: string) { lightboxUrl = url }
  function closeLightbox() { lightboxUrl = null }

  function addSpec() { specs = [...specs, { key: '', value: '' }] }
  function removeSpec(i: number) { specs = specs.filter((_, idx) => idx !== i) }

  function serializeSpecs(): string {
    const obj: Record<string, string> = {}
    for (const s of specs) {
      if (s.key.trim()) obj[s.key.trim()] = s.value
    }
    return JSON.stringify(obj)
  }

  function serializeImages(): string {
    return JSON.stringify(imageUrls.filter(Boolean))
  }

  function thumbUrl(url: string): string {
    if (!url) return ''
    if (url.includes('/large_')) return url.replace('/large_', '/thumb_')
    if (url.startsWith('http')) return url
    return `https://res.cloudinary.com/crazyshot/image/upload/w_120,h_90,c_fill,f_auto,q_auto/${url}.jpg`
  }

  let assetCodePreview = $derived(
    category
      ? `CS-${CATEGORY_CODES[category] ?? '???'}-${new Date().toISOString().slice(2, 7).replace('-', '')}-001`
      : 'CS-???-2607-001'
  )
</script>

<svelte:head><title>상품등록 — CrazyShot CMS</title></svelte:head>

<div class="form-wrap">
  {#if result?.error}
    <div class="error-banner" role="alert">{result.error}</div>
  {/if}

  <form
    method="POST"
    action="?/create"
    use:enhance={() => {
      isLoading = true
      return async ({ update }) => { await update(); isLoading = false }
    }}
    class="product-form"
  >
    <!-- Hidden serialized fields -->
    <input type="hidden" name="specifications" value={serializeSpecs()} />
    <input type="hidden" name="image_urls" value={serializeImages()} />
    <input type="hidden" name="is_active" value={isActive.toString()} />
    <input type="hidden" name="option_links" value={serializeOptionLinks()} />

    <!-- ① 기본정보 -->
    <section class="form-section">
      <h2 class="section-title">① 기본정보</h2>

      <div class="field-row">
        <label class="field-label" for="cat-group-sel">
          카테고리 <span class="required">*</span>
        </label>

        {#if (data.mappingGroups as MappingGroupSimple[]).length > 0}
          <CmsSuggestPicker
            id="cat-group-sel"
            bind:selectedId={selectedGroupId}
            options={groupPickerOptions}
            placeholder="조합그룹 검색 또는 선택..."
            listLabel="조합그룹 제안"
            oninput={onGroupPickerInput}
            onselect={onGroupPickerSelect}
            required
          >
            {#snippet field(c)}
              <input
                type="text"
                class="f-input"
                id={c.id}
                placeholder={c.placeholder}
                required={c.required}
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
          </CmsSuggestPicker>

          <!-- 폼 전송용 hidden 필드 -->
          {#if category}
            <input type="hidden" name="category" value={category} />
          {/if}
          {#if selectedGroupId}
            <input type="hidden" name="group_id" value={selectedGroupId} />
          {/if}
          {#if selectedComboRowId}
            <input type="hidden" name="combo_row_id" value={selectedComboRowId} />
          {/if}
        {:else}
          <!-- 그룹 미등록 시 기존 카테고리 선택 -->
          <select
            id="cat-group-sel"
            name="category"
            class="f-input f-select"
            bind:value={category}
            onchange={onCategoryChange}
            required
          >
            <option value="">카테고리 선택</option>
            {#each CATEGORIES as cat}
              <option value={cat.value}>{cat.label}</option>
            {/each}
          </select>
        {/if}
      </div>

      {#if (data.mappingGroups as MappingGroupSimple[]).length > 0 && selectedGroupId}
        <div class="field-row field-row-combo">
          <div class="field-label">코드 조합 <span class="required">*</span></div>
          {#if combosForGroup.length > 0}
            <div class="combo-rows">
              {#each combosForGroup as combo (combo.combo_row_id)}
                <button
                  type="button"
                  class="combo-row-btn"
                  class:combo-row-selected={selectedComboRowId === combo.combo_row_id}
                  onclick={() => selectCombo(combo)}
                  title={buildComboPreview(combo)}
                >
                  {#if combo.combo_name}
                    <span class="combo-name-label">{combo.combo_name}</span>
                  {/if}
                  <span class="combo-row-chips">
                    <span class="combo-prefix-chip">{comboPrefix(combo)}</span>
                    <span class="combo-sep">·</span>
                    <span class="combo-chips">
                      {#each combo.codes as tc, i}
                        {#if i > 0}<span class="combo-sep">·</span>{/if}
                        <span class="combo-chip">{tc.code}</span>
                      {/each}
                    </span>
                    {#if comboDatePart(combo)}
                      <span class="combo-sep">·</span>
                      <span class="combo-meta-chip combo-ym-chip" title="등록일 기준 년월">
                        {comboDatePart(combo)}
                      </span>
                    {/if}
                    <span class="combo-sep">·</span>
                    <span class="combo-meta-chip combo-seq-chip" title="순번 상한">
                      ~{comboSeqMax(combo)}
                    </span>
                  </span>
                </button>
              {/each}
            </div>
          {:else}
            <p class="combo-empty">이 그룹에 등록된 조합이 없습니다.</p>
          {/if}
        </div>
      {/if}

      <div class="field-row">
        <label class="field-label" for="name">상품명 <span class="required">*</span></label>
        <CmsSimilarNameInput
          id="name"
          name="name"
          bind:value={nameVal}
          placeholder="예: Sony FX3 Full-Frame Cinema Camera"
          categoryLabels={CATEGORY_LABELS}
          oninput={onNameInput}
          onselect={onNameSelect}
          required
        >
          {#snippet field(c)}
            <input
              type="text"
              class="f-input"
              id={c.id}
              name={c.name}
              placeholder={c.placeholder}
              required={c.required}
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
        </CmsSimilarNameInput>
      </div>

      <div class="field-row">
        <label class="field-label" for="brand">브랜드</label>
        <CmsSimilarNameInput
          id="brand"
          name="brand"
          bind:value={brandVal}
          source="brand"
          placeholder="예: Sony"
          categoryLabels={CATEGORY_LABELS}
          minChars={1}
        >
          {#snippet field(c)}
            <input
              type="text"
              class="f-input"
              id={c.id}
              name={c.name}
              placeholder={c.placeholder}
              required={c.required}
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
        </CmsSimilarNameInput>
      </div>

      <div class="field-row">
        <label class="field-label" for="slug">
          슬러그 <span class="required">*</span>
          <span class="field-hint">URL에 사용됩니다 — 영문·숫자·하이픈만</span>
        </label>
        <input
          id="slug"
          name="slug"
          type="text"
          class="f-input"
          placeholder="예: sony-fx3-2607"
          bind:value={slugVal}
          pattern="[a-z0-9\-]+"
          required
        />
      </div>

      <div class="field-row">
        <div class="field-label">판매 상태</div>
        <div class="toggle-wrap">
          <button
            type="button"
            class="toggle-btn"
            class:on={isActive}
            onclick={() => (isActive = !isActive)}
            aria-pressed={isActive}
            aria-label="판매 상태 전환"
          >
            <span class="toggle-knob"></span>
          </button>
          <span class="toggle-label">{isActive ? '활성 (판매중)' : '비활성 (숨김)'}</span>
        </div>
      </div>
    </section>

    <!-- ② 상품 설명 & 스펙 -->
    <section class="form-section">
      <h2 class="section-title">② 상품 설명 & 스펙</h2>

      <div class="field-row">
        <label class="field-label" for="description">상품 설명</label>
        <textarea
          id="description"
          name="description"
          class="f-input f-textarea"
          placeholder="상품 특징, 구성품, 주의사항 등을 입력해주세요."
          rows={4}
        ></textarea>
      </div>

      <div class="field-row">
        <div class="field-label">
          스펙 항목
          <span class="field-hint">키-값 형식으로 입력 — JSON으로 저장됩니다</span>
        </div>
        <div class="spec-list">
          {#each specs as spec, i (i)}
            <div class="spec-row">
              <input
                type="text"
                class="f-input spec-key"
                placeholder="항목명 (예: 센서)"
                bind:value={spec.key}
                aria-label={`스펙 항목명 ${i + 1}`}
              />
              <input
                type="text"
                class="f-input spec-val"
                placeholder="값 (예: 풀프레임 CMOS)"
                bind:value={spec.value}
                aria-label={`스펙 값 ${i + 1}`}
              />
              <button
                type="button"
                class="remove-btn"
                onclick={() => removeSpec(i)}
                aria-label="스펙 항목 삭제"
                disabled={specs.length === 1}
              >✕</button>
            </div>
          {/each}
          <button type="button" class="add-btn" onclick={addSpec}>+ 스펙 항목 추가</button>
        </div>
      </div>
    </section>

    <!-- ③ 옵션상품 -->
    <section class="form-section">
      <h2 class="section-title">③ 옵션상품</h2>
      <p class="section-desc">함께 대여 가능한 옵션상품을 상품 DB에서 검색해 추가합니다.</p>

      <!-- 검색 입력폼 -->
      <div class="option-search-row">
        <div class="option-search-field">
          <CmsSimilarNameInput
            id="option-search"
            bind:value={optionKeyword}
            source="product_search"
            activeOnly={true}
            placeholder="상품명 또는 키워드 입력 후 검색..."
            categoryLabels={CATEGORY_LABELS}
            onselect={onOptionSuggestSelect}
          >
            {#snippet field(c)}
              <input
                type="text"
                class="f-input option-search-input"
                id={c.id}
                placeholder={c.placeholder}
                required={c.required}
                value={c.value}
                oninput={c.oninput}
                onkeydown={(e) => {
                  c.onkeydown(e)
                  if (e.key === 'Enter' && !e.defaultPrevented) {
                    e.preventDefault()
                    void searchOptionProducts()
                  }
                }}
                onfocus={c.onfocus}
                onblur={c.onblur}
                aria-label="옵션상품 검색"
                aria-autocomplete={c.ariaAutocomplete}
                aria-expanded={c.ariaExpanded}
                aria-controls={c.ariaControls}
                autocomplete="off"
              />
            {/snippet}
          </CmsSimilarNameInput>
        </div>
        <button type="button" class="btn-search" onclick={searchOptionProducts} disabled={optionSearching}>
          {optionSearching ? '검색 중...' : '검색'}
        </button>
      </div>

      <!-- 검색 결과 모달 -->
      {#if showOptionModal}
        <div
          class="option-modal-backdrop"
          onclick={() => { showOptionModal = false }}
          role="presentation"
        >
          <div
            class="option-modal"
            role="dialog"
            aria-modal="true"
            aria-label="옵션상품 검색 결과"
            onclick={(e) => e.stopPropagation()}
          >
            <div class="option-modal-header">
              <p class="option-modal-title">검색 결과</p>
              <button
                type="button"
                class="option-modal-close"
                onclick={() => { showOptionModal = false }}
                aria-label="닫기"
              >✕</button>
            </div>
            {#if optionSearching}
              <p class="option-modal-empty">검색 중...</p>
            {:else if optionResults.length === 0}
              <p class="option-modal-empty">검색 결과가 없습니다.</p>
            {:else}
              <ul class="option-result-list">
                {#each optionResults as item (item.id)}
                  <li class="option-result-item">
                    {#if item.image_url}
                      <img
                        src={item.image_url}
                        alt={item.name}
                        class="option-result-thumb"
                        width="56"
                        height="42"
                        loading="lazy"
                      />
                    {:else}
                      <div class="option-result-thumb option-result-thumb--empty">No img</div>
                    {/if}
                    <div class="option-result-info">
                      <p class="option-result-name">{item.name}</p>
                      <p class="option-result-meta">
                        24h: {item.price_24h.toLocaleString()}원 · 재고: {item.stock_quantity}개
                      </p>
                      <a
                        href="/products/{item.id}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="btn-detail-link"
                      >상세정보 더보기</a>
                    </div>
                    <button
                      type="button"
                      class="btn-add-option"
                      onclick={() => addOptionProduct(item)}
                    >추가</button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>
      {/if}

      <!-- 선택된 옵션 목록 -->
      {#if selectedOptions.length > 0}
        <!-- 일괄 적용 행 -->
        <div class="bulk-row">
          <span class="bulk-label">일괄 적용</span>
          <label class="cb-label">
            <input type="checkbox" class="cb-input" bind:checked={bulkRequired} />
            필수 선택
          </label>
          <label class="cb-label">
            <input type="checkbox" class="cb-input" bind:checked={bulkMinSelectRequired} />
            최소 1개 선택 필수
          </label>
          <label class="cb-label">
            <input type="checkbox" class="cb-input" bind:checked={bulkDeliveryDisabled} />
            배송 대여 불가
          </label>
          <button type="button" class="btn-bulk-apply" onclick={applyBulk}>적용</button>
        </div>

        <div class="selected-option-list">
          {#each selectedOptions as opt, i (opt.option_product_id)}
            <div class="selected-option-card">
              {#if opt.image_url}
                <img
                  src={opt.image_url}
                  alt={opt.name}
                  class="selected-option-thumb"
                  width="64"
                  height="48"
                  loading="lazy"
                />
              {:else}
                <div class="selected-option-thumb selected-option-thumb--empty">No img</div>
              {/if}
              <div class="selected-option-info">
                <p class="selected-option-name">{opt.name}</p>
                <p class="selected-option-meta">
                  24h: {opt.price_24h.toLocaleString()}원 · 재고: {opt.stock_quantity}개
                </p>
                <div class="selected-option-cbs">
                  <label class="cb-label">
                    <input
                      type="checkbox"
                      class="cb-input"
                      bind:checked={selectedOptions[i].is_required}
                    />
                    필수 선택
                  </label>
                  <label class="cb-label">
                    <input
                      type="checkbox"
                      class="cb-input"
                      bind:checked={selectedOptions[i].min_select_required}
                    />
                    최소 1개 선택 필수
                  </label>
                  <label class="cb-label">
                    <input
                      type="checkbox"
                      class="cb-input"
                      bind:checked={selectedOptions[i].delivery_rental_disabled}
                    />
                    배송 대여 불가
                  </label>
                </div>
              </div>
              <button
                type="button"
                class="remove-btn"
                onclick={() => removeOption(opt.option_product_id)}
                aria-label="{opt.name} 옵션 제거"
              >✕</button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="no-option-msg">추가된 옵션상품이 없습니다.</p>
      {/if}
    </section>

    <!-- ④ 가격 정책 -->
    <section class="form-section">
      <h2 class="section-title">④ 가격 정책</h2>
      <p class="section-desc">24시간 가격은 필수입니다. 미입력 시 해당 유형 가격정책은 생성되지 않습니다.</p>

      <div class="price-grid">
        <div class="field-row">
          <label class="field-label" for="price_12h">12시간 가격 (원)</label>
          <input id="price_12h" name="price_12h" type="number" class="f-input" placeholder="예: 45000" min="0" step="1000" />
        </div>
        <div class="field-row">
          <label class="field-label" for="price_24h">24시간 가격 (원) <span class="required">*</span></label>
          <input id="price_24h" name="price_24h" type="number" class="f-input" placeholder="예: 85000" min="0" step="1000" />
        </div>
        <div class="field-row">
          <label class="field-label" for="price_monthly">월정액 가격 (원)</label>
          <input id="price_monthly" name="price_monthly" type="number" class="f-input" placeholder="예: 1200000" min="0" step="10000" />
        </div>
      </div>

      <div class="price-grid price-grid-3">
        <div class="field-row">
          <label class="field-label" for="deposit_amount">보증금 (원)</label>
          <input id="deposit_amount" name="deposit_amount" type="number" class="f-input" placeholder="예: 500000" min="0" step="10000" />
        </div>
        <div class="field-row">
          <label class="field-label" for="late_fee_per_hour">연체료/시간 (원)</label>
          <input id="late_fee_per_hour" name="late_fee_per_hour" type="number" class="f-input" placeholder="예: 5000" min="0" />
        </div>
        <div class="field-row">
          <label class="field-label" for="damage_fee_percentage">파손 수수료 (%)</label>
          <input id="damage_fee_percentage" name="damage_fee_percentage" type="number" class="f-input" placeholder="예: 20" min="0" max="100" step="1" />
        </div>
      </div>
    </section>

    <!-- ⑤ 이미지 -->
    <section class="form-section">
      <h2 class="section-title">⑤ 이미지</h2>
      <p class="section-desc">파일을 드래그하거나 클릭해 업로드하세요. 첫 번째 이미지가 대표 이미지입니다.</p>

      {#if isUploading}
        <span class="img-status uploading">업로드 중...</span>
      {:else if uploadError}
        <span class="img-status error">{uploadError}</span>
      {/if}

      {#if imageUrls.filter(Boolean).length < 8}
        <div
          class="drop-zone"
          class:drag-over={isDragging}
          class:uploading={isUploading}
          role="button"
          tabindex="0"
          aria-label="이미지 파일을 드래그하거나 클릭하여 업로드"
          ondragenter={handleDragEnter}
          ondragleave={handleDragLeave}
          ondragover={handleDragOver}
          ondrop={handleDrop}
          onclick={triggerFileInput}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') triggerFileInput(e as unknown as MouseEvent) }}
        >
          <input
            bind:this={fileInputEl}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/bmp"
            multiple
            style="display:none"
            onchange={handleFileSelect}
          />
          <p class="dz-text">이미지를 드래그하거나 클릭하여 업로드</p>
          <button
            type="button"
            class="dz-url-btn"
            onclick={toggleUrlInput}
            aria-label="URL로 이미지 추가"
          >+URL</button>
        </div>
      {/if}

      {#if showUrlInput}
        <div class="url-input-row">
          <input
            class="f-input url-field"
            type="text"
            placeholder="Cloudinary Public ID 또는 전체 URL"
            bind:value={urlInputVal}
            onkeydown={(e) => { if (e.key === 'Enter') addByUrl() }}
            autofocus
          />
          <button type="button" class="btn-url-add" onclick={addByUrl} disabled={!urlInputVal.trim()}>추가</button>
          <button type="button" class="btn-icon-close" onclick={(e) => { e.stopPropagation(); showUrlInput = false; urlInputVal = '' }} aria-label="URL 입력 닫기">✕</button>
        </div>
      {/if}

      {#if imageUrls.filter(Boolean).length > 0}
        <div class="img-card-grid">
          {#each imageUrls.filter(Boolean) as url, i}
            <div class="img-card" class:primary={i === 0} role="group" aria-label={`이미지 ${i + 1}${i === 0 ? ' (대표)' : ''}`}>
              <button
                type="button"
                class="img-card-view"
                onclick={() => openLightbox(url)}
                aria-label={`이미지 ${i + 1} 확대 보기`}
              >
                <img src={thumbUrl(url)} alt={`이미지 ${i + 1}`} class="img-card-thumb" loading="lazy" />
                <span class="img-card-overlay">🔍 확대</span>
              </button>
              <button
                type="button"
                class="img-card-remove"
                onclick={() => removeImage(i)}
                aria-label={`이미지 ${i + 1} 제거`}
                title="이미지 제거"
              >✕</button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-hint">이미지를 드래그하거나 URL을 추가하세요.</p>
      {/if}
    </section>

    <!-- ⑥ 재고 안내 -->
    <section class="form-section info-section">
      <h2 class="section-title">⑥ 실물 재고 (Asset) 등록 안내</h2>
      <div class="info-box">
        <p class="info-text">
          상품 등록 후, 실물 재고는 <strong>[재고관리]</strong> 탭에서 시리얼번호 단위로 등록합니다.
        </p>
        <p class="info-text">
          품번 자동 생성 형식: <code class="asset-code-preview">{assetCodePreview}</code>
        </p>
        <p class="info-subtext">
          CS-{category ? CATEGORY_CODES[category] : '???'}-{'{'}YYMM{'}'}-{'{'}SEQ{'}'}  형식으로 생성됩니다.
        </p>
      </div>
    </section>

    <!-- 제출 버튼 -->
    <div class="form-actions">
      <a href="/cms/products" class="cancel-btn">취소</a>
      <button type="submit" class="submit-btn" disabled={isLoading}>
        {isLoading ? '등록 중...' : '상품 등록'}
      </button>
    </div>
  </form>

  {#if lightboxUrl}
    <div class="lightbox-backdrop" onclick={closeLightbox} role="dialog" aria-modal="true" aria-label="이미지 확대">
      <button class="lightbox-close" onclick={closeLightbox} aria-label="닫기">✕</button>
      <img src={lightboxUrl} alt="이미지 확대" class="lightbox-img" />
    </div>
  {/if}
</div>

<style>
  .form-wrap {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 20px;
    overflow-y: auto;
    height: 100%;
  }

  .error-banner {
    padding: 14px 20px;
    background: rgba(255,53,53,0.08);
    border: 1px solid var(--cs-red-badge);
    border-radius: var(--cms-radius-sm);
    color: var(--cs-red-badge);
    font: var(--text-pc-body-14);
  }

  /* 폼 섹션 */
  .product-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .form-section {
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    padding: 28px 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .section-title {
    font: var(--text-pc-title-18);
    color: var(--cs-text);
    margin: 0 0 4px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--cs-lilac);
  }
  .section-desc {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    margin: -8px 0 0;
  }

  /* 필드 */
  .field-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field-row-combo {
    gap: 10px;
  }
  .field-label {
    font: var(--text-pc-body-14);
    color: var(--cs-text-dark);
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .required { color: var(--cs-red-badge); font: var(--text-pc-script-12); }
  .field-hint {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    font-weight: 400;
  }

  .f-input {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--cms-radius-sm);
    padding: 12px 16px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    width: 100%;
    box-sizing: border-box;
  }
  .f-input::placeholder { color: var(--cs-text-placeholder); }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
  .f-select { cursor: pointer; }
  .f-textarea { resize: vertical; min-height: 100px; }

  /* 토글 */
  .toggle-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
  }
  .toggle-btn {
    position: relative;
    width: 48px;
    height: 28px;
    border: none;
    border-radius: 14px;
    background: var(--cs-surface-gray);
    cursor: pointer;
    transition: background 0.2s;
    flex-shrink: 0;
  }
  .toggle-btn.on { background: var(--cs-purple); }
  .toggle-knob {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--cs-white);
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
  .toggle-btn.on .toggle-knob { transform: translateX(20px); }
  .toggle-label {
    font: var(--text-pc-body-14);
    color: var(--cs-text-dark);
  }

  /* 스펙 */
  .spec-list { display: flex; flex-direction: column; gap: 8px; }
  .spec-row { display: flex; gap: 8px; align-items: center; }
  .spec-key { flex: 2; }
  .spec-val { flex: 3; }

  /* 가격 그리드 */
  .price-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .price-grid-3 { grid-template-columns: 1fr 1fr 1fr; }

  /* 이미지 업로드 */
  .img-status {
    display: inline-flex; align-items: center;
    padding: 4px 12px; border-radius: var(--radius-full);
    font: var(--text-pc-script-12); margin-bottom: 4px;
  }
  .img-status.uploading { background: rgba(59,47,138,0.08); color: var(--cs-purple); }
  .img-status.error { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

  .drop-zone {
    display: flex; flex-direction: row; align-items: center; justify-content: center;
    gap: 10px; min-height: 48px;
    border: 2px dashed var(--cs-border); border-radius: var(--cms-radius-md);
    background: var(--cs-surface-gray);
    cursor: pointer; padding: 10px 20px;
    transition: border-color 0.15s, background 0.15s; user-select: none;
  }
  .drop-zone:hover, .drop-zone:focus-visible {
    border-color: var(--cs-purple); background: rgba(59,47,138,0.04); outline: none;
  }
  .drop-zone.drag-over { border-color: var(--cs-purple); background: rgba(59,47,138,0.08); transform: scale(1.01); }
  .drop-zone.uploading { pointer-events: none; opacity: 0.6; }
  .dz-text { font: var(--text-pc-body-14); color: var(--cs-text-mid); margin: 0; }
  .dz-url-btn {
    background: transparent; border: 1px solid var(--cs-border); border-radius: var(--radius-full);
    color: var(--cs-text-mid); font: var(--text-pc-script-12); padding: 4px 14px;
    cursor: pointer; min-height: 28px; transition: border-color 0.12s, color 0.12s;
  }
  .dz-url-btn:hover { border-color: var(--cs-purple); color: var(--cs-purple); }

  .url-input-row { display: flex; align-items: center; gap: 8px; }
  .url-field { flex: 1; }
  .btn-url-add {
    padding: 8px 16px; background: var(--cs-purple); color: var(--cs-white);
    border: none; border-radius: var(--radius-sm); font: var(--text-pc-script-12);
    cursor: pointer; min-height: 36px; white-space: nowrap; transition: background 0.12s;
  }
  .btn-url-add:hover { background: var(--cs-purple-hover); }
  .btn-url-add:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
  .btn-icon-close {
    width: 32px; height: 32px; border: none; background: transparent; color: var(--cs-text-light);
    border-radius: var(--radius-sm); cursor: pointer; min-height: 32px;
    transition: background 0.12s, color 0.12s;
  }
  .btn-icon-close:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

  .img-card-grid { display: flex; flex-wrap: wrap; gap: 10px; }
  .img-card { position: relative; width: 120px; height: 90px; border-radius: var(--radius-sm); }
  .img-card-view {
    display: block; width: 100%; height: 100%;
    border: none; background: transparent; padding: 0;
    cursor: pointer; border-radius: var(--radius-sm); overflow: hidden; position: relative;
  }
  .img-card-thumb { width: 100%; height: 100%; object-fit: cover; display: block; transition: opacity 0.15s; }
  .img-card-overlay {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.35); color: white; font-size: 18px;
    opacity: 0; transition: opacity 0.15s; border-radius: var(--radius-sm);
  }
  .img-card-view:hover .img-card-overlay { opacity: 1; }
  .img-card-view:hover .img-card-thumb { opacity: 0.85; }
  .img-card-remove {
    position: absolute; top: -8px; right: -8px;
    width: 24px; height: 24px; border-radius: 50%;
    border: none; background: var(--cs-surface-gray); color: var(--cs-text-mid);
    font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: opacity 0.15s, background 0.12s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
  .img-card:hover .img-card-remove { opacity: 1; }
  .img-card-remove:hover { background: var(--cs-red-badge); color: var(--cs-white); }
  .img-card.primary { outline: 3px solid var(--cs-purple); outline-offset: -1px; }
  .empty-hint { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0; }

  .lightbox-backdrop {
    position: fixed; inset: 0; z-index: 500;
    background: rgba(16,11,50,0.85);
    display: flex; align-items: center; justify-content: center;
  }
  .lightbox-img { max-width: 90vw; max-height: 85vh; object-fit: contain; border-radius: var(--radius-sm); }
  .lightbox-close {
    position: absolute; top: 20px; right: 24px;
    background: rgba(255,255,255,0.15); border: none; color: white;
    width: 40px; height: 40px; border-radius: 50%;
    font-size: 20px; cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: background 0.12s;
  }
  .lightbox-close:hover { background: rgba(255,255,255,0.3); }

  /* 공통 버튼 (스펙 행 삭제 / 스펙 항목 추가) */
  .remove-btn {
    flex-shrink: 0;
    width: 36px; height: 36px;
    border: none; border-radius: var(--radius-sm);
    background: var(--cs-surface-gray); color: var(--cs-text-mid);
    cursor: pointer; font: var(--text-pc-script-12);
    transition: background 0.12s, color 0.12s;
  }
  .remove-btn:hover:not(:disabled) { background: rgba(255,53,53,0.1); color: var(--cs-red-badge); }
  .remove-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .add-btn {
    align-self: flex-start;
    padding: 8px 16px;
    border: 1.5px dashed rgba(59,47,138,0.25);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--cs-purple);
    font: var(--text-pc-body-14);
    cursor: pointer;
    min-height: 44px;
    transition: background 0.12s, border-color 0.12s;
  }
  .add-btn:hover { background: var(--cs-lilac); border-color: var(--cs-purple); }

  /* 안내 섹션 */
  .info-section { background: var(--cs-lilac); }
  .info-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px 20px;
    background: white;
    border-radius: var(--cms-radius-sm);
    border-left: 3px solid var(--cs-purple);
  }
  .info-text {
    font: var(--text-pc-body-14);
    color: var(--cs-text-dark);
    margin: 0;
  }
  .info-subtext {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    margin: 0;
  }
  .asset-code-preview {
    display: inline-block;
    padding: 2px 8px;
    background: var(--cs-dark);
    color: var(--cs-orange);
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    letter-spacing: 0.5px;
  }

  /* 폼 액션 버튼 */
  .form-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    padding: 8px 0 20px;
  }
  .cancel-btn {
    display: inline-flex;
    align-items: center;
    height: 50px;
    padding: 0 28px;
    border-radius: var(--radius-xl);
    background: var(--cs-surface-gray);
    color: var(--cs-text-dark);
    text-decoration: none;
    font: var(--text-pc-body-14);
    transition: background 0.12s;
  }
  .cancel-btn:hover { background: var(--cs-purple-op10); }
  .submit-btn {
    height: 50px;
    padding: 0 36px;
    border: none;
    border-radius: var(--radius-xl);
    background: var(--cs-purple);
    color: var(--cs-white);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.12s;
  }
  .submit-btn:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .submit-btn:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  /* ─── 옵션상품 섹션 ──────────────────────────────────────── */
  .option-search-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .option-search-field {
    flex: 1;
    min-width: 0;
  }
  .option-search-input { width: 100%; }
  .btn-search {
    flex-shrink: 0;
    height: 44px;
    padding: 0 20px;
    border: 1.5px solid var(--cs-purple);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-purple);
    font: var(--text-pc-body-14);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s;
  }
  .btn-search:hover:not(:disabled) { background: rgba(59,47,138,0.06); }
  .btn-search:disabled { opacity: 0.5; cursor: not-allowed; }

  /* 모달 */
  .option-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(16,11,50,0.45);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .option-modal {
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    padding: 24px 28px;
    width: 560px;
    max-width: calc(100vw - 40px);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .option-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .option-modal-title {
    font: var(--text-pc-title-16);
    color: var(--cs-text);
    margin: 0;
  }
  .option-modal-close {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    cursor: pointer;
    font: var(--text-pc-script-12);
    transition: background 0.12s;
  }
  .option-modal-close:hover { background: rgba(255,53,53,0.1); color: var(--cs-red-badge); }
  .option-modal-empty {
    font: var(--text-pc-body-14);
    color: var(--cs-text-light);
    margin: 0;
    padding: 20px 0;
    text-align: center;
  }
  .option-result-list {
    list-style: none;
    padding: 0;
    margin: 0;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .option-result-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray);
  }
  .option-result-thumb {
    width: 56px;
    height: 42px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }
  .option-result-thumb--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cs-lilac);
    font: var(--text-pc-descript-10);
    color: var(--cs-text-light);
  }
  .option-result-info { flex: 1; min-width: 0; }
  .option-result-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    margin: 0 0 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .option-result-meta {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0 0 2px;
  }
  .btn-detail-link {
    display: inline-flex;
    align-items: center;
    font: var(--text-pc-script-12);
    color: var(--cs-purple);
    text-decoration: none;
  }
  .btn-detail-link:hover { color: var(--cs-purple-hover); text-decoration: underline; }
  .btn-add-option {
    flex-shrink: 0;
    height: 36px;
    padding: 0 14px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--cs-purple);
    color: var(--cs-white);
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-add-option:hover { background: var(--cs-purple-hover); }

  /* 일괄 적용 행 */
  .bulk-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 14px;
    background: rgba(59,47,138,0.04);
    border-radius: var(--cms-radius-sm);
  }
  .bulk-label {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    white-space: nowrap;
  }
  .cb-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    cursor: pointer;
    min-height: 44px;
  }
  .cb-input {
    accent-color: var(--cs-purple);
    width: 16px;
    height: 16px;
    cursor: pointer;
  }
  .btn-bulk-apply {
    margin-left: auto;
    height: 36px;
    padding: 0 16px;
    border: 1.5px solid var(--cs-purple);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-purple);
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-bulk-apply:hover { background: rgba(59,47,138,0.08); }

  /* 선택된 옵션 카드 */
  .selected-option-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .selected-option-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: var(--cs-white);
    border: 1px solid var(--cs-border);
    border-radius: var(--cms-radius-md);
  }
  .selected-option-thumb {
    width: 64px;
    height: 48px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }
  .selected-option-thumb--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cs-surface-gray);
    font: var(--text-pc-descript-10);
    color: var(--cs-text-light);
  }
  .selected-option-info { flex: 1; min-width: 0; }
  .selected-option-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    margin: 0 0 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .selected-option-meta {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0 0 6px;
  }
  .selected-option-cbs {
    display: flex;
    gap: 14px;
  }
  .no-option-msg {
    font: var(--text-pc-body-14);
    color: var(--cs-text-light);
    margin: 0;
    padding: 16px 0;
  }

  @media (max-width: 640px) {
    .form-section { padding: 20px 16px; }
    .price-grid { grid-template-columns: 1fr; }
    .price-grid-3 { grid-template-columns: 1fr; }
    .bulk-row { flex-wrap: wrap; }
  }

  /* ── 카테고리 콤보 선택 ─────────────────────────────────────────── */
  .combo-rows {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }
  .combo-row-btn {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 8px 14px;
    border: 1.5px solid #ECEBF4;
    border-radius: var(--radius-sm);
    background: var(--cs-white);
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s;
    min-height: 44px;
  }
  .combo-row-btn:hover { border-color: rgba(59,47,138,0.35); background: rgba(59,47,138,0.04); }
  .combo-row-selected { border-color: var(--cs-purple) !important; background: var(--cs-purple-op10) !important; }

  .combo-name-label {
    font: var(--text-pc-descript-10);
    color: var(--cs-text-light);
    line-height: 1.2;
    align-self: flex-start;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .combo-row-chips {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 6px;
  }

  .combo-prefix-chip {
    padding: 2px 7px;
    background: var(--cs-dark);
    color: var(--cs-white);
    border-radius: 4px;
    font: var(--text-pc-body-14);
    font-weight: 700;
    letter-spacing: 0.04em;
    font-family: 'Courier New', monospace;
  }
  .combo-row-selected .combo-prefix-chip {
    background: var(--cs-purple-dark);
  }
  .combo-chips { display: flex; align-items: center; gap: 4px; }
  .combo-chip {
    padding: 2px 7px;
    background: var(--cs-lilac);
    color: var(--cs-purple-dark);
    border-radius: 4px;
    font: var(--text-pc-body-14);
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .combo-row-selected .combo-chip {
    background: var(--cs-purple);
    color: var(--cs-white);
  }
  .combo-sep { color: var(--cs-text-light); font-size: 11px; }
  .combo-meta-chip {
    padding: 2px 7px;
    border-radius: 4px;
    font: var(--text-pc-script-12);
    font-weight: 600;
    font-family: 'Courier New', monospace;
    letter-spacing: 0.02em;
  }
  .combo-ym-chip {
    color: var(--cs-text-dark);
    background: var(--cs-surface-gray);
  }
  .combo-seq-chip {
    color: var(--cs-purple-dark);
    background: rgba(59, 47, 138, 0.08);
  }
  .combo-row-selected .combo-ym-chip {
    color: var(--cs-purple-dark);
    background: rgba(59, 47, 138, 0.12);
  }
  .combo-row-selected .combo-seq-chip {
    color: var(--cs-white);
    background: var(--cs-purple);
  }
  .combo-empty { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 4px 0 0; }
</style>
