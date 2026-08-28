-- ★ MIGRATION: 375_delivery_fee_discount_tiers_rpc.sql
-- Description: delivery_fee_discount_tiers CRUD RPC — 추가(최대 3개 DB단 강제) + 삭제
-- Dependencies: 374_delivery_fee_discount_tiers_table.sql, is_cms_user()
-- Author: Stephen Cconzy
-- Date: 2026-08-29

CREATE OR REPLACE FUNCTION public.upsert_delivery_fee_discount_tier(
  p_id                UUID,
  p_min_rental_amount INT,
  p_condition_type    TEXT,
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
  IF p_condition_type NOT IN ('long_term_rental', 'sale_only_purchase') THEN
    RAISE EXCEPTION 'invalid condition_type: %', p_condition_type;
  END IF;
  IF p_discount_rate NOT IN (0, 0.5, 1) THEN
    RAISE EXCEPTION 'invalid discount_rate: %', p_discount_rate;
  END IF;

  IF p_id IS NULL THEN
    SELECT COUNT(*) INTO v_count FROM delivery_fee_discount_tiers WHERE deleted_at IS NULL;
    IF v_count >= 3 THEN
      RAISE EXCEPTION 'max_limit: 배송료 우대설정은 최대 3개까지 등록할 수 있습니다';
    END IF;

    INSERT INTO delivery_fee_discount_tiers (min_rental_amount, condition_type, discount_rate)
    VALUES (p_min_rental_amount, p_condition_type, p_discount_rate)
    RETURNING id INTO v_id;
  ELSE
    UPDATE delivery_fee_discount_tiers
    SET min_rental_amount = p_min_rental_amount,
        condition_type    = p_condition_type,
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

REVOKE ALL ON FUNCTION public.upsert_delivery_fee_discount_tier(UUID, INT, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_delivery_fee_discount_tier(UUID, INT, TEXT, NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_delivery_fee_discount_tier(p_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  UPDATE delivery_fee_discount_tiers
  SET deleted_at = NOW()
  WHERE id = p_id AND deleted_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_delivery_fee_discount_tier(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_delivery_fee_discount_tier(UUID) TO authenticated;

-- ROLLBACK (수동 실행):
-- DROP FUNCTION IF EXISTS public.delete_delivery_fee_discount_tier(UUID);
-- DROP FUNCTION IF EXISTS public.upsert_delivery_fee_discount_tier(UUID, INT, TEXT, NUMERIC);
