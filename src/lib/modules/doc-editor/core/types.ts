/**
 * doc-editor/core/types.ts — 문서 & 양식 통합 편집기 공용 타입 (이식형 모듈)
 *
 * ⛔ 이식 규칙: 이 폴더(core/)는 프로젝트 고유 import($lib·$app·$env·supabase)를 쓰지 않는다.
 *   허용: @tiptap/*, prosemirror-*, 상대경로. (이식성 소스 스캔 테스트가 강제)
 */

import type { JSONContent } from '@tiptap/core'

/** TipTap 문서 트리 (저장 포맷의 본체) */
export type DocJSON = JSONContent

/**
 * 저장 포맷 — `[{ type:'tiptap-doc', doc }]` 배열의 단일 원소.
 * 계약서 `content_blocks` JSONB와 동일 구조(호환 유지).
 */
export interface TiptapDocBlock {
  type: 'tiptap-doc'
  doc: DocJSON
}

export function isTiptapDocBlock(block: unknown): block is TiptapDocBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as Record<string, unknown>)['type'] === 'tiptap-doc' &&
    'doc' in (block as Record<string, unknown>)
  )
}

/** 변수 칩(MergeFieldNode) 속성 */
export interface MergeFieldAttrs {
  /** 치환 키 (예: '고객이름') — 직렬화 시 `{{variable}}` */
  variable: string
  /** 화면 표시용 레이블 */
  label: string
}

/** 변수 카탈로그: 호스트가 주입한다 (패널·검증이 이 값만 본다) */
export interface VariableCatalogItem extends MergeFieldAttrs {
  /** 패널 보조 설명(선택) */
  hint?: string
}

export interface VariableCatalogGroup {
  /** 탭 식별자 */
  key: string
  /** 탭 표시명 */
  label: string
  items: VariableCatalogItem[]
}

export type VariableCatalog = VariableCatalogGroup[]

/** 치환 입력: 스칼라 값 맵 + (선택) 반복행 항목 배열 */
export interface SubstituteInput {
  /**
   * 변수명 → 값 (인터페이스 타입 객체도 그대로 받는다).
   * 문자열이 아닌 값(배열 등)은 치환 대상이 아니라 `{{key}}` 원문을 유지한다.
   */
  values: object
  /**
   * 반복행(repeatRegion=true) 확장용 항목 목록. undefined면 반복 확장을 하지 않고
   * 기존 스칼라 치환만 수행한다(무회귀). 빈 배열이면 반복 행 전체를 제거한다.
   */
  repeatItems?: ReadonlyArray<object>
}

/** 서명/직인 자산 (어댑터가 목록 제공) */
export interface SignatureAsset {
  id: string
  /** 'signature' | 'seal' 등 호스트 정의 구분 */
  assetType: string
  name?: string
  imageUrl: string
  isDefault?: boolean
}

/** DocEditor 의 onEditImage 로 넘기는 정보 — images 는 문서 안 모든 이미지(문서 순서), index 는 그중 눌린 이미지 */
export interface EditImageInfo {
  src: string
  /** 눌린 이미지의 src 만 교체(너비·정렬·겹치기 위치 등 다른 속성은 유지) */
  replace: (newSrc: string) => void
  /** true=도구줄 '편집'(뷰어를 편집 모드로), false=더블클릭(보기) */
  startEdit: boolean
  images: { src: string; alt: string; replace: (newSrc: string) => void }[]
  index: number
}
