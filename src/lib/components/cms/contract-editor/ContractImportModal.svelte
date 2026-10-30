<script lang="ts">
  /**
   * ContractImportModal.svelte — 외부 문서(.docx/.xlsx) 임포트 모달
   *
   * - 파일 선택(OS 파일탐색기 트리거·크기/확장자 검증)은 호출부(ContractTemplatePanel /
   *   ContractEditorModal)에서 처리하고, 선택된 File을 initialFile prop으로 전달한다
   *   (2026-08-30 — 트리거 버튼 클릭 → 모달의 별도 "파일 선택" 클릭 2단계를 1단계로 통합)
   * - 파싱은 클라이언트에서 수행 (mammoth / SheetJS)
   * - onImport(docx/hwpx HTML)과 onImportSpreadsheet(xlsx SpreadsheetDocument)
   *   두 콜백으로 결과를 부모에게 전달
   *
   * 지원 포맷:
   *   .docx  → mammoth HTML → TipTap setContent
   *   .xlsx  → 모든 시트 → SpreadsheetDocument → 스프레드시트 에디터 모드
   *   .hwpx / .hwp → hwp-convert 변환(동의 후 진행) → TipTap setContent (실패·암호·배포용은 안내 화면)
   */

  import { onDestroy } from 'svelte'
  import { csToast } from '$lib/utils/toast'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import { CONTRACT_VARIABLE_CATALOG } from '$lib/modules/doc-editor/adapters/crazyshot/contractCatalog'
  import { openHwpPreview, suggestVariable, svgToObjectUrl, type HwpPreviewSession } from '$lib/utils/docImport/rhwpPreview'
  import { importDocx } from '$lib/utils/docImport/docxImport'
  import {
    importWorkbookWithStats,
    countTotalRows,
    type FormulaLinkStats,
  } from '$lib/utils/docImport/xlsxToSpreadsheetDocument'
  import { FEATURE_HWPX_EXPERIMENTAL, importHwpx, importHwp } from '$lib/utils/docImport/hwpxImport'
  import type { SpreadsheetDocument } from '$lib/types/contract-document'
  import {
    extractWorkbookImages,
    placeImageInSheet,
    applyImageMarkers,
    type SheetImage,
    type ImagePlacement,
  } from '$lib/utils/docImport/xlsxImages'

  // --------------------------------------------------------------------------
  // Props
  // --------------------------------------------------------------------------
  interface Props {
    /** 호출부에서 이미 선택·검증(크기/확장자)까지 마친 파일 — 모달은 이 파일을 즉시 처리한다 */
    initialFile: File
    onclose: () => void
    /** docx/hwpx → HTML 문자열 */
    onImport: (result: { type: 'html'; html: string }) => void
    /** xlsx → SpreadsheetDocument (스프레드시트 에디터 모드 전환) */
    onImportSpreadsheet?: (doc: SpreadsheetDocument) => void
    /** 엑셀 안 그림(직인·서명 등)을 저장소에 올리고 공개 주소를 돌려준다. 없으면 그림은 가져오지 않는다 */
    onUploadImage?: (blob: Blob, fileName: string) => Promise<string>
    /** '다시 선택'·'다른 파일 선택' — 모달을 닫고 파일 선택창을 다시 연다(호출부가 파일 input 을 가지고 있음). 없으면 그냥 닫는다 */
    onreselect?: () => void
  }

  let { initialFile, onclose, onImport, onImportSpreadsheet, onUploadImage, onreselect }: Props = $props()

  // --------------------------------------------------------------------------
  // 상태
  // --------------------------------------------------------------------------
  type Step =
    | 'docx-preview'
    | 'xlsx-spreadsheet-preview'    // xlsx → 모든 시트 → 스프레드시트 에디터 모드
    | 'hwp-notice'                  // P5-1: .hwp / .hwpx 기본 안내 모달
    | 'hwpx-preview'                // P5-2: .hwpx 변환 결과 미리보기
    | 'loading'

  let step        = $state<Step>('loading')
  let selectedFile: File | null            = $state(initialFile)
  let fileType:     'docx' | 'xlsx' | 'hwp' | 'hwpx' | null = $state(null)

  // docx 상태
  let docxHtml     = $state('')
  let docxWarnings = $state<string[]>([])

  // xlsx 스프레드시트 상태
  let xlsxSpreadsheetDoc = $state<SpreadsheetDocument | null>(null)
  let xlsxTotalRows      = $state(0)
  let xlsxFormulaStats   = $state<FormulaLinkStats>({ linked: 0, valueOnly: 0 })
  /** 엑셀 안에서 찾은 그림(올리기 전) — 시트 번호·위치·파일 */
  let xlsxImages         = $state<{ sheetIndex: number; placement: ImagePlacement; image: SheetImage }[]>([])
  let xlsxImagesSkipped  = $state(0)

  // hwpx 실험 파싱 상태
  let hwpxHtml         = $state('')
  let hwpxWarnings     = $state<string[]>([])
  let hwpError         = $state('')       // 변환 실패 이유(안내 화면에 표시)

  // --------------------------------------------------------------------------
  // 파일 라우팅 — 호출부에서 이미 검증된 initialFile을 확장자별로 분기 처리
  // --------------------------------------------------------------------------
  function routeFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'docx') {
      fileType = 'docx'
      processDocx(file)
    } else if (ext === 'xlsx' || ext === 'xls') {
      fileType = 'xlsx'
      processXlsxAsSpreadsheet(file)
    } else if (ext === 'hwp' || ext === 'hwpx') {
      // .hwp(HWP 5.0 이진)·.hwpx 모두 hwp-convert 로 변환 — feature-flag 꺼짐 시 안내 모달
      fileType = ext
      hwpError = ''
      if (FEATURE_HWPX_EXPERIMENTAL) {
        // 별도 동의 화면 없이 바로 변환한다 — 변환 결과는 미리보기에서 확인한 뒤 "이 내용으로 가져오기"를 눌러야 반영되므로
        // (손실 안내는 미리보기 상단에 함께 표시) 사전 동의 단계는 불필요하다.
        void startHwpxExperimentalParse()
      } else {
        step = 'hwp-notice'
      }
    }
  }

  routeFile(initialFile)

  // --------------------------------------------------------------------------
  // docx 처리
  // --------------------------------------------------------------------------
  async function processDocx(file: File) {
    step = 'loading'
    try {
      const result = await importDocx(file)
      docxHtml     = result.html
      docxWarnings = result.warnings
      step         = 'docx-preview'
    } catch (err) {
      csToast.error(err instanceof Error ? err.message : '.docx 변환에 실패했습니다.')
      onclose()
    }
  }

  function confirmDocxImport() {
    if (!docxHtml) return
    onImport({ type: 'html', html: docxHtml })
    onclose()
  }

  // --------------------------------------------------------------------------
  // xlsx 처리 — 스프레드시트 모드 (전체 시트 임포트)
  // --------------------------------------------------------------------------
  async function processXlsxAsSpreadsheet(file: File) {
    step = 'loading'
    try {
      const { doc, stats } = await importWorkbookWithStats(file)
      xlsxFormulaStats = stats
      const total = countTotalRows(doc)
      xlsxSpreadsheetDoc = doc
      xlsxTotalRows      = total
      // 그림(직인·서명 등) — 위치만 계산해 두고, 저장소 올리기는 "가져오기"를 확정할 때 한다
      xlsxImages = []
      xlsxImagesSkipped = 0
      if (onUploadImage) {
        const found = await extractWorkbookImages(await file.arrayBuffer())
        xlsxImagesSkipped = found.skipped
        doc.sheets.forEach((sheet, sheetIndex) => {
          for (const image of found.bySheet.get(sheet.name) ?? []) {
            const placement = placeImageInSheet(sheet, image)
            if (placement) xlsxImages.push({ sheetIndex, placement, image })
          }
        })
      }
      if (total > 5000) {
        csToast.warning(
          `총 ${total.toLocaleString()}행이 감지됐습니다. 5,000행을 초과하면 에디터 성능이 저하될 수 있습니다.`,
        )
      }
      step = 'xlsx-spreadsheet-preview'
    } catch (err) {
      csToast.error(err instanceof Error ? err.message : '.xlsx 로드에 실패했습니다.')
      onclose()
    }
  }

  async function confirmXlsxSpreadsheetImport() {
    if (!xlsxSpreadsheetDoc) return
    let doc = xlsxSpreadsheetDoc
    if (onUploadImage && xlsxImages.length > 0) {
      step = 'loading'
      // 같은 그림이 여러 번 쓰였으면 한 번만 올린다
      const urlByMedia = new Map<string, string>()
      const placed: { sheetIndex: number; placement: ImagePlacement; url: string }[] = []
      let failed = 0
      for (const { sheetIndex, placement, image } of xlsxImages) {
        try {
          let url = urlByMedia.get(image.mediaPath)
          if (!url) {
            const ext = image.mime === 'image/jpeg' ? 'jpg' : image.mime.split('/')[1]
            url = await onUploadImage(new Blob([image.bytes as BlobPart], { type: image.mime }), `xlsx-image.${ext}`)
            urlByMedia.set(image.mediaPath, url)
          }
          placed.push({ sheetIndex, placement, url })
        } catch {
          failed++
        }
      }
      doc = applyImageMarkers(doc, placed)
      if (failed > 0) csToast.warning(`그림 ${failed}개를 올리지 못해 제외했어요. 나머지는 가져왔습니다.`)
    }
    onImportSpreadsheet?.(doc)
    onclose()
  }

  // --------------------------------------------------------------------------
  // P5-2: HWPX 실험 파싱
  // --------------------------------------------------------------------------
  async function startHwpxExperimentalParse() {
    if (!selectedFile) return
    hwpError = ''
    step = 'loading'
    try {
      const result = fileType === 'hwp' ? await importHwp(selectedFile) : await importHwpx(selectedFile)
      hwpxHtml     = result.html
      hwpxWarnings = result.warnings
      hwpxHtmlBase = ''
      linkMessage  = ''
      step         = 'hwpx-preview'
      void loadOriginalPreview(selectedFile)
    } catch (err) {
      // 변환 실패 → 이유와 함께 안내 화면으로 폴백 (console 출력 금지)
      hwpError = err instanceof Error ? err.message : ''
      step = 'hwp-notice'
    }
  }

  // --------------------------------------------------------------------------
  // 원본 미리보기(한글 엔진) + 누름틀 → 변수 연결 (2026-10-29)
  // 본문 변환은 위 기존 변환기가 그대로 맡는다. 엔진(약 3.1MB)은 여기서 처음 불러온다 — 실패해도 가져오기는 그대로 진행된다.
  // --------------------------------------------------------------------------
  const VARIABLE_OPTIONS = [
    { id: '', label: '연결 안 함' },
    ...CONTRACT_VARIABLE_CATALOG.flatMap((g) => g.items.map((i) => ({ id: i.variable, label: i.label, meta: [g.label] }))),
  ]
  const VARIABLE_NAMES = CONTRACT_VARIABLE_CATALOG.flatMap((g) => g.items.map((i) => i.variable))

  const MAX_PREVIEW_PAGES = 400
  let origStatus   = $state<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  let origPageCount = $state(0)
  let origPageIdx   = $state(0)
  let origPageUrl   = $state<string | null>(null)
  let fieldRows     = $state<{ name: string; count: number; variable: string }[]>([])
  let linkBusy      = $state(false)
  let linkMessage   = $state('')
  let hwpxHtmlBase  = $state('')   // 변수 연결 전 변환 결과 — "원래 변환 결과로" 되돌리기용
  let previewSession: HwpPreviewSession | null = null
  let destroyed = false

  function releasePageUrl() {
    if (origPageUrl) URL.revokeObjectURL(origPageUrl)
    origPageUrl = null
  }

  function closePreviewSession() {
    previewSession?.close()
    previewSession = null
    releasePageUrl()
  }

  function showOrigPage(index: number) {
    if (!previewSession) return
    try {
      const url = svgToObjectUrl(previewSession.renderPageSvg(index))
      releasePageUrl()
      origPageUrl = url
      origPageIdx = index
    } catch {
      origStatus = 'failed'
    }
  }

  async function loadOriginalPreview(file: File) {
    origStatus = 'loading'
    try {
      const [{ loadRhwp }, buffer] = await Promise.all([import('$lib/utils/docImport/rhwpLoader'), file.arrayBuffer()])
      const rh = await loadRhwp()
      const session = openHwpPreview(rh, new Uint8Array(buffer))
      if (destroyed) { session.close(); return }
      // 매우 긴 문서는 원본 미리보기를 생략한다(브라우저 탭 부담 방지) — 변환 결과 가져오기는 그대로 된다
      if (session.pageCount > MAX_PREVIEW_PAGES) { session.close(); origStatus = 'failed'; return }
      closePreviewSession()
      previewSession = session
      origPageCount = session.pageCount
      fieldRows = session.fieldGroups.map((g) => ({
        name: g.name,
        count: g.fieldIds.length,
        variable: suggestVariable(g.name, VARIABLE_NAMES) ?? '',
      }))
      origStatus = 'ready'
      showOrigPage(0)
    } catch {
      origStatus = 'failed' // 원본 미리보기·누름틀 연결 없이 기존 화면으로 진행
    }
  }

  async function applyFieldLinks() {
    if (!previewSession || !selectedFile || linkBusy) return
    const mapping: Record<string, string> = {}
    for (const r of fieldRows) if (r.variable) mapping[r.name] = r.variable
    if (Object.keys(mapping).length === 0) {
      linkMessage = '연결할 변수를 하나 이상 선택해 주세요.'
      return
    }
    linkBusy = true
    linkMessage = ''
    try {
      const { bytes, applied, unreflected } = previewSession.exportWithVariables(mapping)
      const base = selectedFile.name.replace(/\.hwpx?$/i, '')
      const result = await importHwp(new File([bytes as BlobPart], `${base}.hwp`))
      if (!hwpxHtmlBase) hwpxHtmlBase = hwpxHtml
      hwpxHtml = result.html
      linkMessage = `누름틀 ${applied}곳을 변수로 연결했어요.` + (unreflected.length ? ` 본문에 나타나지 않아 반영되지 않은 칸: ${unreflected.join(', ')}` : '')
    } catch {
      linkMessage = '변수 연결을 적용하지 못했어요. 연결 없이 가져올 수 있어요.'
    } finally {
      linkBusy = false
    }
  }

  function revertFieldLinks() {
    if (!hwpxHtmlBase) return
    hwpxHtml = hwpxHtmlBase
    hwpxHtmlBase = ''
    linkMessage = '변수 연결 전의 변환 결과로 되돌렸어요.'
  }

  onDestroy(() => {
    destroyed = true
    closePreviewSession()
  })

  function confirmHwpxImport() {
    if (!hwpxHtml) return
    onImport({ type: 'html', html: hwpxHtml })
    onclose()
  }

  /** 같은 클릭 안에서 닫고 선택창을 연다 — 브라우저가 사용자 클릭으로 인정하는 동안 파일 선택창을 열어야 한다 */
  function reselect() {
    onclose()
    onreselect?.()
  }

  // --------------------------------------------------------------------------
  // 키보드 닫기
  // --------------------------------------------------------------------------
  function trapFocus(event: KeyboardEvent) {
    if (event.key === 'Escape') onclose()
  }
</script>

<svelte:window onkeydown={trapFocus} />

<div class="cim-overlay" role="dialog" aria-modal="true" aria-label="문서 가져오기">
  <div class="cim-modal" class:cim-modal--wide={step === 'hwpx-preview' && (origStatus === 'ready' || origStatus === 'loading')}>
    <!-- 헤더 -->
    <div class="cim-header">
      <span class="cim-title">문서 가져오기</span>
      <button type="button" class="close-btn" onclick={onclose} aria-label="닫기">✕</button>
    </div>

    <!-- 본문 -->
    <div class="cim-body">

      {#if step === 'loading'}
        <div class="cim-loading">변환 중...</div>

      {:else if step === 'hwp-notice'}
        <!-- P5-1: HWP / HWPX 기본 안내 모달 -->
        <div class="cim-section">
          <div class="hwp-notice-icon" aria-hidden="true">📄</div>
          <p class="cim-section-title">한글(.hwp/.hwpx) 직접 변환 안내</p>
          <p class="cim-desc">
            {#if hwpError}
              {hwpError}
            {:else}
              선택한 <strong>.{fileType === 'hwpx' ? 'hwpx' : 'hwp'}</strong> 파일은 현재 직접 변환 기능이 비활성화되어 있습니다.
            {/if}
          </p>
          <div class="hwp-notice-steps">
            <p class="notice-title">아래 순서로 Word 문서로 변환 후 다시 업로드해주세요:</p>
            <ol class="notice-list">
              <li>한글(한컴오피스)에서 해당 파일을 엽니다.</li>
              <li>메뉴 <strong>파일 → 다른 이름으로 저장</strong>을 선택합니다.</li>
              <li>파일 형식을 <strong>Word 문서(.docx)</strong>로 선택합니다.</li>
              <li>저장한 .docx 파일로 다시 업로드합니다.</li>
            </ol>
          </div>
        </div>
        <div class="cim-footer">
          <button type="button" class="btn-cancel" onclick={reselect}>
            다른 파일 선택
          </button>
          <button type="button" class="btn-action" onclick={onclose}>확인</button>
        </div>

      {:else if step === 'hwpx-preview'}
        <!-- P5-2: HWPX 변환 결과 미리보기 -->
        <div class="cim-section">
          <p class="cim-section-title">한글 문서 변환 결과 미리보기</p>
          <p class="cim-desc">표·글자 서식은 가져옵니다. 차트·OLE 개체 등은 빠질 수 있어요. 아래 내용을 확인한 뒤 가져오기를 눌러 주세요.</p>
          {#if hwpxWarnings.length > 0}
            <div class="warn-banner">
              <strong>변환 경고:</strong>
              <ul class="warn-list">
                {#each hwpxWarnings as w}
                  <li>{w}</li>
                {/each}
              </ul>
            </div>
          {/if}
          <div class="hwp-compare" class:hwp-compare--two={origStatus === 'ready' || origStatus === 'loading'}>
            {#if origStatus === 'ready' || origStatus === 'loading'}
              <!-- 원본(한글) 쪽 그림 — SVG 는 {@html} 이 아니라 <img src=blob:> 로만 표시한다(스크립트 실행 차단) -->
              <div class="hwp-pane">
                <div class="hwp-pane-head">
                  <span class="hwp-pane-title">원본 (한글){#if origStatus === 'ready'} · {origPageIdx + 1} / {origPageCount}쪽{/if}</span>
                  {#if origStatus === 'ready' && origPageCount > 1}
                    <span class="hwp-pager">
                      <button type="button" class="hwp-pager-btn" aria-label="이전 쪽" disabled={origPageIdx <= 0} onclick={() => showOrigPage(origPageIdx - 1)}><ChevronIcon direction="left" size={8} color="currentColor" /></button>
                      <button type="button" class="hwp-pager-btn" aria-label="다음 쪽" disabled={origPageIdx >= origPageCount - 1} onclick={() => showOrigPage(origPageIdx + 1)}><ChevronIcon direction="right" size={8} color="currentColor" /></button>
                    </span>
                  {/if}
                </div>
                <div class="hwp-orig-box">
                  {#if origStatus === 'loading'}
                    <div class="hwp-orig-loading">원본 미리보기 준비 중…</div>
                  {:else if origPageUrl}
                    <img class="hwp-orig-img" src={origPageUrl} alt="한글 원본 {origPageIdx + 1}쪽" />
                  {/if}
                </div>
                <p class="cim-desc">원본과 모양이 다르면 이 그림으로 확인하세요. 한컴 글꼴은 쓸 수 없어 글자 모양은 대체될 수 있어요.</p>
              </div>
            {/if}
            <div class="hwp-pane">
              {#if origStatus === 'ready' || origStatus === 'loading'}<div class="hwp-pane-head"><span class="hwp-pane-title">변환 결과 (편집기에 들어갈 내용)</span></div>{/if}
              <div class="docx-preview" aria-label="한글 문서 변환 결과 미리보기">
                {@html hwpxHtml}
              </div>
            </div>
          </div>

          {#if fieldRows.length > 0}
            <div class="link-box">
              <p class="cim-section-title">누름틀 {fieldRows.length}종 발견 — 계약 변수에 연결</p>
              <p class="cim-desc">한글 양식의 누름틀(입력칸)을 계약 변수로 바꿔 가져옵니다. 연결하지 않은 칸은 그대로 가져와요.</p>
              {#each fieldRows as row, i (row.name)}
                <div class="link-row">
                  <span class="link-name">{row.name}{#if row.count > 1}<span class="link-count">×{row.count}</span>{/if}</span>
                  <div class="link-picker">
                    <SuggestPicker
                      id={`lk-${i}`}
                      selectedId={row.variable}
                      options={VARIABLE_OPTIONS}
                      placeholder="변수 선택"
                      listLabel="계약 변수"
                      variant="generic"
                      minChars={0}
                      onselect={(opt) => { row.variable = opt.id; (document.activeElement as HTMLElement | null)?.blur?.() /* 선택 뒤 목록이 열린 채 아래 버튼을 가리지 않게 입력창 포커스를 푼다 */ }}
                    >
                      {#snippet field(c)}
                        <input type="text" class="link-input" id={c.id} placeholder={c.placeholder}
                          value={c.value} oninput={c.oninput} onkeydown={c.onkeydown}
                          onfocus={c.onfocus} onblur={c.onblur}
                          aria-autocomplete={c.ariaAutocomplete} aria-expanded={c.ariaExpanded}
                          aria-controls={c.ariaControls} autocomplete="off" />
                      {/snippet}
                    </SuggestPicker>
                  </div>
                </div>
              {/each}
              <div class="link-actions">
                {#if hwpxHtmlBase}
                  <button type="button" class="btn-cancel" onclick={revertFieldLinks} disabled={linkBusy}>원래 변환 결과로</button>
                {/if}
                <button type="button" class="btn-action" onclick={applyFieldLinks} disabled={linkBusy}>{linkBusy ? '적용 중…' : '변수 연결 적용'}</button>
              </div>
              {#if linkMessage}<p class="cim-desc" role="status">{linkMessage}</p>{/if}
            </div>
          {/if}
        </div>
        <div class="cim-footer">
          <button type="button" class="btn-cancel" onclick={reselect}>다시 선택</button>
          <button type="button" class="btn-action" onclick={confirmHwpxImport}>
            이 내용으로 가져오기
          </button>
        </div>

      {:else if step === 'docx-preview'}
        <!-- docx 미리보기 -->
        <div class="cim-section">
          <p class="cim-section-title">변환 결과 미리보기</p>
          {#if docxWarnings.length > 0}
            <div class="warn-banner">
              <strong>변환 경고 ({docxWarnings.length}건):</strong>
              <ul class="warn-list">
                {#each docxWarnings.slice(0, 5) as w}
                  <li>{w}</li>
                {/each}
                {#if docxWarnings.length > 5}
                  <li>... 외 {docxWarnings.length - 5}건</li>
                {/if}
              </ul>
            </div>
          {/if}
          <div class="docx-preview" aria-label="변환된 문서 미리보기">
            {@html docxHtml}
          </div>
        </div>
        <div class="cim-footer">
          <button type="button" class="btn-cancel" onclick={reselect}>다시 선택</button>
          <button type="button" class="btn-action" onclick={confirmDocxImport}>
            이 내용으로 가져오기
          </button>
        </div>

      {:else if step === 'xlsx-spreadsheet-preview'}
        <!-- xlsx: 모든 시트를 스프레드시트 에디터로 가져오기 확인 -->
        <div class="cim-section">
          <p class="cim-section-title">스프레드시트 가져오기</p>
          {#if xlsxTotalRows > 5000}
            <div class="warn-banner warn-banner--yellow">
              <strong>⚠️ 대용량 경고</strong><br />
              총 {xlsxTotalRows.toLocaleString()}행이 감지됐습니다.
              5,000행을 초과하면 에디터 성능이 저하될 수 있습니다.
            </div>
          {/if}
          {#if xlsxSpreadsheetDoc}
            <div class="xlsx-ss-info">
              <div class="xlsx-ss-info-row">
                <span class="xlsx-ss-label">시트 수</span>
                <span class="xlsx-ss-value">{xlsxSpreadsheetDoc.sheets.length}개</span>
              </div>
              <div class="xlsx-ss-info-row">
                <span class="xlsx-ss-label">총 행 수</span>
                <span class="xlsx-ss-value">{xlsxTotalRows.toLocaleString()}행</span>
              </div>
              {#if xlsxFormulaStats.linked > 0 || xlsxFormulaStats.valueOnly > 0}
                <div class="xlsx-ss-info-row">
                  <span class="xlsx-ss-label">수식</span>
                  <span class="xlsx-ss-value">
                    {xlsxFormulaStats.linked}개 연결{#if xlsxFormulaStats.valueOnly > 0} · {xlsxFormulaStats.valueOnly}개는 값만(지원하지 않는 수식){/if}
                  </span>
                </div>
              {/if}
              {#if xlsxImages.length > 0 || xlsxImagesSkipped > 0}
                <div class="xlsx-ss-info-row">
                  <span class="xlsx-ss-label">그림</span>
                  <span class="xlsx-ss-value">
                    {xlsxImages.length}개 가져옴{#if xlsxImagesSkipped > 0} · {xlsxImagesSkipped}개 제외(지원하지 않는 형식){/if}
                  </span>
                </div>
              {/if}
              <div class="xlsx-ss-sheets">
                {#each xlsxSpreadsheetDoc.sheets as sheet}
                  <div class="xlsx-ss-sheet-chip">
                    {sheet.name}
                    <span class="xlsx-ss-sheet-rows">{sheet.rows.length}행</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
          <p class="cim-desc">
            모든 시트가 <strong>스프레드시트 에디터</strong>로 로드됩니다.
            편집 후 저장하면 계약서에 반영됩니다.
          </p>
        </div>
        <div class="cim-footer">
          <button type="button" class="btn-cancel" onclick={reselect}>
            다시 선택
          </button>
          <button type="button" class="btn-action" onclick={confirmXlsxSpreadsheetImport}>
            스프레드시트로 가져오기
          </button>
        </div>
      {/if}

    </div>
  </div>
</div>

<style>
  .cim-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 400;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .cim-modal {
    background: var(--cs-white, #fff);
    border-radius: var(--cms-radius-sm, 8px);
    width: 100%;
    max-width: 720px;
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
  }

  .cim-modal--wide { max-width: 1100px; }

  /* 원본(한글) ↔ 변환 결과 나란히 보기 */
  .hwp-compare { display: flex; flex-direction: column; gap: 12px; }
  .hwp-compare--two { flex-direction: row; align-items: flex-start; }
  .hwp-compare--two .hwp-pane { flex: 1 1 0; min-width: 0; }
  .hwp-pane { display: flex; flex-direction: column; gap: 8px; }
  .hwp-pane-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .hwp-pane-title { font: var(--text-pc-script-12, 12px); font-weight: 700; color: var(--cs-text, #100B32); }
  .hwp-pager { display: inline-flex; gap: 4px; }
  .hwp-pager-btn {
    width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
    border: none; border-radius: var(--cms-radius-sm, 8px); background: var(--cs-surface-gray, #f6f6f6);
    color: var(--cs-text-mid, #666); cursor: pointer; transition: background 0.1s;
  }
  .hwp-pager-btn:hover:not(:disabled) { background: var(--cs-lilac, #ECEBF4); }
  .hwp-pager-btn:disabled { opacity: 0.4; cursor: default; }
  .hwp-orig-box {
    border: 1px solid var(--cs-lilac, #ECEBF4); border-radius: var(--cms-radius-sm, 8px);
    background: var(--cs-surface-gray, #f6f6f6); max-height: 360px; overflow: auto; padding: 8px;
  }
  .hwp-orig-img { display: block; width: 100%; height: auto; background: #fff; }
  .hwp-orig-loading { padding: 48px 0; text-align: center; font: var(--text-pc-script-12, 12px); color: var(--cs-text-mid, #666); }

  /* 누름틀 → 변수 연결 */
  .link-box { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; background: var(--cs-surface-gray, #f6f6f6); border-radius: var(--cms-radius-sm, 8px); }
  .link-row { display: flex; align-items: center; gap: 10px; }
  .link-name { flex: 0 0 38%; min-width: 0; overflow-wrap: anywhere; font: var(--text-pc-script-12, 12px); font-weight: 700; color: var(--cs-text, #100B32); }
  .link-count { margin-left: 4px; font-weight: 400; color: var(--cs-text-light, #aaa); }
  .link-picker { flex: 1 1 0; min-width: 0; position: relative; }
  .link-input {
    width: 100%; height: 30px; padding: 0 10px; border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--cms-radius-sm, 8px); background: var(--cs-white, #fff);
    font: var(--text-pc-script-12, 12px); color: var(--cs-text, #100B32);
  }
  .link-actions { display: flex; justify-content: flex-end; gap: 8px; }

  .cim-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--cs-lilac, #ECEBF4);
    flex-shrink: 0;
  }
  .cim-title {
    font: var(--text-pc-title-16, 16px);
    font-weight: 700;
    color: var(--cs-text, #100B32);
  }
  .close-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 15px;
    color: var(--cs-text-mid, #666);
    padding: 4px 8px;
    border-radius: var(--radius-sm, 8px);
    transition: background 0.1s;
  }
  .close-btn:hover { background: var(--cs-lilac, #ECEBF4); }

  .cim-body {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .cim-loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-pc-body-14, 14px);
    color: var(--cs-text-mid, #666);
    padding: 48px;
  }

  .cim-section {
    flex: 1;
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow-y: auto;
  }

  .cim-section-title {
    margin: 0;
    font: var(--text-pc-body-14, 14px);
    font-weight: 700;
    color: var(--cs-text, #100B32);
  }

  .cim-desc {
    margin: 0;
    font: var(--text-pc-script-12, 12px);
    color: var(--cs-text-mid, #666);
    line-height: 1.6;
  }

  .warn-banner {
    padding: 10px 14px;
    background: rgba(255, 177, 0, 0.1);
    border: 1px solid rgba(255, 177, 0, 0.4);
    border-radius: var(--cms-radius-sm, 8px);
    font: var(--text-pc-script-12, 12px);
    color: var(--cs-text, #100B32);
    line-height: 1.5;
  }
  .warn-banner--yellow {
    background: rgba(255, 140, 0, 0.08);
    border-color: rgba(255, 140, 0, 0.45);
  }
  .warn-list {
    margin: 6px 0 0;
    padding-left: 18px;
  }
  .warn-list li {
    margin-bottom: 2px;
    color: var(--cs-text-mid, #666);
  }

  /* P5-1: HWP 안내 */
  .hwp-notice-icon {
    font-size: 32px;
    text-align: center;
    line-height: 1;
  }
  .hwp-notice-steps,
  .hwpx-notice-alt {
    background: var(--cs-surface-gray, #f6f6f6);
    border-radius: var(--cms-radius-sm, 8px);
    padding: 12px 14px;
  }
  .notice-title {
    margin: 0 0 8px;
    font: var(--text-pc-script-12, 12px);
    font-weight: 700;
    color: var(--cs-text, #100B32);
  }
  .notice-list {
    margin: 0;
    padding-left: 18px;
    font: var(--text-pc-script-12, 12px);
    color: var(--cs-text, #100B32);
    line-height: 1.7;
  }
  .notice-list li { margin-bottom: 4px; }

  /* docx 미리보기 */
  .docx-preview {
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--cms-radius-sm, 8px);
    padding: 16px;
    background: var(--cs-surface-gray, #f6f6f6);
    max-height: 360px;
    overflow-y: auto;
    font: var(--text-pc-body-14, 14px);
    color: var(--cs-text, #100B32);
    line-height: 1.7;
  }
  .docx-preview :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.5em 0;
  }
  .docx-preview :global(td),
  .docx-preview :global(th) {
    border: 1px solid #ddd;
    padding: 5px 8px;
  }

  /* xlsx 스프레드시트 정보 박스 */
  .xlsx-ss-info {
    background: var(--cs-surface-gray, #f6f6f6);
    border-radius: var(--cms-radius-sm, 8px);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .xlsx-ss-info-row {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .xlsx-ss-label {
    font: var(--text-pc-script-12, 12px);
    font-weight: 700;
    color: var(--cs-text-mid, #666);
    min-width: 60px;
  }
  .xlsx-ss-value {
    font: var(--text-pc-script-12, 12px);
    color: var(--cs-text, #100B32);
  }
  .xlsx-ss-sheets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 2px;
  }
  .xlsx-ss-sheet-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    background: var(--cs-white, #fff);
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--radius-full, 99px);
    font: var(--text-pc-script-12, 12px);
    color: var(--cs-text, #100B32);
  }
  .xlsx-ss-sheet-rows {
    color: var(--cs-text-light, #aaa);
    font-size: 11px;
  }

  /* 푸터 */
  .cim-footer {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 14px 20px;
    border-top: 1px solid var(--cs-lilac, #ECEBF4);
    flex-shrink: 0;
  }

  .btn-action {
    height: 34px;
    padding: 0 18px;
    background: var(--cs-purple, #3B2F8A);
    color: var(--cs-white, #fff);
    border: none;
    border-radius: var(--cms-radius-sm, 8px);
    font: var(--text-pc-script-12, 12px);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-action:hover:not(:disabled) { background: var(--cs-purple-hover, #2d2470); }
  .btn-action:disabled { background: var(--cs-disabled-button, #ccc); cursor: not-allowed; }

  .btn-cancel {
    height: 34px;
    padding: 0 14px;
    border: 1px solid #DDDDDD;
    border-radius: var(--cms-radius-sm, 8px);
    background: var(--cs-white, #fff);
    font: var(--text-pc-script-12, 12px);
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-cancel:hover { background: var(--cs-surface-gray, #f6f6f6); }
</style>
