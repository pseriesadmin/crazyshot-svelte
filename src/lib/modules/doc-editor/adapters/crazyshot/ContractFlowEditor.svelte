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
  import type { EditImageInfo, MergeFieldAttrs, TiptapDocBlock } from '../../core/types'
  import MediaViewer from '$lib/components/common/MediaViewer.svelte'
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

  // 문서 속 이미지 더블클릭·도구줄 '편집' → 공통 이미지 뷰어(편집 포함). 문서 안 모든 이미지가 뷰어의 썸네일 정렬에 나열된다.
  // 편집 결과는 기존 정책대로 data URL로 문서에 인라인한다.
  let viewer = $state<{ info: EditImageInfo; items: { url: string; name: string }[]; index: number } | null>(null)
  function onEditImage(info: EditImageInfo): void {
    viewer = {
      info,
      items: info.images.map((im, i) => ({ url: im.src, name: im.alt || `문서 이미지 ${i + 1}` })),
      index: info.index,
    }
  }
  function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result ?? ''))
      r.onerror = () => reject(new Error('read'))
      r.readAsDataURL(blob)
    })
  }
  async function saveEditedImage(i: number, blob: Blob): Promise<boolean> {
    const v = viewer
    const target = v?.info.images[i]
    if (!v || !target) return false
    const url = await blobToDataUrl(blob)
    if (!url) return false
    target.replace(url)
    viewer = { ...v, items: v.items.map((it, k) => (k === i ? { ...it, url } : it)) }
    return true
  }

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
    {onEditImage}
    {listSignatureAssets}
  />
</div>

{#if viewer}
  <MediaViewer
    items={viewer.items}
    bind:index={viewer.index}
    title="문서 이미지"
    onclose={() => { viewer = null }}
    startInEdit={viewer.info.startEdit}
    onSave={saveEditedImage}
  />
{/if}
