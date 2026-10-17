/**
 * doc-editor — 문서 & 양식 통합 편집기 (이식형 모듈) barrel
 *
 * core: 프로젝트 비종속 순수 TS(확장·치환·렌더·타입).
 * ui:   Svelte 5 컴포넌트(DocEditor·VariablePanel·DocWorkspace) — 호스트 의존은 모두 props 주입.
 * adapters/ 는 호스트별 바인딩(P4~P5)이며 barrel에 포함하지 않는다(필요한 쪽에서 직접 import).
 */
export * from './core/types'
export { DOC_EDITOR_EXTENSIONS, CustomImage, CustomTableCell, CustomTableHeader, CustomTableRow } from './core/extensions'
export { MergeFieldNode } from './core/nodes/MergeFieldNode'
export { Indent, MAX_INDENT } from './core/nodes/Indent'
export * from './core/imageTools'
export { renderDocToHtml } from './core/render'
export { substituteDoc, findUnresolvedInDoc } from './core/substitute'
export { fillMissingTableColwidths } from './core/table-colwidth'

export { default as DocEditor } from './ui/DocEditor.svelte'
export { default as VariablePanel } from './ui/VariablePanel.svelte'
export { default as DocWorkspace } from './ui/DocWorkspace.svelte'
export { DEFAULT_FEATURES } from './ui/features'
export type { DocEditorFeatures } from './ui/features'
export { validateImageFile, ALLOWED_IMAGE_MIME, MAX_IMAGE_BYTES } from './ui/imageFile'
export { ensureIconFont, DEFAULT_ICON_FONT_URL } from './ui/iconFont'
