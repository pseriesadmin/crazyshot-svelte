-- Migration 478: contracts.contract_terms_text / privacy_terms_text (예약별 1회성 override)
--
-- 배경(2026-09-10): Migration #464가 "계약 및 인수 확인"·"개인정보동의" 문단을 편집
-- 가능하게 했지만, 그 컬럼(contract_terms_text/privacy_terms_text)은 contract_templates
-- (공유 양식)에만 존재했고 "사후 클릭편집 기능은 이번 요청 범위 밖"이라고 명시적으로
-- 스코프 밖으로 남겨뒀다(migration #464 주석 참고). Stephen이 이번에 요청한 기능은
-- "특정 전자계약 발행 시 일회성 적용 — 기본 양식에는 영향 주지 않아야 함"이라, 특약
-- (contracts.specifications)과 동일하게 예약별로 독립된 컬럼이 필요하다.
--
-- contracts 테이블에 동일한 두 컬럼을 추가한다. NULL이면 "커스터마이즈 안 함"(발행 당시
-- 템플릿 기본값이 html_document에 이미 구워짐) — 특약과 마찬가지로 이 컬럼 자체는 "현재
-- 편집 UI를 다시 열었을 때 프리필할 원문 텍스트"를 보관하는 용도이고, 실제 계약서 문서에
-- 반영되는 값은 항상 html_document 문자열에 구워진 결과다(서명 시 signed_content_snapshot이
-- html_document를 통째로 얼리므로 §5 "박제" 요구사항은 이 구조만으로 이미 충족됨 — 별도
-- 프리즈 로직 불필요).

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS contract_terms_text TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS privacy_terms_text  TEXT DEFAULT NULL;
