<script lang="ts">
  /**
   * ContractFlowEditor.svelte — 계약서 양식(문서형) 편집기 어댑터 (adapters/crazyshot)
   *
   * 통합 편집기(DocEditor)를 크레이지샷 계약서 양식 화면에 연결한다.
   * ContractTemplatePanel이 기존 ContractDocumentEditor에 쓰던 props·export 이름을 그대로 맞춰
   * 호출부 수정을 최소화한다(initialContent·initialHtml·onchange / insertMergeField·getEditorJSON·setEditorContent·insertEditorContent).
   */
  import type { JSONContent } from '@tiptap/core'
  import DocEditor from '../../ui/DocEditor.svelte'
  import type { MergeFieldAttrs, TiptapDocBlock } from '../../core/types'
  import { notify, listSignatureAssets } from './bindings'
  import './host-tokens.css'

  interface Props {
    initialContent?: TiptapDocBlock | null
    initialHtml?: string
    readonly?: boolean
    onchange?: () => void
  }

  let { initialContent = null, initialHtml, readonly = false, onchange }: Props = $props()

  let editor: DocEditor | undefined = $state()

  export function insertMergeField(attrs: MergeFieldAttrs) { editor?.insertMergeField(attrs) }
  export function setEditorContent(content: string | JSONContent) { editor?.setEditorContent(content) }
  export function insertEditorContent(content: JSONContent) { editor?.insertEditorContent(content) }
  export function getEditorJSON(): JSONContent | null { return editor?.getEditorJSON() ?? null }
</script>

<div class="cs-doc-editor-host" style="display: contents">
  <DocEditor
    bind:this={editor}
    {initialContent}
    {initialHtml}
    {readonly}
    {onchange}
    {notify}
    {listSignatureAssets}
  />
</div>
