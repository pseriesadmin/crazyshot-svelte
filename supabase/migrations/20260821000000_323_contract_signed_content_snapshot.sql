-- Migration 323: 서명 시점 콘텐츠 스냅샷 저장
-- 배경: contracts.content_blocks/canvas_document/spreadsheet_document는 라이브 컬럼이라
-- 서명 후 관리자가 PATCH로 내용을 바꾸면 고객이 "서명한 계약서"를 다시 봐도 바뀐 내용이
-- 그대로 보이는 문제(법적 증거능력 공백, 2026-08-21 정밀감사 발견). 서명 이벤트 시점에
-- 렌더링에 필요한 콘텐츠 전체를 통째로 얼려 저장한다. 소급 적용 없음 — 이 마이그레이션
-- 이후 신규 서명 건부터만 채워짐(Stephen 확정).

ALTER TABLE contract_signings
  ADD COLUMN IF NOT EXISTS signed_content_snapshot jsonb;

COMMENT ON COLUMN contract_signings.signed_content_snapshot IS
  '서명 시점 { title, authoring_mode, content_blocks, specifications, canvas_document, spreadsheet_document } 스냅샷. NULL이면 이 컬럼 도입 이전(2026-08-21) 서명 건 — 라이브 contracts 컬럼으로 폴백.';

ALTER TABLE contract_issuer_signatures
  ADD COLUMN IF NOT EXISTS signed_content_snapshot jsonb;

COMMENT ON COLUMN contract_issuer_signatures.signed_content_snapshot IS
  '발행인 서명 시점 콘텐츠 스냅샷. contract_signings.signed_content_snapshot과 동일 형식.';
