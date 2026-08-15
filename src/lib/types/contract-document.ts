/**
 * contract-document.ts — 계약 전용 타입
 *
 * content-editor.ts (상품설명·크레이지로그 공용)와 완전 독립된 계약서 전용 타입.
 * DB 컬럼 `content_blocks` JSONB 에 저장 시 tiptap-doc 형식을 사용.
 *
 * 저장 포맷 예시 (content_blocks JSONB):
 * [{ "type": "tiptap-doc", "doc": { ...TipTap JSONContent... } }]
 *
 * 렌더링: /contract/[token]/+page.svelte 에서 type === 'tiptap-doc' 분기로 처리.
 *         generateHTML()이 DOM(document)을 사용하므로 browser 가드 필수 — SSR에서 호출 금지.
 * 치환:   contract-substitution.ts의 substituteVariables()는 'tiptap-doc' 블록을 만나면
 *         substituteTiptapDoc()을 호출해 JSONContent 트리를 재귀 순회하며 mergeField 노드를
 *         실제 값 텍스트 노드로 치환한다(pass-through 아님).
 */

import type { JSONContent } from '@tiptap/core'
import type { ContractSubstitutionData } from '$lib/types/contract-module'
import type { SheetMergeRange, XlsxCellFormatting } from '$lib/types/sheet-format'

// --------------------------------------------------------------------------
// DB 저장 포맷 (content_blocks JSONB 컬럼)
// --------------------------------------------------------------------------

/**
 * TipTap 에디터로 작성된 계약서 블록.
 * content_blocks 배열의 단일 원소로 저장된다(항상 배열 길이 1).
 */
export interface TiptapDocBlock {
  type: 'tiptap-doc'
  /** TipTap JSONContent — ProseMirror 문서 트리 */
  doc: JSONContent
}

/**
 * 기존 ContentBlock 배열 포맷(레거시, CmsContentEditor 작성분)과의 구분을 위한 타입 가드.
 * content_blocks[0]?.type === 'tiptap-doc' 이면 새 에디터 형식.
 */
export function isTiptapDocBlock(block: unknown): block is TiptapDocBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as Record<string, unknown>)['type'] === 'tiptap-doc' &&
    'doc' in (block as Record<string, unknown>)
  )
}

// --------------------------------------------------------------------------
// 에디터 내부 타입
// --------------------------------------------------------------------------

/**
 * MergeFieldNode 속성 — 변수 칩 노드
 * contenteditable=false 인라인 atom 노드로 렌더링됨.
 * 직렬화 시 텍스트는 반드시 `{{변수명}}` 원문(substituteVariables 정규식 호환).
 */
export interface MergeFieldAttrs {
  /** 변수명 (ContractSubstitutionData의 키) */
  variable: string
  /** 화면 표시용 레이블 (예: "고객이름") — 직렬화에서는 variable 만 사용 */
  label: string
}

// --------------------------------------------------------------------------
// 저장/로드 헬퍼 타입
// --------------------------------------------------------------------------

/**
 * ContractDocumentEditor 가 onSave 콜백으로 넘기는 페이로드.
 * Supabase 클라이언트를 직접 import 하지 않고 어댑터 콜백으로 위임(Phase 9 패키징 원칙).
 */
export interface ContractDocumentPayload {
  title: string
  contentBlocks: TiptapDocBlock[]
  specifications?: { key: string; value: string }[]
  templateId?: string | null
}

// --------------------------------------------------------------------------
// Canvas 모드 — 고정 배경 + 좌표 기반 필드 배치 (Phase 6)
// --------------------------------------------------------------------------

/**
 * canvas 모드에서 지원하는 필드 타입
 *   v1: signature / text / label (3종)
 *   v2: issuer-image 추가 (발행자 서명·직인 이미지 배치 — ContractCanvasFieldPalette에서 자산 선택)
 */
export type CanvasFieldType = 'signature' | 'text' | 'label' | 'issuer-image'

/**
 * canvas 모드 배경 페이지.
 * 이미지 URL(Supabase Storage 또는 Cloudinary)을 배경으로 사용.
 * width/height는 이미지의 표시 기준 픽셀(display pixel space) — 필드 좌표와 동일 공간.
 */
export interface CanvasPage {
  /** 고유 식별자 (UUID) */
  id: string
  /** 배경 이미지 URL */
  imageUrl: string
  /** 표시 너비 (px) — 필드 좌표의 기준 공간 */
  width: number
  /** 표시 높이 (px) */
  height: number
}

/**
 * canvas 모드 배치 필드.
 * x, y, width, height는 모두 CanvasPage와 동일한 픽셀 좌표 공간.
 *
 * type별 동작:
 *   'signature'    : 고객 서명 입력란 (SignatureCanvas 인라인 배치)
 *   'text'         : DB 연동 텍스트 — boundVariable의 ContractSubstitutionData 값 표시
 *   'label'        : 고정 라벨 텍스트 — label 값을 그대로 표시 (DB 연동 없음)
 *   'issuer-image' : 발행자 서명·직인 이미지 — assetId/imageUrl로 지정된 이미지 표시 (편집 불가)
 *
 * EC-2: x/y/width/height가 CanvasPage 경계 밖이면 서버에서 400으로 차단.
 */
export interface CanvasField {
  id: string
  pageId: string
  type: CanvasFieldType
  /** 좌측 모서리 X 좌표 (px) */
  x: number
  /** 상단 모서리 Y 좌표 (px) */
  y: number
  width: number
  height: number
  /** 서명·텍스트 필드에서 필수 여부 */
  required: boolean
  /** 라벨 텍스트 (type='label') 또는 필드 표시명 */
  label: string
  /**
   * DB 변수 바인딩 — type='text'일 때만 유효.
   * ContractSubstitutionData의 키 중 하나.
   */
  boundVariable?: keyof ContractSubstitutionData
  /**
   * 발행자 이미지 자산 ID — type='issuer-image'일 때만 유효.
   * cms_signature_assets 테이블의 id 참조.
   */
  assetId?: string
  /**
   * 발행자 이미지 URL — type='issuer-image'일 때만 유효.
   * assetId에 해당하는 이미지의 공개 URL (화면 렌더링에 직접 사용).
   */
  imageUrl?: string
}

/**
 * canvas 모드 문서 전체 구조.
 * contract_templates.canvas_document 및 contracts.canvas_document JSONB 컬럼에 저장.
 *
 * EC-3: fields 중 type='signature'인 것이 최소 1개 이상 있어야 저장 가능.
 */
export interface CanvasDocument {
  pages: CanvasPage[]
  fields: CanvasField[]
}

/** CanvasDocument 타입 가드 */
export function isCanvasDocument(value: unknown): value is CanvasDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>)['pages']) &&
    Array.isArray((value as Record<string, unknown>)['fields'])
  )
}

/** EC-3: 최소 1개 서명 필드 필수 검증 */
export function hasSignatureField(doc: CanvasDocument): boolean {
  return doc.fields.some((f) => f.type === 'signature')
}

// --------------------------------------------------------------------------
// Spreadsheet 모드 — 엑셀 임포트 → 스프레드시트 그리드 편집 (Phase spreadsheet)
// --------------------------------------------------------------------------

/**
 * 단일 스프레드시트 시트.
 * xlsxImport.ts의 parseSheet() 반환 구조와 1:1 대응 — 서드파티 포맷에 종속되지 않는
 * 자체 스키마로 저장(jspreadsheet-ce 내부 포맷 직접 저장 금지).
 */
export interface SpreadsheetSheet {
  name: string
  rows: string[][]
  merges: SheetMergeRange[]
  colWidths: (number | null)[]
  cellFormatting: XlsxCellFormatting[][]
}

/**
 * 스프레드시트 문서 전체 구조.
 * contract_templates.spreadsheet_document 및 contracts.spreadsheet_document JSONB 컬럼에 저장.
 */
export interface SpreadsheetDocument {
  sheets: SpreadsheetSheet[]
  activeSheetIndex: number
}

/** SpreadsheetDocument 타입 가드 */
export function isSpreadsheetDocument(value: unknown): value is SpreadsheetDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>)['sheets']) &&
    typeof (value as Record<string, unknown>)['activeSheetIndex'] === 'number'
  )
}

/** EC-2: 좌표 범위 검증 — 필드가 해당 페이지 경계 안에 있는지 확인 */
export function validateFieldBounds(field: CanvasField, page: CanvasPage): boolean {
  return (
    field.x >= 0 &&
    field.y >= 0 &&
    field.x + field.width <= page.width &&
    field.y + field.height <= page.height
  )
}

/**
 * ContractCanvasEditor onSave 콜백 페이로드.
 * Supabase 클라이언트 직접 import 없이 어댑터 콜백으로 위임 (Phase 9 원칙).
 */
export interface ContractCanvasPayload {
  title: string
  canvasDocument: CanvasDocument
  specifications?: { key: string; value: string }[]
  templateId?: string | null
}
