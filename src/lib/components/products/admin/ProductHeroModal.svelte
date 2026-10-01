<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'
  import { validateUploadFile, validateUploadFileSize, getMimeExtension } from '$lib/utils/fileValidation'

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

  // 카테고리 선택 시 헤더 슬라이드 대신 노출되는 배너(가로 100% × 세로 150px) — 카테고리별 1개
  interface CategoryBanner {
    category_id: string
    image_url: string | null
    /** 모바일 전용 배너 이미지(가로 100% × 세로 200px) — 없으면 PC 이미지로 대체 노출 */
    mobile_image_url?: string | null
    link_url: string | null
    alt: string
    enabled: boolean
  }
  interface BannerRow extends CategoryBanner {
    _preview: string | null
    _file: File | null
    _mPreview: string | null
    _mFile: File | null
  }

  // 모바일 목록 중간 배너(촬영본능 PICK! 카드) — 이미지·문구·링크·노출 관리
  interface MidBanner {
    enabled: boolean
    image_url: string | null
    title: string
    sub: string
    link_url: string | null
  }

  interface Props {
    settingKey?: string
    initialSettings: HeroSettings
    /** 배너 설정 대상 카테고리(헤더 슬라이드 설정 모달에서만 사용) */
    categories?: { id: string; name: string }[]
    initialBanners?: { items: CategoryBanner[]; mid_banner?: MidBanner | null }
    onclose: () => void
  }

  let {
    settingKey = 'product_page_hero',
    initialSettings,
    categories = [],
    initialBanners = { items: [] },
    onclose,
  }: Props = $props()

  const BANNER_KEY = 'product_page_category_banners'
  const isHero = settingKey === 'product_page_hero'
  let selectedOpen = $state(true)
  // 카테고리 배너 행 아코디언 — 기본 닫힘(행이 길어 목록 파악이 어려움), 펼친 행의 category_id 목록
  let openBanners = $state<string[]>([])
  function toggleBanner(id: string): void {
    openBanners = openBanners.includes(id) ? openBanners.filter((x) => x !== id) : [...openBanners, id]
  }
  const showBanners = $derived(isHero && categories.length > 0)

  // 모바일 목록 중간 배너 — 저장값이 없으면 기존 하드코딩 값(촬영본능 / PICK! / ellipse.png)을 기본으로 사용
  const MID_DEFAULT_IMAGE = '/images/products/ellipse.png'
  const midInit = initialBanners.mid_banner
  let midEnabled = $state<boolean>(midInit?.enabled ?? true)
  let midImageUrl = $state<string | null>(midInit?.image_url ?? null)
  let midTitle = $state<string>(midInit?.title ?? '촬영본능')
  let midSub = $state<string>(midInit?.sub ?? 'PICK!')
  let midLink = $state<string>(midInit?.link_url ?? '')
  let midFile = $state<File | null>(null)
  let midPreview = $state<string | null>(null)

  function onMidFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const v = validateUploadFile(file)
    if (!v.ok || !file.type.startsWith('image/')) { error = 'PNG, JPEG, WebP, HEIF 이미지 파일만 업로드할 수 있어요.'; return }
    const sz = validateUploadFileSize(file)
    if (!sz.ok) { error = sz.error ?? null; return }
    error = null
    if (midPreview) URL.revokeObjectURL(midPreview)
    midFile = file
    midPreview = URL.createObjectURL(file)
  }

  async function uploadMidImage(): Promise<string | null> {
    if (!midFile) return midImageUrl
    const ext  = getMimeExtension(midFile.type)
    const path = `product-mid-banner/mid-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('cms-assets')
      .upload(path, midFile, { upsert: true, contentType: midFile.type })
    if (upErr) throw new Error(`목록 중간 배너 이미지 업로드 실패: ${upErr.message}`)
    return supabase.storage.from('cms-assets').getPublicUrl(path).data.publicUrl
  }

  let bannerRows = $state<BannerRow[]>(
    categories.map((c) => {
      const saved = initialBanners.items?.find((b) => b.category_id === c.id)
      return {
        category_id: c.id,
        image_url:   saved?.image_url ?? null,
        mobile_image_url: saved?.mobile_image_url ?? null,
        link_url:    saved?.link_url ?? null,
        alt:         saved?.alt ?? '',
        enabled:     saved?.enabled ?? false,
        _preview:    null,
        _file:       null,
        _mPreview:   null,
        _mFile:      null,
      }
    })
  )
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? id

  function onBannerFile(id: string, e: Event, variant: 'pc' | 'mobile' = 'pc') {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const v = validateUploadFile(file)
    if (!v.ok || !file.type.startsWith('image/')) { error = 'PNG, JPEG, WebP, HEIF 이미지 파일만 업로드할 수 있어요.'; return }
    const sz = validateUploadFileSize(file)
    if (!sz.ok) { error = sz.error ?? null; return }
    error = null
    bannerRows = bannerRows.map((r) => {
      if (r.category_id !== id) return r
      if (variant === 'mobile') {
        if (r._mPreview) URL.revokeObjectURL(r._mPreview)
        return { ...r, _mFile: file, _mPreview: URL.createObjectURL(file), enabled: true }
      }
      if (r._preview) URL.revokeObjectURL(r._preview)
      return { ...r, _file: file, _preview: URL.createObjectURL(file), enabled: true }
    })
  }

  function patchBanner(id: string, patch: Partial<BannerRow>) {
    bannerRows = bannerRows.map((r) => (r.category_id === id ? { ...r, ...patch } : r))
  }

  // 링크는 사이트 내 경로(/…) 또는 http(s)://만 허용(javascript: 등 차단). 비우면 링크 없음
  function normalizeLink(raw: string | null | undefined, label: string): string | null {
    const t = (raw ?? '').trim()
    if (!t) return null
    // 백슬래시·공백·제어문자는 브라우저가 "/"로 해석하거나 제거해 //외부도메인 으로 바뀔 수 있어 거부
    if (!/[\x00-\x20\\]/.test(t) && (/^\/(?![/\\])/.test(t) || /^https?:\/\//i.test(t))) return t
    throw new Error(`[${label}] 링크는 "/"로 시작하는 사이트 내 경로 또는 http(s)://로 시작하는 주소만 입력할 수 있어요.`)
  }

  async function uploadBanner(r: BannerRow, variant: 'pc' | 'mobile' = 'pc'): Promise<string | null> {
    const file = variant === 'mobile' ? r._mFile : r._file
    if (!file) return variant === 'mobile' ? (r.mobile_image_url ?? null) : r.image_url
    const ext  = getMimeExtension(file.type)
    const path = `product-category-banner/${r.category_id}${variant === 'mobile' ? '-m' : ''}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('cms-assets')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (upErr) throw new Error(`[${catName(r.category_id)}] 배너 이미지 업로드 실패: ${upErr.message}`)
    return supabase.storage.from('cms-assets').getPublicUrl(path).data.publicUrl
  }

  let mode = $state<'random' | 'fixed'>(initialSettings.mode)
  let selected = $state<ProductItem[]>([])
  let searchResults = $state<ProductItem[]>([])
  let isSearching = $state(false)
  let isLoadingInitial = $state(false)
  let isSaving = $state(false)
  let error = $state<string | null>(null)
  let debounceTimer = $state<ReturnType<typeof setTimeout> | null>(null)
  let pickerSelectedId = $state<string | null>(null)
  // I-3: 마지막 실제 검색어 추적
  let lastSearchQuery = $state('')

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
    if (product) {
      addProduct(product)
      // I-3: 실제 검색 후 선택한 경우에만 학습 신호 전송 (fire-and-forget)
      if (lastSearchQuery) {
        fetch('/api/cms/products/search-suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_id: product.id, search_term: lastSearchQuery, context: 'product_hero' }),
        }).catch(() => {})
      }
    }
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

  // H-6: search_products RPC + get_products_by_ids 이중 호출 → activeOnly=true 단일 서버라우트로 전환
  // nlsearch.md §2 "브라우저 직접 RPC 호출 금지" 준수
  // activeOnly=true 파라미터가 is_active 필터를 서버에서 직접 적용 — get_products_by_ids 크로스체크 불필요
  async function doSearch(q: string) {
    isSearching = true
    lastSearchQuery = q
    try {
      const res = await fetch(
        `/api/cms/products/search-suggestions?q=${encodeURIComponent(q)}&limit=10&activeOnly=true`,
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
    // 링크 형식은 어떤 저장보다 먼저 검증 — 잘못된 링크로 헤더 설정만 먼저 저장되는 일 방지
    if (isHero) {
      try {
        for (const r of bannerRows) normalizeLink(r.link_url, catName(r.category_id))
        normalizeLink(midLink, '목록 중간 배너')
      } catch (e) {
        error = e instanceof Error ? e.message : '링크 형식이 올바르지 않습니다.'
        isSaving = false
        return
      }
    }
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
      isSaving = false
      return
    }
    if (isHero) {
      try {
        const items: CategoryBanner[] = []
        for (const r of bannerRows) {
          const image_url = await uploadBanner(r, 'pc')
          const mobile_image_url = await uploadBanner(r, 'mobile')
          if (!image_url && !mobile_image_url && !r.link_url && !r.alt) continue
          items.push({
            category_id: r.category_id,
            image_url,
            mobile_image_url,
            link_url: normalizeLink(r.link_url, catName(r.category_id)),
            alt: r.alt.trim(),
            enabled: r.enabled && (!!image_url || !!mobile_image_url),
          })
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: bErr } = await (supabase.rpc as any)('upsert_product_page_setting', {
          p_key: BANNER_KEY,
          p_value: {
            items,
            mid_banner: {
              enabled: midEnabled,
              image_url: await uploadMidImage(),
              title: midTitle.trim(),
              sub: midSub.trim(),
              link_url: normalizeLink(midLink, '목록 중간 배너'),
            } satisfies MidBanner,
          },
        })
        if (bErr) throw new Error((bErr as { message: string }).message)
      } catch (e) {
        error = e instanceof Error ? e.message : '배너 저장에 실패했습니다.'
        isSaving = false
        return
      }
    }
    await invalidateAll()
    onclose()
    isSaving = false
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onclose} role="presentation"></div>

<aside class="modal-panel" role="dialog" aria-modal="true" aria-label="헤더 상품 설정">
  <div class="modal-header">
    <span class="modal-title">
      {settingKey === 'product_page_md_picks' ? 'MD 추천 픽 설정' : '공통 상품 슬라이드 설정'}
    </span>
    <button class="modal-close" onclick={onclose} aria-label="닫기">✕</button>
  </div>

  <div class="modal-body">
    <!-- 노출 방식 + 상품 추가 + 선택된 상품 — 카드 스타일 없이 div로만 그룹핑 -->
    <div class="group-wrap">
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

    <!-- 상품 추가 + 선택된 상품 — 카드형 그룹 -->
    <div class="group-products">
    <div class="section">
      <p class="section-label">상품 추가 <span class="count-badge">{selected.length}/{MAX_ITEMS}</span></p>
      <div class="search-wrap">
        <SuggestPicker
          id="product-search"
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
              disabled={selected.length >= MAX_ITEMS}
            />
          {/snippet}
          {#snippet renderItem(item, _i, _sel)}
            <span class="suggest-name">{item.label}</span>
            <span class="suggest-price">{item.meta?.[0] ?? ''}</span>
          {/snippet}
        </SuggestPicker>
        {#if isLoadingInitial || isSearching}
          <p class="search-hint">{isLoadingInitial ? '저장된 상품 불러오는 중…' : '검색 중…'}</p>
        {/if}
      </div>
    </div>

    <!-- 선택된 상품 목록 (드래그 순서) -->
    {#if selected.length > 0}
      <div class="section">
        <!-- 아코디언 — 화살표는 공통 ChevronIcon(방향: 열림=up / 닫힘=down) -->
        <button
          type="button"
          class="acc-head"
          aria-expanded={selectedOpen}
          aria-controls="selected-products-panel"
          onclick={() => (selectedOpen = !selectedOpen)}
        >
          <span class="section-label">선택된 상품 <span class="acc-hint">드래그로 순서 변경</span></span>
          <ChevronIcon direction={selectedOpen ? 'up' : 'down'} />
        </button>
        {#if selectedOpen}
          <div id="selected-products-panel">
            <CmsDragList bind:items={selected} itemKey={(item) => item.id}>
              {#snippet renderItem(item)}
                <div class="selected-row">
                  <span class="selected-name">{item.name}</span>
                  <button class="remove-btn" onclick={() => removeProduct(item.id)} aria-label="{item.name} 제거">✕</button>
                </div>
              {/snippet}
            </CmsDragList>
          </div>
        {/if}
      </div>
    {:else}
      <p class="empty-msg">위 검색창에서 상품을 추가하세요.</p>
    {/if}
    </div>
    </div>

    <!-- 카테고리 선택 시 노출 배너 — 카테고리별 1개, 가로 100% × 세로 150px -->
    {#if showBanners}
      <div class="section banner-section">
        <p class="section-label">카테고리 배너 <span class="count-badge">가로 100% × 세로 150px</span></p>
        <p class="banner-help">카테고리 메뉴를 선택하면 헤더 슬라이드 대신 해당 카테고리의 배너가 노출됩니다. 권장 이미지 크기 1240×150px(가로 세로 약 8:1).</p>
        {#each bannerRows as row (row.category_id)}
          <div class="banner-row">
            <div class="banner-row-head">
              <!-- front-uiux.md §17 체크아이콘 버튼 표준 — 좌측 배치, ON=--cs-purple / OFF=--cs-purple-op10 -->
              <button
                type="button"
                class="checkbox-btn checkbox-btn-terms"
                class:checked={row.enabled}
                disabled={!row.image_url && !row._preview && !row.mobile_image_url && !row._mPreview}
                aria-pressed={row.enabled}
                aria-label="{catName(row.category_id)} 배너 노출"
                onclick={() => patchBanner(row.category_id, { enabled: !row.enabled })}
              >
                <svg width="18" height="12" viewBox="0 0 18 12" fill="none" aria-hidden="true">
                  <path d="M14.788 0.40847C15.5937 -0.206503 16.7506 -0.123176 17.4589 0.632103C18.2144 1.4379 18.1729 2.70376 17.3671 3.45925L17.3622 3.46413C17.3585 3.46759 17.3528 3.47297 17.3456 3.47976C17.3311 3.49333 17.3101 3.51407 17.2821 3.54031C17.2261 3.59279 17.1437 3.66974 17.039 3.76784C16.8294 3.96413 16.5289 4.24474 16.1669 4.58327C15.4428 5.26035 14.4707 6.169 13.4774 7.09304C12.4848 8.01654 11.4689 8.95836 10.6591 9.70144C9.90326 10.3949 9.21125 11.0229 8.954 11.219C8.38484 11.6526 7.64783 12.0001 6.7831 12.0003C5.89707 12.0003 5.14509 11.6357 4.57217 11.138C4.258 10.865 3.25694 9.9462 2.37197 9.13015C1.92122 8.71451 1.48885 8.31388 1.16885 8.01785C1.0088 7.86979 0.875998 7.74749 0.78408 7.66238C0.738281 7.61997 0.702073 7.58638 0.677634 7.56374C0.665704 7.55269 0.656551 7.54415 0.650291 7.53835C0.647126 7.53542 0.644094 7.53301 0.642478 7.53152L0.641502 7.52956H0.640525C-0.169647 6.77877 -0.217693 5.51259 0.533103 4.70242C1.28393 3.89251 2.55017 3.84526 3.36025 4.59597L3.36123 4.59792C3.3628 4.59938 3.36592 4.60089 3.36904 4.60378C3.37524 4.60953 3.38439 4.61807 3.39638 4.62917C3.42067 4.65167 3.45618 4.68551 3.50185 4.72781C3.59333 4.81251 3.72524 4.93384 3.88467 5.08132C4.2037 5.37646 4.63512 5.77493 5.08388 6.18874C5.73477 6.78894 6.40077 7.39812 6.82217 7.78054C6.86093 7.74604 6.90358 7.70918 6.94814 7.66921C7.21008 7.43424 7.55408 7.12113 7.954 6.75417C8.7536 6.02049 9.76226 5.0859 10.7528 4.16433C11.7428 3.24336 12.7128 2.33711 13.4354 1.6614C13.7965 1.32374 14.0957 1.04357 14.3046 0.847923C14.409 0.750147 14.491 0.67359 14.5468 0.621361C14.5745 0.595342 14.5959 0.575239 14.6103 0.56179C14.6174 0.555065 14.6232 0.549566 14.6269 0.546165L14.6317 0.541282L14.788 0.40847Z" fill="currentColor" />
                </svg>
              </button>
              <button
                type="button"
                class="acc-head acc-head--row"
                aria-expanded={openBanners.includes(row.category_id)}
                onclick={() => toggleBanner(row.category_id)}
              >
                <span class="banner-cat">{catName(row.category_id)}</span>
                <ChevronIcon direction={openBanners.includes(row.category_id) ? 'up' : 'down'} />
              </button>
            </div>
            {#if openBanners.includes(row.category_id)}
            <p class="banner-sub">PC 이미지 (1240×150px)</p>
            <div class="banner-thumb" class:banner-thumb-empty={!(row._preview ?? row.image_url)}>
              {#if row._preview ?? row.image_url}
                <img src={row._preview ?? row.image_url} alt="{catName(row.category_id)} 배너 미리보기" />
              {:else}
                <span>이미지 없음</span>
              {/if}
            </div>
            <div class="banner-actions">
              <label class="banner-file-btn">
                이미지 선택
                <input type="file" accept="image/png,image/jpeg,image/webp,image/heif,image/heic" onchange={(e) => onBannerFile(row.category_id, e)} hidden />
              </label>
              {#if row.image_url || row._preview}
                <button type="button" class="remove-btn" aria-label="{catName(row.category_id)} 배너 이미지 제거"
                  onclick={() => patchBanner(row.category_id, { image_url: null, _file: null, _preview: null, enabled: !!(row.mobile_image_url || row._mPreview) && row.enabled })}>✕</button>
              {/if}
            </div>
            <p class="banner-sub">모바일 이미지 (가로 100% × 세로 200px, 권장 680×400px)</p>
            <div class="banner-thumb banner-thumb-m" class:banner-thumb-empty={!(row._mPreview ?? row.mobile_image_url)}>
              {#if row._mPreview ?? row.mobile_image_url}
                <img src={row._mPreview ?? row.mobile_image_url} alt="{catName(row.category_id)} 모바일 배너 미리보기" />
              {:else}
                <span>이미지 없음 (PC 이미지로 대체 노출)</span>
              {/if}
            </div>
            <div class="banner-actions">
              <label class="banner-file-btn">
                모바일 이미지 선택
                <input type="file" accept="image/png,image/jpeg,image/webp,image/heif,image/heic" onchange={(e) => onBannerFile(row.category_id, e, 'mobile')} hidden />
              </label>
              {#if row.mobile_image_url || row._mPreview}
                <button type="button" class="remove-btn" aria-label="{catName(row.category_id)} 모바일 배너 이미지 제거"
                  onclick={() => patchBanner(row.category_id, { mobile_image_url: null, _mFile: null, _mPreview: null })}>✕</button>
              {/if}
            </div>
            <input type="text" class="f-input" placeholder="연결 링크 (예: /products/abc 또는 https://…)" maxlength="500"
              value={row.link_url ?? ''} oninput={(e) => patchBanner(row.category_id, { link_url: e.currentTarget.value })} />
            <input type="text" class="f-input" placeholder="대체 텍스트 (접근성)" maxlength="100"
              value={row.alt} oninput={(e) => patchBanner(row.category_id, { alt: e.currentTarget.value })} />
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- 모바일 목록 중간 배너(촬영본능 PICK! 카드) 관리 -->
    {#if isHero}
      <div class="section banner-section">
        <p class="section-label">모바일 목록 중간 배너 <span class="count-badge">모바일 전용</span></p>
        <p class="banner-help">모바일 상품 목록 중간의 "촬영본능 PICK!" 카드입니다. 이미지·문구·링크를 바꾸거나 노출을 끌 수 있습니다.</p>
        <div class="banner-row">
          <div class="banner-row-head">
            <span class="banner-cat">목록 중간 배너</span>
            <label class="radio-opt">
              <input type="checkbox" checked={midEnabled} onchange={(e) => (midEnabled = e.currentTarget.checked)} />
              <span>노출</span>
            </label>
          </div>
          <div class="banner-thumb banner-thumb-mid">
            <img src={midPreview ?? midImageUrl ?? MID_DEFAULT_IMAGE} alt="목록 중간 배너 이미지 미리보기" />
          </div>
          <div class="banner-actions">
            <label class="banner-file-btn">
              이미지 선택
              <input type="file" accept="image/png,image/jpeg,image/webp,image/heif,image/heic" onchange={onMidFile} hidden />
            </label>
            {#if midImageUrl || midPreview}
              <button type="button" class="remove-btn" aria-label="목록 중간 배너 이미지 제거(기본 이미지로 복원)"
                onclick={() => { if (midPreview) URL.revokeObjectURL(midPreview); midPreview = null; midFile = null; midImageUrl = null }}>✕</button>
            {/if}
          </div>
          <input type="text" class="f-input" placeholder="타이틀 (예: 촬영본능)" maxlength="20" bind:value={midTitle} />
          <input type="text" class="f-input" placeholder="서브 텍스트 (예: PICK!)" maxlength="20" bind:value={midSub} />
          <input type="text" class="f-input" placeholder="연결 링크 (예: /hype-pack 또는 https://…, 비우면 링크 없음)" maxlength="500" bind:value={midLink} />
        </div>
      </div>
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

  .acc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-height: 44px;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .acc-head--row { width: auto; flex: 1; gap: 8px; justify-content: space-between; } /* 카테고리명 좌 · 화살표 우측 끝 */
  .acc-hint { font-size: 11px; color: var(--cs-text-light); }

  /* front 관리모달 섹션 라벨 표준(front-uiux.md §9-2-A ③) */
  .section-label {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
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

  /* front 관리모달 푸터 표준(front-uiux.md §9-2-A ④) */
  .modal-footer {
    flex-shrink: 0;
    padding: 16px 24px;
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    border-top: 1px solid var(--cs-lilac);
  }

  .btn-cancel {
    height: 36px;
    padding: 0 20px;
    background: none;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--radius-md);
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    cursor: pointer;
  }
  .btn-cancel:hover:not(:disabled) { border-color: var(--cs-text-mid); }
  .btn-cancel:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-save {
    height: 36px;
    padding: 0 24px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-md);
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-save:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }

  .banner-help { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0; }
  .group-wrap { display: flex; flex-direction: column; gap: 16px; }
  /* 그룹(노출방식·상품)과 카테고리 배너 사이 여백 +100% (기본 body gap 20px → 40px) */
  .group-wrap + .banner-section { margin-top: 20px; }
  /* 카테고리 배너 ↔ 모바일 목록 중간 배너 사이 여백 +100% (20px → 40px) */
  .banner-section + .banner-section { margin-top: 20px; }
  /* 카드형 — 카테고리 배너 행(.banner-row)과 동일한 연보라 카드 */
  .group-products {
    display: flex; flex-direction: column; gap: 16px;
    background: var(--cs-lilac); border-radius: var(--radius-md); padding: 12px 20px;
  }
  .banner-row {
    display: flex; flex-direction: column; gap: 8px;
    background: var(--cs-lilac); border-radius: var(--radius-md); padding: 12px 20px;
  }
  .banner-row-head { display: flex; align-items: center; gap: 12px; }
  .checkbox-btn { background: none; border: none; padding: 0; cursor: pointer; flex-shrink: 0; display: flex; align-items: center; }
  .checkbox-btn:disabled { cursor: not-allowed; opacity: 0.5; }
  .checkbox-btn-terms { color: var(--cs-purple-op10); }
  .checkbox-btn-terms.checked { color: var(--cs-purple); }
  .checkbox-btn-terms svg { width: 22px; height: 15px; }
  @media (min-width: 768px) { .checkbox-btn-terms svg { width: 18px; height: 12px; } }
  .banner-cat { font: var(--text-pc-title-16); color: var(--cs-text); }
  .banner-thumb {
    width: 100%; aspect-ratio: 1240 / 150; border-radius: var(--radius-sm); overflow: hidden;
    background: var(--cs-white); display: flex; align-items: center; justify-content: center;
  }
  .banner-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .banner-thumb-empty span { font: var(--text-pc-script-12); color: var(--cs-text-light); }
  .banner-sub { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 4px 0 0; }
  .banner-thumb-mid { aspect-ratio: 1 / 1; max-width: 120px; border-radius: 50%; }
  .banner-thumb-m { aspect-ratio: 680 / 400; max-width: 260px; }
  .banner-actions { display: flex; align-items: center; gap: 8px; }
  .banner-file-btn {
    display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 0 14px;
    background: var(--cs-purple); color: var(--cs-white); border-radius: var(--radius-md);
    font: var(--text-pc-body-14); cursor: pointer;
  }
  .banner-file-btn:hover { background: var(--cs-purple-hover); }
</style>
