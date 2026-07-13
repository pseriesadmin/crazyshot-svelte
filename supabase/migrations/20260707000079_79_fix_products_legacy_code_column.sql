-- Migration #79: products.code 레거시 컬럼 NOT NULL 제거
-- Stage DB 전용 보정: migration 시스템 이전에 수동 생성된 code TEXT NOT NULL 컬럼이
--                     현재 INSERT 패턴과 충돌 (product_code가 정식 컬럼, code는 미사용)
-- Production DB에는 이 컬럼이 존재하지 않으므로 실행해도 무해 (IF EXISTS 아님 — ANSI 표준)
ALTER TABLE products ALTER COLUMN code DROP NOT NULL;
