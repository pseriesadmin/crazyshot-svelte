-- ★ MIGRATION: 414_delivery_fee_discount_tiers_rental_item_check.sql
-- Description: delivery_fee_discount_tiers의 condition_types CHECK 제약에 'rental_item'
--   조건 값 추가. #382(empty_array_check_fix) 계승 패턴 — DROP CONSTRAINT + ADD CONSTRAINT.
--
-- 배경: 2026-09-01 Stephen 확정(GATE B Q1) — "대여상품(rental_item)" 조건 신설.
--   카트에 판매전용이 아닌 대여상품(!sale_only)이 1개 이상 있으면 조건 충족.
--   기존 2개 값(long_term_rental·sale_only_purchase)은 그대로 유효(확장만, 제거 없음).
--
-- Dependencies: 382_delivery_fee_discount_tiers_empty_array_check_fix.sql
-- Author: Stephen Cconzy
-- Date: 2026-09-01

ALTER TABLE delivery_fee_discount_tiers
  DROP CONSTRAINT IF EXISTS delivery_fee_discount_tiers_condition_types_check;

ALTER TABLE delivery_fee_discount_tiers
  ADD CONSTRAINT delivery_fee_discount_tiers_condition_types_check
  CHECK (
    condition_types <@ ARRAY['long_term_rental', 'sale_only_purchase', 'rental_item']::text[]
    AND cardinality(condition_types) >= 1
  );

-- ROLLBACK (수동 실행):
-- ALTER TABLE delivery_fee_discount_tiers DROP CONSTRAINT IF EXISTS delivery_fee_discount_tiers_condition_types_check;
-- ALTER TABLE delivery_fee_discount_tiers ADD CONSTRAINT delivery_fee_discount_tiers_condition_types_check
--   CHECK (condition_types <@ ARRAY['long_term_rental','sale_only_purchase']::text[] AND cardinality(condition_types) >= 1);
