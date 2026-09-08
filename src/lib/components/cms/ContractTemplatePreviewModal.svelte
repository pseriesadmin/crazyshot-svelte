<script lang="ts">
  import { csToast } from '$lib/utils/toast'
  import { substituteVariables, substituteSpreadsheetDocument, substituteHtmlDocument, findHtmlUnresolvedVariables, applyIssuerSignatureMarker, applySpecialNotesMarker, updateSpecialNotesInHtml, type AnyContentBlock } from '$lib/utils/contract-substitution'
  import { applyContractTemplate } from '$lib/utils/contract-apply-template'
  import { hasExistingContractContent } from '$lib/utils/contract-content-mode'
  import { isTiptapDocBlock, isSpreadsheetDocument, isHtmlDocument } from '$lib/types/contract-document'
  import { renderTiptapDocToHtml } from '$lib/utils/tiptapRender'
  import { renderSpreadsheetToHtml } from '$lib/utils/spreadsheetRender'
  import ContractFieldPanel from '$lib/components/cms/contract-editor/ContractFieldPanel.svelte'
  import type { TiptapDocBlock } from '$lib/types/contract-document'
  import type { ContractSubstitutionData } from '$lib/types/contract-module'

  interface SpecRow { key: string; value: string }

  interface TemplateSummary {
    id: string
    title: string
    content_blocks: AnyContentBlock[]
    specifications: { key: string; value: string }[]
    created_at: string
    /** 작성 모드 — GET /api/cms/contract-templates로 반환 */
    authoring_mode?: string
    /** canvas 모드 문서 — authoring_mode='canvas'일 때 contracts.canvas_document에 저장 */
    canvas_document?: unknown
    /** spreadsheet 모드 문서 — authoring_mode='spreadsheet'일 때 contracts.spreadsheet_document에 저장 */
    spreadsheet_document?: unknown
    /** html 모드 문서 — authoring_mode='html'일 때 contracts.html_document에 저장 */
    html_document?: unknown
    /** html 모드 전용: 발행자 서명·직인 이미지 URL(Migration #450) */
    html_issuer_signature_url?: string | null
    /** html 모드 전용: 발행자 서명·직인 이미지 너비(px, Migration #451) */
    html_issuer_signature_width?: number | null
  }

  interface Props {
    contractId: string | null
    reservationId: number
    initialTemplateId?: string | null
    onclose: () => void
    onsent: () => void
    /**
     * "편집" 클릭 시 실제로 편집해야 할 contractId를 전달한다.
     * existing 모드(이미 저장된 내용 있음)면 기존 contractId 그대로.
     * template 모드(아직 아무 것도 적용 안 됨)면 handleEditClick()이 먼저 그 양식을
     * contractId에 적용(치환+저장)한 뒤 그 결과 id를 전달 — 그렇지 않으면 호출부가
     * "미리보기 중인 양식"과 무관한 예전 contractId(비어있을 수 있음)로 편집 화면을 열어
     * "정보가 사라졌다"는 오인을 유발한다(2026-08-15 실사용 중 발견한 실제 버그).
     */
    onEdit?: (editedContractId?: string) => void
    /**
     * true = 읽기 전용 열람 모드(대여현황 계약서 탭 전용, 2026-08-20).
     * 양식 목록·편집·발송 UI 전부 숨기고 이미 발행된 내용만 보여준다 — 발송용 데이터
     * 조회(contract-data, manager 이상 게이트)를 호출하지 않아 그 게이트와 무관하게 동작한다.
     */
    viewOnly?: boolean
    /**
     * template 모드에서 특약 클릭편집으로 계약이 방금 새로 발행(init-contract+PATCH)됐을 때
     * 호출된다(2026-09-08 신규) — 모달은 계속 열려있는 채로 existing 모드로 전환되므로,
     * 이 모달을 닫기 전까지는 호출부(RentalContractViewer)의 contractId prop이 갱신되지
     * 않는다. onEdit의 issuedCheckTick++ 패턴과 동일하게 "발행 목록" 표시 상태만 재확인시킨다.
     */
    onapplied?: (contractId: string) => void
    /**
     * 이미 발송(sent_at)·서명(signed_at)됐는지 여부(2026-09-08 신규) — html 모드 "발행=발송"
     * 정책의 되돌리기 가드로만 쓰인다. 미전달 시 항상 false로 간주(발송 전이라고 가정) —
     * AdminChatPanel의 viewOnly 열람 용도처럼 되돌리기 자체가 필요 없는 호출부는 생략 가능.
     */
    signingsentAt?:    string | null
    customerSignedAt?: string | null
  }

  let {
    contractId, reservationId, initialTemplateId = null, onclose, onsent, onEdit, onapplied,
    viewOnly = false, signingsentAt = null, customerSignedAt = null,
  }: Props = $props()

  let templates      = $state<TemplateSummary[]>([])
  let selectedId     = $state<string | null>(null)
  let subData        = $state<ContractSubstitutionData | null>(null)
  let loading        = $state(true)
  let sending        = $state(false)
  let applyingForEdit = $state(false)
  let error          = $state<string | null>(null)
  // template 모드에서 특약 클릭편집으로 계약이 새로 발행되면 그 결과 id를 여기 보관한다 —
  // contractId prop 자체는 부모가 다시 렌더링해줘야 갱신되므로(2026-09-08), 이 모달이 열려
  // 있는 동안은 이 값을 우선 사용한다.
  let localContractId = $state<string | null>(null)
  const effectiveContractId = $derived(localContractId ?? contractId)

  // ── 편집 내용 보존 관련 상태 ─────────────────────────────────────────────────
  // existing 모드: DB에 저장된 content_blocks 그대로 발송 (PATCH 없음, 편집 내용 보존)
  // template 모드: 양식 치환 후 PATCH 저장 → 발송 (기존 동작)
  let existingBlocks        = $state<AnyContentBlock[]>([])
  // canvas 계약의 경우 content_blocks는 항상 [] — canvas_document를 보관해 미리보기 분기에 활용
  let existingCanvasDocument       = $state<unknown>(null)
  // spreadsheet 계약의 경우 content_blocks는 항상 [] — spreadsheet_document를 보관해 미리보기 분기에 활용
  let existingSpreadsheetDocument  = $state<unknown>(null)
  // html 계약의 경우 content_blocks는 항상 [] — html_document를 보관해 미리보기 분기에 활용
  let existingHtmlDocument         = $state<unknown>(null)
  // 발행된 계약의 구조화된 특약 배열 — "계약 발행 보기" 특약 클릭편집 모달을 채우는 데만 쓰임
  // (표시 자체는 이미 existingHtmlDocument에 구운 텍스트로 baked돼 있음, 2026-09-07 신규)
  let existingSpecifications       = $state<SpecRow[]>([])
  let hasExistingContent = $state(false)
  // viewOnly는 항상 existing 취급 — 양식 선택 자체가 UI에서 제거되므로 template 모드로 빠질 일이 없음
  let contentMode        = $state<'existing' | 'template'>(viewOnly ? 'existing' : 'template')
  let overwriteWarning   = $state(false)       // 덮어쓰기 확인 배너 표시 여부
  let pendingTemplateId  = $state<string | null>(null)  // 덮어쓰기 대기 중인 양식 ID

  const selectedTemplate = $derived(templates.find((t) => t.id === selectedId) ?? null)

  // 미리보기 블록: existing 모드는 저장된 블록 그대로, template 모드는 치환 결과
  const previewBlocks = $derived<AnyContentBlock[]>(
    contentMode === 'existing'
      ? existingBlocks
      : (selectedTemplate && subData
          ? substituteVariables(selectedTemplate.content_blocks ?? [], subData)
          : [])
  )

  const previewTitle = $derived(
    contentMode === 'existing' ? '현재 편집된 내용 미리보기' : (selectedTemplate?.title ?? '')
  )

  /**
   * 스프레드시트형 미리보기 문서 — 2026-08-21 신규.
   * existing 모드: 이미 발송 시점에 치환·저장된 값이 그대로 들어있으므로 재치환 없이 사용.
   * template 모드: 아직 발송 전 원본 양식이므로 flow 모드 previewBlocks와 동일하게
   *   subData가 있으면 실시간으로 치환해서 보여준다(applySelectedTemplate()의 실제 발송
   *   로직과 동일한 치환 함수 재사용 — 발송 전/후 미리보기 값이 어긋나지 않도록).
   */
  const previewSpreadsheetDocument = $derived(
    contentMode === 'existing'
      ? (isSpreadsheetDocument(existingSpreadsheetDocument) ? existingSpreadsheetDocument : null)
      : (selectedTemplate && isSpreadsheetDocument(selectedTemplate.spreadsheet_document)
          ? (subData
              ? substituteSpreadsheetDocument(selectedTemplate.spreadsheet_document, subData)
              : selectedTemplate.spreadsheet_document)
          : null)
  )

  /**
   * html형 미리보기 문서 — existing 모드는 저장된 html_document 그대로,
   * template 모드는 subData가 있으면 변수 치환 후 표시.
   */
  const previewHtmlDocument = $derived<string | null>(
    contentMode === 'existing'
      ? (isHtmlDocument(existingHtmlDocument) ? (existingHtmlDocument as string) : null)
      : (selectedTemplate && isHtmlDocument(selectedTemplate.html_document)
          ? (() => {
              const withSig = applyIssuerSignatureMarker(
                selectedTemplate.html_document as string,
                selectedTemplate.html_issuer_signature_url,
                selectedTemplate.html_issuer_signature_width,
              )
              const withNotes = applySpecialNotesMarker(withSig, selectedTemplate.specifications)
              return subData ? substituteHtmlDocument(withNotes, subData) : withNotes
            })()
          : null)
  )

  const showPreview = $derived(
    // canvas / spreadsheet / html 계약은 existingBlocks가 [] 이므로 각 document 유무도 함께 확인
    (contentMode === 'existing' && (
      existingBlocks.length > 0 ||
      existingCanvasDocument != null ||
      existingSpreadsheetDocument != null ||
      existingHtmlDocument != null
    )) ||
    (contentMode === 'template' && selectedTemplate !== null)
  )

  // 발송 버튼 비활성화 조건
  const sendDisabled = $derived(
    sending ||
    overwriteWarning ||
    (contentMode === 'template' && !selectedTemplate)
  )

  /**
   * html 모드(authoring_mode='html') 여부(2026-09-08 신규).
   * html 계약서는 구조적으로 ContractEditorModal(캔버스형 편집기)에서 편집이 불가능하므로
   * — "편집" 버튼 자체를 숨기고, 특약 클릭편집(handleHtmlDocClick)만 유일한 수정 경로로 남긴다.
   */
  const isHtmlMode = $derived(
    contentMode === 'existing'
      ? isHtmlDocument(existingHtmlDocument)
      : selectedTemplate?.authoring_mode === 'html'
  )

  /**
   * "발행" = "채팅으로 발송" 실행으로만 인정한다(2026-09-08, Stephen 확정) — html 모드는
   * "편집" 버튼이 없어 특약 클릭편집(saveSpecialNotes)이 유일한 사전 저장 경로인데, 그
   * 저장은 미리보기 목적상 즉시 DB에 반영된다(§ saveSpecialNotes 참고, item 2 — 이 자동저장
   * 자체는 유지). 그런데 그 상태에서 "채팅으로 발송"을 누르지 않고 취소/닫기하면, 아직
   * 고객에게 보내지도 않은 초안이 "발행 목록"에 그대로 남아 마치 발행된 것처럼 보이는
   * 문제가 있었다(§ RentalContractViewer "발행 목록" 표시조건은 content 존재 여부만 봄).
   * → html 모드 + 미발송(signingsentAt 없음) + 미서명(customerSignedAt 없음) 상태에서
   *   취소/닫기하면, 지금까지 저장된 내용을 되돌려(DELETE) "발행 안 됨" 상태로 복원한다.
   *   이미 발송·서명된 계약(재발송/보기 목적으로 다시 연 경우)은 절대 되돌리지 않는다.
   */
  let closing = $state(false)

  async function handleClose() {
    if (closing) return
    const shouldRevert =
      !viewOnly &&
      isHtmlMode &&
      !signingsentAt &&
      !customerSignedAt &&
      contentMode === 'existing' &&
      hasExistingContent &&
      !!effectiveContractId

    if (!shouldRevert) {
      onclose()
      return
    }

    closing = true
    try {
      await fetch(`/api/cms/contracts/${effectiveContractId}/content`, { method: 'DELETE' })
    } catch {
      // fail-soft — 되돌리기 실패해도 모달 닫기 자체는 막지 않음(다음 진입 시 재확인 가능)
    } finally {
      closing = false
      onapplied?.(effectiveContractId!) // "발행 목록" 표시 상태 재확인(issuedCheckTick 트리거)
      onclose()
    }
  }

  async function loadData() {
    loading = true
    error = null
    try {
      // viewOnly: 양식 목록·발송용 치환 데이터는 화면에 노출되지 않으므로 조회 자체를 생략한다
      // (contract-data는 manager 이상 게이트라 partner 열람 시 불필요한 403을 유발하는 문제도 회피)
      if (!viewOnly) {
        const [tplRes, subRes] = await Promise.all([
          fetch('/api/cms/contract-templates'),
          fetch(`/api/cms/reservations/${reservationId}/contract-data`),
        ])
        if (!tplRes.ok) throw new Error('계약서 양식 목록을 불러오지 못했습니다.')
        if (!subRes.ok) throw new Error('예약 데이터를 불러오지 못했습니다.')

        templates = (await tplRes.json()) as TemplateSummary[]
        subData   = (await subRes.json()) as ContractSubstitutionData
      }

      // 기존 계약서 편집 내용 확인 (편집 보존 목적 — contractId가 있을 때만)
      // 실패해도 template 모드로 graceful fallback (주요 로드에 영향 없음)
      if (contractId) {
        try {
          // viewOnly(순수 "보기")일 때만 서명 시점 스냅샷을 우선 요청 — 편집/재발송 흐름은
          // 항상 라이브 콘텐츠를 그대로 불러와야 그 사이의 실제 변경사항을 잃지 않는다.
          const contentRes = await fetch(
            `/api/cms/contracts/${contractId}/content${viewOnly ? '?preferSignedSnapshot=1' : ''}`,
          )
          if (contentRes.ok) {
            const contentData = (await contentRes.json()) as {
              content_blocks?: unknown
              canvas_document?: unknown
              spreadsheet_document?: unknown
              html_document?: unknown
              authoring_mode?: string
              specifications?: SpecRow[]
            }
            existingSpecifications = contentData.specifications ?? []
            // ⚠️ 2026-09-07 순서 수정: hasExistingContractContent()가 html_document까지 함께
            // 검사하도록 넓어진 뒤로는(위 4번째 인자), authoring_mode='html'/'spreadsheet'인
            // 계약도 이 첫 분기 조건을 그대로 통과해버려 existingHtmlDocument/
            // existingSpreadsheetDocument를 채우는 자기 분기까지 도달하지 못하는 회귀가 있었다
            // (html_document만 있고 content_blocks는 항상 []인 계약이 "발행됨"으로는 잡히지만
            // 정작 그 내용을 담을 변수는 비어 있어 미리보기가 "표시할 계약 내용이 없습니다"로
            // 뜸). authoring_mode별 전용 분기를 먼저 확인하고, 어디에도 안 걸리는 flow/canvas
            // 계약만 마지막 범용 분기로 떨어지도록 순서를 바꿔 해소.
            if (
              contentData.authoring_mode === 'spreadsheet' &&
              contentData.spreadsheet_document != null
            ) {
              // spreadsheet 계약은 content_blocks가 항상 [] — spreadsheet_document로 판별
              existingSpreadsheetDocument = contentData.spreadsheet_document
              hasExistingContent = true
              contentMode = 'existing'
            } else if (
              contentData.authoring_mode === 'html' &&
              isHtmlDocument(contentData.html_document)
            ) {
              // html 계약은 content_blocks가 항상 [] — html_document로 판별
              existingHtmlDocument = contentData.html_document
              hasExistingContent = true
              contentMode = 'existing'
            } else if (hasExistingContractContent(contentData.content_blocks, contentData.canvas_document, contentData.spreadsheet_document, contentData.html_document)) {
              existingBlocks = contentData.content_blocks as AnyContentBlock[]
              // canvas 계약은 canvas_document를 보관 — 미리보기 분기 및 showPreview 조건에 사용
              existingCanvasDocument = contentData.canvas_document ?? null
              hasExistingContent = true
              contentMode = 'existing'
            }
          }
        } catch {
          // 네트워크 오류 등 → template 모드 유지 (graceful fallback)
        }
      }

      // 템플릿 초기 선택 — template 모드일 때만 (existing 모드에서는 미리보기와 무관)
      if (!viewOnly && contentMode !== 'existing') {
        if (initialTemplateId && templates.some((t) => t.id === initialTemplateId)) {
          selectedId = initialTemplateId
        } else if (templates.length > 0) {
          selectedId = templates[0].id
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : '데이터 로딩 실패'
    } finally {
      loading = false
    }
  }

  // 템플릿 항목 클릭 핸들러
  // existing 모드에서는 덮어쓰기 확인을 먼저 경유 — 조용한 덮어쓰기 경로 차단
  function onTemplateClick(templateId: string) {
    if (hasExistingContent && contentMode === 'existing') {
      pendingTemplateId = templateId
      overwriteWarning = true
    } else {
      selectedId = templateId
    }
  }

  // 덮어쓰기 확인 ("양식 다시 적용" 클릭)
  function confirmOverwrite() {
    if (pendingTemplateId) {
      selectedId = pendingTemplateId
      contentMode = 'template'
    }
    pendingTemplateId = null
    overwriteWarning = false
  }

  // 덮어쓰기 취소
  function cancelOverwrite() {
    pendingTemplateId = null
    overwriteWarning = false
  }

  /**
   * 현재 선택된 템플릿을 치환해 contractId에 적용(init-contract + PATCH)한다.
   * send()의 template 분기와 handleEditClick()이 동일 로직을 공유 — 발송 전 "편집"
   * 진입 시에도 미리보기에서 본 내용이 실제로 저장돼 있어야 하기 때문(§ handleEditClick 참고).
   * 실패 시 throw — 호출부에서 각자의 컨텍스트에 맞는 메시지로 처리.
   *
   * @param specsOverride 지정 시 selectedTemplate.specifications 대신 이 값을 저장·치환에 사용한다
   *   (2026-09-08 신규 — template 모드 특약 클릭편집에서, 사용자가 방금 입력한 값을 템플릿의
   *   기존 저장값 대신 즉시 반영하기 위함. saveSpecialNotes() 전용, 다른 호출부는 미지정).
   */
  async function applySelectedTemplate(
    specsOverride?: SpecRow[],
  ): Promise<{ contractId: string; htmlDocument?: string }> {
    if (!selectedTemplate || !subData) throw new Error('양식을 선택해 주세요.')

    const isCanvas      = selectedTemplate.authoring_mode === 'canvas'
    const isSpreadsheet = selectedTemplate.authoring_mode === 'spreadsheet'
    const isHtml        = selectedTemplate.authoring_mode === 'html'
    const specs         = specsOverride ?? (selectedTemplate.specifications ?? [])
    // canvas / spreadsheet / html 모드는 content_blocks가 빈 배열 — substituteVariables 적용 불필요.
    // canvas는 렌더 시점(/contract/[token])에 필드 바인딩으로 치환되지만, spreadsheet/html는
    // 텍스트 어디든 {{변수}} 등장 가능이라 apply-time 치환을 수행해 저장한다.
    const substitutedBlocks = (isCanvas || isSpreadsheet || isHtml)
      ? []
      : substituteVariables(selectedTemplate.content_blocks ?? [], subData)

    const substitutedSpreadsheetDocument =
      isSpreadsheet && isSpreadsheetDocument(selectedTemplate.spreadsheet_document)
        ? substituteSpreadsheetDocument(selectedTemplate.spreadsheet_document, subData)
        : undefined

    const substitutedHtmlDocument =
      isHtml && isHtmlDocument(selectedTemplate.html_document)
        ? substituteHtmlDocument(
            applySpecialNotesMarker(
              applyIssuerSignatureMarker(
                selectedTemplate.html_document as string,
                selectedTemplate.html_issuer_signature_url,
                selectedTemplate.html_issuer_signature_width,
              ),
              specs,
            ),
            subData,
          )
        : undefined

    const result = await applyContractTemplate({
      contractId: effectiveContractId,
      reservationId,
      title:               selectedTemplate.title,
      contentBlocks:       substitutedBlocks,
      specifications:      specs,
      templateId:          selectedTemplate.id,
      authoring_mode:      isSpreadsheet ? 'spreadsheet' : isCanvas ? 'canvas' : isHtml ? 'html' : 'flow',
      canvasDocument:      isCanvas      ? selectedTemplate.canvas_document      : undefined,
      spreadsheetDocument: substitutedSpreadsheetDocument,
      htmlDocument:        substitutedHtmlDocument,
      htmlIssuerSignatureUrl:   isHtml ? (selectedTemplate.html_issuer_signature_url ?? null)   : undefined,
      htmlIssuerSignatureWidth: isHtml ? (selectedTemplate.html_issuer_signature_width ?? null) : undefined,
    })

    if (result.error) throw new Error(result.error)
    if (!result.contractId) throw new Error('계약서 생성에 실패했습니다.')
    return { contractId: result.contractId, htmlDocument: substitutedHtmlDocument }
  }

  /**
   * 이미 서명 완료된 계약서는 "신규 발행/재발송"이 아니라 완료된 계약정보를 채팅으로
   * 단순 재공유한다(2026-09-08 Stephen 지시). send-chat은 서명 완료건을 재발송 불가로
   * 명시 차단하므로(RSV-C-B1) — 그 차단을 우회하는 게 아니라, 애초에 다른 목적(공유)의
   * 별도 엔드포인트로 처리한다. 치환·특약 검증 등 "신규 발행" 전용 로직은 전혀 거치지
   * 않는다 — 이미 확정된 서명 내용을 건드릴 이유가 없기 때문.
   */
  async function shareCompletedContract() {
    if (!effectiveContractId) {
      csToast.error('계약서 정보를 찾을 수 없습니다.')
      return
    }
    sending = true
    try {
      const res = await fetch(`/api/cms/contracts/${effectiveContractId}/share-chat`, {
        method: 'POST',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? '공유 실패')
      }
      csToast.success('완료된 계약서 정보를 채팅으로 공유했습니다.')
      onsent()
    } catch (e) {
      csToast.error(e instanceof Error ? e.message : '공유에 실패했습니다.')
    } finally {
      sending = false
    }
  }

  async function send() {
    if (customerSignedAt) {
      await shareCompletedContract()
      return
    }

    // 사전 가드
    if (contentMode === 'template' && (!selectedTemplate || !subData)) return
    if (contentMode === 'existing' && !effectiveContractId) {
      csToast.error('계약서 정보를 찾을 수 없습니다.')
      return
    }

    // CS2654 보완(CMS 전역 정밀검증 v6, 2026-09-07) — html 모드는 치환 실패 시 빈 문자열로
    // 조용히 지워지는 사양(§HT-6)이라 저장 이후에는 서버(send-chat)가 잔존 변수를 스캔해도
    // 잡히지 않는다. 저장 전(원본 템플릿 + subData) 시점에만 검증 가능하므로 여기서 먼저 막는다.
    if (
      contentMode === 'template' &&
      selectedTemplate?.authoring_mode === 'html' &&
      subData &&
      isHtmlDocument(selectedTemplate.html_document)
    ) {
      const missing = findHtmlUnresolvedVariables(selectedTemplate.html_document as string, subData)
      if (missing.length > 0) {
        csToast.error(`계약서에 아직 채워지지 않은 항목이 있어 발송할 수 없습니다: ${missing.join(', ')}`)
        return
      }
    }

    sending = true
    try {
      let targetContractId = effectiveContractId

      if (contentMode === 'existing') {
        // ── existing 경로: 편집 내용 보존 ──────────────────────────────────────
        // applySelectedTemplate() 호출 없음 → PATCH 없음 → 편집 내용 안전
        // targetContractId는 위에서 이미 effectiveContractId로 설정됨(existing 진입 시점에
        // 항상 non-null — 처음부터 existing이었거나, template 모드 특약 클릭편집으로 방금
        // localContractId가 채워졌거나 둘 중 하나)
      } else {
        // ── template 경로: 양식 치환 + PATCH 저장 + 발송 (기존 동작) ───────────
        targetContractId = (await applySelectedTemplate()).contractId
      }

      const sendRes = await fetch(`/api/cms/contracts/${targetContractId}/send-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!sendRes.ok) {
        const body = await sendRes.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? '발송 실패')
      }

      csToast.success('계약서가 채팅으로 발송되었습니다.')
      onsent()
    } catch (e) {
      csToast.error(e instanceof Error ? e.message : '발송에 실패했습니다.')
    } finally {
      sending = false
    }
  }

  /**
   * "편집" 클릭 핸들러.
   *
   * existing 모드(이미 저장된 내용 있음) — 곧바로 onEdit(contractId) 호출, 편집 내용 그대로 유지.
   *
   * template 모드(아직 아무 것도 저장 안 됨, 미리보기만 하는 중) — 과거엔 onEdit()을 인자 없이
   * 그대로 호출해 호출부(RentalContractViewer)가 "예전 contractId"(비어있거나 이 미리보기와
   * 무관한 레코드)로 편집 화면을 열어버렸다. 사용자 입장에서는 방금 미리보기에서 본 양식
   * 내용이 편집 화면에서 통째로 사라진 것처럼 보였다(2026-08-15 실사용 중 발견한 실제 버그
   * — reservation=67로 재현 확인: content_blocks가 진짜로 빈 배열인 오래된 contract row를
   * 가리키고 있었음). 이제는 "편집"을 누르면 먼저 지금 미리보고 있는 양식을 실제로
   * 적용(치환+저장)한 뒤, 그 결과 contractId로 편집 화면을 연다 — 미리보기=편집 시작점이
   * 항상 일치하도록 보장.
   */
  async function handleEditClick() {
    if (!onEdit) return

    if (contentMode === 'existing') {
      onEdit(effectiveContractId ?? undefined)
      return
    }

    if (!selectedTemplate || !subData) {
      csToast.error('양식을 선택해 주세요.')
      return
    }

    applyingForEdit = true
    try {
      const { contractId: appliedContractId } = await applySelectedTemplate()
      onEdit(appliedContractId)
    } catch (e) {
      csToast.error(e instanceof Error ? e.message : '편집 화면으로 이동하지 못했습니다.')
    } finally {
      applyingForEdit = false
    }
  }

  // ── 특약 클릭 편집 (2026-09-07 신규 "계약 발행 보기"(existing) 전용 → 2026-09-08 template
  // 모드까지 확장) ───────────────────────────────────────────────────────────────
  // 최초 구현은 existing 모드에서만 클릭이 동작했다 — template 모드(발행 전 양식 선택
  // 미리보기)에도 특약 조항이 그대로(선택된 템플릿의 저장값) 보이는데 클릭해도 반응이
  // 없어, 발행 전/후 미리보기가 겉보기엔 똑같은데 한쪽만 동작하는 혼란을 유발했다(Stephen
  // 실사용 중 발견, "특약작성 모달 기능 어디갔어" 문의). template 모드는 아직 이 예약
  // 전용 계약(contracts 행)이 없을 수 있으므로, 저장 시점에 applySelectedTemplate()로
  // 즉시 발행(init-contract+PATCH)한 뒤 contentMode를 'existing'으로 전환한다 — "편집"
  // 버튼을 눌러 진입하는 것과 동일한 발행 경로를 재사용, 별도 저장 로직 이원화 없음.
  let specialNotesModalOpen = $state(false)
  let editingSpecs          = $state<SpecRow[]>([])
  let savingSpecialNotes    = $state(false)

  function handleHtmlDocClick(e: MouseEvent) {
    if (viewOnly) return
    if (contentMode === 'template' && !selectedTemplate) return
    const cell = (e.target as HTMLElement).closest('.cs-special-notes-cell')
    if (!cell) return
    const currentSpecs = contentMode === 'existing'
      ? existingSpecifications
      : (selectedTemplate?.specifications ?? [])
    editingSpecs = currentSpecs.length > 0
      ? currentSpecs.map((s) => ({ ...s }))
      : [{ key: '', value: '' }]
    specialNotesModalOpen = true
  }

  function closeSpecialNotesModal() {
    specialNotesModalOpen = false
  }

  async function saveSpecialNotes() {
    savingSpecialNotes = true
    try {
      const filtered = editingSpecs.filter((s) => s.key.trim())

      if (contentMode === 'existing') {
        if (!effectiveContractId || !isHtmlDocument(existingHtmlDocument)) return
        const newHtml = updateSpecialNotesInHtml(existingHtmlDocument as string, filtered)
        const res = await fetch(`/api/cms/contracts/${effectiveContractId}/content`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content_blocks: [], specifications: filtered, html_document: newHtml }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error ?? '저장에 실패했습니다.')
        }
        existingHtmlDocument = newHtml
        existingSpecifications = filtered
      } else {
        // template 모드 — 지금 미리보고 있는 양식을 이 예약의 계약으로 즉시 발행하면서,
        // 방금 입력한 특약(filtered)을 그 발행 내용에 바로 반영한다.
        const applied = await applySelectedTemplate(filtered)
        if (!applied.htmlDocument) throw new Error('저장에 실패했습니다.')
        localContractId = applied.contractId
        existingHtmlDocument = applied.htmlDocument
        existingSpecifications = filtered
        hasExistingContent = true
        contentMode = 'existing'
        onapplied?.(applied.contractId)
      }

      csToast.success('특약 내용이 저장되었습니다.')
      specialNotesModalOpen = false
    } catch (e) {
      csToast.error(e instanceof Error ? e.message : '저장에 실패했습니다.')
    } finally {
      savingSpecialNotes = false
    }
  }

  loadData()
</script>

<div class="modal-overlay" role="dialog" aria-modal="true" aria-label={viewOnly ? '계약서 보기' : '계약서 양식 선택 및 발송'}>
  <div class="modal-wrap">
    <!-- 헤더 -->
    <div class="modal-header">
      <span class="modal-title">{viewOnly ? '계약서 보기' : '계약서 양식 적용 & 발송'}</span>
      <button type="button" class="close-btn" onclick={handleClose} disabled={closing} aria-label="닫기">✕</button>
    </div>

    {#if loading}
      <div class="state-center">
        <p class="state-text">불러오는 중...</p>
      </div>
    {:else if error}
      <div class="state-center">
        <p class="state-error">{error}</p>
        <button class="btn-retry" onclick={loadData}>다시 시도</button>
      </div>
    {:else if templates.length === 0 && !viewOnly}
      <div class="state-center">
        <p class="state-text">등록된 활성 계약서 양식이 없습니다.</p>
        <p class="state-sub">/cms/reservation/contracts 에서 양식을 먼저 작성하세요.</p>
      </div>
    {:else}
      <!-- 덮어쓰기 확인 배너: existing 모드에서 양식 선택 시 표시 -->
      {#if overwriteWarning}
        <div class="overwrite-banner" role="alert">
          <p class="overwrite-msg">
            이미 편집된 내용이 있습니다. 이 양식을 다시 적용하면 편집 내용이 사라집니다.
          </p>
          <div class="overwrite-actions">
            <button type="button" class="btn-cancel-overwrite" onclick={cancelOverwrite}>취소</button>
            <button type="button" class="btn-confirm-overwrite" onclick={confirmOverwrite}>양식 다시 적용</button>
          </div>
        </div>
      {/if}

      <div class="modal-body">
        <!-- 좌측: 양식 목록 (viewOnly에서는 편집 대상 자체가 없으므로 숨김) -->
        {#if !viewOnly}
          <div class="tpl-list">
            <p class="list-label">
              {contentMode === 'existing' ? '다른 양식으로 교체' : '양식 선택'}
            </p>
            {#if hasExistingContent && contentMode === 'existing'}
              <p class="list-existing-hint">양식 클릭 시 편집 내용 대체 확인</p>
            {/if}
            {#each templates as tpl (tpl.id)}
              <button
                type="button"
                class="tpl-item"
                class:selected={contentMode === 'template' && selectedId === tpl.id}
                class:tpl-item-overwrite-pending={overwriteWarning && pendingTemplateId === tpl.id}
                onclick={() => onTemplateClick(tpl.id)}
              >
                {tpl.title}
              </button>
            {/each}
          </div>
        {/if}

        <!-- 우측: 미리보기 (문서 뷰어) -->
        <div class="preview-pane">
          {#if contentMode === 'existing' && !overwriteWarning && !viewOnly}
            <div class="existing-notice">
              편집된 내용이 그대로 발송됩니다. 다른 양식으로 교체하려면 좌측 목록에서 양식을 클릭하세요.
            </div>
          {/if}
          {#if showPreview}
            <div class="doc-page">
              <div
                class="preview-title"
                class:preview-title-existing={contentMode === 'existing'}
              >
                {previewTitle}
              </div>
              {#if contentMode === 'template' && selectedTemplate?.authoring_mode === 'canvas'}
                <div class="preview-canvas-notice">
                  고정 캔버스형 계약서입니다. 발송 후 고객 서명 화면에서 배경 서식과 서명 필드를 확인할 수 있습니다.
                </div>
              {:else if contentMode === 'existing' && existingCanvasDocument != null}
                <div class="preview-canvas-notice">
                  발행된 고정 캔버스형 계약서입니다. 발송 후 고객 서명 화면에서 기존 발행 내용을 그대로 확인할 수 있습니다.
                </div>
              {/if}
              <div class="preview-content">
                {#each previewBlocks as block (block)}
                  {#if isTiptapDocBlock(block)}
                    <!-- tiptap-doc: 치환 후 정적 HTML로 렌더링 (발송 전 실시간 미리보기) -->
                    <div class="preview-block preview-block-tiptap">{@html renderTiptapDocToHtml((block as TiptapDocBlock).doc)}</div>
                  {:else if block.type === 'text'}
                    <div class="preview-block">{@html block.html}</div>
                  {:else if block.type === 'html'}
                    <div class="preview-block">{@html block.content}</div>
                  {:else if block.type === 'divider'}
                    <hr class="preview-divider" />
                  {/if}
                {/each}
                {#if previewSpreadsheetDocument}
                  <!-- 스프레드시트형: /contract/[token] 고객 화면과 동일한 렌더러로 실제 셀
                       내용을 그대로 펼쳐 보여준다(2026-08-21 — 이전엔 안내 문구만 표시하고
                       실제 내용은 발송 후에만 확인 가능했던 공백을 해소). -->
                  <div class="preview-block spreadsheet-doc-content">
                    {@html renderSpreadsheetToHtml(previewSpreadsheetDocument)}
                  </div>
                {/if}
                {#if previewHtmlDocument}
                  <!-- html형: 변수 치환된 고정 HTML 서식을 그대로 렌더링.
                       특약 셀(.cs-special-notes-cell) 클릭 편집은 viewOnly만 아니면 template/
                       existing 모드 둘 다 동작(2026-09-08 확장, saveSpecialNotes() 참고) -->
                  <div
                    class="preview-block html-contract-doc"
                    class:html-doc-editable={!viewOnly}
                    onclick={handleHtmlDocClick}
                  >
                    {@html previewHtmlDocument}
                  </div>
                {/if}
              </div>
            </div>
          {:else if contentMode === 'template'}
            <div class="preview-empty">양식을 선택하세요.</div>
          {:else}
            <div class="preview-empty">표시할 계약 내용이 없습니다.</div>
          {/if}
        </div>
      </div>

      <!-- 푸터 -->
      <div class="modal-footer">
        <button type="button" class="btn-cancel" onclick={handleClose} disabled={closing}>{viewOnly ? '닫기' : (closing ? '되돌리는 중...' : '취소')}</button>
        {#if !viewOnly}
          {#if onEdit && !isHtmlMode}
            <button
              type="button"
              class="btn-edit"
              onclick={handleEditClick}
              disabled={applyingForEdit || (contentMode === 'template' && !selectedTemplate)}
            >{applyingForEdit ? '적용 중...' : '편집'}</button>
          {/if}
          <button
            type="button"
            class="btn-send"
            onclick={send}
            disabled={sendDisabled}
          >
            {sending ? (customerSignedAt ? '공유 중...' : '발송 중...') : (customerSignedAt ? '완료 계약 공유' : '채팅으로 발송')}
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>

{#if specialNotesModalOpen}
  <div class="modal-overlay special-notes-overlay" role="dialog" aria-modal="true" aria-label="특약 입력">
    <div class="special-notes-modal">
      <div class="modal-header">
        <span class="modal-title">특약 입력</span>
        <button type="button" class="close-btn" onclick={closeSpecialNotesModal} aria-label="닫기">✕</button>
      </div>
      <div class="special-notes-body">
        <ContractFieldPanel
          htmlMode={true}
          specifications={editingSpecs}
          onSpecsChange={(s) => { editingSpecs = s }}
          onInsertField={() => {}}
        />
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-cancel" onclick={closeSpecialNotesModal}>취소</button>
        <button type="button" class="btn-send" onclick={saveSpecialNotes} disabled={savingSpecialNotes}>
          {savingSpecialNotes ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .modal-wrap {
    background: var(--cs-white);
    border-radius: var(--cms-radius-sm);
    width: 960px;
    max-width: 100%;
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
  }

  /* 헤더 */
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }
  .modal-title {
    font: var(--text-pc-title-16);
    font-weight: 700;
    color: var(--cs-text);
  }
  .close-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
    color: var(--cs-text-mid);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    transition: background 0.1s;
  }
  .close-btn:hover { background: var(--cs-lilac); }

  /* 상태 화면 */
  .state-center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 48px 24px;
  }
  .state-text { font: var(--text-pc-body-14); color: var(--cs-text-mid); margin: 0; }
  .state-sub  { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0; }
  .state-error { font: var(--text-pc-body-14); color: var(--cs-error); margin: 0; }
  .btn-retry {
    height: 30px;
    padding: 0 14px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    background: transparent;
    font: var(--text-pc-script-12);
    cursor: pointer;
  }

  /* 덮어쓰기 확인 배너 */
  .overwrite-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 20px;
    background: rgba(245, 158, 11, 0.08);
    border-bottom: 1px solid rgba(245, 158, 11, 0.25);
    border-left: 3px solid var(--cs-warning);
    flex-shrink: 0;
  }
  .overwrite-msg {
    margin: 0;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-warning);
    flex: 1;
    min-width: 0;
  }
  .overwrite-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .btn-cancel-overwrite {
    height: 28px;
    padding: 0 12px;
    border: 1px solid #DDDDDD;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray);
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.1s;
    white-space: nowrap;
  }
  .btn-cancel-overwrite:hover { background: var(--cs-lilac); }
  .btn-confirm-overwrite {
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--cs-warning);
    border-radius: var(--cms-radius-sm);
    background: var(--cs-white);
    color: var(--cs-warning);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
    white-space: nowrap;
  }
  .btn-confirm-overwrite:hover {
    background: rgba(245, 158, 11, 0.10);
  }

  /* 기존 내용 사용 중 안내 (미리보기 상단) */
  .existing-notice {
    padding: 8px 14px;
    margin-bottom: 16px;
    background: rgba(245, 158, 11, 0.06);
    border: 1px solid rgba(245, 158, 11, 0.20);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    color: var(--cs-warning);
    line-height: 1.5;
  }

  /* 미리보기 제목 — existing 모드 구분 */
  .preview-title-existing {
    color: var(--cs-text-mid);
    font-size: 13px;
    font-weight: 700;
  }

  /* 바디 */
  .modal-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* 좌측 목록 */
  .tpl-list {
    width: 220px;
    flex-shrink: 0;
    border-right: 1px solid var(--cs-lilac);
    overflow-y: auto;
    padding: 12px 0;
  }
  .list-label {
    margin: 0 0 4px;
    padding: 0 14px;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
  }
  .list-existing-hint {
    margin: 0 0 6px;
    padding: 2px 14px;
    font: var(--text-pc-script-12);
    font-weight: 400;
    color: var(--cs-warning);
    font-size: 11px;
  }
  .tpl-item {
    display: block;
    width: 100%;
    padding: 10px 14px;
    border: none;
    background: transparent;
    text-align: left;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text);
    cursor: pointer;
    transition: background 0.1s;
    border-bottom: 1px solid var(--cs-lilac);
  }
  .tpl-item:last-child { border-bottom: none; }
  .tpl-item:hover    { background: var(--cs-surface-gray); }
  .tpl-item.selected { background: var(--cs-purple-op10); color: var(--cs-purple); }
  .tpl-item.tpl-item-overwrite-pending {
    background: rgba(245, 158, 11, 0.08);
    color: var(--cs-warning);
  }

  /* 우측 미리보기 — 문서 뷰어 (실제 계약서처럼 종이 카드로 표시) */
  .preview-pane {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    background: var(--cs-surface-gray);
    padding: 28px 24px;
  }
  .preview-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-pc-body-14);
    color: var(--cs-text-light);
  }

  /* 종이 문서 카드 — A4 폭 기준 */
  .doc-page {
    width: 100%;
    max-width: 210mm;
    margin: 0 auto;
    background: var(--cs-white);
    box-shadow: 0 1px 2px rgba(16,11,50,0.06), 0 10px 28px rgba(16,11,50,0.10);
    padding: 20mm;
    box-sizing: border-box;
    position: relative; /* overlay 이미지 absolute 배치 기준점 */
  }
  .preview-title {
    padding: 0 0 18px;
    margin: 0 0 22px;
    font: var(--text-pc-title-18);
    font-weight: 700;
    color: var(--cs-text);
    border-bottom: 2px solid var(--cs-text);
    text-align: center;
  }
  .preview-content {
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .preview-block {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    line-height: 1.9;
  }
  /* overlay 이미지(position:absolute)가 이 블록을 기준으로 배치됨 — contract/[token]/+page.svelte .doc-block-tiptap과 동일 패턴 */
  .preview-block-tiptap {
    position: relative;
  }
  /*
   * renderTiptapDocToHtml()이 표를 감싸는 래퍼 — 넓은 표가 A4 페이지(.doc-page) 폭 밖으로
   * 넘치지 않도록 표만 가로 스크롤(tiptapRender.ts 참고, ContractDocumentEditor.svelte의
   * .tableWrapper와 동일 목적).
   */
  .preview-block-tiptap :global(.tt-table-scroll) {
    overflow-x: auto;
    max-width: 100%;
  }
  /*
   * TipTap 표(tiptap-doc content_blocks에서 생성) 기본 스타일 — 아래 cs-contract-table은
   * 레거시 ContentBlock 표(text/html 블록의 수기 HTML)용이라 TipTap이 생성한 <table>에는
   * 적용되지 않았음. 테두리·패딩이 전혀 없어 표가 "서식 소실"된 것처럼 보였다
   * (2026-08-15 실사용 중 발견 — ContractDocumentEditor.svelte .ProseMirror table 스타일과
   * 동일하게 맞춤, backgroundColor/borderColor 인라인 스타일도 이 기본 테두리 위에 표시됨).
   */
  .preview-block-tiptap :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.5em 0;
  }
  .preview-block-tiptap :global(table th),
  .preview-block-tiptap :global(table td) {
    border: 1px solid #ddd;
    padding: 4px 6px;
    overflow-wrap: anywhere;
  }
  .preview-block-tiptap :global(table th) {
    background: var(--cs-surface-gray);
    font-weight: 700;
  }
  .preview-block :global(table.cs-contract-table) {
    width: 100%;
    border-collapse: collapse;
    font: var(--text-pc-script-12);
  }
  .preview-block :global(table.cs-contract-table th),
  .preview-block :global(table.cs-contract-table td) {
    border: 1px solid #DDDDDD;
    padding: 7px 10px;
    text-align: left;
  }
  .preview-block :global(table.cs-contract-table th) {
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    font-weight: 700;
    width: 100px;
    white-space: nowrap;
  }
  .preview-divider {
    border: none;
    border-top: 1px solid var(--cs-lilac);
    margin: 4px 0;
  }

  /* 스프레드시트형 미리보기 — /contract/[token]/+page.svelte .spreadsheet-doc-content와
     동일한 renderSpreadsheetToHtml() 출력 클래스 스타일(2026-08-21 신규, 3화면 일관 적용) */
  .spreadsheet-doc-content {
    overflow-x: auto;
  }
  .spreadsheet-doc-content :global(.ss-sheet-page) {
    margin-bottom: 24px;
  }
  .spreadsheet-doc-content :global(.ss-sheet-name) {
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-text);
    margin: 0 0 8px;
  }
  .spreadsheet-doc-content :global(.ss-table) {
    border-collapse: collapse;
    font-size: 12px;
    color: var(--cs-text);
    min-width: 100%;
  }
  .spreadsheet-doc-content :global(.ss-table td) {
    border: 1px solid #ccc;
    padding: 4px 6px;
    white-space: pre-wrap;
    vertical-align: top;
    word-break: break-all;
  }
  .spreadsheet-doc-content :global(.ss-cell-image) {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    max-width: 600px;
    height: auto;
    z-index: 5;
    pointer-events: none;
  }

  /* canvas 모드 안내 */
  .preview-canvas-notice {
    padding: 10px 14px;
    margin-bottom: 16px;
    background: rgba(59, 47, 138, 0.06);
    border: 1px solid rgba(59, 47, 138, 0.18);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    color: var(--cs-purple);
    line-height: 1.5;
  }

  /* 푸터 */
  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 14px 20px;
    border-top: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }
  .btn-cancel {
    height: 34px;
    padding: 0 16px;
    border: 1px solid #DDDDDD;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray);
    font: var(--text-pc-body-14);
    cursor: pointer;
    transition: background 0.1s;
  }
  .btn-cancel:hover { background: var(--cs-lilac); }

  .btn-edit {
    height: 34px;
    padding: 0 16px;
    border: 1px solid var(--cs-purple);
    border-radius: var(--cms-radius-sm);
    background: transparent;
    color: var(--cs-purple);
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.1s;
    white-space: nowrap;
  }
  .btn-edit:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-edit:hover { background: var(--cs-purple-op10); }

  .btn-send {
    height: 34px;
    padding: 0 20px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-send:hover    { background: var(--cs-purple-hover); }
  .btn-send:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .no-contract-note {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin-right: auto;
  }

  /* 특약 클릭 편집 — 발행 보기(existing)에서만 커서·hover로 클릭 가능함을 표시.
     .cs-special-notes-cell은 defaultRentalContractHtml.ts가 굽는 고정 앵커 클래스명. */
  .html-doc-editable :global(.cs-special-notes-cell) {
    cursor: pointer;
    transition: background-color 0.12s;
  }
  .html-doc-editable :global(.cs-special-notes-cell:hover) {
    background-color: rgba(59, 47, 138, 0.08);
  }

  /* 특약 입력 모달 — 정중앙 오버레이(.modal-overlay 재사용) 위에 작은 카드로 표시 */
  .special-notes-overlay {
    z-index: 210;
  }
  .special-notes-modal {
    background: var(--cs-white);
    border-radius: var(--cms-radius-sm);
    width: 480px;
    max-width: 100%;
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
  }
  .special-notes-body {
    flex: 1;
    min-height: 240px;
    padding: 16px 20px;
    overflow-y: auto;
  }
</style>
