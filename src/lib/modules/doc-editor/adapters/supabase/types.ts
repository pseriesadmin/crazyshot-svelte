/**
 * adapters/supabase/types.ts — 범용 Supabase 저장소 타입 (이식용)
 *
 * 테이블 정의는 sql/001_doc_editor.sql 과 1:1 대응한다.
 */
import type { TiptapDocBlock } from '../../core/types'

/** doc_templates 한 행 (문서·양식 1건) */
export interface DocTemplateRow {
  id: string
  title: string
  /** 호스트가 분류용으로 쓰는 문자열(예: 'contract', 'notice') — 기본 'doc' */
  kind: string
  /** [{ type:'tiptap-doc', doc }] — 통합 편집기 저장 포맷 */
  content: TiptapDocBlock[]
  /** 호스트 부가 데이터(예: 특약 목록) */
  meta: Record<string, unknown>
  status: 'active' | 'archived'
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type DocTemplateInput = {
  title: string
  kind?: string
  content: TiptapDocBlock[]
  meta?: Record<string, unknown>
  status?: 'active' | 'archived'
}

export type DocTemplatePatch = Partial<DocTemplateInput>

/** doc_signature_assets 한 행 (서명/직인 이미지) */
export interface SignatureAssetRow {
  id: string
  asset_type: 'signature' | 'seal'
  label: string | null
  image_url: string
  storage_path: string | null
  is_default: boolean
  created_at: string
  deleted_at: string | null
}

export interface StoreResult<T> {
  data: T | null
  error: string | null
}
