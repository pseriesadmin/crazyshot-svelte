<script lang="ts">
  import { enhance, applyAction } from '$app/forms'
  import { invalidateAll } from '$app/navigation'
  import type { ActionResult } from '@sveltejs/kit'
  import { resizeProductImage } from '$lib/utils/imageResize'
  import { csToast } from '$lib/utils/toast'

  interface PriceRule {
    duration_type: string
    price: number
    deposit_amount: number | null
    late_fee_per_hour: number | null
    damage_fee_percentage: number | null
  }

  interface AssetDetail {
    id: string
    asset_code: string | null
    serial_number: string | null
    status: string
    condition_notes: string | null
    warehouse_location: string | null
    label_image_url: string | null
    ocr_raw_text: string | null
  }

  interface ProductDetail {
    id: string
    category: string
    name: string
    slug: string
    product_code?: string | null
    brand: string | null
    description: string | null
    product_caption: string | null
    image_urls: string[]
    specifications: Record<string, string> | null
    is_active: boolean
    created_at: string
    qr_payload: string | null
    sale_price: number | null
    sale_only: boolean
    assetCount: number
    price12h: number | null
    price24h: number | null
    assets?: AssetDetail[]
  }

  interface InventoryUnit {
    id: string
    name: string
    product_code: string | null
    is_active: boolean
    price_rules: Array<{ duration_type: string; price: number }>
  }

  interface Props {
    product: ProductDetail
    priceRules: PriceRule[]
    categories: Array<{ value: string; label: string }>
    categoryLabel: string
    initialTab?: string | null
    inventoryList?: InventoryUnit[]
    onclose: () => void
  }

  let { product, priceRules, categories, categoryLabel, initialTab = null, inventoryList = [], onclose }: Props = $props()


  // 카테고리 레이블 맵 (picker용)
  const CATEGORY_LABEL = $derived(
    Object.fromEntries(categories.map(c => [c.value, c.label]))
  )

  type TabKey = 'basic' | 'pricing' | 'images' | 'specs' | 'history'
  const validTabs: TabKey[] = ['basic', 'pricing', 'images', 'specs', 'history']
  const parsedInitialTab: TabKey = (validTabs.includes(initialTab as TabKey) ? initialTab : 'basic') as TabKey
  let activeTab = $state<TabKey>(parsedInitialTab)
  let canvasEl = $state<HTMLCanvasElement | null>(null)
  let isSaving = $state(false)
  let showCategoryPicker = $state(false)
  let catPickerRef: HTMLDivElement | null = null

  function toggleCategoryPicker() {
    showCategoryPicker = !showCategoryPicker
  }

  // ── 기본정보 로컬 상태 ──────────────────────────────────────
  let localBasic = $state({
    name: product.name,
    brand: product.brand ?? '',
    caption: product.product_caption ?? '',
    description: product.description ?? '',
    is_active: product.is_active,
    category: product.category,
  })
  const isDirtyBasic = $derived(
    localBasic.name !== product.name ||
    localBasic.brand !== (product.brand ?? '') ||
    localBasic.caption !== (product.product_caption ?? '') ||
    localBasic.description !== (product.description ?? '') ||
    localBasic.is_active !== product.is_active ||
    localBasic.category !== product.category
  )

  // ── 가격 포맷 헬퍼 (천단위 콤마) ───────────────────────────
  function fmtPriceStr(val: number | null | undefined): string {
    if (!val) return ''
    return val.toLocaleString('ko-KR')
  }

  function handlePriceInput(field: keyof typeof localPricing, raw: string) {
    const digits = raw.replace(/[^0-9]/g, '')
    const num = parseInt(digits, 10)
    localPricing[field] = num ? num.toLocaleString('ko-KR') : ''
  }

  // ── 가격정책 로컬 상태 ──────────────────────────────────────
  let localPricing = $state({
    price_12h:            fmtPriceStr(priceRules.find(r => r.duration_type === '12h')?.price),
    price_24h:            fmtPriceStr(priceRules.find(r => r.duration_type === '24h')?.price),
    price_monthly:        fmtPriceStr(priceRules.find(r => r.duration_type === 'monthly')?.price),
    deposit_amount:       fmtPriceStr(priceRules.find(r => r.duration_type === '24h')?.deposit_amount),
    late_fee_per_hour:    fmtPriceStr(priceRules.find(r => r.duration_type === '24h')?.late_fee_per_hour),
    damage_fee_percentage:String(priceRules.find(r => r.duration_type === '24h')?.damage_fee_percentage ?? ''),
    sale_price:           fmtPriceStr(product.sale_price),
  })
  let localSaleOnly = $state(product.sale_only ?? false)

  // $derived: priceRules/product prop 변경 시(저장 후 invalidateAll) 자동 재계산 → isDirtyPricing 초기화
  const origPricing = $derived({
    price_12h:            fmtPriceStr(priceRules.find(r => r.duration_type === '12h')?.price),
    price_24h:            fmtPriceStr(priceRules.find(r => r.duration_type === '24h')?.price),
    price_monthly:        fmtPriceStr(priceRules.find(r => r.duration_type === 'monthly')?.price),
    deposit_amount:       fmtPriceStr(priceRules.find(r => r.duration_type === '24h')?.deposit_amount),
    late_fee_per_hour:    fmtPriceStr(priceRules.find(r => r.duration_type === '24h')?.late_fee_per_hour),
    damage_fee_percentage:String(priceRules.find(r => r.duration_type === '24h')?.damage_fee_percentage ?? ''),
    sale_price:           fmtPriceStr(product.sale_price),
  })
  const origSaleOnly = $derived(product.sale_only ?? false)
  const isDirtyPricing = $derived(
    localPricing.price_12h             !== origPricing.price_12h ||
    localPricing.price_24h             !== origPricing.price_24h ||
    localPricing.price_monthly         !== origPricing.price_monthly ||
    localPricing.deposit_amount        !== origPricing.deposit_amount ||
    localPricing.late_fee_per_hour     !== origPricing.late_fee_per_hour ||
    localPricing.damage_fee_percentage !== origPricing.damage_fee_percentage ||
    localPricing.sale_price            !== origPricing.sale_price ||
    localSaleOnly                      !== origSaleOnly
  )

  // ── 사양 로컬 상태 ──────────────────────────────────────────
  let localSpecs = $state<Array<{ key: string; value: string }>>(
    Object.entries(product.specifications ?? {}).map(([key, value]) => ({ key, value }))
  )
  const origSpecsJson = JSON.stringify(
    Object.fromEntries(Object.entries(product.specifications ?? {}).map(([k, v]) => [k, v]))
  )
  const isDirtySpecs = $derived(
    JSON.stringify(Object.fromEntries(localSpecs.filter(s => s.key).map(s => [s.key, s.value])))
    !== origSpecsJson
  )

  // ── 이미지 탭 전용 상태 ─────────────────────────────────────
  let localImages = $state<string[]>([...product.image_urls])
  let isDragging = $state(false)
  let dragCounter = 0
  let isAutoSaving = $state(false)
  let isUploading = $state(false)
  let uploadError = $state<string | null>(null)
  let showUrlInput = $state(false)
  let urlInputVal = $state('')
  let fileInputEl = $state<HTMLInputElement | null>(null)
  let lightboxUrl = $state<string | null>(null)
  let holdTimer = $state<ReturnType<typeof setTimeout> | null>(null)

  $effect(() => {
    localImages = [...product.image_urls]
    localSpecs = Object.entries(product.specifications ?? {}).map(([key, value]) => ({ key, value }))
    // priceRules/product 변경 시(저장 후 invalidateAll) localPricing 동기화 → isDirtyPricing 초기화
    localPricing = {
      price_12h:             fmtPriceStr(priceRules.find(r => r.duration_type === '12h')?.price),
      price_24h:             fmtPriceStr(priceRules.find(r => r.duration_type === '24h')?.price),
      price_monthly:         fmtPriceStr(priceRules.find(r => r.duration_type === 'monthly')?.price),
      deposit_amount:        fmtPriceStr(priceRules.find(r => r.duration_type === '24h')?.deposit_amount),
      late_fee_per_hour:     fmtPriceStr(priceRules.find(r => r.duration_type === '24h')?.late_fee_per_hour),
      damage_fee_percentage: String(priceRules.find(r => r.duration_type === '24h')?.damage_fee_percentage ?? ''),
      sale_price:            fmtPriceStr(product.sale_price),
    }
    localSaleOnly = product.sale_only ?? false
  })

  // 탭 전환: 미저장 변경 존재 시 경고 토스트
  function switchTab(tab: TabKey) {
    const dirty =
      (activeTab === 'basic'   && isDirtyBasic)   ||
      (activeTab === 'pricing' && isDirtyPricing)  ||
      (activeTab === 'specs'   && isDirtySpecs)
    if (dirty) csToast.warning('변경 정보 저장 확인')
    activeTab = tab
    if (tab === 'history' && !historyLoaded) {
      loadHistory()
    }
  }

  // QR 코드 렌더링
  $effect(() => {
    const qr = product.qr_payload
    const canvas = canvasEl
    if (!qr || !canvas) return
    renderQR(canvas, qr)
  })

  // initialTab='history'로 패널 열릴 때 자동 로드
  $effect(() => {
    if (parsedInitialTab === 'history' && !historyLoaded) {
      loadHistory()
    }
  })

  async function renderQR(canvas: HTMLCanvasElement, payload: string) {
    try {
      const QRCode = (await import('qrcode')).default
      await QRCode.toCanvas(canvas, payload, {
        width: 88,
        margin: 1,
        color: { dark: '#100B32', light: '#FFFFFF' },
      })
    } catch { /* 미설치 시 무시 */ }
  }

  function downloadQR() {
    if (!canvasEl) return
    const a = document.createElement('a')
    a.href = canvasEl.toDataURL('image/png')
    a.download = `qr-${product.slug}.png`
    a.click()
  }

  function formatPrice(p: number | null): string {
    if (p == null) return '—'
    return p.toLocaleString('ko-KR') + '원'
  }

  function formatDate(d: string): string {
    return d.slice(0, 10).replace(/-/g, '.')
  }

  function thumbUrl(url: string): string {
    if (!url) return ''
    // Supabase Storage: large_ → thumb_ 경로 치환
    if (url.includes('/storage/v1/object/public/product-images/') && url.includes('/large_')) {
      return url.replace('/large_', '/thumb_')
    }
    // 기존 Cloudinary URL 및 외부 URL — 그대로 사용
    return url
  }

  function largeUrl(url: string): string {
    // large URL이 이미 저장되어 있으므로 그대로 반환
    return url
  }

  // 저장 핸들러 (enhance 콜백)
  function handleSectionSave() {
    isSaving = true
    return async ({ result }: { result: ActionResult }) => {
      isSaving = false
      if (result.type === 'success') {
        await invalidateAll()
        csToast.success('저장됐습니다.')
      } else {
        await applyAction(result)
      }
    }
  }

  // ─── 이미지 탭 함수 ───────────────────────────────────────

  async function autoSave() {
    if (isAutoSaving) return
    isAutoSaving = true
    uploadError = null
    try {
      const fd = new FormData()
      fd.append('product_id', product.id)
      fd.append('section_type', 'images')
      fd.append('image_urls', JSON.stringify(localImages.filter(Boolean)))
      await fetch('?/updateSection', { method: 'POST', body: fd })
      await invalidateAll()
    } catch {
      uploadError = '저장 실패. 다시 시도해주세요.'
    } finally {
      isAutoSaving = false
    }
  }

  async function uploadFile(file: File): Promise<string | null> {
    isUploading = true
    uploadError = null
    try {
      // 1. 클라이언트 리사이즈: thumb(400×300) + large(1200×900) WebP 동시 생성
      const { thumb, large } = await resizeProductImage(file)

      // 2. 서버 업로드 (Supabase Storage)
      const fd = new FormData()
      fd.append('product_id', product.id)
      fd.append('thumb', new File([thumb], 'thumb.webp', { type: 'image/webp' }))
      fd.append('large', new File([large], 'large.webp', { type: 'image/webp' }))

      const res = await fetch('/api/cms/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        uploadError = (err as { message?: string }).message ?? '업로드 실패'
        return null
      }
      // largeUrl을 image_urls에 저장 → thumbUrl()에서 /large_ → /thumb_ 치환으로 도출
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
    const arr = Array.from(files)
    let added = false
    for (const file of arr) {
      if (localImages.filter(Boolean).length >= 8) break
      const url = await uploadFile(file)
      if (url) {
        localImages = [...localImages.filter(Boolean), url]
        added = true
      }
    }
    if (added) await autoSave()
  }

  function handleDragEnter(e: DragEvent) {
    e.preventDefault()
    dragCounter++
    isDragging = true
  }

  function handleDragLeave() {
    dragCounter--
    if (dragCounter <= 0) { dragCounter = 0; isDragging = false }
  }

  function handleDragOver(e: DragEvent) { e.preventDefault() }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    dragCounter = 0
    isDragging = false
    const files = e.dataTransfer?.files
    if (files?.length) handleFilesUpload(files)
  }

  function triggerFileInput(e: MouseEvent) {
    // URL 추가 버튼 클릭 시 파일 피커 미실행
    if ((e.target as HTMLElement).closest('.dz-url-btn')) return
    fileInputEl?.click()
  }

  function handleFileSelect(e: Event) {
    const files = (e.target as HTMLInputElement).files
    if (files?.length) handleFilesUpload(files)
    // input 초기화 (같은 파일 재선택 허용)
    ;(e.target as HTMLInputElement).value = ''
  }

  function toggleUrlInput(e: MouseEvent) {
    e.stopPropagation()
    showUrlInput = !showUrlInput
    urlInputVal = ''
  }

  async function addByUrl() {
    const url = urlInputVal.trim()
    if (!url) return
    if (localImages.filter(Boolean).length >= 8) return
    localImages = [...localImages.filter(Boolean), url]
    urlInputVal = ''
    showUrlInput = false
    await autoSave()
  }

  async function removeImageAndSave(i: number) {
    const removedUrl = localImages[i]
    localImages = localImages.filter((_, idx) => idx !== i)
    await autoSave()
    // Supabase Storage 오브젝트 정리 (외부 URL은 서버에서 무시)
    if (removedUrl) {
      fetch('/api/cms/upload', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ largeUrl: removedUrl }),
      }).catch(() => { /* 정리 실패는 비침묵 — UI에는 영향 없음 */ })
    }
  }

  function openLightbox(url: string) { lightboxUrl = url }
  function closeLightbox() { lightboxUrl = null }

  // 대표이미지: image_urls[0] = 대표 (2초 홀드로 설정)
  function startHold(url: string) {
    holdTimer = setTimeout(async () => {
      holdTimer = null
      const filtered = localImages.filter(Boolean)
      const idx = filtered.indexOf(url)
      if (idx <= 0) return  // 이미 대표이거나 없음
      const reordered = [url, ...filtered.filter((u) => u !== url)]
      localImages = reordered
      await autoSave()
    }, 2000)
  }

  function cancelHold() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
  }

  // ─── 이력 탭 상태 ────────────────────────────────────────

  interface HistoryImage {
    url: string
    thumb_url: string
    comment: string
    display_order: number
  }

  interface HistoryRecord {
    id: string
    product_id: string
    recorded_date: string
    images: HistoryImage[]
    created_by: string
    updated_by: string | null
    created_by_email: string | null
    updated_by_email: string | null
    created_at: string
    updated_at: string
  }

  // 편집 중인 이력 레코드 (null = 신규 등록 폼 닫힘)
  interface EditingRecord {
    id: string | null        // null = 신규
    recorded_date: string
    images: HistoryImage[]
  }

  let historyRecords = $state<HistoryRecord[]>([])
  let historyLoading = $state(false)
  let historyLoaded = $state(false)
  let historyEditingId = $state<string | null | 'new'>(null)  // null=닫힘, 'new'=신규, ID=수정
  let editingRecord = $state<EditingRecord | null>(null)
  let historyUploading = $state(false)
  let historyUploadError = $state<string | null>(null)
  let historyFileInputEl = $state<HTMLInputElement | null>(null)
  let historyDragIndex = $state<number | null>(null)
  let historyDragoverIndex = $state<number | null>(null)
  let historyConfirmDeleteId = $state<string | null>(null)
  let historyIsSaving = $state(false)

  function todayDate(): string {
    return new Date().toISOString().slice(0, 10)
  }

  async function loadHistory() {
    if (historyLoading) return
    historyLoading = true
    historyUploadError = null
    try {
      const res = await fetch(`/api/cms/product-history?product_id=${product.id}`)
      if (!res.ok) throw new Error('이력 로드 실패')
      const json = await res.json() as { records: HistoryRecord[] }
      historyRecords = json.records
      historyLoaded = true
    } catch (e) {
      historyUploadError = e instanceof Error ? e.message : '이력 로드 실패'
    } finally {
      historyLoading = false
    }
  }

  function openNewHistory() {
    editingRecord = { id: null, recorded_date: todayDate(), images: [] }
    historyEditingId = 'new'
  }

  function openEditHistory(rec: HistoryRecord) {
    editingRecord = {
      id: rec.id,
      recorded_date: rec.recorded_date,
      images: rec.images.map(img => ({ ...img })),
    }
    historyEditingId = rec.id
  }

  function closeHistoryEditor() {
    historyEditingId = null
    editingRecord = null
    historyUploadError = null
  }

  async function uploadHistoryFile(file: File): Promise<{ url: string; thumb_url: string } | null> {
    historyUploading = true
    historyUploadError = null
    try {
      const { thumb, large } = await resizeProductImage(file)
      const fd = new FormData()
      fd.append('product_id', product.id + '/history')
      fd.append('thumb', new File([thumb], 'thumb.webp', { type: 'image/webp' }))
      fd.append('large', new File([large], 'large.webp', { type: 'image/webp' }))
      const res = await fetch('/api/cms/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        historyUploadError = (err as { message?: string }).message ?? '업로드 실패'
        return null
      }
      const data = await res.json() as { largeUrl: string; thumbUrl: string }
      return { url: data.largeUrl, thumb_url: data.thumbUrl }
    } catch (e) {
      historyUploadError = e instanceof Error ? e.message : '업로드 실패'
      return null
    } finally {
      historyUploading = false
    }
  }

  async function handleHistoryFileSelect(e: Event) {
    const files = (e.target as HTMLInputElement).files
    if (!files?.length || !editingRecord) return
    ;(e.target as HTMLInputElement).value = ''
    const arr = Array.from(files)
    for (const file of arr) {
      if (editingRecord.images.length >= 20) break
      const result = await uploadHistoryFile(file)
      if (result) {
        const newImg: HistoryImage = {
          url: result.url,
          thumb_url: result.thumb_url,
          comment: '',
          display_order: editingRecord.images.length,
        }
        editingRecord = { ...editingRecord, images: [...editingRecord.images, newImg] }
      }
    }
  }

  function removeHistoryImage(idx: number) {
    if (!editingRecord) return
    editingRecord = {
      ...editingRecord,
      images: editingRecord.images.filter((_, i) => i !== idx)
        .map((img, i) => ({ ...img, display_order: i })),
    }
  }

  function updateHistoryImageComment(idx: number, val: string) {
    if (!editingRecord) return
    editingRecord = {
      ...editingRecord,
      images: editingRecord.images.map((img, i) =>
        i === idx ? { ...img, comment: val.slice(0, 50) } : img
      ),
    }
  }

  // 드래그 정렬
  function historyDragStart(idx: number) { historyDragIndex = idx }
  function historyDragOver(e: DragEvent, idx: number) {
    e.preventDefault()
    historyDragoverIndex = idx
  }
  function historyDragEnd() {
    if (historyDragIndex === null || historyDragoverIndex === null || !editingRecord) {
      historyDragIndex = null; historyDragoverIndex = null; return
    }
    if (historyDragIndex === historyDragoverIndex) {
      historyDragIndex = null; historyDragoverIndex = null; return
    }
    const imgs = [...editingRecord.images]
    const [moved] = imgs.splice(historyDragIndex, 1)
    imgs.splice(historyDragoverIndex, 0, moved)
    editingRecord = {
      ...editingRecord,
      images: imgs.map((img, i) => ({ ...img, display_order: i })),
    }
    historyDragIndex = null
    historyDragoverIndex = null
  }

  async function saveHistoryRecord() {
    if (!editingRecord) return
    historyIsSaving = true
    historyUploadError = null
    try {
      const isNew = editingRecord.id === null
      const method = isNew ? 'POST' : 'PUT'
      const body = isNew
        ? { product_id: product.id, recorded_date: editingRecord.recorded_date, images: editingRecord.images }
        : { id: editingRecord.id, recorded_date: editingRecord.recorded_date, images: editingRecord.images }
      const res = await fetch('/api/cms/product-history', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        historyUploadError = (err as { message?: string }).message ?? '저장 실패'
        return
      }
      csToast.success('이력이 저장됐습니다.')
      closeHistoryEditor()
      await loadHistory()
    } catch (e) {
      historyUploadError = e instanceof Error ? e.message : '저장 실패'
    } finally {
      historyIsSaving = false
    }
  }

  async function deleteHistoryRecord(id: string) {
    try {
      const res = await fetch(`/api/cms/product-history?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('삭제 실패')
      csToast.success('이력이 삭제됐습니다.')
      historyConfirmDeleteId = null
      historyRecords = historyRecords.filter(r => r.id !== id)
    } catch (e) {
      csToast.error(e instanceof Error ? e.message : '삭제 실패')
    }
  }

  // ─── 사양 관리 ────────────────────────────────────────────

  function addSpec() { localSpecs = [...localSpecs, { key: '', value: '' }] }
  function removeSpec(i: number) { localSpecs = localSpecs.filter((_, idx) => idx !== i) }
  function updateSpecKey(i: number, val: string) {
    localSpecs = localSpecs.map((s, idx) => idx === i ? { ...s, key: val } : s)
  }
  function updateSpecVal(i: number, val: string) {
    localSpecs = localSpecs.map((s, idx) => idx === i ? { ...s, value: val } : s)
  }

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'basic', label: '기본정보' },
    { key: 'pricing', label: '가격정책' },
    { key: 'images', label: '이미지' },
    { key: 'specs', label: '사양' },
    { key: 'history', label: '이력' },
  ]

  // ─── 상품 삭제 ───────────────────────────────────────────────
  let showDeleteConfirm = $state(false)
  let isDeleting = $state(false)

  // ─── 상품 복제 (빠른 재고 등록) ───────────────────────────────
  let showCloneModal = $state(false)
  let cloneMode = $state<'new_product' | 'add_inventory'>('new_product')
  let cloneCount = $state(1)
  let cloneAutoCode = $state(true)
  let clonePartnerCode = $state(false)
  let clonePartnerType = $state<'제휴' | '외부' | '외주'>('제휴')
  let isCloning = $state(false)

  function openCloneModal() {
    cloneMode = 'new_product'
    cloneCount = 1
    cloneAutoCode = true
    clonePartnerCode = false
    clonePartnerType = '제휴'
    showCloneModal = true
  }

  function closeCloneModal() {
    if (!isCloning) showCloneModal = false
  }

  function handleCloneProduct() {
    isCloning = true
    return async ({ result }: { result: ActionResult }) => {
      isCloning = false
      if (result.type === 'success') {
        const cloned = (result.data as { cloned?: number } | undefined)?.cloned ?? 0
        showCloneModal = false
        await invalidateAll()
        csToast.success(`재고 ${cloned}개가 등록됐습니다.`)
      } else if (result.type === 'failure') {
        const msg = (result.data as { error?: string } | undefined)?.error ?? '복제 등록에 실패했습니다.'
        csToast.error(msg)
      } else {
        await applyAction(result)
      }
    }
  }

  function handleDeleteProduct() {
    isDeleting = true
    return async ({ result }: { result: ActionResult }) => {
      isDeleting = false
      showDeleteConfirm = false
      if (result.type === 'success') {
        csToast.success('상품이 삭제됐습니다.')
        onclose()
      } else {
        csToast.error('삭제에 실패했습니다.')
      }
    }
  }
</script>

{#if inventoryList && inventoryList.length > 1}
  <div class="inv-list-wrap">
    {#each inventoryList as unit (unit.id)}
      <div
        class="inv-row"
        role="button"
        tabindex="0"
        onclick={() => {}}
        onkeydown={() => {}}
      >
        <span class="inv-tag">품번</span>
        <span class="inv-code">{unit.product_code ?? '—'}</span>
        <span class="inv-name">{unit.name}</span>
        <div class="inv-prices">
          {#each unit.price_rules as rule (rule.duration_type)}
            <span class="inv-pill">
              {rule.duration_type === '12h' ? '12H' : rule.duration_type === '24h' ? 'Day' : '월'}
              {rule.price.toLocaleString()}
            </span>
          {/each}
        </div>
        <span class="inv-status" class:inv-status--on={unit.is_active}>
          {unit.is_active ? '노출' : '미노출'}
        </span>
      </div>
    {/each}
  </div>
{/if}

<div class="panel-wrap">
<div class="detail-panel">

  <!-- 패널 헤더 -->
  <div class="panel-header">
    <!-- 상품코드(품번) 행 — 최상위 + 닫기 버튼 우측 정렬 -->
    <div class="ph-code-row">
      <span class="ph-code-label">품번</span>
      {#if product.product_code}
        <span class="ph-code-val">{product.product_code}</span>
      {:else}
        <span class="ph-code-pending">미발행</span>
      {/if}
      <button class="close-btn" onclick={onclose} aria-label="패널 닫기" type="button">✕</button>
    </div>

    <!-- 상품명 + 카피 | QR -->
    <div class="ph-body">
      <div class="ph-left">
        <span class="ph-cat">{categoryLabel}</span>
        <h2 class="ph-name">{product.name}</h2>
        {#if product.product_caption}
          <p class="ph-caption">{product.product_caption}</p>
        {/if}
      </div>
      <div class="ph-right">
        <div class="qr-wrap">
          {#if product.qr_payload}
            <canvas bind:this={canvasEl} width="88" height="88" aria-label="상품 QR 코드"></canvas>
            <button class="qr-dl-btn" onclick={downloadQR} title="QR PNG 다운로드" type="button">↓ QR 저장</button>
          {:else}
            <div class="qr-placeholder" aria-label="QR 코드 준비 중">QR</div>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <!-- 상태 요약 바 -->
  <div class="status-bar">
    <div class="status-bar-left">
      <span class="sb-item"><span class="sb-label">재고</span><span class="sb-value">{product.assetCount}개</span></span>
      <span class="sb-divider">|</span>
      <span class="sb-item"><span class="sb-label">12시간</span><span class="sb-value">{formatPrice(product.price12h)}</span></span>
      <span class="sb-divider">|</span>
      <span class="sb-item"><span class="sb-label">1일</span><span class="sb-value">{formatPrice(product.price24h)}</span></span>
      <span class="sb-divider">|</span>
      <span class="sb-item"><span class="sb-label">등록일</span><span class="sb-value">{formatDate(product.created_at)}</span></span>
      <span class="sb-divider">|</span>
      <span class="status-badge" class:active={product.is_active}>
        {product.is_active ? '노출(ON)' : '미노출(OFF)'}
      </span>
    </div>
    <button type="button" class="status-cta-btn" onclick={openCloneModal}>빠른 재고 등록</button>
  </div>

  <!-- 탭 네비게이션 -->
  <div class="tab-nav" role="tablist">
    {#each TABS as tab}
      <button
        role="tab"
        aria-selected={activeTab === tab.key}
        class="tab-btn"
        class:active={activeTab === tab.key}
        onclick={() => switchTab(tab.key)}
        type="button"
      >{tab.label}</button>
    {/each}
  </div>

  <!-- 탭 콘텐츠 -->
  <div class="tab-content">

    <!-- ① 기본정보 -->
    {#if activeTab === 'basic'}
      <div class="section" role="tabpanel">
        <div class="section-header">
          <span class="section-title">기본정보</span>
          <button
            form="form-basic"
            type="submit"
            class="btn-save-inline"
            class:dirty={isDirtyBasic}
            disabled={!isDirtyBasic || isSaving}
          >{isSaving ? '저장 중...' : '저장'}</button>
        </div>
        <form id="form-basic" method="POST" action="?/updateSection" use:enhance={handleSectionSave} class="inline-form">
          <input type="hidden" name="product_id" value={product.id} />
          <input type="hidden" name="section_type" value="basic" />
          <input type="hidden" name="is_active" value={String(localBasic.is_active)} />
          <input type="hidden" name="category" value={localBasic.category} />
          <div class="inline-row">
            <span class="vr-label">카테고리</span>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div class="cat-picker-wrap" role="presentation" bind:this={catPickerRef}>
              <button type="button" class="cat-current" onclick={toggleCategoryPicker}>
                <span class="cat-current-label">{CATEGORY_LABEL[localBasic.category] ?? localBasic.category}</span>
                <span class="cat-caret" class:open={showCategoryPicker}>▾</span>
              </button>
            </div>
          </div>
          <div class="inline-row">
            <label class="vr-label" for="ib-name">상품명 <span class="required">*</span></label>
            <input id="ib-name" class="il-input" type="text" name="name"
              bind:value={localBasic.name} required />
          </div>
          <div class="inline-row">
            <label class="vr-label" for="ib-brand">브랜드</label>
            <input id="ib-brand" class="il-input" type="text" name="brand"
              bind:value={localBasic.brand} />
          </div>
          <div class="inline-row">
            <label class="vr-label" for="ib-caption">상품 카피</label>
            <div class="caption-wrap">
              <input id="ib-caption" class="il-input" type="text" name="caption"
                maxlength="20"
                placeholder="20자 이내 (한·영·숫자)"
                bind:value={localBasic.caption} />
              <span class="caption-counter" class:over={localBasic.caption.length >= 20}>{localBasic.caption.length}/20</span>
            </div>
          </div>
          <div class="inline-row">
            <span class="vr-label">슬러그</span>
            <span class="vr-value vr-mono">{product.slug}</span>
          </div>
          <div class="inline-row inline-row-top">
            <label class="vr-label" for="ib-desc">설명</label>
            <textarea id="ib-desc" class="il-input il-textarea" name="description" rows="3"
              bind:value={localBasic.description}></textarea>
          </div>
          <div class="inline-row">
            <span class="vr-label">노출 상태</span>
            <div class="toggle-group">
              <label class="radio-label">
                <input type="radio" name="_is_active_radio" value="true"
                  checked={localBasic.is_active}
                  onchange={() => { localBasic.is_active = true }} /><span>노출(ON)</span>
              </label>
              <label class="radio-label">
                <input type="radio" name="_is_active_radio" value="false"
                  checked={!localBasic.is_active}
                  onchange={() => { localBasic.is_active = false }} /><span>미노출(OFF)</span>
              </label>
            </div>
          </div>
        </form>

        <!-- 장치 정보 (읽기 전용) -->
        {#if product.assets && product.assets.length > 0}
          <div class="device-info-section">
            <div class="device-card-list">
              {#each product.assets as asset (asset.id)}
                <div class="device-card">
                  <div class="device-card-thumb">
                    {#if asset.label_image_url}
                      <img src={asset.label_image_url} alt="장치 라벨 스캔" class="device-thumb-img" />
                    {:else}
                      <div class="device-thumb-placeholder">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
                        </svg>
                      </div>
                    {/if}
                  </div>
                  <div class="device-card-info">
                    <div class="device-card-row">
                      <span class="device-label">자산코드</span>
                      <span class="device-value mono">{asset.asset_code ?? '—'}</span>
                    </div>
                    <div class="device-card-row">
                      <span class="device-label">시리얼번호</span>
                      <span class="device-value mono">{asset.serial_number ?? '—'}</span>
                    </div>
                    {#if asset.ocr_raw_text}
                      <div class="device-card-row">
                        <span class="device-label">OCR 스캔</span>
                        <span class="device-value ocr-text">{asset.ocr_raw_text}</span>
                      </div>
                    {/if}
                    <div class="device-card-row">
                      <span class="device-label">보관위치</span>
                      <span class="device-value">{asset.warehouse_location ?? '—'}</span>
                    </div>
                    {#if asset.condition_notes}
                      <div class="device-card-row">
                        <span class="device-label">비고</span>
                        <span class="device-value">{asset.condition_notes}</span>
                      </div>
                    {/if}
                  </div>
                  <div class="device-card-status">
                    <span class="device-status-badge"
                      class:badge-active={asset.status === 'available'}
                      class:badge-inactive={asset.status !== 'available' && asset.status !== 'rented'}
                      class:badge-rented={asset.status === 'rented'}
                    >{asset.status === 'available' ? '대여가능' : asset.status === 'rented' ? '대여중' : asset.status}</span>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {:else if product.assets}
          <div class="device-info-section">
            <p class="no-device-msg">장치 정보</p>
          </div>
        {/if}

      </div>
    {/if}

    <!-- ② 가격정책 -->
    {#if activeTab === 'pricing'}
      <div class="section" role="tabpanel">
        <div class="section-header">
          <span class="section-title">가격정책</span>
          <button
            form="form-pricing"
            type="submit"
            class="btn-save-inline"
            class:dirty={isDirtyPricing}
            disabled={!isDirtyPricing || isSaving}
          >{isSaving ? '저장 중...' : '저장'}</button>
        </div>
        <form id="form-pricing" method="POST" action="?/updateSection" use:enhance={handleSectionSave} class="inline-form">
          <input type="hidden" name="product_id" value={product.id} />
          <input type="hidden" name="section_type" value="pricing" />
          <!-- 서버 제출용 raw 숫자 (콤마 제거) -->
          <input type="hidden" name="price_12h"            value={localPricing.price_12h.replace(/,/g, '')} />
          <input type="hidden" name="price_24h"            value={localPricing.price_24h.replace(/,/g, '')} />
          <input type="hidden" name="price_monthly"        value={localPricing.price_monthly.replace(/,/g, '')} />
          <input type="hidden" name="deposit_amount"       value={localPricing.deposit_amount.replace(/,/g, '')} />
          <input type="hidden" name="late_fee_per_hour"    value={localPricing.late_fee_per_hour.replace(/,/g, '')} />
          <input type="hidden" name="damage_fee_percentage" value={localPricing.damage_fee_percentage} />
          <input type="hidden" name="sale_price"           value={localPricing.sale_price.replace(/,/g, '')} />
          <input type="hidden" name="sale_only"            value={String(localSaleOnly)} />
          <!-- 대여 요금 항목 (sale_only 체크 시 비활성) -->
          <div class="inline-row" class:row-disabled={localSaleOnly}>
            <label class="vr-label" for="ip-12h">12시간 요금</label>
            <input id="ip-12h" class="il-input il-number" type="text" inputmode="numeric" placeholder="0"
              disabled={localSaleOnly}
              value={localPricing.price_12h}
              oninput={(e) => handlePriceInput('price_12h', e.currentTarget.value)} />
          </div>
          <div class="inline-row" class:row-disabled={localSaleOnly}>
            <label class="vr-label" for="ip-24h">24시간(1일) <span class="required">*</span></label>
            <input id="ip-24h" class="il-input il-number" type="text" inputmode="numeric" placeholder="0"
              disabled={localSaleOnly}
              value={localPricing.price_24h}
              oninput={(e) => handlePriceInput('price_24h', e.currentTarget.value)} />
          </div>
          <div class="inline-row" class:row-disabled={localSaleOnly}>
            <label class="vr-label" for="ip-mo">월간 요금</label>
            <input id="ip-mo" class="il-input il-number" type="text" inputmode="numeric" placeholder="0"
              disabled={localSaleOnly}
              value={localPricing.price_monthly}
              oninput={(e) => handlePriceInput('price_monthly', e.currentTarget.value)} />
          </div>
          <!-- 판매금액 + 판매만 가능 체크박스 (월간요금 다음) -->
          <div class="inline-row">
            <label class="vr-label" for="ip-sale">판매금액</label>
            <input id="ip-sale" class="il-input il-number" type="text" inputmode="numeric" placeholder="0"
              value={localPricing.sale_price}
              oninput={(e) => handlePriceInput('sale_price', e.currentTarget.value)} />
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="sale-only-label">
              <input
                type="checkbox"
                class="sale-only-cb"
                checked={localSaleOnly}
                onchange={(e) => {
                  localSaleOnly = e.currentTarget.checked
                  if (e.currentTarget.checked) csToast.warning('판매금액만 표시되고 대여 불가능합니다.')
                }}
              />
              <span>판매만 가능</span>
            </label>
          </div>
          <div class="inline-row" class:row-disabled={localSaleOnly}>
            <label class="vr-label" for="ip-dep">보증금</label>
            <input id="ip-dep" class="il-input il-number" type="text" inputmode="numeric" placeholder="0"
              disabled={localSaleOnly}
              value={localPricing.deposit_amount}
              oninput={(e) => handlePriceInput('deposit_amount', e.currentTarget.value)} />
          </div>
          <div class="inline-row" class:row-disabled={localSaleOnly}>
            <label class="vr-label" for="ip-late">연체료/시간</label>
            <input id="ip-late" class="il-input il-number" type="text" inputmode="numeric" placeholder="0"
              disabled={localSaleOnly}
              value={localPricing.late_fee_per_hour}
              oninput={(e) => handlePriceInput('late_fee_per_hour', e.currentTarget.value)} />
          </div>
          <div class="inline-row" class:row-disabled={localSaleOnly}>
            <label class="vr-label" for="ip-dmg">손상배상 (%)</label>
            <input id="ip-dmg" class="il-input il-number" type="number" name="_unused_dmg"
              min="0" max="100" step="1" placeholder="0"
              disabled={localSaleOnly}
              bind:value={localPricing.damage_fee_percentage} />
          </div>
        </form>
      </div>
    {/if}

    <!-- ③ 이미지 — 통합 모드 (보기+수정 결합, 자동저장) -->
    {#if activeTab === 'images'}
      <div class="section img-section" role="tabpanel">

        <!-- 섹션 헤더 (수정 버튼 없음) -->
        <div class="section-header">
          <span class="section-title">이미지 ({localImages.filter(Boolean).length}장)</span>
          <div class="img-header-status">
            {#if isUploading}
              <span class="img-status uploading">업로드 중...</span>
            {:else if isAutoSaving}
              <span class="img-status saving">저장 중...</span>
            {:else if uploadError}
              <span class="img-status error">{uploadError}</span>
            {/if}
          </div>
        </div>

        <!-- 드롭존 (클릭: 파일 피커 / 드래그: 파일 업로드) -->
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

        <!-- URL 입력 (접이식) -->
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

        <!-- 이미지 카드 그리드 -->
        {#if localImages.filter(Boolean).length > 0}
          <div class="img-card-grid">
            {#each localImages.filter(Boolean) as url, i}
              <div class="img-card" class:primary={i === 0} role="group" aria-label={`이미지 ${i + 1}${i === 0 ? ' (대표)' : ''}`}>
                <button
                  type="button"
                  class="img-card-view"
                  onclick={() => openLightbox(url)}
                  onmousedown={() => startHold(url)}
                  onmouseup={cancelHold}
                  onmouseleave={cancelHold}
                  aria-label={`이미지 ${i + 1} 확대 보기`}
                >
                  <img
                    src={thumbUrl(url)}
                    alt={`이미지 ${i + 1}`}
                    class="img-card-thumb"
                    loading="lazy"
                  />
                  <span class="img-card-overlay">🔍 확대</span>
                </button>
                <button
                  type="button"
                  class="img-card-remove"
                  onclick={() => removeImageAndSave(i)}
                  aria-label={`이미지 ${i + 1} 제거`}
                  title="이미지 제거"
                >✕</button>
              </div>
            {/each}
          </div>
        {:else}
          <p class="empty-hint">이미지를 드래그하거나 URL을 추가하세요.</p>
        {/if}

      </div>
    {/if}

    <!-- ④ 사양 -->
    {#if activeTab === 'specs'}
      <div class="section" role="tabpanel">
        <div class="section-header">
          <span class="section-title">상품 사양</span>
          <button
            form="form-specs"
            type="submit"
            class="btn-save-inline"
            class:dirty={isDirtySpecs}
            disabled={!isDirtySpecs || isSaving}
          >{isSaving ? '저장 중...' : '저장'}</button>
        </div>
        <form id="form-specs" method="POST" action="?/updateSection" use:enhance={handleSectionSave} class="inline-form">
          <input type="hidden" name="product_id" value={product.id} />
          <input type="hidden" name="section_type" value="specs" />
          <input type="hidden" name="specifications"
            value={JSON.stringify(Object.fromEntries(localSpecs.filter(s => s.key).map(s => [s.key, s.value])))} />
          <div class="specs-list">
            {#each localSpecs as spec, i}
              <div class="spec-row">
                <input class="il-input spec-key" type="text" placeholder="항목명" value={spec.key}
                  oninput={(e) => updateSpecKey(i, (e.target as HTMLInputElement).value)} />
                <input class="il-input spec-val" type="text" placeholder="값" value={spec.value}
                  oninput={(e) => updateSpecVal(i, (e.target as HTMLInputElement).value)} />
                <button type="button" class="btn-icon-close" onclick={() => removeSpec(i)} aria-label="항목 제거">✕</button>
              </div>
            {/each}
            <button type="button" class="btn-add-dashed" onclick={addSpec}>+ 항목 추가</button>
          </div>
        </form>
      </div>
    {/if}

    <!-- ⑤ 이력 -->
    {#if activeTab === 'history'}
      <div class="section" role="tabpanel">
        <div class="section-header">
          <span class="section-title">상품 이력</span>
          <button type="button" class="btn-primary-sm" onclick={openNewHistory}
            disabled={historyEditingId === 'new'}>
            + 이력 등록
          </button>
        </div>

        {#if historyLoading}
          <div class="history-empty">이력을 불러오는 중...</div>
        {:else if historyUploadError && !editingRecord}
          <div class="error-bar" role="alert">{historyUploadError}</div>
        {:else}

          <!-- 신규 등록 폼 -->
          {#if historyEditingId === 'new' && editingRecord}
            <div class="history-editor-card">
              <div class="history-editor-header">
                <span class="history-editor-title">새 이력 등록</span>
                <div class="history-editor-date-wrap">
                  <label class="vr-label" for="new-hist-date">날짜</label>
                  <input
                    id="new-hist-date"
                    type="date"
                    class="inline-input"
                    bind:value={editingRecord.recorded_date}
                  />
                </div>
              </div>

              <!-- 이미지 그리드 -->
              <div class="history-img-grid">
                {#each editingRecord.images as img, idx}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="history-img-item"
                    class:drag-over={historyDragoverIndex === idx}
                    draggable="true"
                    ondragstart={() => historyDragStart(idx)}
                    ondragover={(e) => historyDragOver(e, idx)}
                    ondragend={historyDragEnd}
                  >
                    <div class="history-img-thumb-wrap">
                      <img src={img.thumb_url || img.url} alt="이력 이미지 {idx + 1}" class="history-img-thumb" />
                      <button type="button" class="history-img-remove" onclick={() => removeHistoryImage(idx)} aria-label="이미지 제거">✕</button>
                    </div>
                    <input
                      type="text"
                      class="inline-input history-comment"
                      placeholder="코멘트 (50자)"
                      maxlength="50"
                      value={img.comment}
                      oninput={(e) => updateHistoryImageComment(idx, (e.target as HTMLInputElement).value)}
                    />
                  </div>
                {/each}

                {#if editingRecord.images.length < 20}
                  <button
                    type="button"
                    class="history-img-add-btn"
                    onclick={() => historyFileInputEl?.click()}
                    disabled={historyUploading}
                    aria-label="이미지 추가"
                  >
                    {#if historyUploading}
                      <span class="uploading-dot"></span>
                    {:else}
                      <span class="add-icon">+</span>
                      <span class="add-label">이미지 추가</span>
                    {/if}
                  </button>
                {/if}
              </div>

              <input
                bind:this={historyFileInputEl}
                type="file"
                accept="image/webp,image/jpeg,image/png"
                multiple
                style="display:none"
                onchange={handleHistoryFileSelect}
              />

              {#if historyUploadError}
                <div class="error-bar" role="alert">{historyUploadError}</div>
              {/if}

              <div class="history-editor-actions">
                <button type="button" class="btn-ghost-sm" onclick={closeHistoryEditor}>취소</button>
                <button
                  type="button"
                  class="btn-primary-sm"
                  onclick={saveHistoryRecord}
                  disabled={historyIsSaving || editingRecord.images.length === 0}
                >
                  {historyIsSaving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          {/if}

          <!-- 이력 카드 목록 -->
          {#if historyRecords.length === 0 && !historyLoading}
            <div class="history-empty">등록된 이력이 없습니다.</div>
          {:else}
            {#each historyRecords as rec}
              <div class="history-card" class:editing={historyEditingId === rec.id}>
                <div class="history-card-header">
                  <div class="history-card-meta">
                    <span class="history-card-date">{rec.recorded_date}</span>
                    <span class="history-card-by">{rec.created_by_email ?? ''}</span>
                  </div>
                  <div class="history-card-actions">
                    {#if historyEditingId !== rec.id}
                      <button type="button" class="btn-ghost-sm" onclick={() => openEditHistory(rec)}>수정</button>
                      <button type="button" class="btn-danger-sm" onclick={() => { historyConfirmDeleteId = rec.id }}>삭제</button>
                    {/if}
                  </div>
                </div>

                {#if historyEditingId === rec.id && editingRecord}
                  <!-- 수정 폼 인라인 -->
                  <div class="history-editor-date-wrap" style="margin: 8px 0;">
                    <label class="vr-label" for="edit-hist-date-{rec.id}">날짜</label>
                    <input
                      id="edit-hist-date-{rec.id}"
                      type="date"
                      class="inline-input"
                      bind:value={editingRecord.recorded_date}
                    />
                  </div>

                  <div class="history-img-grid">
                    {#each editingRecord.images as img, idx}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <div
                        class="history-img-item"
                        class:drag-over={historyDragoverIndex === idx}
                        draggable="true"
                        ondragstart={() => historyDragStart(idx)}
                        ondragover={(e) => historyDragOver(e, idx)}
                        ondragend={historyDragEnd}
                      >
                        <div class="history-img-thumb-wrap">
                          <img src={img.thumb_url || img.url} alt="이력 이미지 {idx + 1}" class="history-img-thumb" />
                          <button type="button" class="history-img-remove" onclick={() => removeHistoryImage(idx)} aria-label="이미지 제거">✕</button>
                        </div>
                        <input
                          type="text"
                          class="inline-input history-comment"
                          placeholder="코멘트 (50자)"
                          maxlength="50"
                          value={img.comment}
                          oninput={(e) => updateHistoryImageComment(idx, (e.target as HTMLInputElement).value)}
                        />
                      </div>
                    {/each}

                    {#if editingRecord.images.length < 20}
                      <button
                        type="button"
                        class="history-img-add-btn"
                        onclick={() => historyFileInputEl?.click()}
                        disabled={historyUploading}
                        aria-label="이미지 추가"
                      >
                        {#if historyUploading}
                          <span class="uploading-dot"></span>
                        {:else}
                          <span class="add-icon">+</span>
                          <span class="add-label">이미지 추가</span>
                        {/if}
                      </button>
                    {/if}
                  </div>

                  <input
                    bind:this={historyFileInputEl}
                    type="file"
                    accept="image/webp,image/jpeg,image/png"
                    multiple
                    style="display:none"
                    onchange={handleHistoryFileSelect}
                  />

                  {#if historyUploadError}
                    <div class="error-bar" role="alert">{historyUploadError}</div>
                  {/if}

                  <div class="history-editor-actions">
                    <button type="button" class="btn-ghost-sm" onclick={closeHistoryEditor}>취소</button>
                    <button
                      type="button"
                      class="btn-primary-sm"
                      onclick={saveHistoryRecord}
                      disabled={historyIsSaving}
                    >
                      {historyIsSaving ? '저장 중...' : '저장'}
                    </button>
                  </div>

                  {#if rec.updated_by_email}
                    <div class="history-updated-by">최종수정: {rec.updated_by_email}</div>
                  {/if}

                {:else}
                  <!-- 보기 모드 -->
                  <div class="history-img-view-grid">
                    {#each rec.images as img}
                      <div class="history-view-item">
                        <img src={img.thumb_url || img.url} alt="이력 이미지" class="history-img-thumb" />
                        {#if img.comment}
                          <span class="history-view-comment">{img.comment}</span>
                        {/if}
                      </div>
                    {/each}
                  </div>
                  {#if rec.updated_by_email}
                    <div class="history-updated-by">최종수정: {rec.updated_by_email}</div>
                  {/if}
                {/if}
              </div>
            {/each}
          {/if}
        {/if}

      </div>
    {/if}

  </div>

</div>

<!-- 상품 삭제 푸터 (흰 카드 밖, panel-wrap 안) -->
<div class="delete-footer">
  <button
    type="button"
    class="btn-danger"
    onclick={() => { showDeleteConfirm = true }}
  >상품정보 삭제</button>
</div>
</div>

<!-- 상품 복제 모달 -->
{#if showCloneModal}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="clone-modal-backdrop" onclick={closeCloneModal} role="presentation">
    <div
      class="clone-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clone-modal-title"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="clone-modal-header">
        <h3 id="clone-modal-title" class="clone-modal-title">상품정보 복제 자동 등록</h3>
        <button type="button" class="clone-modal-close" onclick={closeCloneModal} aria-label="닫기" disabled={isCloning}>✕</button>
      </div>
      <div class="clone-modal-body">
        <div class="clone-mode-toggle" role="group" aria-label="등록 방식">
          <button
            type="button"
            class="clone-mode-btn"
            class:clone-mode-btn--on={cloneMode === 'new_product'}
            onclick={() => { cloneMode = 'new_product'; cloneAutoCode = true; clonePartnerCode = false }}
            disabled={isCloning}
            aria-pressed={cloneMode === 'new_product'}
          >새 상품으로 복제</button>
          <button
            type="button"
            class="clone-mode-btn"
            class:clone-mode-btn--on={cloneMode === 'add_inventory'}
            onclick={() => { cloneMode = 'add_inventory'; cloneAutoCode = false; clonePartnerCode = false }}
            disabled={isCloning}
            aria-pressed={cloneMode === 'add_inventory'}
          >동일 상품 재고 추가</button>
        </div>
        <p class="clone-modal-desc">
          {#if cloneMode === 'add_inventory'}
            동일 상품의 재고를 추가 등록합니다.<br />
            부모 품번 기반의 고유 품번이 자동 발행됩니다.
          {:else}
            동일 제품으로 재고 일괄 등록합니다.<br />
            현재 상품의 모든 정보(이미지·가격·사양 포함)를 복제합니다.
          {/if}
        </p>
        <div class="clone-source-box">
          {#if product.image_urls && product.image_urls.length > 0}
            <img
              class="clone-source-thumb"
              src={product.image_urls[0]}
              alt={product.name}
            />
          {/if}
          <div class="clone-source-info">
            <span class="clone-source-label">원본 상품</span>
            <span class="clone-source-name">{product.name}</span>
            {#if product.product_code}
              <span class="clone-source-code">{product.product_code}</span>
            {/if}
          </div>
        </div>
        <label class="clone-field">
          <span class="clone-field-label">등록 수량</span>
          <input
            class="f-input clone-count-input"
            type="number"
            min="1"
            max="20"
            bind:value={cloneCount}
            aria-label="등록 수량"
            disabled={isCloning}
          />
        </label>
        {#if cloneMode === 'new_product'}
        <div class="clone-options-row">
          <button
            type="button"
            class="clone-option-toggle"
            class:clone-option-toggle--on={cloneAutoCode}
            onclick={() => { cloneAutoCode = true; clonePartnerCode = false }}
            disabled={isCloning}
            aria-pressed={cloneAutoCode}
          >
            품번(분류코드) 자동 생성
          </button>
          <button
            type="button"
            class="clone-option-toggle"
            class:clone-option-toggle--on={clonePartnerCode}
            onclick={() => { clonePartnerCode = true; cloneAutoCode = false }}
            disabled={isCloning}
            aria-pressed={clonePartnerCode}
          >
            제휴상품 품번 자동 생성
          </button>
        </div>
        {/if}
        {#if cloneMode === 'new_product' && clonePartnerCode}
          <div class="clone-partner-type-row" role="group" aria-label="제휴 유형 선택">
            {#each ['제휴', '외부', '외주'] as type (type)}
              <button
                type="button"
                class="clone-partner-type-btn"
                class:clone-partner-type-btn--on={clonePartnerType === type}
                onclick={() => (clonePartnerType = type as '제휴' | '외부' | '외주')}
                disabled={isCloning}
                aria-pressed={clonePartnerType === type}
              >{type}</button>
            {/each}
          </div>
        {/if}
      </div>
      <div class="clone-modal-actions clone-modal-actions--col">
        <form method="POST" action="?/cloneProduct" use:enhance={handleCloneProduct} style="width:100%">
          <input type="hidden" name="source_product_id" value={product.id} />
          <input type="hidden" name="mode" value={cloneMode} />
          <input type="hidden" name="count" value={cloneCount} />
          <input type="hidden" name="auto_code" value={String(cloneAutoCode)} />
          <input type="hidden" name="partner_code" value={String(clonePartnerCode)} />
          <input type="hidden" name="partner_type" value={clonePartnerType} />
          <button type="submit" class="cta-btn cta-btn--wide" disabled={isCloning || cloneCount < 1}>
            {isCloning ? '등록 중...' : '재고 등록 실행'}
          </button>
        </form>
        <button type="button" class="clone-cancel-link" onclick={closeCloneModal} disabled={isCloning}>취소</button>
      </div>
    </div>
  </div>
{/if}

<!-- 상품 삭제 확인 모달 -->
{#if showDeleteConfirm}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="confirm-backdrop" onclick={() => { if (!isDeleting) showDeleteConfirm = false }} role="presentation">
    <div class="confirm-dialog" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
      <p class="confirm-msg">{product.name}</p>
      <p class="confirm-sub">상품정보를 삭제하면 목록에서 제거됩니다.<br/>이 작업은 되돌릴 수 없습니다.</p>
      <div class="confirm-actions">
        <button type="button" class="btn-ghost-sm" onclick={() => { showDeleteConfirm = false }} disabled={isDeleting}>취소</button>
        <form method="POST" action="?/deleteProduct" use:enhance={handleDeleteProduct}>
          <input type="hidden" name="product_id" value={product.id} />
          <button type="submit" class="btn-danger-sm" disabled={isDeleting}>
            {isDeleting ? '삭제 중...' : '삭제'}
          </button>
        </form>
      </div>
    </div>
  </div>
{/if}

<!-- 이력 삭제 확인 모달 -->
{#if historyConfirmDeleteId}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="confirm-backdrop" onclick={() => { historyConfirmDeleteId = null }} role="presentation">
    <div class="confirm-dialog" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
      <p class="confirm-msg">이력을 삭제할까요?</p>
      <p class="confirm-sub">삭제된 이력은 복구할 수 없습니다.</p>
      <div class="confirm-actions">
        <button type="button" class="btn-ghost-sm" onclick={() => { historyConfirmDeleteId = null }}>취소</button>
        <button type="button" class="btn-danger-sm" onclick={() => { if (historyConfirmDeleteId) deleteHistoryRecord(historyConfirmDeleteId) }}>삭제</button>
      </div>
    </div>
  </div>
{/if}

<!-- 카테고리 픽커 드롭다운 (overflow:hidden 탈출용 fixed 포지션) -->
{#if showCategoryPicker && catPickerRef}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="cat-picker-backdrop" onclick={() => showCategoryPicker = false}></div>
  <div
    class="cat-dropdown-fixed"
    role="listbox"
    style={(() => { const r = catPickerRef!.getBoundingClientRect(); return `top:${r.bottom + 4}px;left:${r.left}px;width:${r.width}px` })()}
  >
    {#each categories as cat}
      <button
        type="button"
        role="option"
        aria-selected={localBasic.category === cat.value}
        class="cat-option"
        class:selected={localBasic.category === cat.value}
        onclick={() => { localBasic.category = cat.value; showCategoryPicker = false }}
      >{cat.label}</button>
    {/each}
  </div>
{/if}

<!-- 라이트박스 모달 -->
{#if lightboxUrl}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="lightbox-backdrop"
    onclick={closeLightbox}
  >
    <button type="button" class="lightbox-close" onclick={closeLightbox} aria-label="닫기">✕</button>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="lightbox-img-wrap" onclick={(e) => e.stopPropagation()}>
      <img src={largeUrl(lightboxUrl)} alt="확대 이미지" class="lightbox-img" />
    </div>
  </div>
{/if}

<style>
  .panel-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .detail-panel {
    display: flex;
    flex-direction: column;
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    overflow: hidden;
  }

  /* 패널 헤더 */
  .panel-header {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 20px 14px;
    border-bottom: 1px solid var(--cs-surface-gray);
    flex-shrink: 0;
  }

  /* 상품코드 행 */
  .ph-code-row {
    display: flex;
    align-items: center;
    gap: 8px;
    position: relative;
  }
  .ph-code-label {
    font: var(--text-pc-descript-10);
    color: var(--cs-text-light);
    flex-shrink: 0;
    min-width: 22px;
  }
  .ph-code-val {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    padding: 2px 6px;
  }
  .ph-code-pending {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-sm);
    padding: 2px 8px;
  }

  /* ph-body: 상품명·카피 + QR */
  .ph-body {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  .ph-left { flex: 1; min-width: 0; }
  .ph-cat {
    display: inline-block;
    padding: 2px 8px;
    background: rgba(59,47,138,0.08);
    color: var(--cs-purple);
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    margin-bottom: 6px;
  }
  .ph-name {
    font: var(--text-pc-title-18);
    color: var(--cs-text);
    margin: 0 0 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ph-caption { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 2px 0 0; font-style: italic; }
  .ph-right { flex-shrink: 0; }

  /* QR */
  .qr-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .qr-wrap canvas { display: block; border-radius: var(--cms-radius-sm); border: 1px solid var(--cs-surface-gray); }
  .qr-dl-btn {
    background: transparent; border: none;
    color: var(--cs-text-light); font: var(--text-pc-script-12);
    cursor: pointer; padding: 2px 6px; border-radius: var(--radius-sm); min-height: 24px;
    transition: color 0.12s, background 0.12s;
  }
  .qr-dl-btn:hover { background: var(--cs-lilac); color: var(--cs-purple); }
  .qr-placeholder {
    width: 88px; height: 88px;
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-sm);
    display: flex; align-items: center; justify-content: center;
    color: var(--cs-text-light); font: var(--text-pc-script-12);
  }
  .close-btn {
    margin-left: auto;
    flex-shrink: 0;
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: var(--radius-sm);
    color: var(--cs-text-light); font-size: 14px; cursor: pointer; min-height: 28px;
    transition: background 0.12s, color 0.12s;
  }
  .close-btn:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

  /* 상태 바 */
  .status-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 15px 20px; background: var(--cs-surface-gray);
    min-height: 75px;
    flex-shrink: 0;
  }
  .status-bar-left {
    display: flex; align-items: center; gap: 10px;
    flex-wrap: wrap; flex: 1; min-width: 0;
  }
  .status-cta-btn {
    display: inline-flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    height: 35px; padding: 0 16px;
    background: var(--cs-purple); color: var(--cs-white);
    border: none; border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    white-space: nowrap; cursor: pointer;
    transition: background 0.12s;
  }
  .status-cta-btn:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .status-cta-btn:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
  .cta-btn {
    display: inline-flex; align-items: center; justify-content: center;
    height: 44px; padding: 0 20px;
    background: var(--cs-purple); color: var(--cs-white);
    border: none; border-radius: var(--radius-xl);
    font: var(--text-pc-body-14);
    white-space: nowrap; cursor: pointer;
    transition: background 0.12s;
  }
  .cta-btn:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .cta-btn:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
  .sb-item { display: flex; align-items: center; gap: 4px; }
  .sb-label { font: var(--text-pc-script-12); color: var(--cs-text-light); }
  .sb-value { font: var(--text-pc-body-14); color: var(--cs-text); }
  .sb-divider { color: var(--cs-border); font-size: 12px; }

  .status-badge {
    display: inline-flex; align-items: center;
    padding: 3px 10px; border-radius: var(--radius-full);
    font: var(--text-pc-script-12);
    background: var(--cs-surface-gray); color: var(--cs-text-light); white-space: nowrap;
  }
  .status-badge.active { background: rgba(59,47,138,0.10); color: var(--cs-purple); }

  /* 탭 */
  .tab-nav {
    display: flex; gap: 2px; padding: 10px 16px 0;
    justify-content: center;
    border-bottom: 1px solid var(--cs-surface-gray);
    flex-shrink: 0; background: var(--cs-white);
  }
  .tab-btn {
    padding: 8px 16px; border: none; border-bottom: 2px solid transparent;
    background: transparent; color: var(--cs-text-mid);
    font: var(--text-pc-body-14); cursor: pointer; min-height: 40px;
    transition: color 0.12s, border-color 0.12s; margin-bottom: -1px;
  }
  .tab-btn:hover { color: var(--cs-text); }
  .tab-btn.active { color: var(--cs-purple); border-bottom-color: var(--cs-purple); font-weight: 700; }

  /* 탭 콘텐츠 */
  .tab-content { padding: 20px 20px 50px; }

  /* 섹션 공통 */
  .section { display: flex; flex-direction: column; gap: 16px; }
  .section-header { display: flex; align-items: center; justify-content: space-between; }
  .section-title { font: var(--text-pc-title-16); color: var(--cs-text); }

  .btn-edit {
    padding: 5px 12px; border: 1.5px solid var(--cs-purple);
    border-radius: var(--radius-sm); background: transparent; color: var(--cs-purple);
    font: var(--text-pc-script-12); cursor: pointer; min-height: 32px; transition: background 0.12s;
  }
  .btn-edit:hover { background: rgba(59,47,138,0.06); }
  .btn-cancel {
    padding: 5px 12px; border: 1.5px solid var(--cs-border);
    border-radius: var(--radius-sm); background: transparent; color: var(--cs-text-mid);
    font: var(--text-pc-script-12); cursor: pointer; min-height: 32px; transition: background 0.12s;
  }
  .btn-cancel:hover { background: var(--cs-surface-gray); }

  /* 폼 */
  .edit-form { display: flex; flex-direction: column; gap: 12px; }
  .field-row { display: flex; flex-direction: column; gap: 6px; }
  .field-row-inline { flex-direction: row; align-items: center; gap: 16px; }
  .f-label { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .required { color: var(--cs-red-badge); }
  .f-input {
    background: var(--cs-surface-gray); border: none;
    border-radius: var(--cms-radius-sm); padding: 9px 14px;
    font: var(--text-pc-body-14); color: var(--cs-text); width: 100%;
  }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
  .f-textarea { resize: vertical; min-height: 80px; }
  .toggle-group { display: flex; gap: 16px; }
  .radio-label {
    display: flex; align-items: center; gap: 6px;
    font: var(--text-pc-body-14); color: var(--cs-text); cursor: pointer;
  }
  .price-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .form-footer { display: flex; justify-content: flex-end; padding-top: 4px; }
  .btn-save {
    padding: 8px 24px; background: var(--cs-purple); color: var(--cs-white);
    border: none; border-radius: var(--radius-sm); font: var(--text-pc-body-14);
    cursor: pointer; min-height: 36px; transition: background 0.12s;
  }
  .btn-save:hover { background: var(--cs-purple-hover); }
  .btn-save:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  /* 인라인 편집 — 저장 버튼 (헤더 우측) */
  .btn-save-inline {
    padding: 5px 14px;
    border: 1.5px solid var(--cs-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-text-light);
    font: var(--text-pc-script-12);
    cursor: not-allowed;
    min-height: 32px;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .btn-save-inline.dirty {
    border-color: var(--cs-purple);
    background: var(--cs-purple);
    color: var(--cs-white);
    cursor: pointer;
  }
  .btn-save-inline.dirty:hover { background: var(--cs-purple-hover); border-color: var(--cs-purple-hover); }

  /* 인라인 편집 폼 */
  .inline-form { display: flex; flex-direction: column; gap: 0; }

  .inline-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 9px 0;
    border-bottom: 1px solid var(--cs-surface-gray);
  }
  .inline-row:last-child { border-bottom: none; }
  .inline-row-top { align-items: flex-start; padding-top: 10px; }
  .row-disabled { opacity: 0.4; pointer-events: none; }

  /* 판매만 가능 체크박스 레이블 */
  .caption-wrap { display: flex; align-items: center; gap: 6px; flex: 1; }
  .caption-counter { font: var(--text-pc-descript-10); color: var(--cs-text-light); white-space: nowrap; flex-shrink: 0; }
  .caption-counter.over { color: var(--cs-red-badge); }

  .sale-only-label {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-left: auto;
    cursor: pointer;
    white-space: nowrap;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    user-select: none;
  }
  .sale-only-cb {
    accent-color: var(--cs-purple);
    width: 14px;
    height: 14px;
    cursor: pointer;
  }

  /* 인라인 입력: 기본 숨김 스타일, 클릭 시 활성화 */
  .il-input {
    flex: 1;
    background: transparent;
    border: none;
    border-radius: var(--cms-radius-sm);
    padding: 3px 8px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    transition: background 0.12s, outline 0.12s;
    min-height: 32px;
  }
  .il-input:hover { background: rgba(59,47,138,0.04); }
  .il-input:focus {
    background: var(--cs-surface-gray);
    outline: 2px solid var(--cs-purple);
    outline-offset: -2px;
  }
  .il-textarea {
    resize: vertical;
    min-height: 72px;
    align-self: stretch;
    padding: 6px 8px;
  }
  .il-number { max-width: 160px; text-align: right; }

  /* 카테고리 picker */
  .cat-picker-wrap { position: relative; flex: 1; }
  .cat-current {
    display: flex; align-items: center; gap: 6px;
    background: transparent; border: none;
    border-radius: var(--cms-radius-sm);
    padding: 3px 8px; cursor: pointer;
    font: var(--text-pc-body-14); color: var(--cs-text);
    min-height: 32px; width: 100%; text-align: left;
    transition: background 0.12s;
  }
  .cat-current:hover { background: rgba(59,47,138,0.04); }
  .cat-current-label { flex: 1; }
  .cat-caret { color: var(--cs-text-light); font-size: 11px; transition: transform 0.15s; }
  .cat-caret.open { transform: rotate(180deg); }
  /* 카테고리 드롭다운 (fixed 포지션 — overflow:hidden 탈출) */
  :global(.cat-picker-backdrop) {
    position: fixed; inset: 0; z-index: 199;
  }
  :global(.cat-dropdown-fixed) {
    position: fixed;
    min-width: 180px;
    max-height: 220px;
    overflow-y: auto;
    background: var(--cs-white);
    border-radius: var(--cms-radius-sm);
    box-shadow: 0 4px 16px rgba(16,11,50,0.12);
    z-index: 200;
    padding: 4px;
  }
  .cat-option {
    display: block; width: 100%;
    padding: 8px 12px;
    text-align: left;
    background: transparent; border: none; border-radius: 6px;
    font: var(--text-pc-body-14); color: var(--cs-text);
    cursor: pointer; transition: background 0.1s;
  }
  .cat-option:hover { background: rgba(59,47,138,0.06); }
  .cat-option.selected { background: rgba(59,47,138,0.10); color: var(--cs-purple); font-weight: 700; }

  /* 사양 */

  /* 뷰 필드 */
  .view-fields { display: flex; flex-direction: column; gap: 0; }
  .view-row {
    display: flex; align-items: flex-start; gap: 16px;
    padding: 10px 0; border-bottom: 1px solid var(--cs-surface-gray);
  }
  .view-row:last-child { border-bottom: none; }
  .vr-label { flex: 0 0 90px; font: var(--text-pc-script-12); color: var(--cs-text-light); padding-top: 1px; }
  .vr-value { flex: 1; font: var(--text-pc-body-14); color: var(--cs-text); word-break: break-word; }
  .vr-highlight { color: var(--cs-purple); font-weight: 700; }
  .vr-mono { font-family: monospace; font-size: 12px; color: var(--cs-text-mid); }
  .vr-desc { white-space: pre-wrap; }

  /* ─── 이미지 탭 전용 ─────────────────────────────── */

  .img-section { gap: 12px; }

  .img-header-status { display: flex; align-items: center; }
  .img-status {
    font: var(--text-pc-script-12);
    padding: 3px 10px;
    border-radius: var(--radius-full);
  }
  .img-status.uploading { background: rgba(59,47,138,0.08); color: var(--cs-purple); }
  .img-status.saving    { background: rgba(59,47,138,0.06); color: var(--cs-text-mid); }
  .img-status.error     { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

  /* 드롭존 */
  .drop-zone {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 48px;
    border: 2px dashed var(--cs-border);
    border-radius: var(--cms-radius-md);
    background: var(--cs-surface-gray);
    cursor: pointer;
    padding: 10px 20px;
    transition: border-color 0.15s, background 0.15s;
    user-select: none;
  }
  .drop-zone:hover,
  .drop-zone:focus-visible {
    border-color: var(--cs-purple);
    background: rgba(59,47,138,0.04);
    outline: none;
  }
  .drop-zone.drag-over {
    border-color: var(--cs-purple);
    background: rgba(59,47,138,0.08);
    transform: scale(1.01);
  }
  .drop-zone.uploading {
    pointer-events: none;
    opacity: 0.6;
  }
  .dz-text {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    margin: 0;
  }
  .dz-url-btn {
    margin-top: 4px;
    background: transparent;
    border: 1px solid var(--cs-border);
    border-radius: var(--radius-full);
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    padding: 4px 14px;
    cursor: pointer;
    min-height: 28px;
    transition: border-color 0.12s, color 0.12s;
  }
  .dz-url-btn:hover { border-color: var(--cs-purple); color: var(--cs-purple); }

  /* URL 입력 행 */
  .url-input-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .url-field { flex: 1; }
  .btn-url-add {
    padding: 8px 16px;
    background: var(--cs-purple); color: var(--cs-white);
    border: none; border-radius: var(--radius-sm);
    font: var(--text-pc-script-12); cursor: pointer; min-height: 36px; white-space: nowrap;
    transition: background 0.12s;
  }
  .btn-url-add:hover { background: var(--cs-purple-hover); }
  .btn-url-add:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
  .btn-icon-close {
    width: 32px; height: 32px;
    border: none; background: transparent; color: var(--cs-text-light);
    border-radius: var(--radius-sm); cursor: pointer; min-height: 32px;
    transition: background 0.12s, color 0.12s;
  }
  .btn-icon-close:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

  /* 이미지 카드 그리드 */
  .img-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
  }
  .img-card {
    position: relative;
    border-radius: var(--cms-radius-sm);
    overflow: hidden;
    background: var(--cs-surface-gray);
    aspect-ratio: 1;
  }
  .img-card-view {
    display: block;
    width: 100%; height: 100%;
    border: none; padding: 0; cursor: zoom-in; background: transparent;
    position: relative;
  }
  .img-card-thumb {
    width: 100%; height: 100%;
    object-fit: cover;
    display: block;
    transition: opacity 0.15s;
  }
  .img-card-overlay {
    position: absolute;
    inset: 0;
    background: rgba(16,11,50,0.45);
    color: var(--cs-white);
    font: var(--text-pc-script-12);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s;
    pointer-events: none;
  }
  .img-card-view:hover .img-card-overlay { opacity: 1; }
  .img-card-view:hover .img-card-thumb { opacity: 0.85; }

  .img-card-remove {
    position: absolute;
    top: 5px; right: 5px;
    width: 24px; height: 24px;
    border: none; border-radius: 50%;
    background: rgba(16,11,50,0.65);
    color: var(--cs-white);
    font-size: 12px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    opacity: 0;
    transition: opacity 0.15s, background 0.12s;
    z-index: 2;
    min-height: unset;
  }
  .img-card:hover .img-card-remove { opacity: 1; }
  .img-card-remove:hover { background: var(--cs-red-badge); }

  /* 대표이미지 아웃라인 */
  .img-card.primary { outline: 3px solid var(--cs-purple); outline-offset: -1px; }

  /* 사양 */
  .specs-list { display: flex; flex-direction: column; gap: 8px; }
  .spec-row { display: flex; align-items: center; gap: 8px; }
  .spec-key { flex: 2; }
  .spec-val { flex: 3; }
  .btn-add-dashed {
    background: transparent;
    border: 1.5px dashed var(--cs-border);
    border-radius: var(--cms-radius-sm);
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    padding: 8px;
    cursor: pointer;
    min-height: 36px;
    transition: border-color 0.12s, color 0.12s;
  }
  .btn-add-dashed:hover { border-color: var(--cs-purple); color: var(--cs-purple); }

  .empty-hint {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    padding: 20px 0;
    text-align: center;
  }

  /* ─── 라이트박스 ─────────────────────────────────── */

  .lightbox-backdrop {
    position: fixed;
    inset: 0;
    z-index: 500;
    background: rgba(16,11,50,0.88);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
    cursor: zoom-out;
  }
  .lightbox-img-wrap {
    max-width: 90vw;
    max-height: 90vh;
    cursor: default;
  }
  .lightbox-img {
    max-width: 100%;
    max-height: 90vh;
    object-fit: contain;
    border-radius: var(--cms-radius-md);
    display: block;
    box-shadow: 0 8px 40px rgba(0,0,0,0.5);
  }
  .lightbox-close {
    position: fixed;
    top: 20px; right: 24px;
    width: 44px; height: 44px;
    border: 2px solid rgba(255,255,255,0.4);
    border-radius: 50%;
    background: rgba(16,11,50,0.65);
    color: var(--cs-white);
    font-size: 18px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.12s, border-color 0.12s;
    z-index: 501;
  }
  .lightbox-close:hover { background: var(--cs-red-badge); border-color: var(--cs-red-badge); }

  /* ── 이력 탭 ──────────────────────────────────────── */
  .history-empty {
    text-align: center;
    padding: 32px 20px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }

  .btn-primary-sm {
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-sm);
    padding: 6px 14px;
    font: var(--text-pc-body-14);
    height: 34px;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .btn-primary-sm:hover { background: var(--cs-purple-hover); }
  .btn-primary-sm:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .btn-ghost-sm {
    background: transparent;
    border: 1.5px solid var(--cs-purple);
    border-radius: var(--radius-sm);
    color: var(--cs-purple);
    padding: 5px 12px;
    font: var(--text-pc-script-12);
    height: 32px;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .btn-ghost-sm:hover { background: rgba(59,47,138,0.06); }

  .btn-danger-sm {
    background: transparent;
    border: 1.5px solid var(--cs-red-badge);
    border-radius: var(--radius-sm);
    color: var(--cs-red-badge);
    padding: 5px 12px;
    font: var(--text-pc-script-12);
    height: 32px;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .btn-danger-sm:hover { background: rgba(255,53,53,0.08); }

  .history-editor-card {
    background: var(--cs-lilac);
    border-radius: var(--cms-radius-md);
    padding: 16px;
    margin-bottom: 16px;
  }

  .history-editor-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 12px;
  }

  .history-editor-title {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    flex: 1;
  }

  .history-editor-date-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .history-img-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 12px;
  }

  .history-img-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100px;
    cursor: grab;
    opacity: 1;
    transition: opacity 0.15s;
  }
  .history-img-item.drag-over { opacity: 0.5; }

  .history-img-thumb-wrap {
    position: relative;
    width: 100px;
    height: 75px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--cs-surface-gray);
  }

  .history-img-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .history-img-remove {
    position: absolute;
    top: 4px; right: 4px;
    width: 20px; height: 20px;
    background: rgba(16,11,50,0.65);
    border: none;
    border-radius: 50%;
    color: var(--cs-white);
    font-size: 10px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.12s;
  }
  .history-img-remove:hover { background: var(--cs-red-badge); }

  .history-comment {
    width: 100%;
    font: var(--text-pc-descript-10);
  }

  .history-img-add-btn {
    width: 100px;
    height: 75px;
    border: 2px dashed var(--cs-border);
    border-radius: var(--radius-sm);
    background: var(--cs-white);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    flex-shrink: 0;
  }
  .history-img-add-btn:hover { border-color: var(--cs-purple); background: rgba(59,47,138,0.04); }
  .history-img-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .add-icon { font-size: 20px; color: var(--cs-text-light); }
  .add-label { font: var(--text-pc-descript-10); color: var(--cs-text-light); }

  .uploading-dot {
    width: 12px; height: 12px;
    border-radius: 50%;
    border: 2px solid var(--cs-purple);
    border-top-color: transparent;
    animation: spin 0.6s linear infinite;
    display: block;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .history-editor-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 8px;
  }

  .history-card {
    background: var(--cs-white);
    border: 1px solid var(--cs-border);
    border-radius: var(--cms-radius-md);
    padding: 14px 16px;
    margin-bottom: 12px;
  }
  .history-card.editing {
    border-color: var(--cs-purple);
    background: rgba(59,47,138,0.02);
  }

  .history-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .history-card-meta {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .history-card-date {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
  }

  .history-card-by {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .history-card-actions {
    display: flex;
    gap: 6px;
  }

  .history-img-view-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .history-view-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 90px;
  }

  .history-view-comment {
    font: var(--text-pc-descript-10);
    color: var(--cs-text-mid);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-updated-by {
    font: var(--text-pc-descript-10);
    color: var(--cs-text-light);
    margin-top: 8px;
    text-align: right;
  }

  /* 삭제 확인 모달 */
  .confirm-backdrop {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(16,11,50,0.45);
    display: flex; align-items: center; justify-content: center;
  }
  .confirm-dialog {
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    padding: 28px 32px;
    min-width: 300px;
    max-width: 400px;
    text-align: center;
  }
  .confirm-msg { font: var(--text-pc-body-14); color: var(--cs-text); margin: 0 0 8px; }
  .confirm-sub { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0 0 20px; }
  .confirm-actions { display: flex; gap: 10px; justify-content: center; }

  /* 상품 복제 모달 */
  .clone-modal-backdrop {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(16,11,50,0.45);
    display: flex; align-items: center; justify-content: center;
  }
  .clone-modal {
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    padding: 24px 28px;
    width: 520px;
    max-width: calc(100vw - 40px);
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .clone-modal-header {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
  }
  .clone-modal-title {
    font: var(--text-pc-title-16);
    color: var(--cs-text);
    margin: 0;
  }
  .clone-modal-close {
    width: 32px; height: 32px;
    border: none; border-radius: var(--radius-sm);
    background: var(--cs-surface-gray); color: var(--cs-text-mid);
    cursor: pointer; font-size: 14px;
    transition: background 0.12s;
  }
  .clone-modal-close:hover:not(:disabled) { background: rgba(255,53,53,0.1); color: var(--cs-red-badge); }
  .clone-modal-close:disabled { opacity: 0.5; cursor: not-allowed; }
  .clone-modal-desc {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0;
    line-height: 1.6;
  }
  .clone-source-box {
    display: flex; flex-direction: row; align-items: center; gap: 12px;
    padding: 12px 16px;
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-sm);
  }
  .clone-source-thumb {
    width: 56px; height: 56px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }
  .clone-source-info {
    display: flex; flex-direction: column; gap: 4px;
    min-width: 0;
  }
  .clone-source-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }
  .clone-source-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
  }
  .clone-source-code {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    font-family: monospace;
  }
  .clone-field { display: flex; flex-direction: column; gap: 6px; }
  .clone-field-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }
  .clone-modal-actions {
    display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  }
  .clone-modal-actions form { margin: 0; }
  .clone-modal-actions--col {
    flex-direction: column; align-items: stretch; gap: 8px;
  }
  .clone-count-input { width: 100px; }
  .clone-partner-type-row {
    display: flex;
    gap: 6px;
    padding: 8px 12px;
    background: rgba(59,47,138,0.04);
    border-radius: var(--cms-radius-sm);
  }
  .clone-partner-type-btn {
    flex: 1;
    height: 34px;
    border-radius: var(--radius-xl);
    border: 1.5px solid var(--cs-border);
    background: var(--cs-white);
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .clone-partner-type-btn:hover:not(:disabled) {
    border-color: var(--cs-purple);
    color: var(--cs-purple);
  }
  .clone-partner-type-btn--on {
    background: rgba(59,47,138,0.10);
    border-color: var(--cs-purple);
    color: var(--cs-purple);
  }
  .clone-partner-type-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .clone-options-row {
    display: flex;
    gap: 8px;
  }
  .clone-option-toggle {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 9px 12px;
    border-radius: var(--radius-xl);
    border: 1.5px solid var(--cs-border);
    background: var(--cs-white);
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    text-align: center;
    line-height: 1.4;
    min-height: 44px;
  }
  .clone-option-toggle:hover:not(:disabled) {
    border-color: var(--cs-purple);
    color: var(--cs-purple);
  }
  .clone-option-toggle--on {
    background: rgba(59,47,138,0.10);
    border-color: var(--cs-purple);
    color: var(--cs-purple);
  }
  .clone-option-toggle:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .cta-btn--wide { width: 100%; }

  /* 재고 목록 섹션 */
  .inv-list-wrap {
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    overflow: hidden;
    margin-bottom: 8px;
  }
  .inv-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--cs-surface-gray);
    cursor: default;
  }
  .inv-row:last-child { border-bottom: none; }
  .inv-tag {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    flex-shrink: 0;
  }
  .inv-code {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    min-width: 120px;
    flex-shrink: 0;
    font-family: monospace;
  }
  .inv-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    flex: 1;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .inv-prices {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
  .inv-pill {
    background: rgba(59,47,138,0.08);
    color: var(--cs-purple);
    border-radius: var(--radius-full);
    padding: 2px 10px;
    font: var(--text-pc-script-12);
    white-space: nowrap;
  }
  .inv-status {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    flex-shrink: 0;
    min-width: 40px;
    text-align: right;
  }
  .inv-status--on {
    color: var(--cs-success-light);
  }

  /* 클론 모드 토글 */
  .clone-mode-toggle {
    display: flex;
    gap: 6px;
    margin-bottom: 14px;
  }
  .clone-mode-btn {
    flex: 1;
    height: 36px;
    border: 1px solid var(--cs-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .clone-mode-btn:hover:not(:disabled) {
    background: rgba(59,47,138,0.06);
    color: var(--cs-text);
  }
  .clone-mode-btn--on {
    background: var(--cs-purple);
    color: var(--cs-white);
    border-color: var(--cs-purple);
  }
  .clone-mode-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .clone-cancel-link {
    background: none; border: none;
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    cursor: pointer; text-align: center;
    padding: 4px 0;
    transition: color 0.12s;
  }
  .clone-cancel-link:hover:not(:disabled) { color: var(--cs-text-mid); }
  .clone-cancel-link:disabled { opacity: 0.5; cursor: not-allowed; }

  /* 장치 정보 섹션 */
  .device-info-section {
    margin-top: 20px;
    border-top: 1px solid var(--cs-surface-gray);
    padding-top: 16px;
  }
  .device-card-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .device-card {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    background: var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    padding: 12px 14px;
  }
  .device-card-thumb {
    flex-shrink: 0;
    width: 72px;
    height: 72px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--cs-surface-gray);
  }
  .device-thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .device-thumb-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--cs-text-light);
  }
  .device-card-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .device-card-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .device-label {
    flex-shrink: 0;
    width: 64px;
    font: var(--text-pc-descript-10);
    color: var(--cs-text-light);
    padding-top: 1px;
  }
  .device-value {
    font: var(--text-pc-script-12);
    color: var(--cs-text);
    min-width: 0;
    word-break: break-all;
  }
  .device-value.mono { font-family: monospace; font-size: 11px; letter-spacing: 0.03em; }
  .device-value.ocr-text {
    color: var(--cs-text-mid);
    font-size: 10px;
    line-height: 1.5;
    white-space: pre-wrap;
    max-height: 48px;
    overflow: hidden;
  }
  .device-card-status {
    flex-shrink: 0;
    padding-top: 2px;
  }
  .device-status-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    font: var(--text-pc-descript-10);
  }
  .device-status-badge.badge-active { background: rgba(16,185,129,0.12); color: var(--cs-success-light); }
  .device-status-badge.badge-rented { background: rgba(59,47,138,0.10); color: var(--cs-purple); }
  .device-status-badge.badge-inactive { background: var(--cs-surface-gray); color: var(--cs-text-light); }
  .no-device-msg {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    padding: 12px 0;
    margin: 0;
  }

  /* error-bar (이력 탭 공용) */
  .error-bar {
    background: var(--cs-bg-error);
    border-left: 3px solid var(--cs-red-badge);
    border-radius: var(--cms-radius-sm);
    padding: 8px 12px;
    font: var(--text-pc-script-12);
    color: var(--cs-error);
    margin-top: 8px;
    margin-bottom: 8px;
  }

  /* 모바일 링크 복사 버튼 */
  .mobile-link-row {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid var(--cs-surface-gray);
  }
  .mobile-link-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    background: var(--cs-lilac);
    border: 1.5px dashed var(--cs-purple);
    border-radius: var(--radius-sm);
    color: var(--cs-purple);
    font: var(--text-pc-script-12);
    cursor: pointer;
    min-height: 36px;
    transition: background 0.15s;
    width: 100%;
    justify-content: center;
  }
  .mobile-link-btn:hover { background: rgba(59,47,138,0.08); }

  /* 상품 삭제 푸터 (흰 카드 밖) */
  .delete-footer {
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    padding: 6px 0 8px;
  }

  .btn-danger {
    display: inline-flex;
    align-items: center;
    height: 44px;
    padding: 0 20px;
    background: var(--cs-red-badge);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    font: var(--text-pc-body-14);
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-danger:hover { background: var(--cs-red); }
</style>
