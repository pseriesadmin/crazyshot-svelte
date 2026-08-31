<script lang="ts">
  /**
   * ContractEditorModal.svelte — 개별 계약서 편집 모달
   *
   * Phase 0~3 적용:
   * - CmsContentEditor → ContractDocumentEditor (TipTap) 교체
   * - ContractModuleBar → ContractFieldPanel (커서위치 삽입) 교체
   * - 특약 조항 UI를 ContractFieldPanel의 "특약" 탭으로 통합 (P3-2)
   */

  import { onMount } from 'svelte'
  import { csToast } from '$lib/utils/toast'
  import ContractDocumentEditor from '$lib/components/cms/contract-editor/ContractDocumentEditor.svelte'
  import ContractFieldPanel from '$lib/components/cms/contract-editor/ContractFieldPanel.svelte'
  import ContractImportModal from '$lib/components/cms/contract-editor/ContractImportModal.svelte'
  import ContractCanvasEditor from '$lib/components/cms/contract-editor/ContractCanvasEditor.svelte'
  import ContractSpreadsheetEditor from '$lib/components/cms/contract-editor/ContractSpreadsheetEditor.svelte'
  import { isTiptapDocBlock, isCanvasDocument, isSpreadsheetDocument } from '$lib/types/contract-document'
  import type { TiptapDocBlock, MergeFieldAttrs, CanvasDocument, ContractCanvasPayload, SpreadsheetDocument } from '$lib/types/contract-document'
  import type { JSONContent } from '@tiptap/core'

  interface Props {
    contractId:    string
    reservationId: number
    onclose:       () => void
  }

  let { contractId, reservationId, onclose }: Props = $props()

  // --------------------------------------------------------------------------
  // 상태
  // --------------------------------------------------------------------------
  let loading        = $state(true)
  let loadError      = $state<string | null>(null)
  let saving         = $state(false)
  let showImport     = $state(false)

  // --------------------------------------------------------------------------
  // 외부 문서 가져오기 — 헤더 버튼 클릭 → 바로 OS 파일탐색기 (2026-08-30)
  // ContractTemplatePanel.svelte와 동일 패턴 — 상세 사유는 그쪽 주석 참고.
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

  let title          = $state('')
  let initialContent = $state<TiptapDocBlock | null>(null)
  let initialHtml    = $state<string | undefined>(undefined)
  let specs          = $state<{ key: string; value: string }[]>([{ key: '', value: '' }])

  // 작성 모드 상태 (flow / canvas / spreadsheet)
  let authoringMode      = $state<'flow' | 'canvas' | 'spreadsheet' | null>(null)
  let canvasDocInit      = $state<CanvasDocument | null>(null)
  let spreadsheetDocInit = $state<SpreadsheetDocument | null>(null)
  // 스프레드시트 에디터 강제 재마운트 키 (새 xlsx 임포트 시 increments)
  let spreadsheetMountKey = $state(0)
  // flow 에디터 강제 재마운트 키 (spreadsheet→flow 전환 후 initialHtml 반영에 사용)
  let editorMountKey = $state(0)

  // flow 에디터 컴포넌트 참조 (insertMergeField / setEditorContent / insertEditorContent / getEditorJSON)
  let editorRef: {
    insertMergeField:    (attrs: MergeFieldAttrs) => void
    setEditorContent:    (content: string | JSONContent) => void
    insertEditorContent: (content: JSONContent) => void
    getEditorJSON:       () => JSONContent | null
  } | null = $state(null)

  // spreadsheet 에디터 컴포넌트 참조 (getSpreadsheetDocument · insertTextAtSelection)
  let spreadsheetEditorRef: {
    getSpreadsheetDocument: () => SpreadsheetDocument
    insertTextAtSelection: (text: string) => boolean
  } | null = $state(null)

  // --------------------------------------------------------------------------
  // 데이터 로드
  // --------------------------------------------------------------------------
  onMount(async () => {
    try {
      const res = await fetch(`/api/cms/contracts/${contractId}/content`)
      if (!res.ok) {
        // 과거엔 이 분기가 아무것도 하지 않고 넘어가 authoringMode가 계속 null로 남았는데,
        // 템플릿 아래(:else) 렌더 조건이 authoringMode==='canvas' 외 전부(= null 포함)를
        // "flow 모드"로 취급해 실패 원인 안내 없이 빈 캔버스만 보여주는 문제가 있었다
        // (2026-08-15 실사용 중 "양식 정보 소실"로 오인됨 — 명시적 에러 상태로 전환).
        const body = await res.json().catch(() => ({})) as { error?: string }
        loadError = body.error ?? `계약서 데이터를 불러오지 못했습니다. (HTTP ${res.status})`
        return
      }
      const body = await res.json() as {
        title?: string
        content_blocks?: unknown[]
        specifications?: { key: string; value: string }[]
        authoring_mode?: string
        canvas_document?: unknown
        spreadsheet_document?: unknown
      }
      title = body.title ?? ''
      specs = (body.specifications?.length ?? 0) > 0
        ? (body.specifications as { key: string; value: string }[])
        : [{ key: '', value: '' }]

      // authoring_mode 감지 — spreadsheet / canvas / flow 분기
      if (body.authoring_mode === 'spreadsheet' && isSpreadsheetDocument(body.spreadsheet_document)) {
        authoringMode      = 'spreadsheet'
        spreadsheetDocInit = body.spreadsheet_document as SpreadsheetDocument
      } else if (body.authoring_mode === 'canvas' && isCanvasDocument(body.canvas_document)) {
        authoringMode = 'canvas'
        canvasDocInit = body.canvas_document as CanvasDocument
      } else {
        authoringMode = 'flow'
        // content_blocks 포맷 감지
        const blocks = body.content_blocks ?? []
        if (blocks.length > 0 && isTiptapDocBlock(blocks[0])) {
          initialContent = blocks[0] as TiptapDocBlock
        } else if (blocks.length > 0) {
          // 레거시 CmsContentEditor ContentBlock 배열 → HTML 추출
          const legacyHtml = (blocks as Array<{ type?: string; html?: string; content?: string }>)
            .map((b) => {
              if (b.type === 'text' && b.html) return b.html
              if (b.type === 'html' && b.content) return b.content
              return ''
            })
            .join('')
          initialHtml = legacyHtml || undefined
        }
        // blocks.length === 0 인 경우 initialContent/initialHtml 둘 다 미설정 상태 유지 —
        // 이건 실제로 "저장된 내용이 없는" 정상 상태(신규 계약)이므로 에러가 아님.
      }
    } catch {
      loadError = '계약서 데이터를 불러오지 못했습니다. 네트워크 상태를 확인해 주세요.'
    } finally {
      loading = false
    }
  })

  // --------------------------------------------------------------------------
  // 저장 (flow 모드)
  // --------------------------------------------------------------------------
  async function save() {
    if (!editorRef) return
    saving = true
    try {
      const doc = editorRef.getEditorJSON()
      const contentBlocks = doc ? [{ type: 'tiptap-doc', doc }] : []

      const res = await fetch(`/api/cms/contracts/${contractId}/content`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content_blocks: contentBlocks,
          specifications: specs.filter((s) => s.key.trim()),
          authoring_mode: 'flow',
        }),
      })
      if (res.ok) {
        csToast.success('계약서가 저장되었습니다.')
        onclose()
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string }
        csToast.error(body.error ?? '저장에 실패했습니다.')
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      saving = false
    }
  }

  // --------------------------------------------------------------------------
  // 저장 (canvas 모드) — ContractCanvasEditor.onSave 콜백
  // EC-3 클라이언트 검증은 ContractCanvasEditor.handleSave()에서 처리 후 여기로 진입.
  // 서버에서 재검증(content/+server.ts PATCH)이 이중으로 수행됨.
  // --------------------------------------------------------------------------
  async function handleCanvasSave(payload: ContractCanvasPayload): Promise<void> {
    saving = true
    try {
      const res = await fetch(`/api/cms/contracts/${contractId}/content`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:           payload.title || title,
          content_blocks:  [],
          specifications:  specs.filter((s) => s.key.trim()),
          authoring_mode:  'canvas',
          canvas_document: payload.canvasDocument,
        }),
      })
      if (res.ok) {
        csToast.success('계약서가 저장되었습니다.')
        onclose()
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string }
        csToast.error(body.error ?? '저장에 실패했습니다.')
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      saving = false
    }
  }

  // --------------------------------------------------------------------------
  // 배경 이미지 업로드 (canvas 모드) — 템플릿 패널과 동일 엔드포인트 재사용
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
  // 임포트 콜백
  // --------------------------------------------------------------------------
  /**
   * docx/hwpx → HTML 임포트.
   * - flow 모드: TipTap setEditorContent
   * - spreadsheet 모드: flow 모드로 전환 후 initialHtml로 에디터 재마운트
   */
  function handleImport(result: { type: 'html'; html: string }) {
    if (authoringMode === 'spreadsheet') {
      // spreadsheet → flow 전환 후 editorMountKey로 강제 재마운트
      authoringMode = 'flow'
      initialHtml   = result.html
      initialContent = null
      editorMountKey++
    } else if (editorRef) {
      editorRef.setEditorContent(result.html)
    }
  }

  /**
   * xlsx → SpreadsheetDocument 임포트.
   * authoringMode를 spreadsheet로 전환하고 spreadsheetMountKey로 에디터 강제 재마운트.
   */
  function handleImportSpreadsheet(doc: SpreadsheetDocument) {
    authoringMode      = 'spreadsheet'
    spreadsheetDocInit = doc
    spreadsheetMountKey++
  }

  // --------------------------------------------------------------------------
  // 저장 (spreadsheet 모드)
  // --------------------------------------------------------------------------
  async function saveSpreadsheet() {
    if (!spreadsheetEditorRef) return
    saving = true
    try {
      const doc = spreadsheetEditorRef.getSpreadsheetDocument()
      const res = await fetch(`/api/cms/contracts/${contractId}/content`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          title,
          content_blocks:       [],
          specifications:       specs.filter((s) => s.key.trim()),
          authoring_mode:       'spreadsheet',
          spreadsheet_document: doc,
        }),
      })
      if (res.ok) {
        csToast.success('계약서가 저장되었습니다.')
        onclose()
      } else {
        const body2 = await res.json().catch(() => ({})) as { error?: string }
        csToast.error(body2.error ?? '저장에 실패했습니다.')
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      saving = false
    }
  }

  function trapFocus(event: KeyboardEvent) {
    if (event.key === 'Escape') onclose()
  }
</script>

<svelte:window onkeydown={trapFocus} />

<div class="modal-overlay" role="dialog" aria-modal="true" aria-label="계약서 편집">
  <div class="modal-box">
    <!-- 헤더 -->
    <div class="modal-header">
      <span class="modal-title">계약서 편집</span>
      <div class="modal-header-actions">
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
            disabled={loading}
          >문서 가져오기</button>
        {/if}
        <button type="button" class="close-btn" onclick={onclose} aria-label="닫기">✕</button>
      </div>
    </div>

    {#if loading}
      <div class="modal-loading">데이터를 불러오는 중...</div>
    {:else if loadError}
      <!-- 데이터 로드 실패 — 과거엔 이 경우 안내 없이 빈 flow 모드 에디터가 떴음(2026-08-15 수정) -->
      <div class="modal-loading modal-load-error">
        <p>{loadError}</p>
        <button type="button" class="btn-secondary" onclick={onclose}>닫기</button>
      </div>
    {:else if authoringMode === 'canvas'}
      <!-- canvas 모드: 제목 입력 + ContractCanvasEditor (자체 저장 버튼 포함) -->
      <div class="modal-title-row">
        <label class="f-label" for="contract-title-canvas">계약서 제목</label>
        <input
          id="contract-title-canvas"
          class="f-input"
          bind:value={title}
          placeholder="계약서 제목"
        />
      </div>
      <div class="canvas-editor-wrap">
        {#key contractId}
          <ContractCanvasEditor
            initialDoc={canvasDocInit}
            title={title}
            specifications={specs.filter((s) => s.key.trim())}
            onUploadPage={uploadCanvasBackground}
            onSave={handleCanvasSave}
          />
        {/key}
      </div>
    {:else if authoringMode === 'spreadsheet'}
      <!-- spreadsheet 모드: 제목 입력 + ContractSpreadsheetEditor -->
      <div class="modal-title-row">
        <label class="f-label" for="contract-title-spreadsheet">계약서 제목</label>
        <input
          id="contract-title-spreadsheet"
          class="f-input"
          bind:value={title}
          placeholder="계약서 제목"
        />
      </div>
      <div class="modal-editor-layout">
        <div class="spreadsheet-editor-wrap">
          {#key `${contractId}-${spreadsheetMountKey}`}
            <ContractSpreadsheetEditor
              bind:this={spreadsheetEditorRef}
              initialDoc={spreadsheetDocInit}
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
      </div>
      <!-- 푸터 (spreadsheet 모드 전용) -->
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick={onclose}>취소</button>
        <button type="button" class="btn-action" onclick={saveSpreadsheet} disabled={saving}>
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    {:else}
      <!-- flow 모드 (기존 동작) -->
      <!-- 제목 -->
      <div class="modal-title-row">
        <label class="f-label" for="contract-title">계약서 제목</label>
        <input
          id="contract-title"
          class="f-input"
          bind:value={title}
          placeholder="계약서 제목"
        />
      </div>

      <!-- 에디터 + 필드 패널 2단 레이아웃 -->
      <div class="modal-editor-layout">
        <div class="editor-col">
          {#key `${contractId}-${editorMountKey}`}
            <ContractDocumentEditor
              bind:this={editorRef}
              {initialContent}
              {initialHtml}
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
      </div>

      <!-- 푸터 (flow 모드 전용) -->
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick={onclose}>취소</button>
        <button type="button" class="btn-action" onclick={save} disabled={saving}>
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
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

  .modal-box {
    background: var(--cs-white);
    border-radius: var(--cms-radius-sm);
    width: 100%;
    max-width: 1100px;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
    gap: 10px;
  }
  .modal-title {
    font: var(--text-pc-title-16);
    font-weight: 700;
    color: var(--cs-text);
  }
  .modal-header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-import {
    height: 30px;
    padding: 0 12px;
    border: 1px solid rgba(59, 47, 138, 0.3);
    border-radius: var(--cms-radius-sm);
    background: transparent;
    font: var(--text-pc-script-12);
    color: var(--cs-purple);
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
  }
  .btn-import:hover:not(:disabled) {
    background: rgba(59, 47, 138, 0.06);
    border-color: var(--cs-purple);
  }
  .btn-import:disabled { opacity: 0.4; cursor: not-allowed; }

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

  .modal-loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    padding: 48px;
  }
  .modal-load-error {
    flex-direction: column;
    gap: 14px;
    color: var(--cs-error, #E53935);
    text-align: center;
  }

  /* 제목 입력 행 */
  .modal-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 18px;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }
  .f-label {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text);
    white-space: nowrap;
  }
  .f-input {
    flex: 1;
    height: 34px;
    padding: 0 10px;
    border: 1px solid #DDDDDD;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    outline: none;
    transition: border-color 0.1s;
  }
  .f-input:focus { border-color: var(--cs-purple); }

  /* 2단 레이아웃 */
  .modal-editor-layout {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 0;
    overflow: hidden;
  }

  .editor-col {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
  }

  .editor-col :global(.cde-wrap) {
    flex: 1;
    min-height: 0;
  }

  .panel-col {
    width: 240px;
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

  /* canvas 에디터 래퍼 (modal-box flex 내에서 나머지 공간 채움) */
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

  /* spreadsheet 에디터 래퍼 */
  .spreadsheet-editor-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .spreadsheet-editor-wrap :global(.spreadsheet-editor-wrap) {
    flex: 1;
    min-height: 0;
  }

  /* 푸터 */
  .modal-footer {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 14px 18px;
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
  }
  .btn-action:hover    { background: var(--cs-purple-hover); }
  .btn-action:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .btn-secondary {
    height: 34px;
    padding: 0 16px;
    background: var(--cs-white);
    color: var(--cs-text);
    border: 1px solid #DDDDDD;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-secondary:hover { background: var(--cs-surface-gray); }
</style>
