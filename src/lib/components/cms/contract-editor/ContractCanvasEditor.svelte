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
   * 필드 타입:
   *   - v1: signature / text / label 3종
   *   - v2: issuer-image 추가 (발행자 서명·직인 이미지 배치 — ContractCanvasFieldPalette에서 자산 선택)
   *   - EC-1: 빈 PDF 거부 (pdfRasterize 내부에서 처리)
   *   - EC-3: 저장 전 signature 필드 최소 1개 필수 검증은 상위 컴포넌트 책임
   *   - CmsContentEditor.svelte 미수정 (공유 컴포넌트 격리 원칙)
   *   - Supabase 직접 import 없음 (onSave/onUploadPage 어댑터 콜백 위임, Phase 9 원칙)
   */

  import { browser } from '$app/environment'
  import { csToast } from '$lib/utils/toast'
  import ContractCanvasFieldPalette from './ContractCanvasFieldPalette.svelte'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import { hasSignatureField } from '$lib/types/contract-document'
  import MediaViewer from '$lib/components/common/MediaViewer.svelte'
  import type { MediaViewerItem } from '$lib/types/media-viewer'
  import { fieldStyle, getContentRectPx } from '$lib/utils/canvasLetterbox'
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
    /** 툴바의 자체 [저장] 버튼 표시 — 호스트가 하단 저장 줄(다른 작성 모드와 같은 위치)에서 save()를 호출하면 false */
    showSaveButton?: boolean
  }

  let {
    initialDoc   = null,
    title: titleProp = '',
    specifications: specsProp = [],
    onUploadPage,
    onSave,
    readonly = false,
    showSaveButton = true,
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
  // 우측 필드 팔레트 접기/펼치기 — 문서형 변수 패널과 같은 아이콘·저장 키(cs-contracts-fieldpanel-open)를 써 한 번 정한 상태가 두 모드에서 같게 유지된다
  const PALETTE_OPEN_KEY = 'cs-contracts-fieldpanel-open'
  let paletteOpen = $state(true)
  $effect(() => {
    try { if (localStorage.getItem(PALETTE_OPEN_KEY) === '0') paletteOpen = false } catch { /* 저장소 접근 불가 시 기본값 */ }
  })
  function togglePalette() {
    paletteOpen = !paletteOpen
    try { localStorage.setItem(PALETTE_OPEN_KEY, paletteOpen ? '1' : '0') } catch { /* 저장 실패 무시 */ }
  }

  function triggerPageUpload() {
    pageFileInput?.click()
  }

  async function onPageFileChange(event: Event) {
    if (readonly) return
    const input  = event.target as HTMLInputElement
    const file   = input.files?.[0]
    if (!file) return
    input.value = ''  // 동일 파일 재선택 허용
    await addBackgroundFile(file)
  }

  /** 배경 파일(PNG·JPEG·WebP·PDF) 1개를 배경 페이지로 추가 — 파일 선택창과 "문서 가져오기에서 넘어온 PDF"가 함께 쓴다 */
  export async function addBackgroundFile(file: File): Promise<void> {
    if (readonly) return

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    // accept 속성은 드래그앤드롭·OS 파일선택기의 "모든 파일" 옵션으로 우회될 수 있으므로,
    // 서버(canvas-bg/+server.ts ALLOWED)와 동일한 허용 목록으로 여기서도 명시 검증한다
    // (HEIC/HEIF 등은 서버가 어차피 거부 — 여기서 먼저 걸러 왕복 없이 즉시 안내)
    const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
    const isImg = ALLOWED_IMAGE_TYPES.has(file.type)

    if (!isPdf && !isImg) {
      csToast.error('PNG, JPEG, WebP 이미지 또는 PDF 파일만 배경으로 사용할 수 있습니다.')
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
  // 이미지 더블클릭 → 공통 이미지 뷰어(편집 포함)
  // 배경 페이지와 발행자 이미지(서명·직인) 전체가 한 목록으로 열려 썸네일 정렬에 모두 나열된다.
  // 배경 페이지는 크기·방향이 바뀌면 필드 위치가 어긋나므로 명암·컬러감만 편집할 수 있고, 발행자 이미지는 모든 편집 메뉴를 쓴다.
  // 편집 결과는 새 파일로 올려(onUploadPage) 해당 페이지·필드의 이미지 주소만 교체한다(공용 서명·직인 자산 원본은 그대로).
  // --------------------------------------------------------------------------
  type ViewerRef = { kind: 'page' | 'field'; id: string }
  let viewer = $state<{ items: MediaViewerItem[]; refs: ViewerRef[]; index: number } | null>(null)

  function openViewer(target: ViewerRef) {
    const items: MediaViewerItem[] = []
    const refs: ViewerRef[] = []
    pages.forEach((p, i) => {
      items.push({ url: p.imageUrl, name: `계약서 배경 페이지 ${i + 1}`, editTools: ['light', 'tone'] })
      refs.push({ kind: 'page', id: p.id })
    })
    for (const f of fields) {
      if (f.type === 'issuer-image' && f.imageUrl) {
        items.push({ url: f.imageUrl, name: f.label || '발행자 이미지' })
        refs.push({ kind: 'field', id: f.id })
      }
    }
    const index = Math.max(refs.findIndex((r) => r.kind === target.kind && r.id === target.id), 0)
    if (items.length === 0) return
    viewer = { items, refs, index }
  }

  async function saveViewerImage(i: number, blob: Blob): Promise<boolean> {
    const v = viewer
    const ref = v?.refs[i]
    if (!v || !ref || readonly) return false
    try {
      const url = await uploadPageBlob(blob, `edited_${Date.now()}.webp`)
      if (ref.kind === 'page') {
        // 페이지 크기 정보도 새 이미지에 맞춘다(명암·컬러감 편집은 크기가 같지만, 큰 이미지는 편집 중 축소될 수 있다)
        const size = await getImageSize(url).catch(() => null)
        pages = pages.map((p) => (p.id === ref.id ? { ...p, imageUrl: url, ...(size ? { width: size.w, height: size.h } : {}) } : p))
      } else {
        fields = fields.map((f) => (f.id === ref.id ? { ...f, imageUrl: url } : f))
      }
      viewer = { ...v, items: v.items.map((it, k) => (k === i ? { ...it, url } : it)) }
      return true
    } catch (err) {
      csToast.error(err instanceof Error ? err.message : '편집한 이미지를 저장하지 못했습니다.')
      return false
    }
  }

  // --------------------------------------------------------------------------
  // 페이지 클릭 → 필드 배치
  // --------------------------------------------------------------------------
  function onPageClick(event: MouseEvent, page: CanvasPage) {
    if (readonly) return
    if (!placingType) return

    // 이미 드래그 중이면 배치 무시
    if (dragging) return

    const frameRect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const content    = getContentRectPx(page, frameRect)

    // 레터박스 여백(실제 이미지 바깥의 A4 프레임 여백) 클릭은 무시 —
    // 스캔된 문서 바깥에는 필드를 배치할 수 없음
    if (
      event.clientX < content.left || event.clientX > content.left + content.width ||
      event.clientY < content.top  || event.clientY > content.top  + content.height
    ) {
      return
    }

    const x = Math.round((event.clientX - content.left) / content.scale)
    const y = Math.round((event.clientY - content.top)  / content.scale)

    // 기본 크기 (필드 타입별)
    const defaults: Record<CanvasFieldType, { w: number; h: number }> = {
      signature:      { w: 200, h: 80 },
      text:           { w: 200, h: 36 },
      label:          { w: 150, h: 28 },
      'issuer-image': { w: 160, h: 100 },
    }
    const { w, h } = defaults[placingType]

    // 페이지 경계 보정 (EC-2)
    const clampedX = Math.max(0, Math.min(x - Math.round(w / 2), page.width  - w))
    const clampedY = Math.max(0, Math.min(y - Math.round(h / 2), page.height - h))

    const LABEL_MAP: Record<CanvasFieldType, string> = {
      signature:      '서명',
      text:           '텍스트',
      label:          '라벨',
      'issuer-image': '발행자 이미지',
    }

    const newField: CanvasField = {
      id:         crypto.randomUUID(),
      pageId:     page.id,
      type:       placingType,
      x:          clampedX,
      y:          clampedY,
      width:      w,
      height:     h,
      required:   placingType === 'signature',
      label:      LABEL_MAP[placingType],
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

    const frameRect = dragging.pageEl.getBoundingClientRect()
    const content    = getContentRectPx(page, frameRect)

    const rawX = (event.clientX - content.left - dragging.pointerOffsetX) / content.scale
    const rawY = (event.clientY - content.top  - dragging.pointerOffsetY) / content.scale

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
  /** 저장 실행 — 툴바 버튼과 호스트의 하단 저장 줄이 함께 쓴다 */
  export async function save(): Promise<void> {
    await handleSave()
  }

  async function handleSave() {
    if (!onSave) return
    // EC-3: 서명 필드 최소 1개 필수 — 클라이언트 검증 (서버에서도 재검증됨)
    if (!hasSignatureField(currentDoc)) {
      csToast.error('서명 필드가 최소 1개 이상 있어야 저장할 수 있습니다.')
      return
    }
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

<!--
  숨겨진 파일 입력 (이미지/PDF) — accept는 서버(canvas-bg/+server.ts ALLOWED)와 정확히 일치시킬 것.
  HEIF/HEIC는 의도적으로 제외: ① 서버가 거부하고(png/jpeg/webp만 허용) ② 설령 허용해도
  대부분 브라우저(Safari 제외)가 <img src>로 HEIC를 직접 렌더링하지 못해 배경이 깨져 보임.
  전역 표준 업로드 포맷(uiux-index.md, PNG/JPEG/WebP/HEIF/PDF)의 예외 케이스임.
-->
<input
  bind:this={pageFileInput}
  type="file"
  accept="image/png,image/jpeg,image/webp,application/pdf"
  style="display:none"
  onchange={onPageFileChange}
/>

<div class="canvas-editor">
  <!-- 메인 영역 -->
  <div class="main-area">
    <!-- 툴바 -->
    <div class="toolbar">
      <button
        class="btn-add-page"
        onclick={triggerPageUpload}
        disabled={readonly || uploading}
      >
        {uploading ? '업로드 중...' : '+ 추가'}
      </button>
      <span class="format-hint">PNG · JPEG · WebP · PDF</span>
      {#if pages.length > 0}
        <span class="page-count">{pages.length}페이지</span>
        <span class="field-count">{fields.length}개 필드</span>
      {/if}
      {#if placingType}
        <span class="placing-hint">페이지를 클릭해 필드를 배치하세요</span>
      {/if}
      {#if onSave && showSaveButton}
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
          <p class="empty-sub">상단 "+ 추가" 버튼으로 이미지 또는 PDF를 업로드하세요.</p>
          <p class="empty-format-hint">지원 형식: PNG · JPEG · WebP · PDF</p>
          <button class="btn-add-page-lg" onclick={triggerPageUpload} disabled={readonly}>
            + 추가
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
              ondblclick={() => { if (!placingType) openViewer({ kind: 'page', id: page.id }) }}
            >
              <!-- 배경 이미지 — object-fit:contain으로 A4 프레임 안에 레터박스 표시 -->
              <img
                src={page.imageUrl}
                alt="계약서 배경 페이지 {pi + 1}"
                class="page-bg"
                draggable="false"
              />

              <!-- 필드 오버레이 (fieldStyle: 레터박스 보정된 프레임 기준 % 좌표, C-3) -->
              {#each fields.filter((f) => f.pageId === page.id) as field (field.id)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="canvas-field field-{field.type}"
                  class:selected={selectedFieldId === field.id}
                  style={fieldStyle(field, page)}
                  onclick={(e) => selectField(field.id, e)}
                  ondblclick={(e) => { if (field.type === 'issuer-image' && field.imageUrl) { e.stopPropagation(); openViewer({ kind: 'field', id: field.id }) } }}
                  onpointerdown={(e) => onFieldPointerDown(e, field)}
                  role="button"
                  tabindex="0"
                  aria-label="{field.label} 필드"
                >
                  {#if field.type === 'issuer-image' && field.imageUrl}
                    <img
                      src={field.imageUrl}
                      alt={field.label || '발행자 이미지'}
                      class="field-issuer-img"
                      draggable="false"
                    />
                  {:else}
                    <span class="field-inner">
                      {#if field.type === 'signature'}
                        <span class="field-sig-icon">✍</span>
                        {field.label}
                      {:else if field.type === 'text'}
                        <span class="field-var">
                          {field.boundVariable ? `{{${field.boundVariable}}}` : field.label}
                        </span>
                      {:else if field.type === 'issuer-image'}
                        <span class="field-issuer-icon">🖋</span>
                        {field.label}
                      {:else}
                        {field.label}
                      {/if}
                    </span>
                  {/if}
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

  <!-- 팔레트 사이드바 — 문서형 변수 패널(.panel-col)과 같이 우측 배치 -->
  <div class="palette-col" class:collapsed={!paletteOpen}>
    <div class="palette-col-head">
      <button type="button" class="palette-toggle" onclick={togglePalette} aria-expanded={paletteOpen} aria-label={paletteOpen ? '필드 패널 닫기' : '필드 패널 펼치기'} title={paletteOpen ? '필드 패널 닫기' : '필드 패널 펼치기'}>
        <ChevronIcon direction={paletteOpen ? 'right' : 'left'} size={6} color="currentColor" />
      </button>
    </div>
    <!-- 접을 때는 지우지 않고 숨긴다 — 선택한 필드·자산 목록 상태 유지 -->
    <div class="palette-body" style:display={paletteOpen ? 'flex' : 'none'}>
      <ContractCanvasFieldPalette
        {placingType}
        {selectedField}
        onSelectType={(t) => { if (!readonly) placingType = t }}
        onUpdateField={updateField}
        onDeleteField={deleteField}
      />
    </div>
  </div>
</div>

{#if viewer}
  <MediaViewer
    items={viewer.items}
    bind:index={viewer.index}
    title="계약서 이미지"
    onclose={() => { viewer = null }}
    onSave={readonly ? undefined : saveViewerImage}
  />
{/if}

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

  /* 우측 필드 팔레트 열 — 문서형 변수 패널(.panel-col)과 같은 구성: 상단 접기 버튼 + 본문 */
  .palette-col {
    width: 220px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--cs-surface-gray, #f6f6f6);
    border-left: 1px solid var(--cs-lilac, #ECEBF4);
    transition: width 0.2s ease;
  }
  .palette-col.collapsed { width: 36px; }
  .palette-col-head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    padding: 4px 8px;
    border-bottom: 1px solid var(--cs-lilac, #ECEBF4);
  }
  .palette-col.collapsed .palette-col-head { justify-content: center; padding: 4px 0; border-bottom: none; }
  .palette-toggle {
    width: 28px; height: 28px; min-height: 28px;
    display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: var(--radius-sm, 8px);
    color: var(--cs-text-light, #aaaaaa); font-size: 14px; cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .palette-toggle:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge, #FF3535); }
  .palette-body { flex: 1; min-height: 0; flex-direction: column; overflow: hidden; }

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

  .format-hint {
    font-size: 11px;
    color: #999;
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
  .empty-format-hint { font-size: 12px; color: #aaa; margin: 0; }
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
    /* A4 비율(210:297) 고정 — 업로드 이미지 원본 비율과 무관(C-3, Stephen 확정).
       이미지는 .page-bg의 object-fit:contain으로 이 프레임 안에 레터박스 표시되고,
       필드 좌표는 fieldStyle()/getContentRectPx()가 레터박스 여백을 보정해 계산한다. */
    aspect-ratio: 210 / 297;
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
  .canvas-field.field-issuer-image {
    border-color: rgba(0, 120, 80, 0.5);
    border-style: dashed;
    background: rgba(0, 120, 80, 0.04);
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
  .field-issuer-icon { font-size: 1.2em; }
  .field-var {
    font-size: inherit;
    color: var(--cs-text, #100B32);
    opacity: 0.7;
    font-style: italic;
  }
  .field-issuer-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
    display: block;
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
