<script lang="ts">
  /**
   * ContractTemplatePanel.svelte — 계약서 양식 편집 패널
   *
   * Phase 0~3 적용:
   * - CmsContentEditor + ContractModuleBar → ContractDocumentEditor + ContractFieldPanel 교체
   * - 특약 조항 UI를 ContractFieldPanel "특약" 탭으로 통합 (P3-2)
   * - 기존 ContentBlock[] 레거시 콘텐츠는 HTML 폴백으로 로드 지원
   */

  import { enhance } from '$app/forms'
  import { csToast } from '$lib/utils/toast'
  import CmsDeleteButton from '$lib/components/cms/CmsDeleteButton.svelte'
  import ContractDocumentEditor from '$lib/components/cms/contract-editor/ContractDocumentEditor.svelte'
  import ContractFieldPanel from '$lib/components/cms/contract-editor/ContractFieldPanel.svelte'
  import ContractImportModal from '$lib/components/cms/contract-editor/ContractImportModal.svelte'
  import { isTiptapDocBlock } from '$lib/types/contract-document'
  import type { TiptapDocBlock, MergeFieldAttrs } from '$lib/types/contract-document'
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
  // 특약 조항 / 제목 / 서명 옵션
  // $state 기본값 + $effect 동기화 패턴 (Pattern 1) — prop 참조를 $state() 초기화에서 제거
  // --------------------------------------------------------------------------
  let specs                   = $state<{ key: string; value: string }[]>([{ key: '', value: '' }])
  let title                   = $state('')
  let requiresIssuerSignature = $state(false)

  $effect(() => {
    specs = Array.isArray(template?.specifications) && (template.specifications as unknown[]).length > 0
      ? (template.specifications as { key: string; value: string }[])
      : [{ key: '', value: '' }]
    title                   = template?.title ?? ''
    requiresIssuerSignature = template?.requires_issuer_signature ?? false
  })
  let saving                  = $state(false)
  let showImport              = $state(false)

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
</script>

<div class="template-panel">
  <!-- 헤더 -->
  <div class="panel-header">
    <span class="panel-title">{template ? '계약서 양식 수정' : '계약서 양식 등록'}</span>
    <div class="panel-header-actions">
      <button
        type="button"
        class="btn-import"
        onclick={() => { showImport = true }}
        title="외부 문서 가져오기"
      >문서 가져오기</button>
      {#if onclose}
        <button type="button" class="close-btn" onclick={onclose} aria-label="닫기">✕</button>
      {/if}
    </div>
  </div>

  <form
    method="POST"
    action={template ? '?/update' : '?/create'}
    use:enhance={({ formData }) => {
      formData.set('content_blocks', serializeBlocks())
      formData.set('specifications', serializeSpecs())
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

    <!-- 에디터 + 필드 패널 2단 레이아웃 -->
    <div class="editor-layout">
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
      <button type="submit" class="btn-action" disabled={saving}>
        {saving ? '저장 중...' : template ? '수정 저장' : '양식 등록'}
      </button>
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
</style>
