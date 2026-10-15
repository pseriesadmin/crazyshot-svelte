/** adapters/supabase barrel — 범용 Supabase 저장소 (클라이언트는 호출 측이 주입) */
export { createDocStore } from './docStore'
export type { DocStore } from './docStore'
export { createSignatureStore, createStorageUploader, toEditorAssets } from './signatureStore'
export type { SignatureStore } from './signatureStore'
export type {
  DocTemplateRow, DocTemplateInput, DocTemplatePatch, SignatureAssetRow, StoreResult,
} from './types'
