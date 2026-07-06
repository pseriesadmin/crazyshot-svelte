<script lang="ts">
  /* global File, FormData */
  import { goto } from '$app/navigation'
  import { resizeProductImage } from '$lib/utils/imageResize'
  import OcrScanner from '$lib/components/common/OcrScanner.svelte'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  type MobTab = 'images' | 'history' | 'device'
  let activeTab = $state<MobTab>('images')

  // ── 이미지 탭 ──────────────────────────────────────────
  let imageUrls = $state<string[]>(data.product.image_urls)
  let imageUploading = $state(false)
  let imageUploadError = $state<string | null>(null)
  let cameraInputEl = $state<HTMLInputElement | null>(null)

  // 이미지 확대 보기
  let lightboxUrl = $state<string | null>(null)

  // 이미지 삭제
  let deleteImageIdx = $state<number | null>(null)
  let imageDeleting = $state(false)

  async function confirmDeleteImage(): Promise<void> {
    if (deleteImageIdx === null) return
    imageDeleting = true
    const url = imageUrls[deleteImageIdx]
    const idx = deleteImageIdx
    try {
      const res = await fetch('/api/cms/upload', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ largeUrl: url, product_id: data.product.id }),
      })
      if (res.ok) {
        imageUrls = imageUrls.filter((_, i) => i !== idx)
      }
    } finally {
      imageDeleting = false
      deleteImageIdx = null
    }
  }

  async function uploadProductImage(file: File): Promise<void> {
    imageUploading = true
    imageUploadError = null
    try {
      const { thumb, large } = await resizeProductImage(file)
      const fd = new FormData()
      fd.append('product_id', data.product.id)
      fd.append('thumb', new File([thumb], 'thumb.webp', { type: 'image/webp' }))
      fd.append('large', new File([large], 'large.webp', { type: 'image/webp' }))
      const res = await fetch('/api/cms/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        imageUploadError = (err as { message?: string }).message ?? '업로드 실패'
        return
      }
      const result = await res.json() as { largeUrl: string }
      imageUrls = [...imageUrls, result.largeUrl]
      imageUploadError = null
    } catch (e) {
      imageUploadError = e instanceof Error ? e.message : '업로드 실패'
    } finally {
      imageUploading = false
    }
  }

  function handleCameraCapture(e: Event): void {
    const files = (e.target as HTMLInputElement).files
    if (files?.length) uploadProductImage(files[0])
    ;(e.target as HTMLInputElement).value = ''
  }

  function thumbUrl(url: string): string {
    if (!url) return ''
    if (url.includes('/large_')) return url.replace('/large_', '/thumb_')
    return url
  }

  // ── 이력 탭 ─────────────────────────────────────────────
  interface HistoryImage {
    url: string
    thumb_url: string
    comment: string
    display_order: number
  }

  interface HistoryRecord {
    id: string
    recorded_date: string
    images: HistoryImage[]
    created_by_email: string | null
    updated_by_email: string | null
  }

  let historyRecords = $state<HistoryRecord[]>([])
  let historyLoading = $state(false)
  let historyLoaded = $state(false)
  let historyError = $state<string | null>(null)

  // 이력 상세 보기
  let selectedHistoryRecord = $state<HistoryRecord | null>(null)

  // 이력 수정 모드
  let editingHistory = $state(false)
  let editImages = $state<HistoryImage[]>([])
  let editReplaceIdx = $state<number | null>(null)
  let editCameraEl = $state<HTMLInputElement | null>(null)
  let editImageUploading = $state(false)

  // 이력 삭제 확인
  let showDeleteConfirm = $state(false)
  let historyDeleting = $state(false)

  function startEditHistory(): void {
    if (!selectedHistoryRecord) return
    editImages = selectedHistoryRecord.images.map(img => ({ ...img }))
    editingHistory = true
  }

  function updateEditComment(idx: number, val: string): void {
    editImages = editImages.map((img, i) =>
      i === idx ? { ...img, comment: val.slice(0, 50) } : img
    )
  }

  function triggerEditReplace(idx: number): void {
    editReplaceIdx = idx
    editCameraEl?.click()
  }

  async function handleEditImageReplace(e: Event): Promise<void> {
    const files = (e.target as HTMLInputElement).files
    if (!files?.length || editReplaceIdx === null) return
    const idx = editReplaceIdx
    ;(e.target as HTMLInputElement).value = ''
    editImageUploading = true
    try {
      const { thumb, large } = await resizeProductImage(files[0])
      const fd = new FormData()
      fd.append('product_id', data.product.id + '/history')
      fd.append('thumb', new File([thumb], 'thumb.webp', { type: 'image/webp' }))
      fd.append('large', new File([large], 'large.webp', { type: 'image/webp' }))
      const res = await fetch('/api/cms/upload', { method: 'POST', body: fd })
      if (!res.ok) return
      const result = await res.json() as { largeUrl: string; thumbUrl: string }
      editImages = editImages.map((img, i) =>
        i === idx
          ? { ...img, url: result.largeUrl, thumb_url: result.thumbUrl }
          : img
      )
    } finally {
      editImageUploading = false
      editReplaceIdx = null
    }
  }

  async function saveEditHistory(): Promise<void> {
    if (!selectedHistoryRecord) return
    historySaving = true
    try {
      const res = await fetch('/api/cms/product-history', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedHistoryRecord.id,
          recorded_date: selectedHistoryRecord.recorded_date,
          images: editImages,
        }),
      })
      if (!res.ok) { historyError = '수정 실패'; return }
      editingHistory = false
      historyLoaded = false
      await loadHistory()
      selectedHistoryRecord = historyRecords.find(r => r.id === selectedHistoryRecord!.id) ?? null
    } finally {
      historySaving = false
    }
  }

  async function deleteHistory(): Promise<void> {
    if (!selectedHistoryRecord) return
    historyDeleting = true
    try {
      const res = await fetch(`/api/cms/product-history?id=${selectedHistoryRecord.id}`, { method: 'DELETE' })
      if (!res.ok) { historyError = '삭제 실패'; return }
      showDeleteConfirm = false
      selectedHistoryRecord = null
      historyLoaded = false
      await loadHistory()
    } finally {
      historyDeleting = false
    }
  }

  // 신규 이력 폼
  let showNewHistory = $state(false)
  let newHistoryImages = $state<HistoryImage[]>([])
  let historyUploading = $state(false)
  let historySaving = $state(false)
  let historyCameraEl = $state<HTMLInputElement | null>(null)

  $effect(() => {
    if (activeTab === 'history' && !historyLoaded) {
      loadHistory()
    }
  })

  async function loadHistory(): Promise<void> {
    historyLoading = true
    historyError = null
    try {
      const res = await fetch(`/api/cms/product-history?product_id=${data.product.id}`)
      if (!res.ok) throw new Error('이력 로드 실패')
      const json = await res.json() as { records: HistoryRecord[] }
      historyRecords = json.records
      historyLoaded = true
    } catch (e) {
      historyError = e instanceof Error ? e.message : '이력 로드 실패'
    } finally {
      historyLoading = false
    }
  }

  async function uploadHistoryImage(file: File): Promise<void> {
    historyUploading = true
    try {
      const { thumb, large } = await resizeProductImage(file)
      const fd = new FormData()
      fd.append('product_id', data.product.id + '/history')
      fd.append('thumb', new File([thumb], 'thumb.webp', { type: 'image/webp' }))
      fd.append('large', new File([large], 'large.webp', { type: 'image/webp' }))
      const res = await fetch('/api/cms/upload', { method: 'POST', body: fd })
      if (!res.ok) return
      const result = await res.json() as { largeUrl: string; thumbUrl: string }
      newHistoryImages = [...newHistoryImages, {
        url: result.largeUrl,
        thumb_url: result.thumbUrl,
        comment: '',
        display_order: newHistoryImages.length,
      }]
    } finally {
      historyUploading = false
    }
  }

  function handleHistoryCameraCapture(e: Event): void {
    const files = (e.target as HTMLInputElement).files
    if (files?.length) uploadHistoryImage(files[0])
    ;(e.target as HTMLInputElement).value = ''
  }

  function updateHistoryComment(idx: number, val: string): void {
    newHistoryImages = newHistoryImages.map((img, i) =>
      i === idx ? { ...img, comment: val.slice(0, 50) } : img
    )
  }

  async function saveNewHistory(): Promise<void> {
    if (newHistoryImages.length === 0) return
    historySaving = true
    try {
      const res = await fetch('/api/cms/product-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: data.product.id,
          recorded_date: new Date().toISOString().slice(0, 10),
          images: newHistoryImages,
        }),
      })
      if (!res.ok) {
        historyError = '저장 실패'
        return
      }
      showNewHistory = false
      newHistoryImages = []
      historyLoaded = false
      await loadHistory()
    } finally {
      historySaving = false
    }
  }

  // ── 장치정보 탭 ──────────────────────────────────────────
  // ── OCR 필드 파싱 ────────────────────────────────────────
  interface OcrField { label: string; value: string; key: string }

  function parseOcrFields(text: string): OcrField[] {
    const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean)
    const fields: OcrField[] = []
    const seen = new Set<string>()

    const matchers: Array<{ label: string; key: string; patterns: RegExp[] }> = [
      {
        label: '모델코드', key: 'model',
        patterns: [
          // eslint-disable-next-line security/detect-unsafe-regex
          /Model(?:\s*(?:No|Name|Code|Number))?[\s:/]+([A-Z0-9][-A-Z0-9_./]{2,})/i,
          /M[/]N[\s:]+([A-Z0-9][-A-Z0-9_./]{2,})/i,
        ],
      },
      {
        label: 'Serial Number', key: 'serial',
        patterns: [
          /S(?:erial)?[\s/]?N(?:umber)?[\s:]+([A-Z0-9][-A-Z0-9_./]{4,})/i,
          /SN[\s:]+([A-Z0-9][-A-Z0-9_./]{4,})/i,
        ],
      },
      {
        label: 'MAC Address', key: 'mac',
        patterns: [
          // eslint-disable-next-line security/detect-unsafe-regex
          /MAC(?:\s*(?:Addr|Address))?[\s:]+([0-9A-Fa-f:]{11,17})/i,
          // eslint-disable-next-line security/detect-unsafe-regex
          /([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})/,
          // eslint-disable-next-line security/detect-unsafe-regex
          /([0-9A-Fa-f]{2}(?:-[0-9A-Fa-f]{2}){5})/,
        ],
      },
      {
        label: 'IMEI', key: 'imei',
        patterns: [
          /IMEI[\s:]+(\d{15})/i,
          /\b(\d{15})\b/,
        ],
      },
      {
        label: '제조사', key: 'manufacturer',
        patterns: [
          /(?:Made\s+(?:in|by)|Manufacturer|Mfr)[\s:]+([A-Za-z][A-Za-z0-9\s]{1,30})/i,
        ],
      },
    ]

    for (const m of matchers) {
      const fullText = lines.join(' ')
      for (const pat of m.patterns) {
        const match = fullText.match(pat)
        if (match?.[1] && !seen.has(m.key)) {
          seen.add(m.key)
          fields.push({ label: m.label, key: m.key, value: match[1].trim() })
          break
        }
      }
    }

    // 매칭 안된 줄은 기타로 (최대 3줄)
    if (fields.length === 0) {
      lines.slice(0, 3).forEach((line, i) => {
        fields.push({ label: `텍스트 ${i + 1}`, key: `other_${i}`, value: line })
      })
    }

    return fields
  }

  let selectedAssetId = $state<string | null>(null)
  let assetCode = $state('')
  let serialNumber = $state('')
  let ocrRawText = $state('')
  let ocrFields = $state<OcrField[]>([])
  let labelImageUrl = $state<string | null>(null)
  let assetSaving = $state(false)
  let assetSaveError = $state<string | null>(null)
  let assetSaveSuccess = $state(false)
  let deviceScanTrigger = $state<(() => void) | null>(null)
  let deviceScanProcessing = $state(false)

  const selectedAsset = $derived(data.assets.find(a => a.id === selectedAssetId) ?? null)

  function selectAsset(id: string): void {
    // blob: URL = 방금 스캔한 신규 이미지 → 자산 선택 시 덮어쓰지 않음
    const hasFreshScan = labelImageUrl?.startsWith('blob:')
    selectedAssetId = id
    const asset = data.assets.find(a => a.id === id)
    assetCode = asset?.asset_code ?? ''
    serialNumber = asset?.serial_number ?? ''
    assetSaveError = null
    assetSaveSuccess = false
    if (!hasFreshScan) {
      // 신규 스캔 없음 → DB 저장값 복원
      ocrRawText = asset?.ocr_raw_text ?? ''
      ocrFields = asset?.ocr_raw_text ? parseOcrFields(asset.ocr_raw_text) : []
      labelImageUrl = asset?.label_image_url ?? null
    }
  }

  function handleOcrResult(text: string, imageUrl: string): void {
    ocrRawText = text
    labelImageUrl = imageUrl
    const parsed = parseOcrFields(text)
    ocrFields = parsed
    // serial 또는 model 필드를 해당 입력란에 자동 채움
    const serialField = parsed.find(f => f.key === 'serial')
    const modelField = parsed.find(f => f.key === 'model')
    if (serialField) serialNumber = serialField.value
    if (modelField && !assetCode) assetCode = modelField.value
    // 파싱 결과가 없으면 첫 줄을 assetCode에
    if (!serialField && !modelField && text.trim()) {
      assetCode = text.split('\n')[0]?.trim() ?? text.trim()
    }
  }

  async function saveAsset(): Promise<void> {
    assetSaving = true
    assetSaveError = null
    assetSaveSuccess = false
    try {
      let targetAssetId = selectedAssetId
      let isNewAsset = false

      // 자산이 없으면 신규 생성
      if (!targetAssetId) {
        const createRes = await fetch('/api/cms/assets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id: data.product.id,
            serial_number: serialNumber.trim() || null,
          }),
        })
        if (!createRes.ok) {
          const err = await createRes.json().catch(() => ({}))
          assetSaveError = (err as { message?: string }).message ?? '자산 생성 실패'
          return
        }
        const createData = await createRes.json() as { asset_id: string }
        targetAssetId = createData.asset_id
        isNewAsset = true
      }

      // 새 스캔 이미지(blob:)가 있으면 Storage에 먼저 업로드
      let persistedLabelUrl: string | null = null
      if (labelImageUrl?.startsWith('blob:')) {
        const blob = await fetch(labelImageUrl).then(r => r.blob())
        const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
        const fd = new FormData()
        fd.append('type', 'label')
        fd.append('asset_id', targetAssetId)
        fd.append('image', new File([blob], `label.${ext}`, { type: blob.type }))
        const uploadRes = await fetch('/api/cms/upload', { method: 'POST', body: fd })
        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => ({}))
          assetSaveError = (err as { message?: string }).message ?? '이미지 업로드 실패'
          return
        }
        const uploadData = await uploadRes.json() as { labelUrl: string }
        persistedLabelUrl = uploadData.labelUrl
      }

      const patchBody: { asset_code?: string; serial_number?: string; label_image_url?: string; ocr_raw_text?: string } = {}
      if (assetCode.trim()) patchBody.asset_code = assetCode.trim()
      if (serialNumber.trim()) patchBody.serial_number = serialNumber.trim()
      if (persistedLabelUrl) patchBody.label_image_url = persistedLabelUrl
      if (ocrRawText.trim()) patchBody.ocr_raw_text = ocrRawText.trim()

      const res = await fetch(`/api/cms/assets/${targetAssetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        assetSaveError = (err as { message?: string }).message ?? '저장 실패'
        return
      }

      // blob URL → 영구 URL 교체
      if (persistedLabelUrl) labelImageUrl = persistedLabelUrl
      assetSaveSuccess = true

      if (isNewAsset) {
        // 신규 자산 — 목록에 추가 + 선택 상태 전환
        const newAsset = {
          id: targetAssetId,
          asset_code: assetCode.trim() || null,
          serial_number: serialNumber.trim() || null,
          label_image_url: persistedLabelUrl,
          ocr_raw_text: ocrRawText.trim() || null,
          status: 'available',
          deleted_at: null,
        }
        data.assets = [...data.assets, newAsset]
        selectedAssetId = targetAssetId
      } else {
        // 기존 자산 낙관적 업데이트
        data.assets = data.assets.map(a =>
          a.id === targetAssetId
            ? {
                ...a,
                asset_code: assetCode.trim() || a.asset_code,
                serial_number: serialNumber.trim() || a.serial_number,
                label_image_url: persistedLabelUrl ?? a.label_image_url,
                ocr_raw_text: ocrRawText.trim() || a.ocr_raw_text,
              }
            : a
        )
      }
    } catch (e) {
      assetSaveError = e instanceof Error ? e.message : '저장 실패'
    } finally {
      assetSaving = false
    }
  }
</script>

<div class="mob-product-page">
  <!-- 상단 헤더 -->
  <div class="mob-product-header">
    <button type="button" class="back-btn" onclick={() => goto('/cms/mobile')} aria-label="뒤로">‹</button>
    <div class="header-info">
      <span class="header-name">{data.product.name}</span>
      {#if data.product.product_code}
        <span class="header-code">{data.product.product_code}</span>
      {/if}
    </div>
  </div>

  <!-- 탭 네비게이션 -->
  <div class="mob-tab-nav" role="tablist">
    <button
      type="button"
      role="tab"
      class="mob-tab"
      class:active={activeTab === 'images'}
      onclick={() => { activeTab = 'images' }}
      aria-selected={activeTab === 'images'}
    >상품이미지</button>
    <button
      type="button"
      role="tab"
      class="mob-tab"
      class:active={activeTab === 'history'}
      onclick={() => { activeTab = 'history' }}
      aria-selected={activeTab === 'history'}
    >상품이력</button>
    <button
      type="button"
      role="tab"
      class="mob-tab"
      class:active={activeTab === 'device'}
      onclick={() => { activeTab = 'device' }}
      aria-selected={activeTab === 'device'}
    >장치정보</button>
  </div>

  <!-- 탭 콘텐츠 -->
  <div class="mob-tab-content">

    <!-- 탭: 상품이미지 -->
    {#if activeTab === 'images'}
      <div class="tab-panel images-panel" role="tabpanel">
        {#if imageUploadError}
          <div class="mob-error" role="alert">{imageUploadError}</div>
        {/if}

        {#if imageUrls.length === 0}
          <div class="mob-empty">등록된 이미지가 없습니다.</div>
        {:else}
          <div class="image-grid">
            {#each imageUrls as url, i}
              <div class="image-cell" class:first-cell={i === 0}>
                <button
                  type="button"
                  class="image-expand-btn"
                  onclick={() => { lightboxUrl = url }}
                  aria-label="이미지 확대"
                >
                  <img src={thumbUrl(url)} alt="상품 이미지 {i + 1}" class="image-thumb" loading="lazy" />
                </button>
                {#if i === 0}
                  <span class="representative-badge">대표</span>
                {/if}
                <button
                  type="button"
                  class="image-delete-btn"
                  onclick={() => { deleteImageIdx = i }}
                  aria-label="이미지 삭제"
                >✕</button>
              </div>
            {/each}
          </div>

          <!-- 삭제 확인 모달 -->
          {#if deleteImageIdx !== null}
            <div class="confirm-backdrop" onclick={() => { deleteImageIdx = null }} role="presentation">
              <div class="confirm-dialog" role="dialog" aria-modal="true">
                <p class="confirm-msg">이미지를 삭제하시겠습니까?</p>
                <p class="confirm-sub">삭제한 이미지는 복구할 수 없습니다.</p>
                <div class="confirm-actions">
                  <button type="button" class="detail-btn-cancel" onclick={() => { deleteImageIdx = null }}>취소</button>
                  <button type="button" class="detail-btn-delete" onclick={confirmDeleteImage} disabled={imageDeleting}>
                    {imageDeleting ? '삭제 중...' : '삭제'}
                  </button>
                </div>
              </div>
            </div>
          {/if}

          <!-- 라이트박스 -->
          {#if lightboxUrl}
            <div class="lightbox-backdrop" onclick={() => { lightboxUrl = null }} role="presentation">
              <img src={lightboxUrl} alt="이미지 확대" class="lightbox-img" />
            </div>
          {/if}
        {/if}

        <input
          bind:this={cameraInputEl}
          type="file"
          accept="image/*"
          capture="environment"
          style="display:none"
          onchange={handleCameraCapture}
          aria-hidden="true"
        />
      </div>
    {/if}

    <!-- 탭: 상품이력 -->
    {#if activeTab === 'history'}
      <div class="tab-panel" role="tabpanel">
        {#if historyError}
          <div class="mob-error" role="alert">{historyError}</div>
        {:else if historyLoading}
          <div class="mob-empty">이력 로드 중...</div>
        {:else}
          {#if !showNewHistory && !selectedHistoryRecord}
          {:else if showNewHistory}
            <div class="history-form-card">
              <div class="history-form-date">
                {new Date().toISOString().slice(0, 10)} (오늘)
              </div>

              <div class="history-photo-list">
                {#each newHistoryImages as img, idx}
                  <div class="history-photo-item">
                    <img src={img.thumb_url || img.url} alt="이력 이미지 {idx + 1}" class="history-photo-thumb" />
                    <input
                      type="text"
                      class="history-comment-input"
                      placeholder="코멘트 (50자)"
                      maxlength="50"
                      value={img.comment}
                      oninput={(e) => updateHistoryComment(idx, (e.target as HTMLInputElement).value)}
                    />
                  </div>
                {/each}
              </div>

              <div class="history-form-actions">
                <button
                  type="button"
                  class="mob-secondary-btn"
                  onclick={() => historyCameraEl?.click()}
                  disabled={historyUploading || newHistoryImages.length >= 20}
                >
                  {historyUploading ? '업로드 중...' : '사진 촬영'}
                </button>
                <button
                  type="button"
                  class="mob-secondary-btn cancel"
                  onclick={() => { showNewHistory = false; newHistoryImages = [] }}
                >
                  취소
                </button>
              </div>

              <button
                type="button"
                class="mob-cta-btn"
                onclick={saveNewHistory}
                disabled={historySaving || newHistoryImages.length === 0}
              >
                {historySaving ? '저장 중...' : '저장'}
              </button>

              <input
                bind:this={historyCameraEl}
                type="file"
                accept="image/*"
                capture="environment"
                style="display:none"
                onchange={handleHistoryCameraCapture}
                aria-hidden="true"
              />
            </div>
          {/if}

          {#if selectedHistoryRecord}
            <!-- 이력 상세 보기 -->
            <div class="history-detail-panel">
              <div class="history-detail-header">
                <button
                  type="button"
                  class="history-detail-back"
                  onclick={() => { selectedHistoryRecord = null; editingHistory = false }}
                  aria-label="목록으로"
                >‹</button>
                <span class="history-detail-date">{selectedHistoryRecord.recorded_date}</span>
                {#if !editingHistory}
                  <div class="history-detail-actions">
                    <button type="button" class="detail-btn-edit" onclick={startEditHistory}>수정</button>
                    <button type="button" class="detail-btn-delete" onclick={() => { showDeleteConfirm = true }}>삭제</button>
                  </div>
                {/if}
              </div>

              {#if editingHistory}
                <!-- 수정 모드 -->
                <div class="history-detail-list">
                  {#each editImages as img, i}
                    <div class="history-photo-item">
                      <button
                        type="button"
                        class="edit-img-btn"
                        onclick={() => triggerEditReplace(i)}
                        disabled={editImageUploading}
                        aria-label="이미지 교체"
                      >
                        <img
                          src={img.thumb_url || img.url}
                          alt="이력 이미지 {i + 1}"
                          class="history-photo-thumb"
                          loading="lazy"
                        />
                        <span class="edit-img-overlay">교체</span>
                      </button>
                      <input
                        type="text"
                        class="history-comment-input"
                        placeholder="코멘트 (50자)"
                        maxlength="50"
                        value={img.comment}
                        oninput={(e) => updateEditComment(i, (e.target as HTMLInputElement).value)}
                      />
                    </div>
                  {/each}
                </div>
                <input
                  bind:this={editCameraEl}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style="display:none"
                  onchange={handleEditImageReplace}
                  aria-hidden="true"
                />
                <div class="history-edit-actions">
                  <button
                    type="button"
                    class="detail-btn-cancel"
                    onclick={() => { editingHistory = false }}
                  >취소</button>
                  <button
                    type="button"
                    class="detail-btn-save"
                    onclick={saveEditHistory}
                    disabled={historySaving || editImageUploading}
                  >{historySaving ? '저장 중...' : editImageUploading ? '업로드 중...' : '저장'}</button>
                </div>
              {:else}
                <!-- 보기 모드 -->
                <div class="history-detail-list">
                  {#each selectedHistoryRecord.images as img, i}
                    <div class="history-photo-item">
                      <img
                        src={img.thumb_url || img.url}
                        alt="이력 이미지 {i + 1}"
                        class="history-photo-thumb"
                        loading="lazy"
                      />
                      {#if img.comment}
                        <span class="history-detail-comment">{img.comment}</span>
                      {:else}
                        <span class="history-detail-no-comment">코멘트 없음</span>
                      {/if}
                    </div>
                  {/each}
                </div>
                {#if selectedHistoryRecord.created_by_email}
                  <div class="history-detail-meta">
                    등록: {selectedHistoryRecord.created_by_email}
                  </div>
                {/if}
              {/if}
            </div>

            <!-- 삭제 확인 모달 -->
            {#if showDeleteConfirm}
              <div class="confirm-backdrop" onclick={() => { showDeleteConfirm = false }} role="presentation">
                <div class="confirm-dialog" role="dialog" aria-modal="true">
                  <p class="confirm-msg">이력을 삭제하시겠습니까?</p>
                  <p class="confirm-sub">{selectedHistoryRecord.recorded_date} 이력이 영구 삭제됩니다.</p>
                  <div class="confirm-actions">
                    <button type="button" class="detail-btn-cancel" onclick={() => { showDeleteConfirm = false }}>취소</button>
                    <button type="button" class="detail-btn-delete" onclick={deleteHistory} disabled={historyDeleting}>
                      {historyDeleting ? '삭제 중...' : '삭제'}
                    </button>
                  </div>
                </div>
              </div>
            {/if}
          {:else if historyRecords.length === 0}
            <div class="mob-empty">등록된 이력이 없습니다.</div>
          {:else}
            {#each historyRecords as rec (rec.id)}
              <button
                type="button"
                class="history-card"
                onclick={() => { selectedHistoryRecord = rec }}
              >
                <div class="history-card-date">{rec.recorded_date}</div>
                <div class="history-photo-row">
                  {#each rec.images.slice(0, 5) as img}
                    <img src={img.thumb_url || img.url} alt="이력" class="history-list-thumb" loading="lazy" />
                  {/each}
                  {#if rec.images.length > 5}
                    <div class="history-more-badge">+{rec.images.length - 5}</div>
                  {/if}
                </div>
                {#if rec.created_by_email}
                  <div class="history-card-by">{rec.created_by_email}</div>
                {/if}
              </button>
            {/each}
          {/if}
        {/if}
      </div>
    {/if}

    <!-- 탭: 장치정보 -->
    {#if activeTab === 'device'}
      <div class="tab-panel" role="tabpanel">

        <!-- OCR 엔진 (compact — 항상 초기화, UI 숨김) -->
        <div style="display:none">
          <OcrScanner
            lang="eng"
            compact={true}
            onResult={(text, imgUrl) => { deviceScanProcessing = false; handleOcrResult(text, imgUrl) }}
            onError={(e) => { deviceScanProcessing = false; assetSaveError = e.message }}
            onReady={(fn) => { deviceScanTrigger = fn }}
          />
        </div>

        <!-- 스캔 결과 카드 -->
        {#if labelImageUrl || ocrFields.length > 0}
          <div class="scan-result-card">
            {#if labelImageUrl}
              <div class="scan-thumb-wrap">
                <img src={labelImageUrl} alt="스캔된 라벨 이미지" class="scan-thumb" loading="lazy" />
              </div>
            {/if}
            <div class="scan-fields">
              {#if ocrFields.length > 0}
                {#each ocrFields as field (field.key)}
                  <div class="scan-field-row">
                    <span class="scan-field-label">{field.label}</span>
                    <span class="scan-field-value">{field.value}</span>
                  </div>
                {/each}
              {:else if ocrRawText}
                <p class="scan-raw-text">{ocrRawText}</p>
              {/if}
            </div>
          </div>
        {/if}

        {#if deviceScanProcessing}
          <div class="device-scanning-msg" aria-live="polite">스캔 처리 중...</div>
        {/if}

        {#if data.assets.length === 0 && !labelImageUrl && ocrFields.length === 0}
          <div class="mob-empty">등록된 자산이 없습니다.</div>
        {:else}
          <div class="asset-list">
            {#each data.assets as asset (asset.id)}
              <button
                type="button"
                class="asset-item"
                class:selected={selectedAssetId === asset.id}
                onclick={() => selectAsset(asset.id)}
              >
                <div class="asset-info">
                  <span class="asset-code">{asset.asset_code ?? '코드 없음'}</span>
                  {#if asset.serial_number}
                    <span class="asset-serial">S/N: {asset.serial_number}</span>
                  {/if}
                </div>
                <span class="asset-status-badge">{asset.status}</span>
              </button>
            {/each}
          </div>

          {#if selectedAsset}
            <div class="device-edit-card">
              <div class="device-edit-title">장치코드 편집</div>

              <div class="device-field">
                <label class="device-label" for="mob-asset-code">장치 코드</label>
                <input
                  id="mob-asset-code"
                  type="text"
                  class="device-input"
                  bind:value={assetCode}
                  placeholder="예: CS-CAM-001"
                />
              </div>

              <div class="device-field">
                <label class="device-label" for="mob-serial">시리얼 번호</label>
                <input
                  id="mob-serial"
                  type="text"
                  class="device-input"
                  bind:value={serialNumber}
                  placeholder="S/N"
                />
              </div>

              {#if assetSaveError}
                <div class="mob-error" role="alert">{assetSaveError}</div>
              {/if}
              {#if assetSaveSuccess}
                <div class="mob-success" role="status">저장됐습니다.</div>
              {/if}

              <button
                type="button"
                class="mob-cta-btn"
                onclick={saveAsset}
                disabled={assetSaving || (!assetCode.trim() && !serialNumber.trim() && !labelImageUrl && !ocrRawText.trim())}
              >
                {assetSaving ? '저장 중...' : '저장'}
              </button>
            </div>
          {/if}
        {/if}
      </div>
    {/if}

  </div>

  <!-- 하단 고정 액션 바 -->
  {#if activeTab === 'images'}
    <div class="bottom-action-bar">
      <button
        type="button"
        class="mob-cta-btn"
        onclick={() => cameraInputEl?.click()}
        disabled={imageUploading}
        aria-label="이미지 촬영"
      >
        {imageUploading ? '업로드 중...' : '이미지 촬영'}
      </button>
    </div>
  {:else if activeTab === 'history' && !showNewHistory && !selectedHistoryRecord}
    <div class="bottom-action-bar">
      <button
        type="button"
        class="mob-cta-btn"
        onclick={() => { showNewHistory = true; newHistoryImages = [] }}
        aria-label="이력 등록"
      >
        이력 등록
      </button>
    </div>
  {:else if activeTab === 'device'}
    <div class="bottom-action-bar" class:two-btn={labelImageUrl || ocrFields.length > 0}>
      {#if labelImageUrl || ocrFields.length > 0}
        <!-- 스캔 결과 있음: 저장 + 다시 스캔 -->
        <button
          type="button"
          class="mob-cta-btn mob-cta-save"
          onclick={saveAsset}
          disabled={assetSaving || (data.assets.length > 0 && !selectedAssetId)}
          aria-label="저장"
        >
          {assetSaving ? '저장 중...' : '저장'}
        </button>
        <button
          type="button"
          class="mob-cta-btn mob-cta-rescan"
          onclick={() => { deviceScanProcessing = true; deviceScanTrigger?.() }}
          disabled={!deviceScanTrigger || deviceScanProcessing}
          aria-label="다시 스캔"
        >
          {deviceScanProcessing ? '스캔 중...' : '다시 스캔'}
        </button>
      {:else}
        <!-- 스캔 결과 없음: 장치 스캔 단독 -->
        <button
          type="button"
          class="mob-cta-btn"
          onclick={() => { deviceScanProcessing = true; deviceScanTrigger?.() }}
          disabled={!deviceScanTrigger || deviceScanProcessing}
          aria-label="장치 스캔"
        >
          {deviceScanProcessing ? '스캔 중...' : !deviceScanTrigger ? '스캐너 초기화 중...' : '장치 스캔'}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .mob-product-page {
    display: flex;
    flex-direction: column;
    flex: 1;
    background: var(--cs-lilac);
  }

  .mob-product-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px 6px;
    background: var(--cs-lilac);
  }

  .back-btn {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--cs-text);
    font-size: 28px;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    line-height: 1;
  }

  .header-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .header-name {
    font: var(--text-pc-title-16);
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .header-code {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  /* 서브탭 — CMS cms-subtabbar 표준 */
  .mob-tab-nav {
    display: flex;
    justify-content: center;
    gap: 4px;
    padding: 6px 14px 8px;
    background: transparent;
  }

  .mob-tab {
    flex: 1;
    min-height: 36px;
    background: none;
    border: none;
    border-radius: var(--radius-md);
    color: var(--cs-text-mid);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .mob-tab:hover { background: rgba(59,47,138,0.08); color: var(--cs-text); }
  .mob-tab.active {
    background: var(--cs-white);
    color: var(--cs-purple);
  }

  .mob-tab-content {
    flex: 1;
    overflow-y: auto;
  }

  .tab-panel {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* 하단 액션 바 */
  .bottom-action-bar {
    flex-shrink: 0;
    padding: 12px 16px 16px;
    background: var(--cs-lilac);
  }

  /* 이미지 패널 — 하단 바 높이만큼 여백 불필요 (flex 구조로 자동 처리) */
  .images-panel {
    padding-bottom: 8px;
  }

  /* 이미지 탭 */
  .image-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }

  .image-cell {
    position: relative;
    aspect-ratio: 4/3;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--cs-surface-gray);
  }

  .image-expand-btn {
    display: block;
    width: 100%;
    height: 100%;
    border: none;
    padding: 0;
    background: none;
    cursor: pointer;
  }

  .image-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .image-delete-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 24px;
    height: 24px;
    background: rgba(16,11,50,0.62);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-full);
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .representative-badge {
    position: absolute;
    bottom: 4px;
    left: 4px;
    background: var(--cs-purple);
    color: var(--cs-white);
    font-size: 10px;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
  }

  /* 라이트박스 */
  .lightbox-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: rgba(16,11,50,0.92);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .lightbox-img {
    max-width: 94vw;
    max-height: 88vh;
    object-fit: contain;
    border-radius: var(--cms-radius-sm);
  }

  /* item 5: 상단 촬영 버튼 — 탭별 공통 */
  .mob-capture-btn {
    width: 100%;
    height: 56px;
    background: var(--cs-orange);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    font-size: 17px;
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.15s;
    letter-spacing: -0.3px;
  }
  .mob-capture-btn:hover:not(:disabled) { opacity: 0.88; }
  .mob-capture-btn:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .mob-cta-btn {
    width: 100%;
    height: 52px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
  }
  .mob-cta-btn:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .mob-cta-btn:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  /* 스캔 결과 후 두 버튼 레이아웃 */
  .bottom-action-bar.two-btn {
    display: flex;
    gap: 10px;
  }
  .mob-cta-save  { flex: 1; }
  .mob-cta-rescan {
    flex: 0 0 auto;
    width: 110px;
    background: transparent;
    border: 1.5px solid var(--cs-purple);
    color: var(--cs-purple);
  }
  .mob-cta-rescan:hover:not(:disabled) { background: rgba(59,47,138,0.06); }
  .mob-cta-rescan:disabled { border-color: var(--cs-disabled-button); color: var(--cs-disabled-button); background: transparent; }

  .device-hint {
    text-align: center;
    padding: 10px 16px;
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    font-size: 13px;
    color: var(--cs-text-mid);
  }

  .mob-secondary-btn {
    flex: 1;
    height: 44px;
    background: transparent;
    border: 1.5px solid var(--cs-purple);
    border-radius: var(--radius-lg);
    color: var(--cs-purple);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .mob-secondary-btn.cancel {
    border-color: var(--cs-text-light);
    color: var(--cs-text-mid);
  }
  .mob-secondary-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .mob-empty {
    text-align: center;
    padding: 32px 20px;
    font-size: 14px;
    color: var(--cs-text-light);
  }

  .mob-error {
    background: var(--cs-bg-error);
    border-radius: var(--radius-sm);
    padding: 10px 14px;
    font-size: 13px;
    color: var(--cs-error);
  }

  .mob-success {
    background: var(--cs-bg-success);
    border-radius: var(--radius-sm);
    padding: 10px 14px;
    font-size: 13px;
    color: var(--cs-text-success);
  }

  /* 이력 탭 */
  .history-form-card {
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .history-form-date {
    font-size: 15px;
    font-weight: 700;
    color: var(--cs-text);
  }

  /* 이력 이미지 카드 목록형 */
  .history-photo-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .history-photo-item {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-sm);
    padding: 8px;
  }

  .history-photo-thumb {
    width: 72px;
    height: 54px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
    display: block;
    background: var(--cs-border);
  }

  .history-comment-input {
    flex: 1;
    min-width: 0;
    background: var(--cs-white);
    border: none;
    border-radius: var(--radius-sm);
    padding: 0 12px;
    height: 44px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
  }
  .history-comment-input::placeholder { color: var(--cs-text-placeholder); }
  .history-comment-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  .history-form-actions {
    display: flex;
    gap: 8px;
  }

  /* 이력 상세 패널 */
  .history-detail-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .history-detail-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .history-detail-actions {
    margin-left: auto;
    display: flex;
    gap: 6px;
  }

  .detail-btn-edit {
    height: 34px;
    padding: 0 14px;
    border-radius: var(--radius-sm);
    border: 1.5px solid var(--cs-purple);
    background: transparent;
    color: var(--cs-purple);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .detail-btn-edit:hover { background: rgba(59,47,138,0.06); }

  .detail-btn-delete {
    height: 34px;
    padding: 0 14px;
    border-radius: var(--radius-sm);
    border: 1.5px solid var(--cs-red-badge);
    background: transparent;
    color: var(--cs-red-badge);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .detail-btn-delete:hover { background: rgba(255,53,53,0.08); }
  .detail-btn-delete:disabled { opacity: 0.6; cursor: not-allowed; }

  .detail-btn-save {
    height: 34px;
    padding: 0 16px;
    border-radius: var(--radius-sm);
    border: none;
    background: var(--cs-purple);
    color: var(--cs-white);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .detail-btn-save:hover { background: var(--cs-purple-hover); }
  .detail-btn-save:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .detail-btn-cancel {
    height: 34px;
    padding: 0 14px;
    border-radius: var(--radius-sm);
    border: 1.5px solid var(--cs-border);
    background: transparent;
    color: var(--cs-text-mid);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .detail-btn-cancel:hover { background: var(--cs-surface-gray); }

  .edit-img-btn {
    position: relative;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .edit-img-btn:disabled { opacity: 0.6; cursor: not-allowed; }

  .edit-img-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(16,11,50,0.45);
    color: var(--cs-white);
    font: var(--text-pc-script-12);
    opacity: 0;
    transition: opacity 0.15s;
  }
  .edit-img-btn:hover .edit-img-overlay { opacity: 1; }

  .history-edit-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  /* 삭제 확인 모달 */
  .confirm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(16,11,50,0.45);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .confirm-dialog {
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    padding: 28px 24px;
    width: calc(100% - 48px);
    max-width: 320px;
    text-align: center;
  }

  .confirm-msg {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    margin: 0 0 8px;
  }

  .confirm-sub {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0 0 20px;
  }

  .confirm-actions {
    display: flex;
    gap: 8px;
    justify-content: center;
  }

  .history-detail-back {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--cs-text);
    font-size: 28px;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    line-height: 1;
  }

  .history-detail-date {
    font: var(--text-pc-title-16);
    color: var(--cs-text);
  }

  .history-detail-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .history-detail-comment {
    flex: 1;
    min-width: 0;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    word-break: break-all;
  }

  .history-detail-no-comment {
    flex: 1;
    min-width: 0;
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }

  .history-detail-meta {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    padding: 4px 0;
  }

  /* 이력 카드 (목록) */
  .history-card {
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    border: none;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s;
  }
  .history-card:hover { background: rgba(59,47,138,0.04); }

  .history-card-date {
    font-size: 15px;
    font-weight: 700;
    color: var(--cs-text);
  }

  .history-photo-row {
    display: flex;
    gap: 6px;
    overflow: hidden;
  }

  .history-list-thumb {
    width: 60px;
    height: 45px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
    display: block;
    background: var(--cs-surface-gray);
  }

  .history-more-badge {
    width: 60px;
    height: 45px;
    background: var(--cs-surface-gray);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    color: var(--cs-text-mid);
    flex-shrink: 0;
  }

  .history-card-by {
    font-size: 11px;
    color: var(--cs-text-light);
  }

  /* 장치정보 탭 */
  .asset-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .asset-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--cs-white);
    border: 2px solid transparent;
    border-radius: var(--radius-lg);
    padding: 12px 16px;
    cursor: pointer;
    text-align: left;
    min-height: 56px;
    transition: border-color 0.12s;
    width: 100%;
  }
  .asset-item.selected { border-color: var(--cs-purple); }

  .asset-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .asset-code {
    font-size: 14px;
    font-weight: 600;
    color: var(--cs-text);
  }

  .asset-serial {
    font-size: 12px;
    color: var(--cs-text-mid);
  }

  .asset-status-badge {
    font-size: 11px;
    padding: 2px 8px;
    background: rgba(59,47,138,0.08);
    color: var(--cs-purple);
    border-radius: var(--radius-full);
  }

  .device-edit-card {
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .device-edit-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--cs-text);
  }

  .device-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .device-label {
    font-size: 12px;
    color: var(--cs-text-mid);
  }

  .device-input {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-md);
    padding: 12px 14px;
    font-size: 15px;
    color: var(--cs-text);
    height: 48px;
    width: 100%;
  }
  .device-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  /* 스캔 결과 카드 */
  .scan-result-card {
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .scan-thumb-wrap {
    width: 100%;
    background: var(--cs-dark);
    display: flex;
    align-items: center;
    justify-content: center;
    max-height: 200px;
    overflow: hidden;
  }

  .scan-thumb {
    width: 100%;
    max-height: 200px;
    object-fit: contain;
    display: block;
  }

  .scan-fields {
    display: flex;
    flex-direction: column;
    padding: 12px 14px;
    gap: 8px;
  }

  .scan-field-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .scan-field-label {
    color: var(--cs-text-mid);
    flex-shrink: 0;
  }

  .scan-field-value {
    color: var(--cs-text);
    font-weight: 600;
    text-align: right;
    word-break: break-all;
  }

  .scan-raw-text {
    font-size: 13px;
    color: var(--cs-text);
    margin: 0;
    word-break: break-all;
    white-space: pre-wrap;
  }

  .device-scanning-msg {
    text-align: center;
    font-size: 13px;
    color: var(--cs-text-mid);
    padding: 8px 0;
  }

  .ocr-result-card {
    background: rgba(59,47,138,0.04);
    border-radius: var(--radius-sm);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .label-image-wrap {
    width: 100%;
    background: var(--cs-dark);
    display: flex;
    align-items: center;
    justify-content: center;
    max-height: 200px;
    overflow: hidden;
  }

  .label-image {
    width: 100%;
    max-height: 200px;
    object-fit: contain;
    display: block;
  }

  .ocr-fields-list {
    display: flex;
    flex-direction: column;
    padding: 8px 12px;
    gap: 6px;
  }

  .ocr-field-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .ocr-field-label {
    font-size: 11px;
    color: var(--cs-text-light);
    min-width: 90px;
    flex-shrink: 0;
    padding-top: 1px;
  }

  .ocr-field-value {
    font-size: 13px;
    font-family: monospace;
    color: var(--cs-text);
    word-break: break-all;
  }

  .ocr-raw-text {
    padding: 8px 12px;
    font-size: 12px;
    color: var(--cs-text-mid);
    word-break: break-all;
    white-space: pre-wrap;
  }

  .ocr-section {
    border-top: 1px solid var(--cs-border);
    padding-top: 12px;
  }
</style>
