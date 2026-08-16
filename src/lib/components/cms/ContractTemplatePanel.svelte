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
  import { invalidateAll } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'
  import CmsDeleteButton from '$lib/components/cms/CmsDeleteButton.svelte'
  import ContractDocumentEditor from '$lib/components/cms/contract-editor/ContractDocumentEditor.svelte'
  import ContractFieldPanel from '$lib/components/cms/contract-editor/ContractFieldPanel.svelte'
  import ContractImportModal from '$lib/components/cms/contract-editor/ContractImportModal.svelte'
  import ContractCanvasEditor from '$lib/components/cms/contract-editor/ContractCanvasEditor.svelte'
  import ContractSpreadsheetEditor from '$lib/components/cms/contract-editor/ContractSpreadsheetEditor.svelte'
  import { isTiptapDocBlock, isCanvasDocument, hasSignatureField, isSpreadsheetDocument } from '$lib/types/contract-document'
  import type { TiptapDocBlock, MergeFieldAttrs, CanvasDocument, ContractCanvasPayload, SpreadsheetDocument } from '$lib/types/contract-document'
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
   * 작성 모드: 'flow' | 'canvas' | 'spreadsheet' | null(신규 미선택)
   * 신규(template=null): 처음엔 null → 모드 선택 UI → 선택 후 고정
   * 기존(template!=null): template.authoring_mode에서 초기화 (이후 변경 불가)
   */
  let authoringMode           = $state<'flow' | 'canvas' | 'spreadsheet' | null>(null)
  // spreadsheet 에디터 강제 재마운트 키 (새 xlsx 임포트 시 increments)
  let spreadsheetMountKey     = $state(0)

  $effect(() => {
    specs = Array.isArray(template?.specifications) && (template.specifications as unknown[]).length > 0
      ? (template.specifications as { key: string; value: string }[])
      : [{ key: '', value: '' }]
    title                   = template?.title ?? ''
    requiresIssuerSignature = template?.requires_issuer_signature ?? false
    // 모드 초기화: 기존 템플릿이면 authoring_mode 사용, 신규면 null(미선택)
    authoringMode = template
      ? ((template.authoring_mode as 'flow' | 'canvas' | 'spreadsheet') ?? 'flow')
      : null
  })

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
        await invalidateAll()
        if (onsaved) onsaved(id)
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
        await invalidateAll()
        if (onsaved) onsaved(id)
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
        <button
          type="button"
          class="btn-import"
          onclick={() => { showImport = true }}
          title="외부 문서 가져오기"
        >문서 가져오기</button>
      {/if}
      {#if onclose}
        <button type="button" class="close-btn" onclick={onclose} aria-label="닫기">✕</button>
      {/if}
    </div>
  </div>

  <form
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
      formData.set('authoring_mode', 'flow')
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
      <span class="toggle-hint">이 양식으로 계약을 발행할 때 관리자(발행자) 서명 또는 직인 첨부를 필수로 만듭니다.</span>
      <input type="hidden" name="requires_issuer_signature" value={requiresIssuerSignature.toString()} />
    </div>

    <!-- 서명 & 직인 이미지 등록 — 토글 행 바로 아래 -->
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
    <div class="field-row field-row--sig-upload">
      <span class="f-label">서명·직인 이미지</span>
      {#if sigUploadFile}
        <!-- 파일 선택됨 → 유형 선택 + 확인/취소 -->
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
      {:else}
        <button
          type="button"
          class="btn-sig-upload"
          onclick={openSigUpload}
          aria-label="서명·직인 이미지 파일 선택"
        >서명 & 직인 이미지 등록</button>
        <span class="sig-upload-hint">PNG · JPEG · GIF · 최대 5MB</span>
      {/if}
    </div>

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
      {:else}
        <!-- flow 모드: TipTap 에디터 + 필드 패널 2단 레이아웃 -->
        <div class="editor-col">
          {#key template?.id ?? '__new__'}
            <ContractDocumentEditor
              bind:this={editorRef}
              initialContent={docInit.initialContent}
              initialHtml={docInit.initialHtml}
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

    <!-- 액션 영역 -->
    <div class="panel-actions">
      {#if template}
        <CmsDeleteButton
          action="?/softDelete"
          id={template.id}
          warnMessage="한번 더 클릭 시 이 양식이 삭제됩니다."
          successMessage="양식이 삭제되었습니다."
          onsuccess={() => { onsaved?.('') }}
        />
      {/if}
      {#if authoringMode === 'canvas'}
        <!-- canvas 모드: 에디터 내 저장 버튼 사용 — 외부 저장 버튼 숨김 -->
        <span class="canvas-save-hint">저장은 캔버스 에디터 내 저장 버튼을 사용하세요.</span>
      {:else if authoringMode === 'spreadsheet'}
        <!-- spreadsheet 모드: fetch 기반 저장 -->
        <button
          type="button"
          class="btn-action"
          disabled={saving}
          onclick={handleSpreadsheetSave}
        >
          {saving ? '저장 중...' : template ? '수정 저장' : '양식 등록'}
        </button>
      {:else if authoringMode !== null}
        <!-- flow 모드: 일반 저장 버튼 -->
        <button type="submit" class="btn-action" disabled={saving}>
          {saving ? '저장 중...' : template ? '수정 저장' : '양식 등록'}
        </button>
      {/if}
    </div>
  </form>
</div>

<!-- 임포트 모달 -->
{#if showImport}
  <ContractImportModal
    onclose={() => { showImport = false }}
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
  .toggle-hint {
    flex-basis: 100%;
    padding-left: calc(68px + 18px); /* f-label 너비 + gap 보정 */
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    line-height: 1.4;
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
  .panel-actions :global(.act-del) { margin-right: auto; }

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
  .sig-upload-hint {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
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
</style>
