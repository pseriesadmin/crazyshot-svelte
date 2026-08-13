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
  import { isTiptapDocBlock } from '$lib/types/contract-document'
  import type { TiptapDocBlock, MergeFieldAttrs } from '$lib/types/contract-document'
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
        }
        title = body.title ?? ''
        specs = (body.specifications?.length ?? 0) > 0
          ? (body.specifications as { key: string; value: string }[])
          : [{ key: '', value: '' }]

        // content_blocks 포맷 감지
        const blocks = body.content_blocks ?? []
        if (blocks.length > 0 && isTiptapDocBlock(blocks[0])) {
          // 신규 TipTap 포맷
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
    } catch {
      csToast.error('계약서 데이터를 불러오지 못했습니다.')
    } finally {
      loading = false
    }
  })

  // --------------------------------------------------------------------------
  // 저장
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
        <button
          type="button"
          class="btn-import"
          onclick={() => { showImport = true }}
          title="외부 문서 가져오기"
          disabled={loading}
        >문서 가져오기</button>
        <button type="button" class="close-btn" onclick={onclose} aria-label="닫기">✕</button>
      </div>
    </div>

    {#if loading}
      <div class="modal-loading">데이터를 불러오는 중...</div>
    {:else}
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

      <!-- 푸터 -->
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
