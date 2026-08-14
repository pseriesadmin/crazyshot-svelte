/**
 * contract-content-mode.ts
 *
 * ContractTemplatePreviewModal이 "기존 편집 내용 보존(existing)" 모드로 진입할지
 * "양식 치환(template)" 모드로 진입할지 결정하는 순수 판별 함수.
 *
 * 배경 (QA 3차 재검수 발견 — 2026-08-13):
 *   기존 구현은 contracts.content_blocks에 편집 내용이 있어도
 *   "미리보기 & 발송" → "채팅으로 발송" 시 항상 템플릿 원본 기준으로 재생성해 덮어썼다.
 *   관리자 입장에서 "내가 고친 내용이 사라졌다"는 데이터 유실처럼 보이는 워크플로우 버그였다.
 *
 * 수정 원칙:
 *   content_blocks가 비어있지 않거나 canvas_document가 유효한 상태 = 이미 발행됐거나 편집된 적 있음
 *   → ContractTemplatePreviewModal은 기본값을 existing 모드로 설정
 *   → send()는 applyContractTemplate() (PATCH 포함) 없이 send-chat만 호출
 *   → 템플릿을 명시적으로 다시 적용하려는 경우에만 overwriteWarning 확인 절차 경유
 *
 * 수정 이력:
 *   QA 5차 재검수 발견 — canvas 계약은 content_blocks가 항상 [] 이므로 기존 판별 로직이
 *   canvas 계약을 "발행된 적 없음"으로 오판했다. canvasDocument 파라미터를 추가해
 *   canvas 계약도 올바르게 existing 모드로 진입하도록 수정 (2026-08-13).
 */

import { isCanvasDocument } from '$lib/types/contract-document'

/**
 * contracts.content_blocks 또는 canvas_document에 발행된 내용이 있는지 판별.
 *
 * 판별 기준:
 *   blocks가 하나 이상의 블록을 포함하는 배열 (flow 모드 계약)
 *   OR canvasDocument가 유효한 CanvasDocument이면서 fields 배열에 1개 이상 항목이 있음 (canvas 모드 계약)
 *
 * canvas 계약 특성: content_blocks는 항상 [] — 실제 내용은 canvas_document에 저장.
 *   따라서 canvas_document 없이 content_blocks만 검사하면 canvas 계약을 항상 "내용 없음"으로 오판.
 *
 * @param blocks         DB에서 조회한 content_blocks 원본값 (any 타입 의도적 허용 — DB JSONB 파싱값)
 * @param canvasDocument DB에서 조회한 canvas_document 원본값 (optional — 미전달 시 무시)
 * @returns true  = 발행된 내용 있음 → existing 모드 진입
 *          false = 내용 없음       → template 모드 진입 (기존 동작)
 */
export function hasExistingContractContent(blocks: unknown, canvasDocument?: unknown): boolean {
  if (Array.isArray(blocks) && blocks.length > 0) return true
  if (isCanvasDocument(canvasDocument) && canvasDocument.fields.length > 0) return true
  return false
}
