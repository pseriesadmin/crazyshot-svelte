<script lang="ts">
  /**
   * ContractTemplatePanel.svelte — 계약서 양식 편집 패널
   *
   * Phase 0~3 적용:
   * - CmsContentEditor + ContractModuleBar → ContractDocumentEditor + ContractFieldPanel 교체
   * - 특약 조항 UI를 ContractFieldPanel "특약" 탭으로 통합 (P3-2)
   * - 기존 ContentBlock[] 레거시 콘텐츠는 HTML 폴백으로 로드 지원
   */

  import { enhance, deserialize } from '$app/forms'
  import { csToast } from '$lib/utils/toast'
  import CmsDeleteButton from '$lib/components/cms/CmsDeleteButton.svelte'
  import ContractDocumentEditor from '$lib/components/cms/contract-editor/ContractDocumentEditor.svelte'
  import ContractFieldPanel from '$lib/components/cms/contract-editor/ContractFieldPanel.svelte'
  import ContractImportModal from '$lib/components/cms/contract-editor/ContractImportModal.svelte'
  import ContractCanvasEditor from '$lib/components/cms/contract-editor/ContractCanvasEditor.svelte'
  import ContractSpreadsheetEditor from '$lib/components/cms/contract-editor/ContractSpreadsheetEditor.svelte'
  import { isTiptapDocBlock, isCanvasDocument, hasSignatureField, isSpreadsheetDocument, isHtmlDocument } from '$lib/types/contract-document'
  import type { TiptapDocBlock, MergeFieldAttrs, CanvasDocument, ContractCanvasPayload, SpreadsheetDocument } from '$lib/types/contract-document'
  import { DEFAULT_RENTAL_CONTRACT_HTML } from '$lib/components/cms/contract-editor/templates/defaultRentalContractHtml'
  import { applyIssuerSignatureMarker, applySpecialNotesMarker, applyContractTermsMarker, applyPrivacyTermsMarker } from '$lib/utils/contract-substitution'
  import type { ContractTemplate } from '$lib/types/contract-template'
  import type { JSONContent } from '@tiptap/core'

  interface Props {
    template:  ContractTemplate | null
    onclose?:  () => void
    onsaved?:  (id: string) => void
  }

  let { template = null, onclose, onsaved }: Props = $props()

  // --------------------------------------------------------------------------
  // 에디터 컴포넌트 참조
  // --------------------------------------------------------------------------
  let editorRef: {
    insertMergeField:   (attrs: MergeFieldAttrs) => void
    setEditorContent:   (content: string | JSONContent) => void
    insertEditorContent:(content: JSONContent) => void
    getEditorJSON:      () => JSONContent | null
  } | null = $state(null)

  // --------------------------------------------------------------------------
  // content_blocks 포맷 감지 — $derived.by()로 template prop 변경에 대응
  // TipTap vs 레거시 ContentBlock 배열 판별 로직을 반응형 컨텍스트로 격리
  // --------------------------------------------------------------------------
  const docInit = $derived.by(() => {
    const rawBlocks = (template?.content_blocks as unknown[]) ?? []
    let initialContent: TiptapDocBlock | null = null
    let initialHtml: string | undefined       = undefined

    if (rawBlocks.length > 0 && isTiptapDocBlock(rawBlocks[0])) {
      initialContent = rawBlocks[0] as TiptapDocBlock
    } else if (rawBlocks.length > 0) {
      // 레거시 ContentBlock 배열 → HTML 추출
      initialHtml = (rawBlocks as Array<{ type?: string; html?: string; content?: string }>)
        .map((b) => {
          if (b.type === 'text' && b.html) return b.html
          if (b.type === 'html' && b.content) return b.content
          return ''
        })
        .join('') || undefined
    }
    return { initialContent, initialHtml }
  })

  // --------------------------------------------------------------------------
  // 특약 조항 / 제목 / 서명 옵션 / 작성 모드
  // $state 기본값 + $effect 동기화 패턴 (Pattern 1) — prop 참조를 $state() 초기화에서 제거
  // --------------------------------------------------------------------------
  let specs                   = $state<{ key: string; value: string }[]>([{ key: '', value: '' }])
  let title                   = $state('')
  let requiresIssuerSignature = $state(false)
  /**
   * 작성 모드: 'flow' | 'canvas' | 'spreadsheet' | 'html' | null(신규 미선택)
   * 신규(template=null): 처음엔 null → 모드 선택 UI → 선택 후 고정
   * 기존(template!=null): template.authoring_mode에서 초기화 (이후 변경 불가)
   */
  let authoringMode           = $state<'flow' | 'canvas' | 'spreadsheet' | 'html' | null>(null)
  // spreadsheet 에디터 강제 재마운트 키 (새 xlsx 임포트 시 increments)
  let spreadsheetMountKey     = $state(0)
  // html 모드 발행자 서명·직인 이미지 URL/너비(Migration #450/#451) — $effect 동기화는 위 Pattern 1과 동일
  let htmlIssuerSignatureUrl   = $state<string | null>(null)
  let htmlIssuerSignatureWidth = $state<number | null>(null)
  // 위치 이동(드래그) 오프셋(px, Migration #463) — 기본 중앙 위치 대비 델타값. 0/null = 중앙(기존과 동일)
  let htmlIssuerSignatureOffsetX = $state<number>(0)
  let htmlIssuerSignatureOffsetY = $state<number>(0)
  const HTML_SIG_DEFAULT_WIDTH = 90
  // "계약 및 인수 확인"·"개인정보동의" 문단 텍스트(Migration #464) — 빈 문자열 = 기본 문구 사용
  let htmlContractTermsText = $state<string>('')
  let htmlPrivacyTermsText  = $state<string>('')

  // --------------------------------------------------------------------------
  // isDirty 판정 — spreadsheet 모드 "수정 저장" 버튼 활성/비활성 (2026-08-28 Stephen 요청)
  //
  // title/specs/requiresIssuerSignature는 template 로드 시점 스냅샷(origXxx)과 비교해
  // isDirty를 계산한다(products.md §4 isDirty 감지 패턴과 동일 원칙 — localXxx vs origXxx).
  // 그리드 자체의 편집(셀 값·서식·컬럼너비·병합 등)은 jspreadsheet-ce 내부 상태라 Svelte
  // 리액티비티 밖에 있으므로, ContractSpreadsheetEditor의 onchange 콜백으로 별도
  // spreadsheetContentDirty 플래그를 직접 세운다.
  // --------------------------------------------------------------------------
  let origTitle                   = ''
  let origSpecsJson               = '[]'
  let origRequiresIssuerSignature = false
  let spreadsheetContentDirty     = $state(false)
  // flow(TipTap)/html 모드 "수정 저장" 버튼도 spreadsheet와 동일하게 게이팅한다(2026-09-08,
  // Stephen "다른 계약서 편집 UI와 동일" 요청 — 위 spreadsheet 전용 isDirty 판정을 그대로 확장).
  // flow: TipTap 문서도 그리드처럼 Svelte 리액티비티 밖이라 ContractDocumentEditor의 신규
  // onchange 콜백으로 별도 플래그. html: html_document 자체는 상수(변경 불가)라 발행자
  // 서명·직인 URL/너비만 스냅샷 비교 대상.
  let flowContentDirty            = $state(false)
  let origHtmlIssuerSignatureUrl: string | null   = null
  let origHtmlIssuerSignatureWidth: number | null = null
  let origHtmlIssuerSignatureOffsetX = 0
  let origHtmlIssuerSignatureOffsetY = 0
  let origHtmlContractTermsText = ''
  let origHtmlPrivacyTermsText  = ''

  $effect(() => {
    // ⛔ 반드시 로컬 상수에 먼저 계산해두고 그 값을 $state에 대입 + origXxx 스냅샷
    // 양쪽에 그대로 재사용할 것 — specs/title/requiresIssuerSignature($state)를 이
    // effect 안에서 쓰고 나서 다시 읽으면(예: `origTitle = title`) 그 읽기가 effect의
    // 의존성으로 잡혀, 이 effect 자신이 만든 변경이 자기 자신을 다시 트리거하는 무한
    // 루프(Svelte effect_update_depth_exceeded)가 발생한다(2026-08-28 실제 발생·수정 —
    // specs는 매번 새 배열 리터럴이라 참조가 항상 달라 특히 즉시 재현됐음).
    const nextSpecs = Array.isArray(template?.specifications) && (template.specifications as unknown[]).length > 0
      ? (template.specifications as { key: string; value: string }[])
      : [{ key: '', value: '' }]
    const nextTitle = template?.title ?? ''
    const nextRequiresIssuerSignature = template?.requires_issuer_signature ?? false
    // 모드 초기화: 기존 템플릿이면 authoring_mode 사용, 신규면 null(미선택)
    const nextAuthoringMode = template
      ? ((template.authoring_mode as 'flow' | 'canvas' | 'spreadsheet' | 'html') ?? 'flow')
      : null
    // html 모드 발행자 서명·직인 이미지 URL/너비/위치(Migration #450/#451/#463) — 템플릿 로드 시 동기화
    const nextHtmlIssuerSignatureUrl   = template?.html_issuer_signature_url ?? null
    const nextHtmlIssuerSignatureWidth = template?.html_issuer_signature_width ?? null
    const nextHtmlIssuerSignatureOffsetX = template?.html_issuer_signature_offset_x ?? 0
    const nextHtmlIssuerSignatureOffsetY = template?.html_issuer_signature_offset_y ?? 0
    // "계약 및 인수 확인"·"개인정보동의" 문단 텍스트(Migration #464) — 템플릿 로드 시 동기화
    const nextHtmlContractTermsText = template?.contract_terms_text ?? ''
    const nextHtmlPrivacyTermsText  = template?.privacy_terms_text ?? ''

    specs                     = nextSpecs
    title                     = nextTitle
    requiresIssuerSignature   = nextRequiresIssuerSignature
    authoringMode             = nextAuthoringMode
    htmlIssuerSignatureUrl    = nextHtmlIssuerSignatureUrl
    htmlIssuerSignatureWidth  = nextHtmlIssuerSignatureWidth
    htmlIssuerSignatureOffsetX = nextHtmlIssuerSignatureOffsetX
    htmlIssuerSignatureOffsetY = nextHtmlIssuerSignatureOffsetY
    htmlContractTermsText     = nextHtmlContractTermsText
    htmlPrivacyTermsText      = nextHtmlPrivacyTermsText

    // isDirty 비교 기준 스냅샷 갱신 + 그리드/문서 변경 플래그 초기화(양식 전환·재로드 시점)
    origTitle                   = nextTitle
    origSpecsJson               = JSON.stringify(nextSpecs)
    origRequiresIssuerSignature = nextRequiresIssuerSignature
    origHtmlIssuerSignatureUrl  = nextHtmlIssuerSignatureUrl
    origHtmlIssuerSignatureWidth = nextHtmlIssuerSignatureWidth
    origHtmlIssuerSignatureOffsetX = nextHtmlIssuerSignatureOffsetX
    origHtmlIssuerSignatureOffsetY = nextHtmlIssuerSignatureOffsetY
    origHtmlContractTermsText   = nextHtmlContractTermsText
    origHtmlPrivacyTermsText    = nextHtmlPrivacyTermsText
    spreadsheetContentDirty     = false
    flowContentDirty            = false
  })

  const isSpreadsheetDirty = $derived(
    title !== origTitle ||
    JSON.stringify(specs) !== origSpecsJson ||
    requiresIssuerSignature !== origRequiresIssuerSignature ||
    spreadsheetContentDirty
  )

  // flow/html 모드 공용 isDirty — authoringMode에 따라 그 모드만의 콘텐츠 비교를 더한다.
  const isFlowOrHtmlDirty = $derived(
    title !== origTitle ||
    JSON.stringify(specs) !== origSpecsJson ||
    requiresIssuerSignature !== origRequiresIssuerSignature ||
    (authoringMode === 'flow' && flowContentDirty) ||
    (authoringMode === 'html' && (
      htmlIssuerSignatureUrl !== origHtmlIssuerSignatureUrl ||
      htmlIssuerSignatureWidth !== origHtmlIssuerSignatureWidth ||
      htmlIssuerSignatureOffsetX !== origHtmlIssuerSignatureOffsetX ||
      htmlIssuerSignatureOffsetY !== origHtmlIssuerSignatureOffsetY ||
      htmlContractTermsText !== origHtmlContractTermsText ||
      htmlPrivacyTermsText !== origHtmlPrivacyTermsText
    ))
  )

  /** canvas 모드 초기 문서 — template의 canvas_document를 파싱 */
  const canvasDocInit = $derived<CanvasDocument | null>(
    isCanvasDocument(template?.canvas_document)
      ? (template?.canvas_document as CanvasDocument)
      : null
  )

  /** spreadsheet 모드 초기 문서 — template의 spreadsheet_document를 파싱 */
  const spreadsheetDocInit = $derived<SpreadsheetDocument | null>(
    isSpreadsheetDocument((template as unknown as Record<string, unknown> | null)?.['spreadsheet_document'])
      ? ((template as unknown as Record<string, unknown>)['spreadsheet_document'] as SpreadsheetDocument)
      : null
  )

  /** spreadsheet 에디터 컴포넌트 참조 */
  let spreadsheetEditorRef: {
    getSpreadsheetDocument: () => SpreadsheetDocument
    insertTextAtSelection: (text: string) => boolean
  } | null = $state(null)

  let saving                  = $state(false)
  let showImport              = $state(false)

  // --------------------------------------------------------------------------
  // 외부 문서 가져오기 — 헤더 버튼 클릭 → 바로 OS 파일탐색기 (2026-08-30)
  // 과거엔 헤더 버튼 클릭 → 모달의 "선택" 화면 → 그 안의 "파일 선택" 버튼 클릭, 총 2단계였음.
  // 파일 선택(및 크기·확장자 검증)을 여기서 먼저 처리한 뒤 결과 File을 모달에 넘겨 1단계로 통합.
  // --------------------------------------------------------------------------
  const CONTRACT_IMPORT_ACCEPT = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // .xlsx
    'application/vnd.ms-excel',                                                 // .xls (xlsx fallback)
    '.docx',
    '.xlsx',
    '.xls',
    '.hwp',
    '.hwpx',
  ].join(',')
  const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024 // 10MB

  let importFileInput = $state<HTMLInputElement | null>(null)
  let importFile       = $state<File | null>(null)

  function triggerImport() {
    importFileInput?.click()
  }

  function onImportFileChange(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return

    if (file.size > MAX_IMPORT_FILE_SIZE) {
      csToast.error('파일 크기가 10MB를 초과합니다. 더 작은 파일로 다시 시도해주세요.')
    } else {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      if (!['docx', 'xlsx', 'xls', 'hwp', 'hwpx'].includes(ext)) {
        csToast.error('.docx, .xlsx, .hwp, .hwpx 파일만 지원합니다.')
      } else {
        importFile  = file
        showImport  = true
      }
    }
    // 동일 파일 재선택 허용
    if (importFileInput) importFileInput.value = ''
  }

  // --------------------------------------------------------------------------
  // 서명 & 직인 이미지 등록 — 로컬 업로드 UI
  // gif 허용: 이 컴포넌트 전용 로컬 검증만 사용 (전역 validateUploadFile 사용 금지)
  // --------------------------------------------------------------------------
  let sigUploadInputEl = $state<HTMLInputElement | null>(null)
  let sigUploadFile    = $state<File | null>(null)
  let sigUploadType    = $state<'signature' | 'seal'>('signature')
  let sigUploading     = $state(false)

  function openSigUpload() {
    sigUploadInputEl?.click()
  }

  function onSigFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const f = input.files?.[0] ?? null
    sigUploadFile = f
    // 파일 선택 시 input 리셋 (같은 파일 재선택 가능하도록)
    input.value = ''
  }

  function cancelSigUpload() {
    sigUploadFile = null
    sigUploadType = 'signature'
  }

  async function confirmSigUpload() {
    if (!sigUploadFile) return
    sigUploading = true
    try {
      const form = new FormData()
      form.set('file', sigUploadFile)
      form.set('asset_type', sigUploadType)
      form.set('label', sigUploadFile.name.replace(/\.[^.]+$/, ''))

      const res = await fetch('/api/cms/signature-assets', { method: 'POST', body: form })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        csToast.error(body?.error ?? '자산 등록에 실패했습니다.')
      } else {
        csToast.success('자산이 등록되었습니다.')
        sigUploadFile = null
        sigUploadType = 'signature'
      }
    } catch {
      csToast.error('자산 등록 중 오류가 발생했습니다.')
    } finally {
      sigUploading = false
    }
  }

  // --------------------------------------------------------------------------
  // html 모드 발행자 서명·직인 삽입 팝오버(Migration #450) — ContractDocumentEditor.svelte
  // "서명/직인 삽입" 팝오버(GET /api/cms/signature-assets)와 완전히 동일한 자산 목록·동일한
  // 엔드포인트를 재사용한다. flow/spreadsheet 모드는 에디터 커서 위치에 <img> 노드를 삽입하지만,
  // html 모드는 편집 캔버스 자체가 없으므로(고정 템플릿) 셀 위치 대신 "이 템플릿 전체에 1개"
  // 라는 더 단순한 모델로 htmlIssuerSignatureUrl 상태 하나에만 저장한다.
  // --------------------------------------------------------------------------
  interface HtmlSigAsset {
    id: string
    asset_type: string
    image_url: string
    label: string | null
    is_default: boolean
  }

  let showHtmlSigPicker = $state(false)
  let htmlSigAssets     = $state<HtmlSigAsset[]>([])
  let htmlSigLoading    = $state(false)
  let htmlSigPickerEl: HTMLDivElement | null = $state(null)

  async function openHtmlSigPicker() {
    if (showHtmlSigPicker) {
      showHtmlSigPicker = false
      return
    }
    showHtmlSigPicker = true
    htmlSigLoading = true
    try {
      const res = await fetch('/api/cms/signature-assets')
      htmlSigAssets = res.ok ? (await res.json() as HtmlSigAsset[]) : []
    } catch {
      htmlSigAssets = []
    } finally {
      htmlSigLoading = false
    }
  }

  function selectHtmlSigAsset(asset: HtmlSigAsset) {
    htmlIssuerSignatureUrl   = asset.image_url
    htmlIssuerSignatureWidth = HTML_SIG_DEFAULT_WIDTH
    // 새 이미지를 고르면 항상 기본 중앙 위치에서 다시 시작(2026-09-08, Migration #463)
    htmlIssuerSignatureOffsetX = 0
    htmlIssuerSignatureOffsetY = 0
    showHtmlSigPicker = false
  }

  // 크기조절 툴바(ContractSpreadsheetEditor.svelte 소(100)/중(200)/대(400)+커스텀 입력과
  // 동일 인터랙션) — 서버측 20~1200 클램프는 applyIssuerSignatureMarker()가 재검증하므로
  // 여기서는 UX 편의 목적만
  function setHtmlSigWidth(px: number) {
    if (!Number.isFinite(px) || px <= 0) return
    htmlIssuerSignatureWidth = Math.min(1200, Math.max(20, Math.round(px)))
  }

  function removeHtmlSigAsset() {
    htmlIssuerSignatureUrl   = null
    htmlIssuerSignatureWidth = null
    htmlIssuerSignatureOffsetX = 0
    htmlIssuerSignatureOffsetY = 0
  }

  // 팝오버 외부 클릭 시 닫기 (ContractDocumentEditor.svelte 동일 패턴)
  $effect(() => {
    if (!showHtmlSigPicker) return
    function onDocClick(e: MouseEvent) {
      const el = htmlSigPickerEl
      if (el && !el.contains(e.target as Node)) {
        showHtmlSigPicker = false
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  })

  // --------------------------------------------------------------------------
  // 문서 안 도장 이미지 클릭 → 크기조절 툴바를 그 이미지 바로 위에 표시
  // (ContractSpreadsheetEditor.svelte renderCellValue()와 동일 UX — "이미지를 선택하면
  // 그 위에 툴바가 뜬다". 위 발행자 서명·직인 행의 작은 미리보기와는 완전히 별개 —
  // Stephen 지시: "설정바가 문서양식 내 직인(서명) 이미지 선택 시 위에 위치해야해".
  // .html-preview-doc은 {@html previewHtml}로 매번 새 DOM을 그리므로, 그 안의
  // <img class="issuer-sig-overlay">도 매번 새 노드로 교체된다 — previewHtml이 바뀔
  // 때마다 이 effect가 다시 돌아 최신 img에 리스너를 재바인딩한다.
  // --------------------------------------------------------------------------
  let htmlPreviewDocEl: HTMLDivElement | null = $state(null)
  // 2026-09-08(6차 후속) — 아래 "문서 밖 클릭 시 툴바 닫기" $effect에서 크기조절 툴바·
  // 캔버스 상단 popup 클릭은 선택 해제 대상에서 제외하기 위한 참조(그 외 레이아웃 클릭은
  // 전부 해제 대상).
  let docSigToolbarEl: HTMLDivElement | null = $state(null)
  let htmlSigCanvasPopupEl: HTMLDivElement | null = $state(null)
  let showDocSigToolbar  = $state(false)
  let docSigToolbarPos   = $state({ top: 0, left: 0 })
  // 이미지가 크거나 스크롤 위치상 이미지 위쪽 공간이 부족하면(overflow:auto 컨테이너 경계
  // 밖으로 잘림) 툴바를 이미지 아래쪽으로 전환 — 툴바 자체 높이(34px 실측)+여백(8px)
  const DOC_SIG_TOOLBAR_CLEARANCE = 42
  let docSigToolbarBelow = $state(false)

  const previewHtml = $derived(
    applyPrivacyTermsMarker(
      applyContractTermsMarker(
        applySpecialNotesMarker(
          applyIssuerSignatureMarker(
            DEFAULT_RENTAL_CONTRACT_HTML,
            htmlIssuerSignatureUrl,
            htmlIssuerSignatureWidth,
            htmlIssuerSignatureOffsetX,
            htmlIssuerSignatureOffsetY,
          ),
          specs,
        ),
        htmlContractTermsText,
      ),
      htmlPrivacyTermsText,
    )
  )

  /** 문서 컨테이너 기준으로 도장 이미지의 상/하단 중앙 좌표를 구해 툴바 위치를 갱신 */
  function positionDocSigToolbar(): void {
    const container = htmlPreviewDocEl
    const img = container?.querySelector<HTMLImageElement>('.issuer-sig-overlay')
    if (!container || !img) return
    const cRect = container.getBoundingClientRect()
    const iRect = img.getBoundingClientRect()
    const viewportTopGap = iRect.top - cRect.top // 현재 스크롤 위치 기준 이미지 위쪽 여백
    docSigToolbarBelow = viewportTopGap < DOC_SIG_TOOLBAR_CLEARANCE
    docSigToolbarPos = {
      top:  (docSigToolbarBelow ? iRect.bottom : iRect.top) - cRect.top + container.scrollTop,
      left: iRect.left - cRect.left + container.scrollLeft + iRect.width / 2,
    }
  }

  // 위치 이동(드래그) 오프셋 클램프 — contract-substitution.ts ISSUER_SIGNATURE_OFFSET_LIMIT과 동일 범위(UX 편의 목적, 서버가 최종 재검증)
  const HTML_SIG_OFFSET_LIMIT = 2000
  function clampSigOffset(v: number): number {
    return Math.min(HTML_SIG_OFFSET_LIMIT, Math.max(-HTML_SIG_OFFSET_LIMIT, Math.round(v)))
  }

  $effect(() => {
    void previewHtml // {@html} 재생성 시마다 새 <img> 엘리먼트를 다시 찾아 리스너 재바인딩
    const container = htmlPreviewDocEl
    const imgEl = container?.querySelector<HTMLImageElement>('.issuer-sig-overlay')
    if (!container || !imgEl) {
      showDocSigToolbar = false
      return
    }
    // TS는 중첩 클로저(onPointerDown 등) 안에서 위 null 가드로 좁혀진 타입을 유지하지
    // 못한다(narrowing이 함수 경계를 넘지 못함) — 재대입되지 않는 별도 const로 다시 잡아
    // 클로저 안에서도 non-null로 취급되게 한다.
    const img: HTMLImageElement = imgEl
    // 고객·서명 화면에서는 pointer-events:none(클릭 통과)이 기본이지만, 이 편집 패널의
    // 미리보기에서만 인라인 스타일로 재활성화 — 다른 렌더링 지점(고객 서명 페이지 등)에는
    // 영향 없음(그쪽은 이 컴포넌트를 거치지 않음).
    img.style.cursor = 'grab'
    img.style.pointerEvents = 'auto'
    img.style.userSelect = 'none'
    img.style.touchAction = 'none'

    // ------------------------------------------------------------------------
    // 위치 이동(드래그) 인터랙션(Migration #463, 2026-09-08) — "직인이 표 칸 중앙에 고정돼
    // 원하는 위치로 옮길 수 없다"는 실사용 피드백에 따라 신규 추가. 기존 클릭→크기조절
    // 툴바 토글 기능(onImgClick)은 그대로 유지하고, "움직임 없는 클릭"과 "드래그"를
    // 구분해 드래그 종료 시에는 툴바를 열고 닫지 않는다.
    //
    // 매 mousemove마다 $state(htmlIssuerSignatureOffsetX/Y)를 갱신하면 {@html previewHtml}가
    // 통째로 재생성돼(img 노드 자체가 매 프레임 교체) 끊김이 생긴다 — 드래그 중에는 DOM에
    // 직접 transform만 적용해 60fps로 부드럽게 움직이고, 손을 뗀 시점(pointerup)에만 최종
    // 값을 $state에 커밋해 1회만 재생성되도록 분리했다.
    // ------------------------------------------------------------------------
    let isDragging       = false
    let dragMoved         = false
    let dragStartX        = 0
    let dragStartY        = 0
    let dragStartOffsetX  = 0
    let dragStartOffsetY  = 0
    const DRAG_MOVE_THRESHOLD = 4 // 이 값 미만 이동은 "클릭"으로 간주(토글 유지)

    function onImgClick(e: MouseEvent): void {
      e.stopPropagation()
      if (dragMoved) { dragMoved = false; return } // 방금 드래그 종료 직후의 합성 click 이벤트는 토글 무시
      showDocSigToolbar = !showDocSigToolbar
      if (showDocSigToolbar) positionDocSigToolbar()
    }

    function onPointerDown(e: PointerEvent): void {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      isDragging      = true
      dragMoved        = false
      dragStartX       = e.clientX
      dragStartY       = e.clientY
      dragStartOffsetX = htmlIssuerSignatureOffsetX
      dragStartOffsetY = htmlIssuerSignatureOffsetY
      img.style.cursor = 'grabbing'
      img.setPointerCapture(e.pointerId)
    }

    function onPointerMove(e: PointerEvent): void {
      if (!isDragging) return
      const dx = e.clientX - dragStartX
      const dy = e.clientY - dragStartY
      if (!dragMoved && (Math.abs(dx) > DRAG_MOVE_THRESHOLD || Math.abs(dy) > DRAG_MOVE_THRESHOLD)) dragMoved = true
      if (!dragMoved) return
      const nx = clampSigOffset(dragStartOffsetX + dx)
      const ny = clampSigOffset(dragStartOffsetY + dy)
      img.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`
      if (showDocSigToolbar) positionDocSigToolbar()
    }

    function onPointerUp(e: PointerEvent): void {
      if (!isDragging) return
      isDragging = false
      img.style.cursor = 'grab'
      try { img.releasePointerCapture(e.pointerId) } catch { /* 이미 해제된 경우 무시 */ }
      if (dragMoved) {
        const dx = e.clientX - dragStartX
        const dy = e.clientY - dragStartY
        // previewHtml 재파생(§ $derived 위)이 동일한 최종값으로 img를 다시 그려주므로
        // 여기서 별도로 DOM을 되돌리지 않아도 값이 어긋나지 않는다.
        htmlIssuerSignatureOffsetX = clampSigOffset(dragStartOffsetX + dx)
        htmlIssuerSignatureOffsetY = clampSigOffset(dragStartOffsetY + dy)
      }
    }

    img.addEventListener('click', onImgClick)
    img.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    if (showDocSigToolbar) positionDocSigToolbar()
    return () => {
      img.removeEventListener('click', onImgClick)
      img.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  })

  // 이미지 선택 해제 — 이미지 자신·크기조절 툴바·캔버스 상단 popup을 제외한 나머지
  // 레이아웃(문서 내 다른 영역 포함, 우측 특약 패널 등 문서 밖 영역도 포함) 클릭 시
  // 선택 해제. 2026-09-08(6차 후속) — Stephen 지적: 기존에는 ".html-preview-doc 밖"
  // 클릭에만 반응해, 같은 문서 안에서 도장 이미지가 아닌 다른 영역(계약서 본문 등)을
  // 클릭해도 선택이 풀리지 않던 결함이 있었다 — 판정 범위를 "이미지·툴바·popup 자신"
  // 으로 좁히고 그 "밖"은 전부 해제 대상으로 넓혔다. showDocSigToolbar가 false가 되면
  // 캔버스 popup(.html-sig-canvas-popup, {#if showDocSigToolbar && htmlIssuerSignatureUrl})도
  // 조건이 함께 꺼지므로 자동으로 감춰진다(별도 처리 불필요).
  $effect(() => {
    if (!showDocSigToolbar) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      const img = htmlPreviewDocEl?.querySelector<HTMLImageElement>('.issuer-sig-overlay')
      if (img?.contains(target)) return // 이미지 자신 클릭은 onImgClick이 토글 처리
      if (docSigToolbarEl?.contains(target)) return // 크기조절 툴바 조작 중 닫히지 않도록 제외
      if (htmlSigCanvasPopupEl?.contains(target)) return // 캔버스 popup(제거 버튼 등) 조작 중 제외
      showDocSigToolbar = false
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  })

  // --------------------------------------------------------------------------
  // 폼 직렬화 (use:enhance에서 content_blocks를 에디터에서 읽어 주입)
  // --------------------------------------------------------------------------
  function serializeBlocks(): string {
    const json = editorRef?.getEditorJSON()
    const blocks: TiptapDocBlock[] = json ? [{ type: 'tiptap-doc', doc: json }] : []
    return JSON.stringify(blocks)
  }

  function serializeSpecs(): string {
    return JSON.stringify(specs.filter((s) => s.key.trim()))
  }

  // --------------------------------------------------------------------------
  // 임포트 콜백
  // --------------------------------------------------------------------------
  /**
   * ⛔ 2026-08-16 데이터 손상 방지 가드(Stephen "기존 양식을 다른 작성모드로 뒤엎어넣는
   * 실수 방지" 요청) — 이 컴포넌트 자신의 authoringMode 선언부 주석에 "template!=null:
   * 이후 변경 불가"라고 이미 명시돼 있었으나, 실제로는 이 두 임포트 콜백이 그 규칙을
   * 지키지 않고 무조건 authoringMode를 덮어썼다. "문서 가져오기" 버튼은 flow 모드에서만
   * 노출되지만 그 모달은 .docx와 .xlsx를 같은 파일선택창에서 받는다 — 기존 문서형(flow)
   * 계약서를 편집하다가 실수로 .xlsx를 선택하면 이 콜백이 조용히 authoringMode를
   * 'spreadsheet'로 바꾸고, 그대로 저장하면 handleSpreadsheetSave()가 content_blocks를
   * '[]'로 비운 채 같은 template.id로 덮어써 원본 문서형 내용이 영구 소실된다(서버
   * update 액션도 authoring_mode를 검증 없이 그대로 반영 — +page.server.ts 쪽에도 동일
   * 원칙의 방어 로직 별도 추가). 기존 양식(template!=null)에서는 모드 전환 임포트 자체를
   * 차단하고, 형식을 바꾸고 싶다면 새 양식을 작성하도록 안내한다. 신규 작성(template=null)
   * 에서는 "임포트로 모드를 고른다"는 기존 의도된 흐름 그대로 유지.
   */
  const MODE_LOCK_MESSAGE = '기존 계약서 양식은 작성 모드를 변경할 수 없습니다. 형식을 바꾸려면 새 양식을 작성해주세요.'

  /**
   * docx/hwpx → HTML 임포트.
   * flow 모드에서만 editorRef를 통해 콘텐츠를 설정.
   * spreadsheet 모드에서 docx를 임포트하면 flow 모드로 전환 후 콘텐츠 설정
   * (editorRef가 null이므로 임시로 상태만 변경 — 에디터는 다음 렌더링에서 마운트됨).
   */
  function handleImport(result: { type: 'html'; html: string }) {
    if (editorRef) {
      editorRef.setEditorContent(result.html)
    } else if (template && authoringMode !== 'flow') {
      csToast.error(MODE_LOCK_MESSAGE)
    } else {
      // spreadsheet 모드 → flow 전환: 에디터 마운트 후 initialHtml으로 콘텐츠 반영됨
      // (docInit은 $derived이므로 직접 수정 불가 — 대신 mode 전환으로 재마운트 유도)
      authoringMode = 'flow'
      csToast.success('문서 가져오기 완료. 에디터를 열어 내용을 확인하세요.')
    }
  }

  /**
   * xlsx → SpreadsheetDocument 임포트.
   * authoringMode를 spreadsheet로 전환. 기존 양식이 flow/canvas였다면 차단(위 주석 참고).
   */
  function handleImportSpreadsheet(doc: SpreadsheetDocument) {
    if (template && authoringMode !== 'spreadsheet') {
      csToast.error(MODE_LOCK_MESSAGE)
      return
    }
    authoringMode = 'spreadsheet'
    spreadsheetMountKey++
    // spreadsheetDocInit은 $derived(template.spreadsheet_document)라 즉시 반영 불가.
    // ContractSpreadsheetEditor를 임포트된 doc으로 초기화하려면 key를 활용.
    // 실제 initialDoc은 아래 {#key spreadsheetMountKey} 블록에서 _importedDoc 변수로 전달.
    _importedSpreadsheetDoc = doc
    // xlsx 가져오기 자체가 저장 전 변경 사항이므로 즉시 dirty 처리
    spreadsheetContentDirty = true
  }

  /** 임포트된 SpreadsheetDocument 임시 저장 — key 재마운트 시 initialDoc으로 전달 */
  let _importedSpreadsheetDoc = $state<SpreadsheetDocument | null>(null)

  // --------------------------------------------------------------------------
  // spreadsheet 모드 저장 — fetch로 직접 action에 POST
  // --------------------------------------------------------------------------
  async function handleSpreadsheetSave(): Promise<void> {
    if (!spreadsheetEditorRef) return
    saving = true
    try {
      const doc = spreadsheetEditorRef.getSpreadsheetDocument()
      const formData = new FormData()
      if (template) formData.set('id', template.id)
      formData.set('title',                title)
      formData.set('authoring_mode',       'spreadsheet')
      formData.set('spreadsheet_document', JSON.stringify(doc))
      formData.set('content_blocks',       '[]')
      formData.set('specifications',       serializeSpecs())
      formData.set('requires_issuer_signature', requiresIssuerSignature.toString())

      const actionUrl = template ? '?/update' : '?/create'
      const response  = await fetch(actionUrl, { method: 'POST', body: formData })
      const result    = deserialize(await response.text())

      if (result.type === 'success') {
        csToast.success(template ? '수정되었습니다.' : '등록되었습니다.')
        const id = (result.data as { id?: string })?.id ?? template?.id ?? ''
        // ⛔ 2026-08-28 발견 — invalidateAll()을 여기서 한 번 호출하고, 곧이어 호출하는
        // onsaved(id)(부모 +page.svelte의 onSaved)에서 또 한 번 중복 호출하고 있었다.
        // 저장 자체는 이미 성공했는데, 성공 토스트가 뜬 "이후"에 실행되는 이 중복
        // invalidateAll()에서 문제가 생기면 catch가 이를 저장 실패로 오인해 성공 토스트와
        // 오류 토스트가 동시에 뜨는 버그로 이어졌다(Stephen 실사용 중 발견). 부모의
        // onSaved()가 invalidateAll + 네비게이션을 전담하므로 여기서는 제거 — 저장 자체의
        // 성공/실패 판정과 그 이후의 화면 갱신을 명확히 분리한다.
        onsaved?.(id)
      } else if (result.type === 'failure') {
        csToast.error((result.data as { error?: string })?.error ?? '저장에 실패했습니다.')
      } else {
        csToast.error('저장에 실패했습니다.')
      }
    } catch {
      csToast.error('저장 중 오류가 발생했습니다.')
    } finally {
      saving = false
    }
  }

  // --------------------------------------------------------------------------
  // canvas 모드 전용: 배경 이미지 업로드 콜백 (ContractCanvasEditor.onUploadPage)
  // /api/cms/contract-templates/canvas-bg 엔드포인트에 위임
  // --------------------------------------------------------------------------
  async function uploadCanvasBackground(blob: Blob, fileName: string): Promise<string> {
    const formData = new FormData()
    formData.set('file', blob, fileName)
    const res = await fetch('/api/cms/contract-templates/canvas-bg', {
      method: 'POST',
      body:   formData,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(body?.error ?? '배경 이미지 업로드에 실패했습니다.')
    }
    const data = await res.json() as { url: string }
    return data.url
  }

  // --------------------------------------------------------------------------
  // canvas 모드 저장 — ContractCanvasEditor.onSave 콜백
  // use:enhance 를 거치지 않고 fetch로 직접 action에 POST
  // --------------------------------------------------------------------------
  async function handleCanvasSave(payload: ContractCanvasPayload): Promise<void> {
    // EC-3: 서명 필드 최소 1개 필수 — 클라이언트 검증 (서버에서도 재검증됨)
    if (!hasSignatureField(payload.canvasDocument)) {
      csToast.error('서명 필드가 최소 1개 이상 있어야 저장할 수 있습니다.')
      return
    }
    saving = true
    try {
      const formData = new FormData()
      if (template) formData.set('id', template.id)
      formData.set('title',                    title)
      formData.set('authoring_mode',           'canvas')
      formData.set('canvas_document',          JSON.stringify(payload.canvasDocument))
      formData.set('content_blocks',           '[]')
      formData.set('specifications',           serializeSpecs())
      formData.set('requires_issuer_signature', requiresIssuerSignature.toString())

      const actionUrl = template ? '?/update' : '?/create'
      const response  = await fetch(actionUrl, { method: 'POST', body: formData })
      const result    = deserialize(await response.text())

      if (result.type === 'success') {
        csToast.success(template ? '수정되었습니다.' : '등록되었습니다.')
        const id = (result.data as { id?: string })?.id ?? template?.id ?? ''
        // ⛔ 2026-08-28 발견 — 스프레드시트 모드 저장 함수(handleSpreadsheetSave)와 동일한
        // 버그 — invalidateAll() 중복 호출 제거(부모 onSaved()가 전담). 상세 사유는 그쪽
        // 주석 참고.
        onsaved?.(id)
      } else if (result.type === 'failure') {
        csToast.error((result.data as { error?: string })?.error ?? '저장에 실패했습니다.')
      } else {
        csToast.error('저장에 실패했습니다.')
      }
    } catch {
      csToast.error('저장 중 오류가 발생했습니다.')
    } finally {
      saving = false
    }
  }
</script>

<div class="template-panel">
  <!-- 헤더 -->
  <div class="panel-header">
    <span class="panel-title">{template ? '계약서 양식 수정' : '계약서 양식 등록'}</span>
    <div class="panel-header-actions">
      {#if authoringMode === 'flow'}
        <input
          type="file"
          accept={CONTRACT_IMPORT_ACCEPT}
          style="display:none"
          bind:this={importFileInput}
          onchange={onImportFileChange}
          aria-label="문서 파일 선택"
        />
        <button
          type="button"
          class="btn-import"
          onclick={triggerImport}
          title="외부 문서 가져오기"
        >문서 가져오기</button>
      {/if}
      {#if onclose}
        <button type="button" class="close-btn" onclick={onclose} aria-label="닫기">✕</button>
      {/if}
    </div>
  </div>

  <form
    id="tpl-form"
    method="POST"
    action={template ? '?/update' : '?/create'}
    use:enhance={({ formData, cancel }) => {
      // canvas / spreadsheet 모드는 직접 fetch로 처리 — form submit 취소
      if (authoringMode === 'canvas' || authoringMode === 'spreadsheet') {
        cancel()
        return
      }
      formData.set('content_blocks', serializeBlocks())
      formData.set('specifications', serializeSpecs())
      // ⛔ 2026-09-05 발견·수정 — 이 블록은 canvas/spreadsheet를 제외한 나머지 전부(flow +
      // html)가 타는 일반 form submit 경로인데, authoring_mode를 'flow' 리터럴로 무조건
      // 덮어써 html 모드로 저장해도 항상 'flow'로 저장되는 결함이 있었다(html_document 자체는
      // 폼의 hidden input으로 별도 제출돼 정상 저장되지만 authoring_mode만 틀리게 저장되는
      // 상태 — 실브라우저로 직접 재현·확인). 실제 선택된 모드를 반영한다.
      formData.set('authoring_mode', authoringMode === 'html' ? 'html' : 'flow')
      saving = true
      return async ({ result, update }) => {
        saving = false
        if (result.type === 'success') {
          csToast.success(template ? '수정되었습니다.' : '등록되었습니다.')
          const id = (result.data as { id?: string })?.id ?? template?.id ?? ''
          if (onsaved) {
            onsaved(id)
          } else {
            await update()
          }
        } else if (result.type === 'failure') {
          const msg = (result.data as { error?: string })?.error ?? '저장에 실패했습니다.'
          csToast.error(msg)
        }
      }
    }}
  >
    {#if template}
      <input type="hidden" name="id" value={template.id} />
    {/if}

    <!-- 제목 -->
    <div class="field-row">
      <label class="f-label" for="tpl-title">계약서 제목</label>
      <input
        id="tpl-title"
        class="f-input"
        name="title"
        bind:value={title}
        placeholder="계약서 양식 제목 입력"
        required
      />
    </div>

    <!-- 발행자 서명·직인 필수 토글 -->
    <div class="field-row field-row--toggle">
      <span class="f-label">발행자 서명·직인 필수</span>
      <div class="toggle-wrap">
        <button
          type="button"
          class="toggle-btn"
          class:on={requiresIssuerSignature}
          onclick={() => { requiresIssuerSignature = !requiresIssuerSignature }}
          aria-pressed={requiresIssuerSignature}
          aria-label="발행자 서명·직인 필수 여부 전환"
        >
          <span class="toggle-knob"></span>
        </button>
        <span class="toggle-label">
          {requiresIssuerSignature ? '필수 (서명·직인 없으면 발송 차단)' : '선택 (서명·직인 없어도 발송 가능)'}
        </span>
      </div>
      <!-- 2026-09-08 후속 — Stephen 지시: "'서명 & 직인 이미지 등록' 버튼 UI만을 구현된
           로직 그대로 이 토글 행 레이아웃 내부로 이동 재배치할 것". 아래 field-row--sig-upload
           행에 있던 등록 버튼(openSigUpload 핸들러 그대로)을 이 행 안으로 옮겨 같은 줄에
           배치 — 파일 선택 전(!sigUploadFile)에만 노출하는 기존 조건도 그대로 유지. -->
      {#if !sigUploadFile}
        <button
          type="button"
          class="btn-sig-upload btn-sig-upload--toggle-row"
          onclick={openSigUpload}
          aria-label="서명·직인 이미지 파일 선택"
        >서명 & 직인 이미지 등록</button>
      {/if}
      <!-- 2026-09-08(7차 후속) — Stephen 지적: 5차 후속에서 .html-sig-row 전체를
           !htmlIssuerSignatureUrl(서명 미등록) 상태에만 렌더링하도록 좁히면서, "이미
           등록된 서명·직인 자산 목록에서 골라 삽입"하는 서명/직인 삽입 버튼+팝오버가
           서명이 이미 설정된 일반 상태에서는 아예 호출할 수 없게 돼버렸다(=사실상
           제거된 것과 동일) — Stephen "이미 등록된 직인(서명) 이미지 목록 선택 모달을
           복원해 - 제거된 '서명/직인 삽입' 버튼 UI를 복원하고 선택위치로 재배열해"
           지시로 htmlIssuerSignatureUrl 여부와 무관하게 항상 노출로 복원 + 위 "서명 &
           직인 이미지 등록" 버튼 바로 옆(Stephen이 선택한 위치)으로 재배치. 로직
           (openHtmlSigPicker/showHtmlSigPicker/htmlSigAssets/selectHtmlSigAsset)은
           변경 없이 그대로 재사용 — 팝오버 위치 기준(position:relative)만 이 인라인
           wrapper(.html-sig-picker-inline)로 이관. -->
      <div class="html-sig-picker-inline" bind:this={htmlSigPickerEl}>
        <button
          type="button"
          class="btn-sig-upload"
          class:active={showHtmlSigPicker}
          onclick={openHtmlSigPicker}
          aria-expanded={showHtmlSigPicker}
          aria-haspopup="listbox"
          aria-label="발행자 서명·직인 삽입"
        >서명/직인 삽입</button>
        {#if showHtmlSigPicker}
          <div class="html-sig-popover" role="listbox" aria-label="서명/직인 자산 목록">
            {#if htmlSigLoading}
              <div class="html-sig-info">불러오는 중...</div>
            {:else if htmlSigAssets.length === 0}
              <div class="html-sig-info">
                등록된 서명·직인이 없습니다.<br />위 '서명 &amp; 직인 이미지 등록' 버튼으로 먼저 등록하세요.
              </div>
            {:else}
              <div class="html-sig-list">
                {#each htmlSigAssets as asset (asset.id)}
                  <button
                    type="button"
                    class="html-sig-item"
                    role="option"
                    aria-selected={false}
                    onclick={() => selectHtmlSigAsset(asset)}
                    aria-label="{asset.asset_type === 'signature' ? '서명' : '직인'} 삽입{asset.label ? ': ' + asset.label : ''}"
                  >
                    <img src={asset.image_url} alt="{asset.asset_type === 'signature' ? '서명' : '직인'} 미리보기" class="html-sig-thumb" />
                    <span class="html-sig-item-label">{asset.label ?? (asset.asset_type === 'signature' ? '서명' : '직인')}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
      <!-- 2026-09-08 후속 제거 — 기존 .toggle-hint("이 양식으로 계약을 발행할 때...
           필수로 만듭니다")는 바로 왼쪽 toggle-label이 이미 상태별로 동일 의미를
           동적으로 보여주고 있어(예: "필수 (서명·직인 없으면 발송 차단)") 순수 중복
           정보였다 — Stephen "불필요한 레이아웃 요소로 판정되면 제거해서 캔버스 영역
           세로폭을 확보할 것" 지시에 따라 판정·제거(관련 CSS .toggle-hint도 함께 제거). -->
      <input type="hidden" name="requires_issuer_signature" value={requiresIssuerSignature.toString()} />
    </div>

    <!-- gif 허용은 이 input에만: 전역 fileValidation.ts 수정 금지 -->
    <input
      bind:this={sigUploadInputEl}
      type="file"
      accept="image/png,image/gif,image/jpeg"
      style="display:none"
      oninput={onSigFileChange}
      aria-hidden="true"
      tabindex="-1"
    />
    <!-- 2026-09-08(8차 후속) — Stephen 지적: 4차 후속(등록 버튼 이동)으로 이 행에
         파일 미선택 시 라벨+힌트("PNG · JPEG · GIF · 최대 5MB") 텍스트만 남아있던
         구간을 "불필요 요소판정 시 제거" 지시. 상호작용 요소가 전혀 없는 순수 안내
         문구 한 줄뿐이라 판정 결과 제거 — 행 자체를 파일 선택 후(sigUploadFile 있을
         때)에만 렌더링하도록 변경해 파일 미선택 상태에서는 이 행 전체(패딩·보더 포함)가
         사라져 세로공간을 확보한다. 파일 선택 후 필요한 유형선택(서명/직인)+등록/취소
         UI는 로직 그대로 유지(사라지면 업로드 확정 경로 자체가 없어지므로 제외 대상 아님). -->
    {#if sigUploadFile}
      <div class="field-row field-row--sig-upload">
        <span class="f-label">서명·직인 이미지</span>
        <div class="sig-upload-confirm">
          <span class="sig-file-name" title={sigUploadFile.name}>{sigUploadFile.name}</span>
          <div class="sig-type-picker" role="group" aria-label="자산 유형 선택">
            <label class="sig-type-option">
              <input
                type="radio"
                name="sig_upload_type_picker"
                value="signature"
                checked={sigUploadType === 'signature'}
                onchange={() => { sigUploadType = 'signature' }}
              />
              서명
            </label>
            <label class="sig-type-option">
              <input
                type="radio"
                name="sig_upload_type_picker"
                value="seal"
                checked={sigUploadType === 'seal'}
                onchange={() => { sigUploadType = 'seal' }}
              />
              직인
            </label>
          </div>
          <button
            type="button"
            class="btn-sig-confirm"
            onclick={confirmSigUpload}
            disabled={sigUploading}
            aria-label="자산 등록 확인"
          >{sigUploading ? '등록 중...' : '등록'}</button>
          <button
            type="button"
            class="btn-sig-cancel"
            onclick={cancelSigUpload}
            disabled={sigUploading}
            aria-label="취소"
          >취소</button>
        </div>
      </div>
    {/if}

    <!-- 에디터 영역 — 모드별 분기 -->
    <div class="editor-layout">
      {#if authoringMode === null}
        <!-- 신규 작성: 모드 미선택 → 모드 선택 UI -->
        <div class="mode-select">
          <p class="mode-select-title">계약서 작성 방식을 선택하세요</p>
          <div class="mode-buttons">
            <button
              type="button"
              class="mode-btn"
              onclick={() => { authoringMode = 'flow' }}
            >
              <span class="mode-name">문서형 (흐름형)</span>
              <span class="mode-desc">TipTap 에디터로 계약서를 직접 작성합니다. 변수 치환·특약 조항을 지원합니다.</span>
            </button>
            <button
              type="button"
              class="mode-btn"
              onclick={() => { authoringMode = 'canvas' }}
            >
              <span class="mode-name">고정 캔버스형</span>
              <span class="mode-desc">기존 서식(PDF·이미지)을 배경으로 불러와 서명·텍스트 필드를 좌표로 배치합니다.</span>
            </button>
            <button
              type="button"
              class="mode-btn"
              onclick={() => { authoringMode = 'html' }}
            >
              <span class="mode-name">HTML형 (고정 서식)</span>
              <span class="mode-desc">Excel 기반 고정 HTML 서식을 사용합니다. 고객정보·상품목록 등 변수가 자동으로 치환됩니다. 특약 조항만 직접 입력하세요.</span>
            </button>
          </div>
        </div>
      {:else if authoringMode === 'canvas'}
        <!-- canvas 모드: ContractCanvasEditor가 전체 영역 차지 -->
        <div class="canvas-editor-wrap">
          {#key template?.id ?? '__new__'}
            <ContractCanvasEditor
              initialDoc={canvasDocInit}
              title={title}
              specifications={specs}
              onUploadPage={uploadCanvasBackground}
              onSave={handleCanvasSave}
            />
          {/key}
        </div>
      {:else if authoringMode === 'spreadsheet'}
        <!-- spreadsheet 모드: ContractSpreadsheetEditor + 필드 패널 2단 레이아웃 -->
        <div class="spreadsheet-editor-wrap">
          {#key spreadsheetMountKey}
            <ContractSpreadsheetEditor
              bind:this={spreadsheetEditorRef}
              initialDoc={_importedSpreadsheetDoc ?? spreadsheetDocInit}
              onchange={() => { spreadsheetContentDirty = true }}
            />
          {/key}
        </div>
        <div class="panel-col">
          <ContractFieldPanel
            onInsertField={(attrs: MergeFieldAttrs) => {
              const ok = spreadsheetEditorRef?.insertTextAtSelection(`{{${attrs.variable}}}`)
              if (!ok) csToast.error('삽입할 셀을 먼저 선택해주세요.')
            }}
            specifications={specs}
            onSpecsChange={(s: { key: string; value: string }[]) => { specs = s }}
          />
        </div>
      {:else if authoringMode === 'html'}
        <!-- html 모드: 고정 HTML 서식 미리보기(읽기 전용) + 특약 조항 입력 패널 -->
        <!-- html_document 필드: 항상 DEFAULT_RENTAL_CONTRACT_HTML을 저장 (변경 불가) -->
        <input type="hidden" name="html_document" value={DEFAULT_RENTAL_CONTRACT_HTML} />
        <input type="hidden" name="html_issuer_signature_url" value={htmlIssuerSignatureUrl ?? ''} />
        <input type="hidden" name="html_issuer_signature_width" value={htmlIssuerSignatureWidth ?? ''} />
        <input type="hidden" name="html_issuer_signature_offset_x" value={htmlIssuerSignatureOffsetX} />
        <input type="hidden" name="html_issuer_signature_offset_y" value={htmlIssuerSignatureOffsetY} />
        <input type="hidden" name="html_contract_terms_text" value={htmlContractTermsText} />
        <input type="hidden" name="html_privacy_terms_text" value={htmlPrivacyTermsText} />
        <div class="html-preview-wrap">
          <!-- 2026-09-08 제거 — "HTML 고정 서식 미리보기" 라벨 + 안내 문구(.html-preview-label)는
               순수 정적 텍스트로 상호작용 요소가 전혀 없고, 동일한 안내("특약은 관리자가 직접
               입력하는 고정 텍스트입니다" 등)가 우측 ContractFieldPanel 각 탭 힌트에 이미
               있어 중복이었다. Stephen 지시: "불필요한 레이아웃 요소로 판정되면 제거해서
               캔버스 영역 세로폭을 확보할 것" — 판정 결과 제거, 그만큼 .html-preview-doc
               캔버스 세로 공간 확보(관련 CSS .html-preview-label/.html-preview-hint도 함께 제거). -->

          <!-- 발행자(대표이사) 서명·직인 삽입/제거 UI(2026-09-08, 3차 후속) — 서명이 이미
               등록된 상태의 미리보기/힌트/제거 UI는 .html-sig-canvas-popup(아래
               .html-preview-doc 안, showDocSigToolbar 연동)으로, "서명/직인 삽입"
               버튼+팝오버(기존 자산 목록에서 선택)는 위 발행자 서명·직인 필수 토글
               행(.html-sig-picker-inline)으로 각각 이관 완료(7차 후속) — 이 위치에는
               더 이상 별도 행이 없다. -->

          <div class="html-preview-doc" bind:this={htmlPreviewDocEl}>
            {#if showDocSigToolbar && htmlIssuerSignatureUrl}
              <!-- 캔버스 상단 popup(2026-09-08, Migration #463 후속) — position:sticky로
                   .html-preview-doc 스크롤 컨테이너 상단에 고정. {@html previewHtml}보다
                   먼저(DOM 최상단) 렌더링해야 sticky의 기준 위치가 스크롤 0에서 시작한다
                   (아래에 두면 문서 콘텐츠 높이만큼 내려간 지점에서만 고정되기 시작함).
                   showDocSigToolbar가 false로 바뀌면(다른 곳 클릭 등) 즉시 사라진다. -->
              <div class="html-sig-canvas-popup" bind:this={htmlSigCanvasPopupEl}>
                <span class="f-label">발행자(대표이사) 서명·직인</span>
                <img
                  src={htmlIssuerSignatureUrl}
                  alt="발행자 서명/직인 미리보기"
                  class="html-sig-preview"
                />
                <span class="html-sig-hint">마우스로 끌어 위치를 옮기거나, 아래 크기조절 툴바로 크기를 바꿀 수 있습니다.</span>
                <button
                  type="button"
                  class="btn-sig-cancel"
                  onclick={() => { removeHtmlSigAsset(); showDocSigToolbar = false }}
                  aria-label="발행자 서명·직인 이미지 삭제"
                >제거</button>
              </div>
            {/if}
            {@html previewHtml}
            {#if showDocSigToolbar}
              <!-- ContractSpreadsheetEditor.svelte renderCellValue()의 플로팅 툴바(소/중/대
                   프리셋+구분선+너비입력+구분선+✕삭제, #fff/#ECEBF4/#100B32/#FF3535 동일
                   색상)를 그대로 이식 — 문서 안 실제 도장 이미지를 클릭했을 때 그 이미지
                   바로 위에 뜬다(docSigToolbarPos, positionDocSigToolbar() 참고). -->
              <div
                class="html-sig-toolbar"
                class:html-sig-toolbar--below={docSigToolbarBelow}
                style="top:{docSigToolbarPos.top}px; left:{docSigToolbarPos.left}px;"
                role="group"
                aria-label="서명·직인 이미지 크기·위치 조절"
                bind:this={docSigToolbarEl}
              >
                <button type="button" class="html-sig-tbtn" title="너비 100px" onclick={() => setHtmlSigWidth(100)}>소(100)</button>
                <button type="button" class="html-sig-tbtn" title="너비 200px" onclick={() => setHtmlSigWidth(200)}>중(200)</button>
                <button type="button" class="html-sig-tbtn" title="너비 400px" onclick={() => setHtmlSigWidth(400)}>대(400)</button>
                <span class="html-sig-tsep"></span>
                <input
                  type="number"
                  class="html-sig-tinput"
                  min="20"
                  max="1200"
                  placeholder="px"
                  value={htmlIssuerSignatureWidth ?? HTML_SIG_DEFAULT_WIDTH}
                  onkeydown={(e) => { if (e.key === 'Enter') setHtmlSigWidth(Number((e.currentTarget as HTMLInputElement).value)) }}
                  onblur={(e) => setHtmlSigWidth(Number((e.currentTarget as HTMLInputElement).value))}
                  aria-label="서명·직인 이미지 너비(px)"
                />
                <span class="html-sig-tsep"></span>
                <!-- 위치 초기화(Migration #463, 2026-09-08 신규) — 문서 안 이미지를 직접 드래그해
                     이동한 뒤, 기본 중앙 위치로 손쉽게 되돌릴 수 있는 탈출구. -->
                <button
                  type="button"
                  class="html-sig-tbtn"
                  title="가운데로 되돌리기"
                  onclick={() => { htmlIssuerSignatureOffsetX = 0; htmlIssuerSignatureOffsetY = 0 }}
                  aria-label="발행자 서명·직인 이미지 위치 초기화"
                >위치 초기화</button>
                <span class="html-sig-tsep"></span>
                <button type="button" class="html-sig-tbtn html-sig-tbtn--danger" title="이미지 삭제" onclick={() => { removeHtmlSigAsset(); showDocSigToolbar = false }} aria-label="발행자 서명·직인 이미지 삭제">✕</button>
              </div>
            {/if}
          </div>
        </div>
        <div class="panel-col">
          <ContractFieldPanel
            onInsertField={() => {}}
            htmlMode={true}
            specifications={specs}
            onSpecsChange={(s: { key: string; value: string }[]) => { specs = s }}
            contractTermsText={htmlContractTermsText}
            onContractTermsChange={(v: string) => { htmlContractTermsText = v }}
            privacyTermsText={htmlPrivacyTermsText}
            onPrivacyTermsChange={(v: string) => { htmlPrivacyTermsText = v }}
          />
        </div>
      {:else}
        <!-- flow 모드: TipTap 에디터 + 필드 패널 2단 레이아웃 -->
        <div class="editor-col">
          {#key template?.id ?? '__new__'}
            <ContractDocumentEditor
              bind:this={editorRef}
              initialContent={docInit.initialContent}
              initialHtml={docInit.initialHtml}
              onchange={() => { flowContentDirty = true }}
            />
          {/key}
        </div>
        <div class="panel-col">
          <ContractFieldPanel
            onInsertField={(attrs: MergeFieldAttrs) => editorRef?.insertMergeField(attrs)}
            specifications={specs}
            onSpecsChange={(s: { key: string; value: string }[]) => { specs = s }}
          />
        </div>
      {/if}
    </div>
  </form>

  <!--
    액션 영역 — ⛔ 2026-08-29 위 <form id="tpl-form">의 형제(sibling)로 의도적으로 폼 밖에
    배치한다. CmsDeleteButton은 자기 자신도 독립된 <form>을 렌더링하는데(CmsDeleteButton.svelte),
    예전에는 이 영역이 위 <form> "안"에 있어 <form> 안에 또 <form>이 중첩되는 상태였다 —
    HTML 규격상 폼 중첩은 무효라 브라우저가 SSR로 받은 마크업을 파싱할 때 구조를 임의로
    고쳐버려, 그 결과 Svelte 5의 하이드레이션(SSR 결과와 클라이언트 렌더 결과를 맞춰보는
    과정) 자체가 매번 깨지고 있었다(모든 기존 계약서 양식 최초 진입 시 100% 재현되던
    "Illegal invocation" 콘솔 에러). 하이드레이션이 깨진 상태에서 좌측 목록의 다른 양식을
    클릭하면 이전 패널 DOM이 정상적으로 정리(unmount)되지 않고 새 패널이 그 위에 또
    쌓여, 화면은 이전 양식 그대로인데 실제로는 인스턴스가 중복 생성되는 증상으로
    이어졌다(Stephen 최초 발견 — 다른 양식 클릭해도 화면이 안 바뀜). 아래 flow 모드
    저장 버튼은 물리적으로 폼 밖에 있지만 `form="tpl-form"` 속성으로 여전히 그 폼을
    제출한다(HTML5 표준 기능) — 동작은 이전과 동일, 마크업 구조만 중첩을 없앴다.
  -->
  <div class="panel-actions">
    {#if authoringMode === 'canvas'}
      <!-- canvas 모드: 에디터 내 저장 버튼 사용 — 외부 저장 버튼 숨김 -->
      <span class="canvas-save-hint">저장은 캔버스 에디터 내 저장 버튼을 사용하세요.</span>
    {:else if authoringMode === 'spreadsheet'}
      <!--
        spreadsheet 모드: fetch 기반 저장
        기존 양식 수정("수정 저장")은 isSpreadsheetDirty(실제 변경 감지)가 true일 때만
        활성화 — 2026-08-28 Stephen 요청("수정 감지 시 활성화, 미감지 시 비활성화").
        신규 양식 등록("양식 등록")은 비교 대상 원본이 없어 이 게이팅에서 제외(기존
        동작 그대로 항상 클릭 가능).
      -->
      <button
        type="button"
        class="btn-action"
        disabled={saving || (!!template && !isSpreadsheetDirty)}
        onclick={handleSpreadsheetSave}
      >
        {saving ? '저장 중...' : template ? '수정 저장' : '양식 등록'}
      </button>
    {:else if authoringMode !== null}
      <!--
        flow/html 모드: 일반 저장 버튼 — form="tpl-form"으로 폼 밖에서도 정상 제출.
        기존 양식 수정("수정 저장")은 isFlowOrHtmlDirty(실제 변경 감지)가 true일 때만
        활성화 — spreadsheet 모드와 동일 원칙(2026-09-08, "다른 계약서 편집 UI와 동일"
        요청). 신규 양식 등록("양식 등록")은 비교 대상 원본이 없어 게이팅 제외.
      -->
      <button type="submit" form="tpl-form" class="btn-action" disabled={saving || (!!template && !isFlowOrHtmlDirty)}>
        {saving ? '저장 중...' : template ? '수정 저장' : '양식 등록'}
      </button>
    {/if}
    {#if template}
      <!-- 삭제 아이콘 버튼 — "수정 저장"/"양식 등록" 버튼 우측 끝에 배치(2026-09-08,
           CMS 표준 아이콘형 삭제버튼 위치 요청). 이전엔 이 액션바 맨 왼쪽에 있었다
           (margin-right:auto로 저장 버튼과 분리돼 있어 위치가 낯설다는 지적) — 지금은
           저장 버튼 다음 순서로 옮기고 그 스타일 규칙을 제거했다. -->
      <CmsDeleteButton
        action="?/delete"
        id={template.id}
        warnMessage="한번 더 클릭 시 이 양식이 삭제됩니다."
        successMessage="양식이 삭제되었습니다."
        onsuccess={() => { onsaved?.('') }}
      />
    {/if}
  </div>
</div>

<!-- 임포트 모달 -->
{#if showImport && importFile}
  <ContractImportModal
    initialFile={importFile}
    onclose={() => { showImport = false; importFile = null }}
    onImport={handleImport}
    onImportSpreadsheet={handleImportSpreadsheet}
  />
{/if}

<style>
  .template-panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
    gap: 10px;
  }
  .panel-title {
    font: var(--text-pc-title-16);
    font-weight: 700;
    color: var(--cs-text);
  }
  .panel-header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-import {
    height: 28px;
    padding: 0 10px;
    border: 1px solid rgba(59, 47, 138, 0.3);
    border-radius: var(--cms-radius-sm);
    background: transparent;
    font: var(--text-pc-script-12);
    color: var(--cs-purple);
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
  }
  .btn-import:hover {
    background: rgba(59, 47, 138, 0.06);
    border-color: var(--cs-purple);
  }

  .close-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
    color: var(--cs-text-mid);
    padding: 4px 8px;
    line-height: 1;
    border-radius: var(--radius-sm);
    transition: background 0.1s;
  }
  .close-btn:hover { background: var(--cs-lilac); }

  form {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .field-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 18px;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }
  .field-row--toggle {
    flex-wrap: wrap;
    align-items: center;
    row-gap: 4px;
    padding-top: 8px;
    padding-bottom: 8px;
  }
  .f-label {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text);
    white-space: nowrap;
  }
  .f-input {
    flex: 1;
    height: 32px;
    padding: 0 10px;
    border: 1px solid #DDDDDD;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    outline: none;
    transition: border-color 0.1s;
  }
  .f-input:focus { border-color: var(--cs-purple); }

  /* 토글 (기존 CMS 표준 패턴 — products/new와 동일) */
  .toggle-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .toggle-btn {
    position: relative;
    width: 44px;
    height: 26px;
    border: none;
    border-radius: 13px;
    background: var(--cs-surface-gray);
    cursor: pointer;
    transition: background 0.2s;
    flex-shrink: 0;
  }
  .toggle-btn.on { background: var(--cs-purple); }
  .toggle-knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--cs-white);
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.18);
  }
  .toggle-btn.on .toggle-knob { transform: translateX(18px); }
  .toggle-label {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
  }
  /* .toggle-hint(2026-09-08 제거) — toggle-label이 이미 상태별 동일 의미를 동적으로
     보여줘 순수 중복이던 정적 안내문. 캔버스 세로공간 확보를 위해 마크업+CSS 함께 제거. */
  /* 2026-09-08 — "서명 & 직인 이미지 등록" 버튼을 이 토글 행에 배치 +
     margin-left:auto로 행 오른쪽 끝에 정렬. */
  .btn-sig-upload--toggle-row {
    margin-left: auto;
  }

  /* 2단 레이아웃 */
  .editor-layout {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }

  .editor-col {
    flex: 1;
    min-width: 0;
    /*
     * overflow-y:auto(과거)를 overflow:hidden으로 변경 — .cde-wrap이 이미 flex:1 +
     * min-height:0으로 이 컨테이너에 정확히 맞춰지고, 내부 스크롤은 .cde-editor-area가
     * 전담한다. 바깥(.editor-col)에도 overflow-y:auto가 남아있으면 "이중 스크롤 컨테이너"가
     * 되어, 표 삽입 후 포커스 이동 시 브라우저가 안쪽(.cde-editor-area)이 아니라 바깥
     * (.editor-col)을 스크롤해버리는 경우가 생긴다 — 이러면 .cde-toolbar까지 통째로
     * 화면 위로 밀려 올라가 "메뉴바가 안 보인다"는 증상으로 나타난다(2026-08-15 실사용 중
     * 발견 — 빈 캔버스에서는 스크롤이 필요 없어 재현되지 않다가, 표를 삽입해 내용이 길어지면
     * 재현되는 패턴과 정확히 일치).
     */
    overflow: hidden;
    padding: 14px;
    display: flex;
    flex-direction: column;
  }

  .editor-col :global(.cde-wrap) {
    flex: 1;
    min-height: 0;
    /* min-width:0 필수 — 없으면 flex 아이템이 콘텐츠(넓은 임포트 표)의 min-content 폭까지
       자기 자신을 늘려버려 overflow-x:auto(.tableWrapper)가 무력화되고 툴바까지 화면
       밖으로 밀려나는 전형적인 flexbox 버그가 재현된다(2026-08-15 실사용 중 발견 —
       "엑셀 편집 메뉴바 미노출" + "가로폭이 비정상적으로 펼쳐짐" 두 증상의 공통 원인). */
    min-width: 0;
  }

  .panel-col {
    width: 220px;
    flex-shrink: 0;
    border-left: 1px solid var(--cs-lilac);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .panel-col :global(.cfp-wrap) {
    flex: 1;
    border: none;
    border-radius: 0;
  }

  .panel-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }

  .btn-action {
    height: 34px;
    padding: 0 20px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
    margin-left: auto;
  }
  .btn-action:hover    { background: var(--cs-purple-hover); }
  .btn-action:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  /* 서명·직인 이미지 등록 행 */
  .field-row--sig-upload {
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding-top: 8px;
    padding-bottom: 8px;
  }
  .btn-sig-upload {
    height: 28px;
    padding: 0 12px;
    border: 1px solid rgba(59, 47, 138, 0.4);
    border-radius: var(--cms-radius-sm);
    background: transparent;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-purple);
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
    white-space: nowrap;
  }
  .btn-sig-upload:hover {
    background: rgba(59, 47, 138, 0.06);
    border-color: var(--cs-purple);
  }
  .sig-upload-confirm {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .sig-file-name {
    font: var(--text-pc-script-12);
    color: var(--cs-text);
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sig-type-picker {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .sig-type-option {
    display: flex;
    align-items: center;
    gap: 4px;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text);
    cursor: pointer;
    user-select: none;
  }
  .sig-type-option input[type='radio'] { accent-color: var(--cs-purple); cursor: pointer; }
  .btn-sig-confirm {
    height: 28px;
    padding: 0 12px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.1s;
    white-space: nowrap;
  }
  .btn-sig-confirm:hover    { background: var(--cs-purple-hover); }
  .btn-sig-confirm:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
  .btn-sig-cancel {
    height: 28px;
    padding: 0 10px;
    background: transparent;
    color: var(--cs-text-mid);
    border: 1px solid #DDDDDD;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.1s;
    white-space: nowrap;
  }
  .btn-sig-cancel:hover    { background: var(--cs-surface-gray); }
  .btn-sig-cancel:disabled { opacity: 0.5; cursor: not-allowed; }

  /* 모드 선택 UI */
  .mode-select {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 24px;
    gap: 20px;
  }
  .mode-select-title {
    font: var(--text-pc-title-16);
    font-weight: 700;
    color: var(--cs-text);
    margin: 0;
  }
  .mode-buttons {
    display: flex;
    gap: 16px;
  }
  .mode-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    width: 220px;
    padding: 20px 18px;
    border: 1.5px solid #DDDDDD;
    border-radius: var(--radius-md);
    background: #ffffff;
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  }
  .mode-btn:hover {
    border-color: var(--cs-purple);
    background: rgba(59, 47, 138, 0.03);
    box-shadow: 0 2px 8px rgba(59, 47, 138, 0.10);
  }
  .mode-name {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
  }
  .mode-desc {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    line-height: 1.5;
  }

  /* canvas 에디터 래퍼 */
  .canvas-editor-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .canvas-editor-wrap :global(.cce-wrap) {
    flex: 1;
    min-height: 0;
  }

  /* canvas 모드 저장 안내 힌트 */
  .canvas-save-hint {
    margin-left: auto;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  /* spreadsheet 에디터 래퍼 */
  .spreadsheet-editor-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .spreadsheet-editor-wrap :global(.cse-wrap) {
    flex: 1;
    min-height: 0;
  }

  /* html 모드 미리보기 */
  .html-preview-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
  }
  .html-preview-doc {
    position: relative; /* 도장 이미지 클릭 시 뜨는 .html-sig-toolbar의 위치 기준점 */
    flex: 1;
    overflow: auto;
    padding: 16px;
    background: #fff;
  }

  /* "서명/직인 삽입" 버튼+팝오버(기존 자산 목록에서 선택)의 인라인 위치 기준 wrapper
     (2026-09-08, 7차 후속) — 발행자 서명·직인 필수 토글 행(.field-row--toggle) 안에
     "서명 & 직인 이미지 등록" 버튼 바로 옆에 배치된다. 과거 .html-sig-row(전용 행)는
     레이아웃 세로공간 확보를 위해 제거되고, 그 팝오버 위치 기준(position:relative)
     역할만 이 인라인 wrapper로 이관됨. */
  .html-sig-picker-inline {
    position: relative;
    flex-shrink: 0;
  }
  /* 발행자 서명·직인 미리보기 썸네일(캔버스 상단 popup, 아래 .html-sig-canvas-popup) */
  .html-sig-preview {
    display: block;
    max-height: 48px;
    width: auto;
    height: auto;
    object-fit: contain;
    border: 1px solid var(--cs-lilac);
    border-radius: 4px;
    background: #fafafa;
    flex-shrink: 0;
  }
  .html-sig-hint {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }
  /* 캔버스 상단 popup(2026-09-08) — 서명이 이미 등록된 상태의 미리보기·힌트·제거 UI를
     .html-sig-row에서 이곳으로 이관. .html-preview-doc(overflow:auto) 스크롤 컨테이너
     안에서 position:sticky로 상단 고정 — showDocSigToolbar(문서 안 도장 이미지 선택 상태)와
     연동해 노출/해제된다. */
  .html-sig-canvas-popup {
    position: sticky;
    top: 8px;
    z-index: 25;
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 12px;
    padding: 8px 12px;
    background: #fff;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    box-shadow: 0 4px 16px rgba(16, 11, 50, 0.12);
  }
  /* 문서 안 도장 이미지를 클릭했을 때 뜨는 플로팅 크기조절 툴바 — ContractSpreadsheetEditor.svelte
     renderCellValue()의 인라인 style 툴바(소/중/대 프리셋+구분선+너비입력+구분선+✕삭제,
     #fff/#ECEBF4/#100B32/#FF3535 고정 색상)를 CSS 클래스로 그대로 옮겨 적었다 — 임의로 새
     디자인을 만들지 않고 그 팝오버와 동일한 색상·크기값을 재현한다. 위치(top/left)는
     positionDocSigToolbar()가 클릭된 이미지의 실제 좌표를 계산해 인라인으로 지정 —
     .html-preview-doc(position:relative) 기준 절대좌표. (Stephen "설정바가 문서양식 내
     직인(서명) 이미지 선택 시 위에 위치해야해" 지시, 2026-09-07 재수정) */
  .html-sig-toolbar {
    position: absolute;
    transform: translate(-50%, calc(-100% - 8px)); /* 기본: 이미지 위쪽 */
    display: flex;
    align-items: center;
    gap: 4px;
    background: #fff;
    border: 1px solid #ECEBF4;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(16, 11, 50, 0.12);
    padding: 4px 8px;
    white-space: nowrap;
    z-index: 20;
  }
  /* 이미지 위쪽 공간이 부족할 때(overflow:auto 컨테이너 상단 경계에 잘림) 아래쪽으로 전환
     — positionDocSigToolbar()의 docSigToolbarBelow 판정과 짝을 이룸 */
  .html-sig-toolbar--below {
    transform: translate(-50%, 8px);
  }
  .html-sig-tbtn {
    min-height: 24px;
    min-width: 24px;
    padding: 2px 7px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    color: #100B32;
    cursor: pointer;
    line-height: 1.4;
    flex-shrink: 0;
    transition: background 0.1s;
    white-space: nowrap;
  }
  .html-sig-tbtn:hover { background: #ECEBF4; }
  .html-sig-tbtn--danger { color: #FF3535; }
  .html-sig-tsep {
    width: 1px;
    height: 16px;
    background: #ECEBF4;
    flex-shrink: 0;
    align-self: center;
  }
  .html-sig-tinput {
    width: 56px;
    height: 24px;
    padding: 0 4px;
    border: 1px solid #ECEBF4;
    border-radius: 6px;
    font-size: 11px;
    color: #100B32;
    outline: none;
    box-sizing: border-box;
    flex-shrink: 0;
  }
  .html-sig-popover {
    position: absolute;
    top: calc(100% + 4px);
    left: 12px;
    z-index: 200;
    background: var(--cs-white, #fff);
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    box-shadow: 0 4px 16px rgba(16, 11, 50, 0.12);
    min-width: 220px;
    max-width: 320px;
    overflow: hidden;
  }
  .html-sig-info {
    padding: 14px 16px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    line-height: 1.6;
    text-align: center;
  }
  .html-sig-list {
    display: flex;
    flex-direction: column;
    max-height: 280px;
    overflow-y: auto;
    padding: 4px;
  }
  .html-sig-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--cms-radius-sm);
    cursor: pointer;
    text-align: left;
    transition: background 0.1s, border-color 0.1s;
    width: 100%;
  }
  .html-sig-item:hover {
    background: var(--cs-lilac);
    border-color: var(--cs-lilac);
  }
  .html-sig-thumb {
    width: 48px;
    height: 32px;
    object-fit: contain;
    border: 1px solid var(--cs-lilac);
    border-radius: 4px;
    background: #fafafa;
    flex-shrink: 0;
  }
  .html-sig-item-label {
    font: var(--text-pc-script-12);
    font-weight: 600;
    color: var(--cs-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
