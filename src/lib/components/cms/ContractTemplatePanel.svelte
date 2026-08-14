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
  import { isTiptapDocBlock, isCanvasDocument, hasSignatureField } from '$lib/types/contract-document'
  import type { TiptapDocBlock, MergeFieldAttrs, CanvasDocument, ContractCanvasPayload } from '$lib/types/contract-document'
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
   * 작성 모드: 'flow' | 'canvas' | null(신규 미선택)
   * 신규(template=null): 처음엔 null → 모드 선택 UI → 선택 후 고정
   * 기존(template!=null): template.authoring_mode에서 초기화 (이후 변경 불가)
   */
  let authoringMode           = $state<'flow' | 'canvas' | null>(null)

  $effect(() => {
    specs = Array.isArray(template?.specifications) && (template.specifications as unknown[]).length > 0
      ? (template.specifications as { key: string; value: string }[])
      : [{ key: '', value: '' }]
    title                   = template?.title ?? ''
    requiresIssuerSignature = template?.requires_issuer_signature ?? false
    // 모드 초기화: 기존 템플릿이면 authoring_mode 사용, 신규면 null(미선택)
    authoringMode = template
      ? ((template.authoring_mode as 'flow' | 'canvas') ?? 'flow')
      : null
  })

  /** canvas 모드 초기 문서 — template의 canvas_document를 파싱 */
  const canvasDocInit = $derived<CanvasDocument | null>(
    isCanvasDocument(template?.canvas_document)
      ? (template?.canvas_document as CanvasDocument)
      : null
  )

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
  function handleImport(result: { type: 'html'; html: string } | { type: 'json'; content: JSONContent }) {
    if (!editorRef) return
    if (result.type === 'html') {
      editorRef.setEditorContent(result.html)
    } else {
      editorRef.insertEditorContent(result.content)
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
      // canvas 모드는 handleCanvasSave()가 직접 fetch로 처리 — form submit 취소
      if (authoringMode === 'canvas') {
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
    overflow-y: auto;
    padding: 14px;
    display: flex;
    flex-direction: column;
  }

  .editor-col :global(.cde-wrap) {
    flex: 1;
    min-height: 0;
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
</style>
