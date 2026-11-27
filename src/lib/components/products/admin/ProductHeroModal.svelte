<script lang="ts">
  import { untrack } from 'svelte'
  import { invalidateAll } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'
  import CardToneSelect from '$lib/components/common/CardToneSelect.svelte'
  import { normalizeCardTone, type CardTone } from '$lib/utils/cardTone'
  import { validateUploadFile, validateUploadFileSize, getMimeExtension } from '$lib/utils/fileValidation'
  import type { ProductListMode } from '$lib/utils/productListOrder'
  import { csToast } from '$lib/utils/toast'
  import { DEFAULT_MD_POPUP_CONDITION, normalizeMdPopupCondition, type MdPopupCondition } from '$lib/utils/mdPopupCondition'

  interface ProductItem {
    id: string
    name: string
    image_urls: string[] | null
    base_price_daily: number
    /** 헤더 슬라이드 카드 바탕색(헤더 슬라이드 설정에서만 사용) — 비어 있으면 기존 옅은 퍼플 */
    card_tone?: CardTone | null
  }

  interface HeroSettings {
    products: { id: string; order: number; tone?: CardTone | null }[]
    mode: ProductListMode
    /** MD 추천 픽 설정 전용 — 'MD 추천' 팝업 노출조건(없으면 찜 ON·예약 OFF) */
    popup?: Partial<MdPopupCondition>
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
    /** 통합 설정 모달 안에 섹션으로 표시(오버레이·헤더·취소 숨김) */
    embedded?: boolean
  }

  let {
    settingKey = 'product_page_hero',
    initialSettings,
    categories = [],
    initialBanners = { items: [] },
    onclose,
    embedded = false,
  }: Props = $props()

  const BANNER_KEY = 'product_page_category_banners'
  const isHero = settingKey === 'product_page_hero'
  const isMd = settingKey === 'product_page_md_picks'
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
  // 배너 이미지는 cms-assets 버킷에 올라가며 이 버킷의 파일 크기 한도는 5MB(Stage·Production 동일) — 공통 10MB 검사만으로는 저장 때 'exceeded the maximum allowed size'로 실패하므로 선택 시점에 막는다
  const CMS_ASSETS_MAX_BYTES = 5 * 1024 * 1024
  const CMS_ASSETS_SIZE_ERROR = '배너 이미지는 5MB 이하만 올릴 수 있어요. 용량을 줄여 다시 선택해 주세요.'
  let midFile = $state<File | null>(null)
  let midPreview = $state<string | null>(null)

  function onMidFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const v = validateUploadFile(file)
    if (!v.ok || !file.type.startsWith('image/')) { midError = 'PNG, JPEG, WebP, HEIF 이미지 파일만 업로드할 수 있어요.'; return }
    const sz = validateUploadFileSize(file, CMS_ASSETS_MAX_BYTES)
    if (!sz.ok) { midError = CMS_ASSETS_SIZE_ERROR; return }
    midError = null
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

  // 저장된 순서(items 배열 순서)대로 먼저, 아직 저장된 적 없는 카테고리는 기존 카테고리 순서로 뒤에
  const bannerOrderIdx = (id: string) => {
    const i = initialBanners.items?.findIndex((b) => b.category_id === id) ?? -1
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }
  let bannerRows = $state<BannerRow[]>(
    [...categories].sort((a, b) => bannerOrderIdx(a.id) - bannerOrderIdx(b.id)).map((c) => {
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
    if (!v.ok || !file.type.startsWith('image/')) { bannerError = 'PNG, JPEG, WebP, HEIF 이미지 파일만 업로드할 수 있어요.'; return }
    const sz = validateUploadFileSize(file, CMS_ASSETS_MAX_BYTES)
    if (!sz.ok) { bannerError = CMS_ASSETS_SIZE_ERROR; return }
    bannerError = null
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

  let mode = $state<ProductListMode>(initialSettings.mode)
  // MD 추천 팝업 노출조건 — 설정값에 없으면 찜 ON·예약 OFF(기존 동작 유지)
  // 저장된 값(prop)이 '실제로 달라졌을 때만' 그 값으로 다시 맞춘다 — $state(prop) 1회 초기화 금지 규칙.
  // 설정을 다시 불러와도(객체만 새로 바뀌고 값은 같을 때) 편집 중인 토글은 유지한다: 비교는 값 문자열(savedPopupKey)로 한다.
  const savedPopupKey = $derived.by(() => {
    const c = normalizeMdPopupCondition(initialSettings.popup)
    return `${c.on_wish}-${c.on_reserve}`
  })
  let popup = $state<MdPopupCondition>({ ...DEFAULT_MD_POPUP_CONDITION })
  $effect(() => {
    void savedPopupKey
    popup = untrack(() => normalizeMdPopupCondition(initialSettings.popup))
  })
  let selected = $state<ProductItem[]>([])
  let searchResults = $state<ProductItem[]>([])
  let isSearching = $state(false)
  let isLoadingInitial = $state(false)
  // 모듈별 저장 상태·오류 — ① 슬라이드 ② 카테고리 배너 ③ 목록 중간 배너
  let savingSlide = $state(false)
  let savingBanner = $state(false)
  let savingMid = $state(false)
  let slideError = $state<string | null>(null)
  let bannerError = $state<string | null>(null)
  let midError = $state<string | null>(null)
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

  // Fix 1 — 초기 저장 상품 복원(모달이 열릴 때 1회만)
  // 모듈별 저장 뒤 invalidateAll() 로 initialSettings 가 새 객체가 되어도 다시 복원하지 않는다 —
  // 다시 실행하면 다른 모듈을 저장하는 순간 아직 저장하지 않은 슬라이드 상품 편집분이 저장본으로 덮어써진다(sp3 M1, 2026-11-18)
  let restoredOnce = false
  $effect(() => {
    const ids = initialSettings.products
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((p) => p.id)
      .filter(Boolean)
    if (restoredOnce) return
    restoredOnce = true
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
        const toneById = new Map(initialSettings.products.map((p) => [p.id, normalizeCardTone(p.tone)]))
        selected = ids
          .map((id) => map.get(id))
          .filter((x): x is ProductItem => !!x)
          .map((x) => ({ ...x, card_tone: toneById.get(x.id) ?? null }))
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

  // 카드 바탕색 선택 — 해당 상품 항목만 직접 바꾼다
  function setCardTone(id: string, tone: CardTone): void {
    const item = selected.find((s) => s.id === id)
    if (item) item.card_tone = tone
  }

  function removeProduct(id: string) {
    selected = selected.filter((s) => s.id !== id)
  }

  // ── 저장은 모듈별로 나눈다(2026-11-18 Stephen 지시) ─────────────────────────────
  // ① 슬라이드(노출 방식·상품) ② 카테고리 배너 ③ 목록 중간 배너 — 각자 [저장]으로 그 모듈만 저장하고, 한 번에 모두 저장하는 버튼은 두지 않는다.
  // ②·③은 같은 설정 키(product_page_category_banners)에 items / mid_banner 로 함께 들어가므로, 저장하지 않는 쪽은
  // '마지막으로 저장된 값'을 그대로 다시 써서 서로 덮어쓰지 않게 한다(저장 성공 때마다 아래 기준값을 갱신).
  let savedItems: CategoryBanner[] = [...(initialBanners.items ?? [])]
  let savedMid: MidBanner | null = initialBanners.mid_banner ?? null

  async function writeBanners(items: CategoryBanner[], mid: MidBanner | null): Promise<string | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: bErr } = await (supabase.rpc as any)('upsert_product_page_setting', {
      p_key: BANNER_KEY,
      p_value: { items, ...(mid ? { mid_banner: mid } : {}) },
    })
    return bErr ? (bErr as { message: string }).message : null
  }

  async function persistSlide(): Promise<boolean> {
    savingSlide = true
    slideError = null
    const value: HeroSettings = {
      // tone: 헤더 슬라이드에서 바탕색을 고른 상품에만 담는다(비어 있으면 기존 옅은 퍼플 카드)
      products: selected.map((p, i) => (isHero && p.card_tone ? { id: p.id, order: i, tone: p.card_tone } : { id: p.id, order: i })),
      mode,
      // MD 추천 픽 설정에만: 'MD 추천' 팝업 노출조건(찜 선택·예약 선택)
      ...(isMd ? { popup: { on_wish: popup.on_wish, on_reserve: popup.on_reserve } } : {}),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase.rpc as any)('upsert_product_page_setting', {
      p_key: settingKey,
      p_value: value,
    })
    if (err) {
      slideError = (err as { message: string }).message
      savingSlide = false
      return false
    }
    await invalidateAll()
    savingSlide = false
    return true
  }

  /** ① 슬라이드 모듈 저장 — 열린 채로 유지(다른 모듈을 이어서 편집 가능) */
  async function saveSlide() {
    if (await persistSlide()) csToast.success('저장했어요.')
  }

  /** MD 추천 픽 모달(모듈 1개뿐)의 저장 — 저장 후 닫기 */
  async function save() {
    if (await persistSlide()) onclose()
  }

  /** ② 카테고리 배너 모듈 저장 */
  async function saveCategoryBanners() {
    savingBanner = true
    bannerError = null
    try {
      for (const r of bannerRows) normalizeLink(r.link_url, catName(r.category_id))
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
      const msg = await writeBanners(items, savedMid)
      if (msg) throw new Error(msg)
      savedItems = items
      // 창이 열린 채 유지되므로 행을 저장 결과로 맞춘다(같은 파일을 다음 저장 때 다시 올리지 않도록 파일·미리보기 정리)
      bannerRows = bannerRows.map((r) => {
        if (r._preview) URL.revokeObjectURL(r._preview)
        if (r._mPreview) URL.revokeObjectURL(r._mPreview)
        const s = items.find((i) => i.category_id === r.category_id)
        return {
          ...r,
          image_url: s?.image_url ?? null,
          mobile_image_url: s?.mobile_image_url ?? null,
          enabled: s?.enabled ?? false,
          _file: null, _preview: null, _mFile: null, _mPreview: null,
        }
      })
      await invalidateAll()
      csToast.success('저장했어요.')
    } catch (e) {
      bannerError = e instanceof Error ? e.message : '카테고리 배너 저장에 실패했습니다.'
    } finally {
      savingBanner = false
    }
  }

  /** ③ 목록 중간 배너 모듈 저장 */
  async function saveMidBanner() {
    savingMid = true
    midError = null
    try {
      const link_url = normalizeLink(midLink, '목록 중간 배너')
      const image_url = await uploadMidImage()
      const mid: MidBanner = { enabled: midEnabled, image_url, title: midTitle.trim(), sub: midSub.trim(), link_url }
      const msg = await writeBanners(savedItems, mid)
      if (msg) throw new Error(msg)
      savedMid = mid
      if (midPreview) URL.revokeObjectURL(midPreview)
      midPreview = null
      midFile = null
      midImageUrl = image_url
      await invalidateAll()
      csToast.success('저장했어요.')
    } catch (e) {
      midError = e instanceof Error ? e.message : '목록 중간 배너 저장에 실패했습니다.'
    } finally {
      savingMid = false
    }
  }
</script>

{#if !embedded}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={onclose} role="presentation"></div>
{/if}

<aside class="modal-panel" class:embedded role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-label="헤더 상품 설정">
  {#if !embedded}
    <div class="modal-header">
      <span class="modal-title">
        {settingKey === 'product_page_md_picks' ? 'MD 추천 픽 설정' : '공통 상품 슬라이드 설정'}
      </span>
      <button class="modal-close" onclick={onclose} aria-label="닫기">✕</button>
    </div>
  {/if}

  <div class="modal-body">
    <!-- 노출 방식 + 상품 추가 + 선택된 상품 — 카드 스타일 없이 div로만 그룹핑 -->
    <div class="group-wrap">
    {#if isMd}
      <!-- 노출조건: 찜 선택·예약 선택 각각 ON/OFF — ON인 행위를 고객이 했을 때 'MD 추천' 팝업을 연다 -->
      <div class="section">
        <p class="section-label">노출조건</p>
        <div class="combo-wrap" role="group" aria-label="노출조건">
          <button type="button" class="combo-btn" class:combo-btn-active={popup.on_wish} aria-pressed={popup.on_wish} onclick={() => (popup.on_wish = !popup.on_wish)}>
            <span class="combo-label">찜 선택</span>
          </button>
          <button type="button" class="combo-btn" class:combo-btn-active={popup.on_reserve} aria-pressed={popup.on_reserve} onclick={() => (popup.on_reserve = !popup.on_reserve)}>
            <span class="combo-label">예약 선택</span>
          </button>
        </div>
        <p class="banner-help">옵션 다중 선택 가능</p>
      </div>
    {/if}
    <div class="section">
      <p class="section-label">노출 방식</p>
      <div class="combo-wrap" role="group" aria-label="노출 방식">
        <button type="button" class="combo-btn" class:combo-btn-active={mode === 'fixed'} aria-pressed={mode === 'fixed'} onclick={() => (mode = 'fixed')}>
          <span class="combo-label">고정 순서</span>
        </button>
        <button type="button" class="combo-btn" class:combo-btn-active={mode === 'random'} aria-pressed={mode === 'random'} onclick={() => (mode = 'random')}>
          <span class="combo-label">랜덤 노출</span>
        </button>
        <button type="button" class="combo-btn" class:combo-btn-active={mode === 'random_once'} aria-pressed={mode === 'random_once'} onclick={() => (mode = 'random_once')}>
          <span class="combo-label">1회 랜덤노출</span>
        </button>
      </div>
      <p class="banner-help">옵션 중 단일 선택 가능</p>
    </div>

    <!-- 상품 추가 + 선택된 상품 — 카드형 그룹 -->
    <div class="group-products group-plain">
    <div class="section">
      <p class="section-label">상품 추가 <span class="count-badge count-badge-end">{selected.length}/{MAX_ITEMS}</span></p>
      <div class="search-wrap">
        <SuggestPicker
          id="product-search-{settingKey}"
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
        <p class="section-label">선택된 상품 <span class="drag-hint">드래그로 순서 변경</span></p>
        <div class="selected-products-panel">
          <CmsDragList bind:items={selected} itemKey={(item) => item.id}>
            {#snippet renderItem(item)}
              <div class="selected-row selected-row--plain">
                {#if isHero}
                  <div class="selected-info">
                    <span class="selected-name">{item.name}</span>
                    <CardToneSelect value={item.card_tone} defaultTone="lilac" onselect={(t) => setCardTone(item.id, t)} />
                  </div>
                {:else}
                  <span class="selected-name">{item.name}</span>
                {/if}
                <button class="remove-btn" onclick={() => removeProduct(item.id)} aria-label="{item.name} 제거">
                    <!-- CMS 공통 표준 삭제 아이콘(휴지통 SVG 12×12) -->
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                      <polyline points="3,6 5,6 21,6"/>
                      <path d="M19,6l-1,14H6L5,6"/>
                      <path d="M10,11v6M14,11v6"/>
                      <path d="M9,6V4h6v2"/>
                    </svg>
                </button>
              </div>
            {/snippet}
          </CmsDragList>
        </div>
      </div>
    {:else}
      <p class="empty-msg">위 검색창에서 상품을 추가하세요.</p>
    {/if}
    </div>
    {#if !isHero}
      <p class="banner-help size-help">카드 PC 232×232 · 모바일 139×139 · 둥근 사각형</p>
    {/if}
    <!-- ① 슬라이드 모듈 저장 — 헤더 상품 설정 모달(isHero)에서만. MD 추천 픽 모달은 하단 [저장] 하나가 이 모듈 전체다 -->
    {#if isHero}
      {#if slideError}<p class="save-error" role="alert">{slideError}</p>{/if}
      <div class="module-actions">
        <button type="button" class="btn-save" onclick={saveSlide} disabled={savingSlide}>{savingSlide ? '저장 중…' : '저장'}</button>
      </div>
    {/if}
    </div>

    <!-- 카테고리 선택 시 노출 배너 — 카테고리별 1개, 가로 100% × 세로 150px -->
    {#if showBanners}
      <div class="section banner-section">
        <p class="section-label">카테고리 배너 <span class="count-badge">가로 100% × 세로 150px</span></p>
        <p class="banner-help">카테고리 메뉴를 선택하면 헤더 슬라이드 대신 해당 카테고리의 배너가 노출됩니다. 권장 이미지 크기 1240×150px(가로 세로 약 8:1).</p>
        <CmsDragList bind:items={bannerRows} itemKey={(r) => r.category_id}>
          {#snippet renderItem(row)}
          <div class="banner-row banner-row--card">
            <!-- 상단 바 — 홈 배너 카드와 같은 구성: 왼쪽 우선노출지정(카테고리 배너에는 해당 기능이 없어 비활성 표시) / 오른쪽 기본노출지정(노출 on/off) -->
            <div class="vis-bars">
              <button type="button" class="vis-bar vis-bar--first" disabled aria-label="우선노출지정(사용 불가)" tabindex="-1">우선노출지정</button>
              <button
                type="button"
                class="vis-bar"
                class:vis-bar--on={row.enabled}
                disabled={!row.image_url && !row._preview && !row.mobile_image_url && !row._mPreview}
                aria-pressed={row.enabled}
                aria-label="{catName(row.category_id)} 배너 노출"
                onclick={() => patchBanner(row.category_id, { enabled: !row.enabled })}
              >
                <span class="vis-ico">
                  <svg width="18" height="12" viewBox="0 0 18 12" fill="none" aria-hidden="true">
                    <path d="M14.788 0.40847C15.5937 -0.206503 16.7506 -0.123176 17.4589 0.632103C18.2144 1.4379 18.1729 2.70376 17.3671 3.45925L17.3622 3.46413C17.3585 3.46759 17.3528 3.47297 17.3456 3.47976C17.3311 3.49333 17.3101 3.51407 17.2821 3.54031C17.2261 3.59279 17.1437 3.66974 17.039 3.76784C16.8294 3.96413 16.5289 4.24474 16.1669 4.58327C15.4428 5.26035 14.4707 6.169 13.4774 7.09304C12.4848 8.01654 11.4689 8.95836 10.6591 9.70144C9.90326 10.3949 9.21125 11.0229 8.954 11.219C8.38484 11.6526 7.64783 12.0001 6.7831 12.0003C5.89707 12.0003 5.14509 11.6357 4.57217 11.138C4.258 10.865 3.25694 9.9462 2.37197 9.13015C1.92122 8.71451 1.48885 8.31388 1.16885 8.01785C1.0088 7.86979 0.875998 7.74749 0.78408 7.66238C0.738281 7.61997 0.702073 7.58638 0.677634 7.56374C0.665704 7.55269 0.656551 7.54415 0.650291 7.53835C0.647126 7.53542 0.644094 7.53301 0.642478 7.53152L0.641502 7.52956H0.640525C-0.169647 6.77877 -0.217693 5.51259 0.533103 4.70242C1.28393 3.89251 2.55017 3.84526 3.36025 4.59597L3.36123 4.59792C3.3628 4.59938 3.36592 4.60089 3.36904 4.60378C3.37524 4.60953 3.38439 4.61807 3.39638 4.62917C3.42067 4.65167 3.45618 4.68551 3.50185 4.72781C3.59333 4.81251 3.72524 4.93384 3.88467 5.08132C4.2037 5.37646 4.63512 5.77493 5.08388 6.18874C5.73477 6.78894 6.40077 7.39812 6.82217 7.78054C6.86093 7.74604 6.90358 7.70918 6.94814 7.66921C7.21008 7.43424 7.55408 7.12113 7.954 6.75417C8.7536 6.02049 9.76226 5.0859 10.7528 4.16433C11.7428 3.24336 12.7128 2.33711 13.4354 1.6614C13.7965 1.32374 14.0957 1.04357 14.3046 0.847923C14.409 0.750147 14.491 0.67359 14.5468 0.621361C14.5745 0.595342 14.5959 0.575239 14.6103 0.56179C14.6174 0.555065 14.6232 0.549566 14.6269 0.546165L14.6317 0.541282L14.788 0.40847Z" fill="currentColor" />
                  </svg>
                </span>기본노출지정
              </button>
            </div>
            <div class="banner-row-head">
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
            <div class="banner-media">
              <div class="banner-thumbs">
            <!-- 이미지 칸 자체가 버튼 — 홈 배너 카드(HomeBannerModal .thumb-wrap)처럼 눌러서 교체, 슬롯 이름표(PC·모바일)는 칸 안 왼쪽 아래 -->
            <div class="banner-thumb-wrap">
              <label class="banner-thumb" class:banner-thumb-empty={!(row._preview ?? row.image_url)} title="PC 이미지 (1240×150px) — 클릭하여 교체">
                {#if row._preview ?? row.image_url}
                  <img src={row._preview ?? row.image_url} alt="{catName(row.category_id)} 배너 미리보기" />
                {:else}
                  <span>없음</span>
                {/if}
                <span class="slot-tag">PC</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/heif,image/heic" onchange={(e) => onBannerFile(row.category_id, e)} hidden />
              </label>
              {#if row.image_url || row._preview}
                <button type="button" class="remove-btn banner-thumb-remove" aria-label="{catName(row.category_id)} 배너 이미지 제거"
                  onclick={() => patchBanner(row.category_id, { image_url: null, _file: null, _preview: null, enabled: !!(row.mobile_image_url || row._mPreview) && row.enabled })}>✕</button>
              {/if}
            </div>
            <div class="banner-thumb-wrap banner-thumb-wrap-m">
              <label class="banner-thumb banner-thumb-m" class:banner-thumb-empty={!(row._mPreview ?? row.mobile_image_url)} title="모바일 이미지 (가로 100% × 세로 200px, 권장 680×400px) — 클릭하여 교체">
                {#if row._mPreview ?? row.mobile_image_url}
                  <img src={row._mPreview ?? row.mobile_image_url} alt="{catName(row.category_id)} 모바일 배너 미리보기" />
                {:else}
                  <span>PC로 대체</span>
                {/if}
                <span class="slot-tag">모바일</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/heif,image/heic" onchange={(e) => onBannerFile(row.category_id, e, 'mobile')} hidden />
              </label>
              {#if row.mobile_image_url || row._mPreview}
                <button type="button" class="remove-btn banner-thumb-remove" aria-label="{catName(row.category_id)} 모바일 배너 이미지 제거"
                  onclick={() => patchBanner(row.category_id, { mobile_image_url: null, _mFile: null, _mPreview: null })}>✕</button>
              {/if}
            </div>
              </div>
            <div class="banner-fields">
              <input type="text" class="f-input" placeholder="연결 링크 (예: /products/abc 또는 https://…)" maxlength="500"
                value={row.link_url ?? ''} oninput={(e) => patchBanner(row.category_id, { link_url: e.currentTarget.value })} />
              <input type="text" class="f-input" placeholder="대체 텍스트 (접근성)" maxlength="100"
                value={row.alt} oninput={(e) => patchBanner(row.category_id, { alt: e.currentTarget.value })} />
            </div>
            </div>
            <!-- 삭제 — 홈 배너 카드(.btn-remove)와 같은 표준 휴지통 아이콘, 카드 하단 우측. 이 카테고리의 이미지·링크·대체 텍스트를 비우고 숨김 처리(저장 시 반영) -->
            <button
              type="button"
              class="row-remove"
              onclick={() => patchBanner(row.category_id, { image_url: null, _file: null, _preview: null, mobile_image_url: null, _mFile: null, _mPreview: null, link_url: '', alt: '', enabled: false })}
              aria-label="{catName(row.category_id)} 배너 비우기"
              title="배너 비우기"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <polyline points="3,6 5,6 21,6"/>
                <path d="M19,6l-1,14H6L5,6"/>
                <path d="M10,11v6M14,11v6"/>
                <path d="M9,6V4h6v2"/>
              </svg>
            </button>
            {/if}
          </div>
          {/snippet}
        </CmsDragList>
        <!-- ② 카테고리 배너 모듈 저장 -->
        {#if bannerError}<p class="save-error" role="alert">{bannerError}</p>{/if}
        <div class="module-actions">
          <button type="button" class="btn-save" onclick={saveCategoryBanners} disabled={savingBanner}>{savingBanner ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    {/if}

    <!-- 모바일 목록 중간 배너(촬영본능 PICK! 카드) 관리 -->
    {#if isHero}
      <div class="section banner-section">
        <p class="section-label">모바일 목록 중간 배너 <span class="count-badge">모바일 카드 화면폭×160px · 둥근 사각형</span></p>
        <p class="banner-help">모바일 상품 목록 중간의 "촬영본능 PICK!" 카드입니다. 이미지·문구·링크를 바꾸거나 노출을 끌 수 있습니다.</p>
        <div class="banner-row banner-row--card">
          <!-- 상단 바 — 카테고리 배너 카드와 같은 구성: 왼쪽 우선노출지정(해당 기능 없음, 비활성) / 오른쪽 기본노출지정(노출 on/off) -->
          <div class="vis-bars">
            <button type="button" class="vis-bar vis-bar--first" disabled aria-label="우선노출지정(사용 불가)" tabindex="-1">우선노출지정</button>
            <button
              type="button"
              class="vis-bar"
              class:vis-bar--on={midEnabled}
              aria-pressed={midEnabled}
              aria-label="목록 중간 배너 노출"
              onclick={() => (midEnabled = !midEnabled)}
            >
              <span class="vis-ico">
                <svg width="18" height="12" viewBox="0 0 18 12" fill="none" aria-hidden="true">
                    <path d="M14.788 0.40847C15.5937 -0.206503 16.7506 -0.123176 17.4589 0.632103C18.2144 1.4379 18.1729 2.70376 17.3671 3.45925L17.3622 3.46413C17.3585 3.46759 17.3528 3.47297 17.3456 3.47976C17.3311 3.49333 17.3101 3.51407 17.2821 3.54031C17.2261 3.59279 17.1437 3.66974 17.039 3.76784C16.8294 3.96413 16.5289 4.24474 16.1669 4.58327C15.4428 5.26035 14.4707 6.169 13.4774 7.09304C12.4848 8.01654 11.4689 8.95836 10.6591 9.70144C9.90326 10.3949 9.21125 11.0229 8.954 11.219C8.38484 11.6526 7.64783 12.0001 6.7831 12.0003C5.89707 12.0003 5.14509 11.6357 4.57217 11.138C4.258 10.865 3.25694 9.9462 2.37197 9.13015C1.92122 8.71451 1.48885 8.31388 1.16885 8.01785C1.0088 7.86979 0.875998 7.74749 0.78408 7.66238C0.738281 7.61997 0.702073 7.58638 0.677634 7.56374C0.665704 7.55269 0.656551 7.54415 0.650291 7.53835C0.647126 7.53542 0.644094 7.53301 0.642478 7.53152L0.641502 7.52956H0.640525C-0.169647 6.77877 -0.217693 5.51259 0.533103 4.70242C1.28393 3.89251 2.55017 3.84526 3.36025 4.59597L3.36123 4.59792C3.3628 4.59938 3.36592 4.60089 3.36904 4.60378C3.37524 4.60953 3.38439 4.61807 3.39638 4.62917C3.42067 4.65167 3.45618 4.68551 3.50185 4.72781C3.59333 4.81251 3.72524 4.93384 3.88467 5.08132C4.2037 5.37646 4.63512 5.77493 5.08388 6.18874C5.73477 6.78894 6.40077 7.39812 6.82217 7.78054C6.86093 7.74604 6.90358 7.70918 6.94814 7.66921C7.21008 7.43424 7.55408 7.12113 7.954 6.75417C8.7536 6.02049 9.76226 5.0859 10.7528 4.16433C11.7428 3.24336 12.7128 2.33711 13.4354 1.6614C13.7965 1.32374 14.0957 1.04357 14.3046 0.847923C14.409 0.750147 14.491 0.67359 14.5468 0.621361C14.5745 0.595342 14.5959 0.575239 14.6103 0.56179C14.6174 0.555065 14.6232 0.549566 14.6269 0.546165L14.6317 0.541282L14.788 0.40847Z" fill="currentColor" />
                  </svg>
              </span>기본노출지정
            </button>
          </div>
          <div class="banner-row-head">
            <span class="banner-cat banner-cat--pad">목록 중간 배너</span>
          </div>
          <div class="banner-media">
            <div class="banner-thumbs">
              <!-- 이미지 칸 자체가 버튼 — 눌러서 교체 -->
              <label class="banner-thumb banner-thumb-mid" title="목록 중간 배너 이미지 — 클릭하여 교체">
                <img src={midPreview ?? midImageUrl ?? MID_DEFAULT_IMAGE} alt="목록 중간 배너 이미지 미리보기" />
                <input type="file" class="mid-pick-input" accept="image/png,image/jpeg,image/webp,image/heif,image/heic" onchange={onMidFile} />
              </label>
            </div>
            <div class="banner-fields">
              <input type="text" class="f-input" placeholder="타이틀 (예: 촬영본능)" maxlength="20" bind:value={midTitle} />
              <input type="text" class="f-input" placeholder="서브 텍스트 (예: PICK!)" maxlength="20" bind:value={midSub} />
              <input type="text" class="f-input" placeholder="연결 링크 (예: /hype-pack 또는 https://…, 비우면 링크 없음)" maxlength="500" bind:value={midLink} />
            </div>
          </div>
        </div>
        <!-- ③ 목록 중간 배너 모듈 저장 -->
        {#if midError}<p class="save-error" role="alert">{midError}</p>{/if}
        <div class="module-actions">
          <button type="button" class="btn-save" onclick={saveMidBanner} disabled={savingMid}>{savingMid ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    {/if}
  </div>

  <!-- 헤더 상품 설정 모달(isHero)은 모듈마다 [저장]이 있어 하단 통합 저장 버튼을 두지 않는다(2026-11-18). MD 추천 픽 모달만 하단 [취소]/[저장] 유지 -->
  {#if !isHero}
    {#if slideError}
      <p class="save-error save-error-footer" role="alert">{slideError}</p>
    {/if}
    <div class="modal-footer">
      {#if !embedded}<button class="btn-cancel" onclick={onclose} disabled={savingSlide}>취소</button>{/if}
      <button class="btn-save" onclick={save} disabled={savingSlide}>
        {savingSlide ? '저장 중…' : '저장'}
      </button>
    </div>
  {/if}
</aside>

<style>
  /* 통합 설정 모달 안에 섹션으로 박히는 모드(embedded) — 오버레이·헤더 없이 본문 흐름에 배치 */
  .modal-panel.embedded { position: static; height: auto; width: auto; max-width: none; z-index: auto; border-radius: 0; box-shadow: none; background: transparent; display: block; overflow: visible; }
  .modal-panel.embedded .modal-body { overflow: visible; flex: none; }

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

  /* front 관리모달 섹션 라벨 표준(front-uiux.md §9-2-A ③) */
  .section-label {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text-mid);
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .count-badge-end { margin-left: auto; } /* 상품 추가 개수 배지 — 우측 끝 */

  .count-badge {
    background: rgba(59, 47, 138, 0.1);
    color: var(--cs-purple);
    border-radius: var(--radius-full);
    padding: 1px 8px;
    font-size: 11px;
  }

  /* 콤보 버튼 선택 그룹 — front-uiux.md §16 표준(PC 기본 + 모바일 오버라이드) */
  /* 상품 그리드 설정 모달의 노출 순서 콤보와 같은 규격: 버튼 폭 동일(가장 긴 버튼 기준) · 행/열 간격 12px/6px · 라벨 --text-pc-script-12 */
  .combo-wrap {
    /* 옵션이 3개(고정 순서·랜덤 노출·1회 랜덤노출)가 되어 좁은 폭에서는 줄바꿈 — 2026-11-13 */
    display: inline-flex;
    flex-wrap: wrap;
    gap: 12px 6px;
    align-self: flex-start;
  }
  .combo-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 9px 16px;
    border-radius: var(--radius-xl);
    border: 1.5px solid #DCDCDC;
    background: #fff;
    cursor: pointer;
    transition: all 0.18s;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .combo-btn:hover { background: #F5F4FA; } /* 호버는 BG 색상 변경만 */
  .combo-btn-active,
  .combo-btn-active:hover {
    border-color: var(--cs-purple);
    background: var(--cs-purple);
  }
  .combo-label { font: var(--text-pc-script-12); color: var(--cs-text); }
  .combo-btn-active .combo-label { color: #fff; }
  @media (max-width: 640px) {
    .combo-btn   { padding: 8px 12px; }
  }



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

  .selected-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
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
  /* 모듈별 [저장] — 각 모듈 카드 맨 아래 오른쪽 */
  .module-actions { display: flex; justify-content: flex-end; margin-top: 12px; }
  /* MD 추천 픽 모달 — 오류 문구를 하단 버튼줄 위에 보이도록(본문 영역을 벗어난 위치라 좌우 여백만 맞춘다) */
  .save-error-footer { margin: 0 24px 12px; }

  .banner-help { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0; }
  .size-help {
    width: fit-content;
    margin: 16px auto 0;
    background: rgba(59, 47, 138, 0.1);
    color: var(--cs-purple);
    border-radius: var(--radius-full);
    padding: 1px 8px;
    font-size: 11px;
    font-weight: 700;
  }
  .group-wrap { display: flex; flex-direction: column; gap: 16px; }
  /* 그룹(노출방식·상품)과 카테고리 배너 사이 여백 +100% (기본 body gap 20px → 40px) */
  .group-wrap + .banner-section { margin-top: 20px; }
  /* 카테고리 배너 ↔ 모바일 목록 중간 배너 사이 여백 +100% (20px → 40px) */
  .banner-section + .banner-section { margin-top: 20px; }
  /* 카드형 — 카테고리 배너 행(.banner-row)과 동일한 연보라 카드 */
  .group-products {
    display: flex; flex-direction: column; gap: 16px;
    background: var(--cs-lilac); border-radius: var(--radius-md); padding: 20px;
  }
  /* 상품 모달 카드 — 상품 그리드 모달 '고정노출 설정' 카드와 동일 규격(패딩 20px · 제목 12px/700/보조색 · 입력창↔목록 여백 12px) */
  .group-products .section-label {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
  }
  .selected-products-panel { margin-top: 12px; }

  /* MD 추천 설정 — 홈 카테고리 상품 모달(HomeCategoryProductsModal)과 같은 구성: 연보라 카드 없이 '상품 추가'·'선택된 상품' 두 구역으로 분리 */
  .group-products.group-plain { background: transparent; border-radius: 0; padding: 0; gap: 20px; }
  .group-products.group-plain .section-label { font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text-mid); }
  .group-plain .count-badge-end { margin-left: 0; background: none; padding: 0; font-size: 12px; font-weight: 400; color: var(--cs-text-mid); }
  .group-plain .drag-hint { font-size: 11px; font-weight: 400; color: var(--cs-text-light); }
  .group-plain .selected-products-panel { margin-top: 0; }
  .group-plain :global(.drag-list) { gap: 8px; }
  .selected-row--plain { padding: 8px 10px; background: var(--cs-surface-gray); border-radius: var(--radius-sm); }
  .group-plain .selected-name { font: var(--text-pc-script-12); font-weight: 700; }
  .banner-row {
    display: flex; flex-direction: column; gap: 8px;
    background: var(--cs-lilac); border-radius: var(--radius-md); padding: 12px 20px;
  }
  /* 카테고리 배너 카드 — 홈 배너 카드(HomeBannerModal .banner-row)와 같은 연회색 면·반경 8px·안쪽 여백 10px + 상단 노출 바 */
  .banner-row--card { flex: 1; min-width: 0; background: var(--cs-surface-gray); border-radius: var(--radius-sm); padding: 10px; }
  .banner-row--card .acc-head--row { padding: 0 10px; }   /* 카테고리명·화살표 좌우 끝 여백 */
  .banner-section :global(.drag-list) { gap: 8px; }
  .vis-bars { display: flex; margin: -10px -10px 0; }
  .vis-bar {
    flex: 1;
    display: flex; align-items: center; justify-content: center; gap: 4px;
    font: var(--text-pc-descript-10); line-height: 15px; color: var(--cs-text-mid);
    box-sizing: content-box; height: 30px; padding: 5px 0;
    border: none; border-radius: 0;
    background: var(--cs-border); cursor: pointer; transition: background 0.18s ease, color 0.18s ease;
  }
  .vis-bar:first-child { border-top-left-radius: var(--radius-sm); }
  .vis-bar:last-child { border-top-right-radius: var(--radius-sm); }
  .vis-bar--on { background: var(--cs-purple-op10); color: var(--cs-purple-dark); }
  .vis-bar:disabled { cursor: not-allowed; opacity: 0.5; }
  .vis-ico { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: var(--radius-sm, 8px); color: var(--cs-purple-op10); transition: background 0.15s, color 0.15s; }
  .vis-bar--on .vis-ico { color: var(--cs-purple); }
  .vis-bar:not(:disabled):hover .vis-ico { background: rgba(59, 47, 138, 0.06); }
  .vis-ico svg { width: 18px; height: 12px; }
  .banner-row-head { display: flex; align-items: center; gap: 12px; }
  .banner-cat { font: var(--text-pc-title-16); color: var(--cs-text); }
  .banner-thumb {
    width: 64px; height: 48px; border-radius: 6px; overflow: hidden;
    background: var(--cs-white); display: flex; align-items: center; justify-content: center;
  }
  .banner-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .banner-thumb { position: relative; cursor: pointer; user-select: none; -webkit-user-select: none; transition: opacity 0.15s; }
  .banner-thumb:hover { opacity: 0.85; }
  .banner-thumb-wrap { position: relative; }
  /* CMS 공통 표준 삭제 아이콘 버튼(홈 배너 카드 .btn-remove 규격) — 투명 면, 호버는 옅은 레드 면 + 레드 아이콘 */
  .row-remove {
    display: inline-flex; align-items: center; justify-content: center; align-self: flex-end;
    min-height: 32px; min-width: 28px; flex-shrink: 0; padding: 0 8px;
    border: none; border-radius: var(--radius-sm); background: transparent;
    color: var(--cs-text-light); cursor: pointer; transition: background 0.1s, color 0.1s;
  }
  .row-remove:hover { background: rgba(255, 53, 53, 0.08); color: var(--cs-red-badge); }
  .banner-media { display: flex; align-items: flex-start; gap: 8px; }
  .banner-media .banner-fields { flex: 1; }
  .banner-thumbs { flex-shrink: 0; width: 64px; display: flex; flex-direction: column; gap: 4px; }
  .banner-thumb-remove { position: absolute; top: 2px; right: 2px; z-index: 2; min-height: 18px; min-width: 18px; width: 18px; height: 18px; padding: 0; font-size: 10px; background: rgba(255, 255, 255, 0.85); }
  .slot-tag {
    position: absolute; bottom: 3px; left: 3px; z-index: 1; padding: 1px 5px; border-radius: 5px;
    background: var(--cs-dark); color: var(--cs-white); font-size: 10px; font-weight: 700; line-height: 1.3; pointer-events: none;
  }
  .banner-thumb-empty span:not(.slot-tag) { font-size: 10px; text-align: center; line-height: 1.2; color: var(--cs-text-light); }
  .banner-thumb-mid { width: 64px; height: 64px; border-radius: 50%; }
  .banner-cat--pad { padding: 0 10px; }
  .mid-pick-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  .banner-fields { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
</style>
