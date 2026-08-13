<script lang="ts">
  /**
   * ContractDocumentEditor.svelte — 계약 전용 TipTap flow 모드 에디터
   *
   * - CmsContentEditor.svelte 와 완전 독립 (상품설명·크레이지로그 공용 컴포넌트 미수정)
   * - svelte-tiptap 3.x (Svelte5 지원) 기반
   * - 이미지 업로드: validateUploadFile() 필수 통과 (P0-3)
   * - 변수 칩(MergeFieldNode): 직렬화 시 {{변수명}} 원문 보장 (substituteVariables 호환)
   * - 저장: onSave(payload) 어댑터 콜백으로 위임 (Supabase 직접 import 없음, Phase 9 원칙)
   */

  import { onDestroy, untrack } from 'svelte'
  import { createEditor, EditorContent } from 'svelte-tiptap'
  import { generateHTML, type JSONContent } from '@tiptap/core'

  import { csToast } from '$lib/utils/toast'
  import { validateUploadFile } from '$lib/utils/fileValidation'
  import { TIPTAP_CONTRACT_EXTENSIONS } from './tiptapExtensions'
  import type { TiptapDocBlock, ContractDocumentPayload, MergeFieldAttrs } from '$lib/types/contract-document'

  // --------------------------------------------------------------------------
  // Props
  // --------------------------------------------------------------------------
  interface Props {
    /** 초기 문서 콘텐츠 (content_blocks JSONB에서 로드된 값) */
    initialContent?: TiptapDocBlock | null
    /**
     * 레거시 HTML 초기값 — initialContent가 null일 때 폴백으로 사용.
     * 기존 CmsContentEditor(ContentBlock 배열)로 작성된 HTML을 그대로 로드할 때 사용.
     */
    initialHtml?: string
    /** 계약서 제목 */
    title?: string
    /** 특약 조항 */
    specifications?: { key: string; value: string }[]
    /** 적용된 템플릿 ID */
    templateId?: string | null
    /** 저장 콜백 — Supabase를 직접 호출하지 않고 호출부에 위임 */
    onSave?: (payload: ContractDocumentPayload) => Promise<void>
    /** 편집 비활성화 여부 */
    readonly?: boolean
  }

  let {
    initialContent = null,
    initialHtml,
    title: titleProp = '',
    specifications: specsProp = [],
    templateId = null,
    onSave,
    readonly = false,
  }: Props = $props()

  // --------------------------------------------------------------------------
  // 에디터 extension은 tiptapExtensions.ts에서 공유 (tiptapRender.ts와 동일 설정)
  // → TIPTAP_CONTRACT_EXTENSIONS import로 대체 (위 import 블록 참조)
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // TipTap 에디터 생성 (svelte-tiptap createEditor → Readable<Editor>)
  //
  // untrack()으로 props를 읽음: 부모가 {#key}로 remount를 보장하므로
  // content/editable은 마운트 시점에 한 번만 읽으면 충분 (의도적 비반응형 스냅샷).
  // readonly 변경 대응은 아래 $effect에서 setEditable()로 별도 처리.
  // --------------------------------------------------------------------------
  const editorStore = createEditor({
    extensions: TIPTAP_CONTRACT_EXTENSIONS,
    content: untrack(() =>
      initialContent?.doc ??
      initialHtml ??
      ({ type: 'doc', content: [{ type: 'paragraph' }] } as JSONContent)
    ),
    editable: untrack(() => !readonly),
  })

  onDestroy(() => {
    $editorStore?.destroy()
  })

  // readonly prop 변경 시 TipTap 에디터 editable 상태 동기화
  $effect(() => {
    $editorStore?.setEditable(!readonly)
  })

  // --------------------------------------------------------------------------
  // UI 상태
  // --------------------------------------------------------------------------
  let saving        = $state(false)
  let showHtmlModal = $state(false)
  let htmlSource    = $state('')
  let imgInput: HTMLInputElement | null = $state(null)

  // --------------------------------------------------------------------------
  // 서식 메뉴 핸들러 (P1-4)
  // --------------------------------------------------------------------------
  function toggle(cmd: string, opts?: Record<string, unknown>) {
    const e = $editorStore
    if (!e) return
    const chain = e.chain().focus()
    // unknown 경유 캐스팅 — ChainedCommands 동적 호출 (타입 안전한 대안 없음)
    type AnyChain = Record<string, (arg?: Record<string, unknown>) => AnyChain & { run: () => boolean }>
    const anyChain = chain as unknown as AnyChain
    const fn = anyChain[cmd]
    if (fn) {
      opts ? fn.call(anyChain, opts).run() : fn.call(anyChain).run()
    }
  }

  function isActive(cmd: string, opts?: Record<string, unknown>): boolean {
    return $editorStore?.isActive(cmd, opts) ?? false
  }

  function setLink() {
    const e = $editorStore
    if (!e) return
    const prev = e.getAttributes('link')['href'] as string | undefined ?? ''
    const url  = window.prompt('링크 URL', prev)
    if (url === null) return
    if (url === '') {
      e.chain().focus().unsetLink().run()
    } else {
      e.chain().focus().setLink({ href: url }).run()
    }
  }

  // --------------------------------------------------------------------------
  // 표 삽입/편집 핸들러 (P1-5)
  // --------------------------------------------------------------------------
  function insertTable() {
    $editorStore
      ?.chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run()
  }

  // --------------------------------------------------------------------------
  // 이미지 업로드 핸들러 (P1-6, P0-3 검증 포함)
  // --------------------------------------------------------------------------
  function triggerImgUpload() {
    imgInput?.click()
  }

  function onImgFileChange(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    const validation = validateUploadFile(file)
    if (!validation.ok) {
      csToast.error(validation.error ?? '허용되지 않는 파일 형식입니다.')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const src = e.target?.result as string
      if (src) {
        $editorStore?.chain().focus().setImage({ src }).run()
      }
    }
    reader.readAsDataURL(file)
    // 동일 파일 재선택 허용을 위해 value 초기화
    if (imgInput) imgInput.value = ''
  }

  // --------------------------------------------------------------------------
  // HTML 소스 보기/편집 토글 (P1-7)
  // --------------------------------------------------------------------------
  function openHtmlModal() {
    const e = $editorStore
    if (!e) return
    const doc = e.getJSON()
    htmlSource = generateHTML(doc, TIPTAP_CONTRACT_EXTENSIONS)
    showHtmlModal = true
  }

  function applyHtmlSource() {
    $editorStore?.commands.setContent(htmlSource)
    showHtmlModal = false
  }

  // --------------------------------------------------------------------------
  // 변수 칩 삽입 (P1-8) — 외부에서 접근 가능하도록 public 메서드로 노출
  // --------------------------------------------------------------------------
  export function insertMergeField(attrs: MergeFieldAttrs) {
    $editorStore?.chain().focus().insertMergeField(attrs).run()
  }

  // --------------------------------------------------------------------------
  // 문서 교체 (docx 임포트용) — HTML 문자열 또는 TipTap JSONContent 수용
  // --------------------------------------------------------------------------
  export function setEditorContent(content: string | JSONContent) {
    $editorStore?.commands.setContent(content)
  }

  // --------------------------------------------------------------------------
  // 커서 위치에 콘텐츠 삽입 (xlsx 테이블 삽입용)
  // --------------------------------------------------------------------------
  export function insertEditorContent(content: JSONContent) {
    $editorStore?.chain().focus().insertContent(content).run()
  }

  // --------------------------------------------------------------------------
  // 현재 에디터 JSON 반환 (폼 직렬화·저장용)
  // --------------------------------------------------------------------------
  export function getEditorJSON(): JSONContent | null {
    return $editorStore?.getJSON() ?? null
  }

  // --------------------------------------------------------------------------
  // 저장 (onSave 어댑터 콜백)
  // --------------------------------------------------------------------------
  async function handleSave() {
    if (!onSave) return
    const e = $editorStore
    if (!e) return
    saving = true
    try {
      const doc = e.getJSON()
      const block: TiptapDocBlock = { type: 'tiptap-doc', doc }
      await onSave({
        title:          titleProp,
        contentBlocks:  [block],
        specifications: specsProp,
        templateId,
      })
    } catch (err) {
      csToast.error(err instanceof Error ? err.message : '저장에 실패했습니다.')
    } finally {
      saving = false
    }
  }
</script>

<!-- 숨겨진 이미지 파일 input (P1-6) -->
<input
  type="file"
  accept="image/png,image/jpeg,image/webp,image/heif,image/heic"
  style="display:none"
  bind:this={imgInput}
  onchange={onImgFileChange}
  aria-label="이미지 업로드"
/>

<div class="cde-wrap">
  <!-- 서식 메뉴바 (P1-4, P1-5) -->
  {#if !readonly}
    <div class="cde-toolbar" role="toolbar" aria-label="서식 도구">
      <!-- 텍스트 서식 -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('bold')}
          onclick={() => toggle('toggleBold')}
          title="굵게 (Ctrl+B)"
          aria-label="굵게"
        ><strong>B</strong></button>
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('italic')}
          onclick={() => toggle('toggleItalic')}
          title="기울임 (Ctrl+I)"
          aria-label="기울임"
        ><em>I</em></button>
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('underline')}
          onclick={() => toggle('toggleUnderline')}
          title="밑줄 (Ctrl+U)"
          aria-label="밑줄"
        ><u>U</u></button>
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('strike')}
          onclick={() => toggle('toggleStrike')}
          title="취소선"
          aria-label="취소선"
        ><s>S</s></button>
      </div>

      <div class="cde-sep"></div>

      <!-- 정렬 -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('textAlign', { textAlign: 'left' })}
          onclick={() => toggle('setTextAlign', { textAlign: 'left' })}
          title="왼쪽 정렬"
          aria-label="왼쪽 정렬"
        >≡</button>
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('textAlign', { textAlign: 'center' })}
          onclick={() => toggle('setTextAlign', { textAlign: 'center' })}
          title="가운데 정렬"
          aria-label="가운데 정렬"
        >≡</button>
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('textAlign', { textAlign: 'right' })}
          onclick={() => toggle('setTextAlign', { textAlign: 'right' })}
          title="오른쪽 정렬"
          aria-label="오른쪽 정렬"
        >≡</button>
      </div>

      <div class="cde-sep"></div>

      <!-- 목록 -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('bulletList')}
          onclick={() => toggle('toggleBulletList')}
          title="글머리기호 목록"
          aria-label="글머리기호 목록"
        >•≡</button>
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('orderedList')}
          onclick={() => toggle('toggleOrderedList')}
          title="번호 목록"
          aria-label="번호 목록"
        >1≡</button>
      </div>

      <div class="cde-sep"></div>

      <!-- 제목 레벨 -->
      <div class="cde-group">
        {#each [1, 2, 3] as level (level)}
          <button
            type="button"
            class="cde-btn"
            class:active={isActive('heading', { level })}
            onclick={() => toggle('toggleHeading', { level })}
            title="제목 {level}"
            aria-label="제목 {level}"
          >H{level}</button>
        {/each}
      </div>

      <div class="cde-sep"></div>

      <!-- 링크 -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn"
          class:active={isActive('link')}
          onclick={setLink}
          title="링크 설정"
          aria-label="링크 설정"
        >🔗</button>
      </div>

      <div class="cde-sep"></div>

      <!-- 표 (P1-5) -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn"
          onclick={insertTable}
          title="표 삽입"
          aria-label="표 삽입"
        >표+</button>
        <button
          type="button"
          class="cde-btn"
          onclick={() => $editorStore?.chain().focus().addRowAfter().run()}
          title="행 추가"
          aria-label="행 추가"
        >행+</button>
        <button
          type="button"
          class="cde-btn"
          onclick={() => $editorStore?.chain().focus().deleteRow().run()}
          title="행 삭제"
          aria-label="행 삭제"
        >행-</button>
        <button
          type="button"
          class="cde-btn"
          onclick={() => $editorStore?.chain().focus().addColumnAfter().run()}
          title="열 추가"
          aria-label="열 추가"
        >열+</button>
        <button
          type="button"
          class="cde-btn"
          onclick={() => $editorStore?.chain().focus().deleteColumn().run()}
          title="열 삭제"
          aria-label="열 삭제"
        >열-</button>
        <button
          type="button"
          class="cde-btn"
          onclick={() => $editorStore?.chain().focus().toggleHeaderRow().run()}
          title="헤더행 토글"
          aria-label="헤더행 토글"
        >헤더</button>
        <button
          type="button"
          class="cde-btn"
          onclick={() => $editorStore?.chain().focus().deleteTable().run()}
          title="표 삭제"
          aria-label="표 삭제"
        >표-</button>
      </div>

      <div class="cde-sep"></div>

      <!-- 이미지 (P1-6) -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn"
          onclick={triggerImgUpload}
          title="이미지 삽입"
          aria-label="이미지 삽입"
        >이미지</button>
      </div>

      <div class="cde-sep"></div>

      <!-- HTML 소스 보기 (P1-7) -->
      <div class="cde-group">
        <button
          type="button"
          class="cde-btn"
          onclick={openHtmlModal}
          title="HTML 소스 편집"
          aria-label="HTML 소스 편집"
        >&lt;/&gt;</button>
      </div>
    </div>
  {/if}

  <!-- TipTap 에디터 영역 (P1-3) -->
  <div class="cde-editor-area" class:readonly>
    <EditorContent editor={$editorStore} class="cde-editor-content" />
  </div>

  <!-- 저장 버튼 -->
  {#if onSave && !readonly}
    <div class="cde-footer">
      <button
        type="button"
        class="cde-btn-save btn-action"
        onclick={handleSave}
        disabled={saving}
      >
        {saving ? '저장 중...' : '저장'}
      </button>
    </div>
  {/if}
</div>

<!-- HTML 소스 편집 모달 (P1-7) -->
{#if showHtmlModal}
  <div class="cde-html-overlay" role="dialog" aria-modal="true" aria-label="HTML 소스 편집">
    <div class="cde-html-modal">
      <div class="cde-html-header">
        <span class="cde-html-title">HTML 소스 편집</span>
        <button
          type="button"
          class="close-btn"
          onclick={() => { showHtmlModal = false }}
          aria-label="닫기"
        >✕</button>
      </div>
      <textarea
        class="cde-html-textarea"
        bind:value={htmlSource}
        spellcheck="false"
        aria-label="HTML 소스"
      ></textarea>
      <div class="cde-html-footer">
        <button type="button" class="btn-action" onclick={applyHtmlSource}>적용</button>
        <button type="button" class="btn-cancel" onclick={() => { showHtmlModal = false }}>취소</button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* 전체 래퍼 */
  .cde-wrap {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--cms-radius-sm, 8px);
    overflow: hidden;
    background: var(--cs-white, #fff);
  }

  /* 서식 메뉴바 */
  .cde-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    padding: 6px 10px;
    background: var(--cs-surface-gray, #f6f6f6);
    border-bottom: 1px solid var(--cs-lilac, #ECEBF4);
  }

  .cde-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .cde-sep {
    width: 1px;
    height: 18px;
    background: var(--cs-lilac, #ECEBF4);
    margin: 0 4px;
  }

  .cde-btn {
    min-height: 28px;
    min-width: 28px;
    padding: 2px 6px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm, 8px);
    font-size: 12px;
    font-weight: 600;
    color: var(--cs-text, #100B32);
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
    white-space: nowrap;
  }
  .cde-btn:hover { background: var(--cs-lilac, #ECEBF4); }
  .cde-btn.active {
    background: var(--cs-purple-op10, rgba(59,47,138,0.1));
    border-color: var(--cs-purple, #3B2F8A);
    color: var(--cs-purple, #3B2F8A);
  }

  /* 에디터 영역 */
  .cde-editor-area {
    flex: 1;
    min-height: 360px;
    padding: 16px;
    overflow-y: auto;
  }
  .cde-editor-area.readonly { background: var(--cs-surface-gray, #f6f6f6); }

  /* TipTap 에디터 내부 스타일 */
  .cde-editor-area :global(.cde-editor-content) {
    outline: none;
    min-height: 320px;
  }
  .cde-editor-area :global(.ProseMirror) {
    outline: none;
    font: var(--text-pc-body-14, 14px);
    color: var(--cs-text, #100B32);
    line-height: 1.8;
  }
  .cde-editor-area :global(.ProseMirror p) {
    margin: 0 0 0.5em;
  }
  .cde-editor-area :global(.ProseMirror h1) { font-size: 1.5em; font-weight: 700; margin: 0.5em 0; }
  .cde-editor-area :global(.ProseMirror h2) { font-size: 1.3em; font-weight: 700; margin: 0.5em 0; }
  .cde-editor-area :global(.ProseMirror h3) { font-size: 1.1em; font-weight: 700; margin: 0.4em 0; }
  .cde-editor-area :global(.ProseMirror ul),
  .cde-editor-area :global(.ProseMirror ol) {
    padding-left: 1.4em;
    margin: 0.4em 0;
  }

  /* 표 스타일 */
  .cde-editor-area :global(.ProseMirror table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.5em 0;
  }
  .cde-editor-area :global(.ProseMirror table th),
  .cde-editor-area :global(.ProseMirror table td) {
    border: 1px solid #ddd;
    padding: 6px 10px;
    min-width: 40px;
  }
  .cde-editor-area :global(.ProseMirror table th) {
    background: var(--cs-surface-gray, #f6f6f6);
    font-weight: 700;
  }
  .cde-editor-area :global(.ProseMirror .selectedCell) {
    background: rgba(59,47,138,0.08);
  }

  /* 이미지 */
  .cde-editor-area :global(.ProseMirror img) {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
  }

  /* 변수 칩 (MergeFieldNode) */
  .cde-editor-area :global(.cs-merge-chip) {
    display: inline-flex;
    align-items: center;
    padding: 1px 7px;
    background: var(--cs-purple-op10, rgba(59,47,138,0.1));
    border: 1px solid var(--cs-purple, #3B2F8A);
    border-radius: 99px;
    font-size: 11px;
    font-weight: 700;
    color: var(--cs-purple, #3B2F8A);
    cursor: default;
    user-select: none;
    white-space: nowrap;
  }
  .cde-editor-area :global(.cs-merge-chip.ProseMirror-selectednode) {
    outline: 2px solid var(--cs-purple, #3B2F8A);
    outline-offset: 1px;
  }

  /* 푸터 */
  .cde-footer {
    display: flex;
    justify-content: flex-end;
    padding: 8px 12px;
    border-top: 1px solid var(--cs-lilac, #ECEBF4);
    background: var(--cs-surface-gray, #f6f6f6);
  }

  .cde-btn-save {
    height: 32px;
    padding: 0 20px;
    background: var(--cs-purple, #3B2F8A);
    color: var(--cs-white, #fff);
    border: none;
    border-radius: var(--cms-radius-sm, 8px);
    font: var(--text-pc-body-14, 14px);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }
  .cde-btn-save:hover:not(:disabled) { background: var(--cs-purple-hover, #2d2470); }
  .cde-btn-save:disabled { background: var(--cs-disabled-button, #ccc); cursor: not-allowed; }

  /* HTML 소스 모달 */
  .cde-html-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .cde-html-modal {
    background: var(--cs-white, #fff);
    border-radius: var(--cms-radius-sm, 8px);
    width: 760px;
    max-width: 100%;
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 40px rgba(0,0,0,0.18);
  }
  .cde-html-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--cs-lilac, #ECEBF4);
    flex-shrink: 0;
  }
  .cde-html-title {
    font: var(--text-pc-title-16, 16px);
    font-weight: 700;
    color: var(--cs-text, #100B32);
  }
  .close-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
    color: var(--cs-text-mid, #666);
    padding: 4px 8px;
    border-radius: var(--radius-sm, 8px);
    transition: background 0.1s;
  }
  .close-btn:hover { background: var(--cs-lilac, #ECEBF4); }
  .cde-html-textarea {
    flex: 1;
    min-height: 360px;
    padding: 12px;
    font-family: monospace;
    font-size: 12px;
    line-height: 1.6;
    border: none;
    outline: none;
    resize: none;
    color: var(--cs-text, #100B32);
  }
  .cde-html-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--cs-lilac, #ECEBF4);
    flex-shrink: 0;
  }
  .btn-action {
    height: 32px;
    padding: 0 16px;
    background: var(--cs-purple, #3B2F8A);
    color: var(--cs-white, #fff);
    border: none;
    border-radius: var(--cms-radius-sm, 8px);
    font: var(--text-pc-script-12, 12px);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-action:hover { background: var(--cs-purple-hover, #2d2470); }
  .btn-cancel {
    height: 32px;
    padding: 0 14px;
    border: 1px solid #ddd;
    border-radius: var(--cms-radius-sm, 8px);
    background: var(--cs-surface-gray, #f6f6f6);
    font: var(--text-pc-script-12, 12px);
    cursor: pointer;
    transition: background 0.1s;
  }
  .btn-cancel:hover { background: var(--cs-lilac, #ECEBF4); }
</style>
