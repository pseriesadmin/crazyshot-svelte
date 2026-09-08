-- ★ MIGRATION: 462_coupons_discount_value_usage_count_checks.sql
-- Description: coupons.discount_value/usage_count CHECK 제약 Production 누락분 추가
--   (Stage·Production 통일) — Migration #461(discount_type)과 동일 계열 후속.
--
-- 배경(2026-09-08): #461 조사 중 Production coupons 테이블에 discount_type 제약뿐 아니라
-- discount_value>0 / usage_count>=0 두 제약도 함께 없었음을 발견(Migration #15 이력 자체가
-- Production에 없는 것으로 추정 — user_coupons.used_count 누락과 동일 원인 계열).
-- Production 실데이터 검증 결과 두 제약 모두 위반 행 0건(안전하게 추가 가능) —
-- discount_type과 달리 값 확장 없이 Stage와 동일하게 그대로 적용.
--
-- DROP CONSTRAINT IF EXISTS 후 재생성 — Stage(기존 제약 재생성, no-op 동등)·Production
-- (신규 생성) 양쪽에 동일 SQL로 안전 적용.
-- Author: Stephen Cconzy
-- Date: 2026-09-08

ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_discount_value_check;
ALTER TABLE public.coupons
  ADD CONSTRAINT coupons_discount_value_check CHECK (discount_value > 0);

ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_usage_count_check;
ALTER TABLE public.coupons
  ADD CONSTRAINT coupons_usage_count_check CHECK (usage_count >= 0);

-- ROLLBACK (수동 실행):
-- ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_discount_value_check;
-- ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_usage_count_check;
