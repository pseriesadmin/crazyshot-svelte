<script lang="ts">
  /**
   * ContractCanvasEditor.svelte — canvas 모드 계약서 에디터 (Phase 6, P6-3)
   *
   * 기능:
   *   1. 배경 이미지 업로드 (이미지 그대로 / PDF → pdfRasterize 래스터화)
   *   2. ContractCanvasFieldPalette에서 필드 타입 선택 → 페이지 클릭으로 배치
   *   3. 배치된 필드 드래그로 이동 (Pointer Events)
   *   4. 필드 선택 → 팔레트 속성 패널에서 편집
   *   5. 변경 즉시 onchange(CanvasDocument) 콜백으로 통보
   *
   * 제약:
   *   - v1 필드 타입: signature / text / label 3종 (과설계 금지)
   *   - EC-1: 빈 PDF 거부 (pdfRasterize 내부에서 처리)
   *   - EC-3: 저장 전 signature 필드 최소 1개 필수 검증은 상위 컴포넌트 책임
   *   - CmsContentEditor.svelte 미수정 (공유 컴포넌트 격리 원칙)
   *   - Supabase 직접 import 없음 (onSave/onUploadPage 어댑터 콜백 위임, Phase 9 원칙)
   */

  import { browser } from '$app/environment'
  import { csToast } from '$lib/utils/toast'
  import ContractCanvasFieldPalette from './ContractCanvasFieldPalette.svelte'
  import type {
    CanvasDocument,
    CanvasField,
    CanvasFieldType,
    CanvasPage,
    ContractCanvasPayload,
  } from '$lib/types/contract-document'

  // --------------------------------------------------------------------------
  // Props
  // --------------------------------------------------------------------------
  interface Props {
    /** 초기 canvas 문서 (없으면 빈 문서로 시작) */
    initialDoc?: CanvasDocument | null
    /** 계약서 제목 */
    title?: string
    /** 특약 조항 */
    specifications?: { key: string; value: string }[]
    /**
     * 배경 이미지 업로드 콜백.
     * Blob을 받아 URL(Supabase Storage 등)을 반환. 미제공 시 Data URL 사용(개발용).
     */
    onUploadPage?: (blob: Blob, fileName: string) => Promise<string>
    /** 저장 콜백 (Supabase 직접 호출 대신 어댑터 위임) */
    onSave?: (payload: ContractCanvasPayload) => Promise<void>
    /** 편집 비활성화 */
    readonly?: boolean
  }

  let {
    initialDoc   = null,
    title: titleProp = '',
    specifications: specsProp = [],
    onUploadPage,
    onSave,
    readonly = false,
  }: Props = $props()

  // --------------------------------------------------------------------------
  // 문서 상태
  // $state 기본값 + $effect 동기화 패턴 (Pattern 1) — prop 참조를 $state() 초기화에서 제거.
  // $effect는 마운트 직후 첫 번째 페인트 이전에 실행되므로 빈 캔버스 깜빡임 없음.
  // --------------------------------------------------------------------------
  let pages  = $state<CanvasPage[]>([])
  let fields = $state<CanvasField[]>([])
  let title  = $state<string>('')

  $effect(() => {
    pages  = initialDoc?.pages  ?? []
    fields = initialDoc?.fields ?? []
    title  = titleProp
  })

  // --------------------------------------------------------------------------
  // UI 상태
  // --------------------------------------------------------------------------
  let placingType     = $state<CanvasFieldType | null>(null)
  let selectedFieldId = $state<string | null>(null)
  let saving          = $state(false)
  let uploading       = $state(false)
  let pageFileInput: HTMLInputElement | null = $state(null)

  // 드래그 상태
  interface DragState {
    fieldId: string
    pointerOffsetX: number  // 포인터 → 필드 좌측 모서리 거리
    pointerOffsetY: number
    pageEl: HTMLElement
    pageId: string
  }
  let dragging = $state<DragState | null>(null)

  // --------------------------------------------------------------------------
  // 파생 값
  // --------------------------------------------------------------------------
  const selectedField = $derived<CanvasField | null>(
    fields.find((f) => f.id === selectedFieldId) ?? null,
  )

  const currentDoc = $derived<CanvasDocument>({ pages, fields })

  // --------------------------------------------------------------------------
  // 페이지 업로드 처리
  // --------------------------------------------------------------------------
  function triggerPageUpload() {
    pageFileInput?.click()
  }

  async function onPageFileChange(event: Event) {
    if (readonly) return
    const input  = event.target as HTMLInputElement
    const file   = input.files?.[0]
    if (!file) return
    input.value = ''  // 동일 파일 재선택 허용

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    const isImg = file.type.startsWith('image/')

    if (!isPdf && !isImg) {
      csToast.error('이미지(PNG/JPEG/WebP) 또는 PDF 파일만 배경으로 사용할 수 있습니다.')
      return
    }

    // EC-1: 빈 PDF 체크는 pdfRasterize 내부에서 수행
    uploading = true
    try {
      if (isPdf) {
        // PDF → 클라이언트 래스터화 (P6-2)
        if (!browser) {
          csToast.error('PDF 래스터화는 브라우저에서만 가능합니다.')
          return
        }
        const { rasterizePdf } = await import('$lib/utils/pdfRasterize')
        const rasterized = await rasterizePdf(file)
        for (const rp of rasterized) {
          const url = await uploadPageBlob(rp.blob, `page_${Date.now()}_${rp.pageNum}.png`)
          const id  = crypto.randomUUID()
          pages = [...pages, { id, imageUrl: url, width: rp.width, height: rp.height }]
        }
        csToast.success(`PDF ${rasterized.length}페이지를 배경으로 추가했습니다.`)
      } else {
        // 이미지 직접 사용
        const imgBlob  = file
        const imgUrl   = await uploadPageBlob(imgBlob, file.name)
        const { w, h } = await getImageSize(imgUrl)
        const id       = crypto.randomUUID()
        pages = [...pages, { id, imageUrl: imgUrl, width: w, height: h }]
      }
    } catch (err) {
      csToast.error(err instanceof Error ? err.message : '배경 추가에 실패했습니다.')
    } finally {
      uploading = false
    }
  }

  /** Blob → URL 변환 (onUploadPage 콜백 있으면 위임, 없으면 Data URL 사용) */
  async function uploadPageBlob(blob: Blob, fileName: string): Promise<string> {
    if (onUploadPage) {
      return await onUploadPage(blob, fileName)
    }
    // 개발 폴백: Data URL (큰 파일에는 부적합하나 개발 환경에서 동작 확인 용도)
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = (e) => resolve(e.target?.result as string)
      reader.onerror = () => reject(new Error('파일 읽기 실패'))
      reader.readAsDataURL(blob)
    })
  }

  /** 이미지 URL에서 자연 크기 추출 */
  function getImageSize(url: string): Promise<{ w: number; h: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload  = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => reject(new Error('이미지 크기를 읽을 수 없습니다.'))
      img.src     = url
    })
  }

  // --------------------------------------------------------------------------
  // 페이지 클릭 → 필드 배치
  // --------------------------------------------------------------------------
  function onPageClick(event: MouseEvent, page: CanvasPage) {
    if (readonly) return
    if (!placingType) return

    // 이미 드래그 중이면 배치 무시
    if (dragging) return

    const rect  = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const scale = rect.width / page.width
    const x     = Math.round((event.clientX - rect.left) / scale)
    const y     = Math.round((event.clientY - rect.top)  / scale)

    // 기본 크기 (필드 타입별)
    const defaults: Record<CanvasFieldType, { w: number; h: number }> = {
      signature: { w: 200, h: 80 },
      text:      { w: 200, h: 36 },
      label:     { w: 150, h: 28 },
    }
    const { w, h } = defaults[placingType]

    // 페이지 경계 보정 (EC-2)
    const clampedX = Math.max(0, Math.min(x - Math.round(w / 2), page.width  - w))
    const clampedY = Math.max(0, Math.min(y - Math.round(h / 2), page.height - h))

    const newField: CanvasField = {
      id:         crypto.randomUUID(),
      pageId:     page.id,
      type:       placingType,
      x:          clampedX,
      y:          clampedY,
      width:      w,
      height:     h,
      required:   placingType === 'signature',
      label:      placingType === 'signature' ? '서명' : placingType === 'text' ? '텍스트' : '라벨',
    }
    fields = [...fields, newField]
    selectedFieldId = newField.id
    placingType     = null  // 배치 후 배치 모드 해제
  }

  // --------------------------------------------------------------------------
  // 필드 선택 / 삭제
  // --------------------------------------------------------------------------
  function selectField(id: string, e: Event) {
    e.stopPropagation()
    if (!readonly) selectedFieldId = id
  }

  function deleteField(id: string) {
    fields = fields.filter((f) => f.id !== id)
    if (selectedFieldId === id) selectedFieldId = null
  }

  function updateField(updated: CanvasField) {
    fields = fields.map((f) => (f.id === updated.id ? updated : f))
  }

  // --------------------------------------------------------------------------
  // 드래그 이동 (Pointer Events)
  // --------------------------------------------------------------------------
  function onFieldPointerDown(event: PointerEvent, field: CanvasField) {
    if (readonly || placingType) return
    event.stopPropagation()
    event.preventDefault()

    const el    = event.currentTarget as HTMLElement
    const pageEl = el.closest('.canvas-page') as HTMLElement | null
    if (!pageEl) return

    el.setPointerCapture(event.pointerId)
    const rect  = el.getBoundingClientRect()
    dragging = {
      fieldId: field.id,
      pointerOffsetX: event.clientX - rect.left,
      pointerOffsetY: event.clientY - rect.top,
      pageEl,
      pageId: field.pageId,
    }
    selectedFieldId = field.id
  }

  function onFieldPointerMove(event: PointerEvent) {
    if (!dragging) return

    const page = pages.find((p) => p.id === dragging!.pageId)
    if (!page) return

    const pageRect = dragging.pageEl.getBoundingClientRect()
    const scale    = pageRect.width / page.width

    const rawX = (event.clientX - pageRect.left - dragging.pointerOffsetX) / scale
    const rawY = (event.clientY - pageRect.top  - dragging.pointerOffsetY) / scale

    const field  = fields.find((f) => f.id === dragging!.fieldId)
    if (!field) return

    const newX = Math.max(0, Math.min(Math.round(rawX), page.width  - field.width))
    const newY = Math.max(0, Math.min(Math.round(rawY), page.height - field.height))

    fields = fields.map((f) =>
      f.id === dragging!.fieldId ? { ...f, x: newX, y: newY } : f,
    )
  }

  function onFieldPointerUp() {
    dragging = null
  }

  // --------------------------------------------------------------------------
  // 배경 없이 캔버스 클릭 → 선택 해제
  // --------------------------------------------------------------------------
  function clearSelection() {
    if (!placingType) selectedFieldId = null
  }

  // --------------------------------------------------------------------------
  // 저장
  // --------------------------------------------------------------------------
  async function handleSave() {
    if (!onSave) return
    saving = true
    try {
      await onSave({
        title,
        canvasDocument: currentDoc,
        specifications: specsProp,
      })
      csToast.success('저장되었습니다.')
    } catch {
      csToast.error('저장에 실패했습니다.')
    } finally {
      saving = false
    }
  }
</script>

<!-- 숨겨진 파일 입력 (이미지/PDF) -->
<input
  bind:this={pageFileInput}
  type="file"
  accept="image/png,image/jpeg,image/webp,image/heif,image/heic,application/pdf"
  style="display:none"
  onchange={onPageFileChange}
/>

<div class="canvas-editor">
  <!-- 팔레트 사이드바 -->
  <ContractCanvasFieldPalette
    {placingType}
    {selectedField}
    onSelectType={(t) => { if (!readonly) placingType = t }}
    onUpdateField={updateField}
    onDeleteField={deleteField}
  />

  <!-- 메인 영역 -->
  <div class="main-area">
    <!-- 툴바 -->
    <div class="toolbar">
      <button
        class="btn-add-page"
        onclick={triggerPageUpload}
        disabled={readonly || uploading}
      >
        {uploading ? '업로드 중...' : '+ 배경 추가'}
      </button>
      {#if pages.length > 0}
        <span class="page-count">{pages.length}페이지</span>
        <span class="field-count">{fields.length}개 필드</span>
      {/if}
      {#if placingType}
        <span class="placing-hint">페이지를 클릭해 필드를 배치하세요</span>
      {/if}
      {#if onSave}
        <button
          class="btn-save"
          onclick={handleSave}
          disabled={saving || readonly}
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      {/if}
    </div>

    <!-- 캔버스 스크롤 영역 -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="canvas-scroll"
      class:placing={!!placingType}
      onclick={clearSelection}
      onpointermove={onFieldPointerMove}
      onpointerup={onFieldPointerUp}
    >
      {#if pages.length === 0}
        <div class="empty-state">
          <p class="empty-title">배경 페이지가 없습니다</p>
          <p class="empty-sub">상단 "+ 배경 추가" 버튼으로 이미지 또는 PDF를 업로드하세요.</p>
          <button class="btn-add-page-lg" onclick={triggerPageUpload} disabled={readonly}>
            + 배경 추가
          </button>
        </div>
      {:else}
        {#each pages as page, pi (page.id)}
          <div class="page-wrapper">
            <div class="page-num">페이지 {pi + 1}</div>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="canvas-page"
              class:placing={!!placingType}
              onclick={(e) => onPageClick(e, page)}
              style="aspect-ratio: {page.width} / {page.height};"
            >
              <!-- 배경 이미지 -->
              <img
                src={page.imageUrl}
                alt="계약서 배경 페이지 {pi + 1}"
                class="page-bg"
                draggable="false"
              />

              <!-- 필드 오버레이 -->
              {#each fields.filter((f) => f.pageId === page.id) as field (field.id)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="canvas-field field-{field.type}"
                  class:selected={selectedFieldId === field.id}
                  style="
                    left:   {(field.x / page.width)  * 100}%;
                    top:    {(field.y / page.height) * 100}%;
                    width:  {(field.width  / page.width)  * 100}%;
                    height: {(field.height / page.height) * 100}%;
                  "
                  onclick={(e) => selectField(field.id, e)}
                  onpointerdown={(e) => onFieldPointerDown(e, field)}
                  role="button"
                  tabindex="0"
                  aria-label="{field.label} 필드"
                >
                  <span class="field-inner">
                    {#if field.type === 'signature'}
                      <span class="field-sig-icon">✍</span>
                      {field.label}
                    {:else if field.type === 'text'}
                      <span class="field-var">
                        {field.boundVariable ? `{{${field.boundVariable}}}` : field.label}
                      </span>
                    {:else}
                      {field.label}
                    {/if}
                  </span>
                  {#if !readonly}
                    <button
                      class="field-del-btn"
                      onclick={(e) => { e.stopPropagation(); deleteField(field.id) }}
                      aria-label="필드 삭제"
                    >✕</button>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .canvas-editor {
    display: flex;
    height: 100%;
    min-height: 400px;
    background: var(--cs-surface-gray, #f6f6f6);
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--radius-sm, 8px);
    overflow: hidden;
  }

  /* 메인 영역 */
  .main-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* 툴바 */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: #fff;
    border-bottom: 1px solid var(--cs-lilac, #ECEBF4);
    flex-shrink: 0;
  }
  .btn-add-page {
    padding: 5px 12px;
    background: var(--cs-purple, #3B2F8A);
    color: #fff;
    border: none;
    border-radius: var(--radius-sm, 8px);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    min-height: 30px;
    transition: opacity 0.15s;
  }
  .btn-add-page:disabled { opacity: 0.6; cursor: not-allowed; }

  .page-count,
  .field-count {
    font-size: 11px;
    color: #888;
    background: var(--cs-lilac, #ECEBF4);
    padding: 2px 8px;
    border-radius: 99px;
  }

  .placing-hint {
    font-size: 11px;
    color: var(--cs-purple, #3B2F8A);
    font-weight: 600;
    flex: 1;
    text-align: center;
  }

  .btn-save {
    margin-left: auto;
    padding: 5px 14px;
    background: #fff;
    border: 1.5px solid var(--cs-purple, #3B2F8A);
    color: var(--cs-purple, #3B2F8A);
    border-radius: var(--radius-sm, 8px);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    min-height: 30px;
    transition: all 0.15s;
  }
  .btn-save:hover:not(:disabled) {
    background: var(--cs-purple, #3B2F8A);
    color: #fff;
  }
  .btn-save:disabled { opacity: 0.6; cursor: not-allowed; }

  /* 스크롤 영역 */
  .canvas-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    background: #e8e8e8;
  }
  .canvas-scroll.placing { cursor: crosshair; }

  /* 빈 상태 */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 60px 20px;
    text-align: center;
    flex: 1;
  }
  .empty-title { font-size: 16px; font-weight: 700; color: #444; margin: 0; }
  .empty-sub   { font-size: 13px; color: #888; margin: 0; }
  .btn-add-page-lg {
    padding: 10px 20px;
    background: var(--cs-purple, #3B2F8A);
    color: #fff;
    border: none;
    border-radius: var(--radius-md, 15px);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    min-height: 44px;
  }
  .btn-add-page-lg:disabled { opacity: 0.6; cursor: not-allowed; }

  /* 페이지 */
  .page-wrapper {
    width: 100%;
    max-width: 760px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .page-num {
    font-size: 11px;
    color: #888;
    font-weight: 600;
  }
  .canvas-page {
    position: relative;
    width: 100%;
    background: #fff;
    box-shadow: 0 2px 12px rgba(0,0,0,0.15);
    border-radius: 4px;
    overflow: hidden;
    user-select: none;
  }
  .canvas-page.placing { cursor: crosshair; }

  .page-bg {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
    user-select: none;
  }

  /* 필드 오버레이 */
  .canvas-field {
    position: absolute;
    box-sizing: border-box;
    border: 2px dashed rgba(59, 47, 138, 0.5);
    border-radius: 4px;
    background: rgba(59, 47, 138, 0.06);
    cursor: grab;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    transition: border-color 0.1s, background 0.1s;
  }
  .canvas-field:active { cursor: grabbing; }
  .canvas-field.selected {
    border: 2px solid var(--cs-purple, #3B2F8A);
    background: rgba(59, 47, 138, 0.10);
  }
  .canvas-field.field-signature {
    border-color: rgba(59, 47, 138, 0.6);
    background: rgba(59, 47, 138, 0.08);
  }
  .canvas-field.field-text {
    border-color: rgba(16, 11, 50, 0.4);
    background: rgba(16, 11, 50, 0.04);
  }
  .canvas-field.field-label {
    border-color: rgba(0,0,0,0.3);
    border-style: solid;
    background: rgba(0,0,0,0.02);
  }

  .field-inner {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: clamp(9px, 1.5cqi, 13px);
    font-weight: 600;
    color: var(--cs-purple, #3B2F8A);
    padding: 2px 4px;
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .field-sig-icon { font-size: 1.2em; }
  .field-var {
    font-size: inherit;
    color: var(--cs-text, #100B32);
    opacity: 0.7;
    font-style: italic;
  }

  .field-del-btn {
    position: absolute;
    top: 1px;
    right: 1px;
    width: 18px;
    height: 18px;
    min-width: 18px;
    background: rgba(229, 57, 53, 0.8);
    color: #fff;
    border: none;
    border-radius: 50%;
    font-size: 9px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s;
    padding: 0;
    line-height: 1;
  }
  .canvas-field:hover .field-del-btn,
  .canvas-field.selected .field-del-btn {
    opacity: 1;
  }
</style>
