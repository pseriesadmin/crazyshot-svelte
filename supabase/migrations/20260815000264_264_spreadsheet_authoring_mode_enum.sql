-- Migration #264: contract_authoring_mode ENUM에 'spreadsheet' 값 추가
--
-- 배경: 전자계약 스프레드시트 모드(.xlsx → SpreadsheetDocument) 신규 구현.
--       contract_templates.authoring_mode / contracts.authoring_mode 컬럼은
--       Migration 225에서 생성한 진짜 ENUM 타입 `contract_authoring_mode`
--       ('flow' | 'canvas')를 사용한다(CHECK constraint 아님 — 225번 파일로 확인됨).
--       'spreadsheet' 값을 추가해 새 모드가 DB에 저장될 수 있도록 한다.
--
-- ⚠️ 적용 전 반드시 crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 후 crazyshot(vnbpmvxruyciuuaermyh) 적용.
-- ⚠️ ALTER TYPE ... ADD VALUE는 함수/DO 블록 내부에서 실행 시 PostgreSQL이
--    "cannot run inside a transaction block"로 거부하는 경우가 있어 반드시 최상위
--    단일 문(top-level statement)으로만 작성한다(DO $$ 블록으로 감싸지 않음).
-- ⚠️ 같은 트랜잭션 내에서 방금 추가한 값을 바로 사용할 수 없으므로(PostgreSQL 제약),
--    이 값을 사용하는 컬럼 추가(Migration 265)는 반드시 별도 마이그레이션이어야 한다.

ALTER TYPE contract_authoring_mode ADD VALUE IF NOT EXISTS 'spreadsheet';

-- rollback:
-- PostgreSQL은 ENUM에서 값 제거를 지원하지 않는다(ADD VALUE의 역연산 없음).
-- 되돌리려면 신규 타입을 만들고 컬럼을 재생성해야 한다 — 시범서비스 단계에서는
-- 'spreadsheet' 값이 사용되지 않는 한 그대로 두어도 무해하므로 별도 롤백 스크립트를
-- 작성하지 않는다.
