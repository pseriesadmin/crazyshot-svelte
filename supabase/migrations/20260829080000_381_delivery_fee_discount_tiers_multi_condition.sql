-- ★ MIGRATION: 381_delivery_fee_discount_tiers_multi_condition.sql
-- Description: 배송료 우대설정 "조건" 콤보를 단일선택 → 다중선택으로 변경.
--   두 조건(3일이상 장기대여/판매상품 구매)을 함께 선택하면 AND로 결합해 두 조건이
--   모두(각각 카트 내 OR 판정) 충족될 때만 그 조합이 매칭되도록 확장(Stephen 확정,
--   2026-08-29 — 동일 세션 내 374/375로 만든 단일선택 설계를 배포 전 즉시 개정).
-- Dependencies: 374_delivery_fee_discount_tiers_table.sql, 375_delivery_fee_discount_tiers_rpc.sql
-- Author: Stephen Cconzy
-- Date: 2026-08-29
--
-- ⚠️ Stage에 Stephen이 직접 등록한 테스트 데이터 1건이 이미 존재해(적용 시점 확인) 단순
--   DROP COLUMN이 아니라 기존 값을 1원소 배열로 백필한 뒤 옛 컬럼을 제거한다.

ALTER TABLE delivery_fee_discount_tiers
  ADD COLUMN condition_types TEXT[];

UPDATE delivery_fee_discount_tiers
  SET condition_types = ARRAY[condition_type]
  WHERE condition_type IS NOT NULL;

ALTER TABLE delivery_fee_discount_tiers
  ALTER COLUMN condition_types SET NOT NULL;

ALTER TABLE delivery_fee_discount_tiers DROP COLUMN condition_type;

ALTER TABLE delivery_fee_discount_tiers
  ADD CONSTRAINT delivery_fee_discount_tiers_condition_types_check
  CHECK (
    condition_types <@ ARRAY['long_term_rental', 'sale_only_purchase']::text[]
    AND array_length(condition_types, 1) >= 1
  );

-- 기존 4-param(TEXT) 오버로드 제거 — PostgREST 오버로드 모호성 방지(products.md §2-3 사례).
DROP FUNCTION IF EXISTS public.upsert_delivery_fee_discount_tier(UUID, INT, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.upsert_delivery_fee_discount_tier(
  p_id                UUID,
  p_min_rental_amount INT,
  p_condition_types   TEXT[],
  p_discount_rate     NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count INT;
  v_id    UUID;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  IF p_min_rental_amount IS NULL OR p_min_rental_amount < 0 THEN
    RAISE EXCEPTION 'min_rental_amount must be >= 0';
  END IF;
  IF p_condition_types IS NULL OR array_length(p_condition_types, 1) IS NULL THEN
    RAISE EXCEPTION 'condition_types must have at least one value';
  END IF;
  IF NOT (p_condition_types <@ ARRAY['long_term_rental', 'sale_only_purchase']::text[]) THEN
    RAISE EXCEPTION 'invalid condition_types: %', p_condition_types;
  END IF;
  IF p_discount_rate NOT IN (0, 0.5, 1) THEN
    RAISE EXCEPTION 'invalid discount_rate: %', p_discount_rate;
  END IF;

  IF p_id IS NULL THEN
    SELECT COUNT(*) INTO v_count FROM delivery_fee_discount_tiers WHERE deleted_at IS NULL;
    IF v_count >= 3 THEN
      RAISE EXCEPTION 'max_limit: 배송료 우대설정은 최대 3개까지 등록할 수 있습니다';
    END IF;

    INSERT INTO delivery_fee_discount_tiers (min_rental_amount, condition_types, discount_rate)
    VALUES (p_min_rental_amount, p_condition_types, p_discount_rate)
    RETURNING id INTO v_id;
  ELSE
    UPDATE delivery_fee_discount_tiers
    SET min_rental_amount = p_min_rental_amount,
        condition_types   = p_condition_types,
        discount_rate     = p_discount_rate
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'not_found: delivery_fee_discount_tier id %', p_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_delivery_fee_discount_tier(UUID, INT, TEXT[], NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_delivery_fee_discount_tier(UUID, INT, TEXT[], NUMERIC) TO authenticated;

-- ROLLBACK (수동 실행):
-- ALTER TABLE delivery_fee_discount_tiers DROP CONSTRAINT IF EXISTS delivery_fee_discount_tiers_condition_types_check;
-- ALTER TABLE delivery_fee_discount_tiers DROP COLUMN IF EXISTS condition_types;
-- ALTER TABLE delivery_fee_discount_tiers ADD COLUMN condition_type TEXT;
-- DROP FUNCTION IF EXISTS public.upsert_delivery_fee_discount_tier(UUID, INT, TEXT[], NUMERIC);
