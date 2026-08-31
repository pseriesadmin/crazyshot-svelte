-- ★ MIGRATION: 382_delivery_fee_discount_tiers_empty_array_check_fix.sql
-- Description: 381에서 추가한 delivery_fee_discount_tiers_condition_types_check가
--   빈 배열(ARRAY[]::text[])을 통과시키는 버그 수정.
--
-- 원인: array_length(빈배열, 1)은 0이 아니라 NULL을 반환한다(Postgres 스펙) — CHECK
--   제약에서 NULL 비교(NULL >= 1)는 FALSE가 아니라 NULL로 평가되고, CHECK 제약은 NULL을
--   "위반 아님"으로 취급하므로 빈 배열이 그대로 통과했다. cardinality()는 빈 배열에서
--   0을 반환하므로 이 문제가 없다 — RPC 레벨(upsert_delivery_fee_discount_tier)의 검증은
--   `array_length(...) IS NULL`로 이미 올바르게 작성돼 있어 정상 차단되지만, 테이블 CHECK
--   자체가 최후 방어선 역할을 못 하고 있던 상태였다(직접 SQL 테스트로 발견·즉시 수정).
-- Dependencies: 381_delivery_fee_discount_tiers_multi_condition.sql
-- Author: Stephen Cconzy
-- Date: 2026-08-29

ALTER TABLE delivery_fee_discount_tiers
  DROP CONSTRAINT delivery_fee_discount_tiers_condition_types_check;

ALTER TABLE delivery_fee_discount_tiers
  ADD CONSTRAINT delivery_fee_discount_tiers_condition_types_check
  CHECK (
    condition_types <@ ARRAY['long_term_rental', 'sale_only_purchase']::text[]
    AND cardinality(condition_types) >= 1
  );

-- ROLLBACK (수동 실행):
-- ALTER TABLE delivery_fee_discount_tiers DROP CONSTRAINT IF EXISTS delivery_fee_discount_tiers_condition_types_check;
-- ALTER TABLE delivery_fee_discount_tiers ADD CONSTRAINT delivery_fee_discount_tiers_condition_types_check
--   CHECK (condition_types <@ ARRAY['long_term_rental','sale_only_purchase']::text[] AND array_length(condition_types,1) >= 1);
