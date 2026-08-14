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
  import { isTiptapDocBlock, isCanvasDocument } from '$lib/types/contract-document'
  import type { TiptapDocBlock, MergeFieldAttrs, CanvasDocument, ContractCanvasPayload } from '$lib/types/contract-document'
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
  let saving         = $state(false)
  let showImport     = $state(false)

  let title          = $state('')
  let initialContent = $state<TiptapDocBlock | null>(null)
  let initialHtml    = $state<string | undefined>(undefined)
  let specs          = $state<{ key: string; value: string }[]>([{ key: '', value: '' }])

  // canvas 모드 상태
  let authoringMode  = $state<'flow' | 'canvas' | null>(null)
  let canvasDocInit  = $state<CanvasDocument | null>(null)

  // 에디터 컴포넌트 참조 (insertMergeField / setEditorContent / insertEditorContent / getEditorJSON)
  let editorRef: {
    insertMergeField:   (attrs: MergeFieldAttrs) => void
    setEditorContent:   (content: string | JSONContent) => void
    insertEditorContent:(content: JSONContent) => void
    getEditorJSON:      () => JSONContent | null
  } | null = $state(null)

  // --------------------------------------------------------------------------
  // 데이터 로드
  // --------------------------------------------------------------------------
  onMount(async () => {
    try {
      const res = await fetch(`/api/cms/contracts/${contractId}/content`)
      if (res.ok) {
        const body = await res.json() as {
          title?: string
          content_blocks?: unknown[]
          specifications?: { key: string; value: string }[]
          authoring_mode?: string
          canvas_document?: unknown
        }
        title = body.title ?? ''
        specs = (body.specifications?.length ?? 0) > 0
          ? (body.specifications as { key: string; value: string }[])
          : [{ key: '', value: '' }]

        // authoring_mode 감지 — canvas vs flow 분기
        if (body.authoring_mode === 'canvas' && isCanvasDocument(body.canvas_document)) {
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
        }
      }
    } catch {
      csToast.error('계약서 데이터를 불러오지 못했습니다.')
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
  function handleImport(result: { type: 'html'; html: string } | { type: 'json'; content: JSONContent }) {
    if (!editorRef) return
    if (result.type === 'html') {
      editorRef.setEditorContent(result.html)
    } else {
      editorRef.insertEditorContent(result.content)
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
          <button
            type="button"
            class="btn-import"
            onclick={() => { showImport = true }}
            title="외부 문서 가져오기"
            disabled={loading}
          >문서 가져오기</button>
        {/if}
        <button type="button" class="close-btn" onclick={onclose} aria-label="닫기">✕</button>
      </div>
    </div>

    {#if loading}
      <div class="modal-loading">데이터를 불러오는 중...</div>
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
          {#key contractId}
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
{#if showImport}
  <ContractImportModal
    onclose={() => { showImport = false }}
    onImport={handleImport}
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
