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
 *   content_blocks가 비어있지 않은 상태 = 이미 발행됐거나 편집된 적 있음
 *   → ContractTemplatePreviewModal은 기본값을 existing 모드로 설정
 *   → send()는 applyContractTemplate() (PATCH 포함) 없이 send-chat만 호출
 *   → 템플릿을 명시적으로 다시 적용하려는 경우에만 overwriteWarning 확인 절차 경유
 */

/**
 * contracts.content_blocks에 편집된 내용이 있는지 판별.
 *
 * 판별 기준: 배열이면서 하나 이상의 블록을 포함 — 타입(text/tiptap-doc/divider 등) 불문.
 * 빈 배열·null·undefined·배열 아닌 값은 전부 "내용 없음"으로 처리.
 *
 * @param blocks DB에서 조회한 content_blocks 원본값 (any 타입 의도적 허용 — DB JSONB 파싱값)
 * @returns true  = 편집된 내용 있음 → existing 모드 진입
 *          false = 내용 없음       → template 모드 진입 (기존 동작)
 */
export function hasExistingContractContent(blocks: unknown): boolean {
  return Array.isArray(blocks) && blocks.length > 0
}
