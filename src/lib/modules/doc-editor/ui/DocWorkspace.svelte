<script lang="ts">
  /**
   * DocWorkspace.svelte — 편집기 + 변수 패널 결합 레이아웃 (doc-editor ui, 이식형)
   *
   * 호스트가 한 줄로 쓸 수 있는 기본 조합: 좌측 DocEditor(가변 폭) + 우측 VariablePanel(고정 폭).
   * DocEditor의 props는 그대로 받아 전달하고, 패널 클릭 시 insertVariable을 연결한다.
   * 레이아웃을 직접 짜고 싶은 호스트는 DocEditor·VariablePanel을 개별로 쓰면 된다.
   */
  import type { Snippet } from 'svelte'
  import DocEditor from './DocEditor.svelte'
  import VariablePanel from './VariablePanel.svelte'
  import type { DocJSON, EditImageInfo, MergeFieldAttrs, SignatureAsset, TiptapDocBlock, VariableCatalog } from '../core/types'
  import type { DocEditorFeatures } from './features'

  interface Props {
    catalog: VariableCatalog
    extraTabs?: { key: string; label: string }[]
    extra?: Snippet<[string]>
    panelWidth?: string
    panelHint?: string
    initialContent?: TiptapDocBlock | DocJSON | null
    initialHtml?: string
    readonly?: boolean
    onchange?: () => void
    notify?: (message: string, level: 'warning' | 'error' | 'info') => void
    uploadImage?: (file: File) => Promise<{ url: string }>
    onEditImage?: (info: EditImageInfo) => void
    listSignatureAssets?: () => Promise<SignatureAsset[]>
    features?: Partial<DocEditorFeatures>
    iconFontUrl?: string | null
  }

  let {
    catalog,
    extraTabs,
    extra,
    panelWidth = '220px',
    panelHint,
    ...editorProps
  }: Props = $props()

  let editor: DocEditor | undefined = $state()

  export function insertVariable(attrs: MergeFieldAttrs) { editor?.insertVariable(attrs) }
  export function getEditorJSON() { return editor?.getEditorJSON() ?? null }
  export function getEditorHTML() { return editor?.getEditorHTML() ?? '' }
  export function setEditorContent(content: Parameters<DocEditor['setEditorContent']>[0]) { editor?.setEditorContent(content) }
  export function focus() { editor?.focus() }
</script>

<div class="dws-layout">
  <div class="dws-editor"><DocEditor bind:this={editor} {...editorProps} /></div>
  <div class="dws-panel" style="width: {panelWidth}">
    <VariablePanel {catalog} {extraTabs} {extra} hint={panelHint} onInsert={(attrs) => editor?.insertVariable(attrs)} />
  </div>
</div>

<style>
  .dws-layout { display: flex; gap: 12px; align-items: stretch; min-width: 0; }
  .dws-editor { flex: 1; min-width: 0; }
  .dws-panel { flex-shrink: 0; }
</style>
