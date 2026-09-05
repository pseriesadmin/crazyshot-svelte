-- Migration 446: contract_authoring_mode ENUM에 'html' 값 추가
-- 
-- ⚠️ 반드시 447_html_document_column.sql 과 분리된 별도 트랜잭션으로 실행해야 함.
--    같은 트랜잭션에서 방금 추가한 ENUM 값을 쓰는 컬럼 추가는 Postgres에서 허용되지 않음
--    (264→265번 마이그레이션 선례와 동일 제약).
--
-- 적용 순서: stage(ezyvffjvuwmtuhpxdjrw) 검증 → production(vnbpmvxruyciuuaermyh) 별도 승인 후 적용

ALTER TYPE contract_authoring_mode ADD VALUE IF NOT EXISTS 'html';
