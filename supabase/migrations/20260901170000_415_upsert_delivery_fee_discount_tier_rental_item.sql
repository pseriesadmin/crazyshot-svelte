-- ★ MIGRATION: 415_upsert_delivery_fee_discount_tier_rental_item.sql
-- Description: upsert_delivery_fee_discount_tier RPC 내부 condition_types 화이트리스트에
--   'rental_item' 추가. #385(max5) 계승 패턴 — CREATE OR REPLACE(시그니처 변경 없음).
--
-- 배경: 2026-09-01 Stephen 확정(GATE B Q1) — "대여상품(rental_item)" 조건 신설.
--   CHECK 제약(Migration #414)과 반드시 동기화돼야 한다.
--   시그니처(파라미터 4개: p_id/p_min_rental_amount/p_condition_types/p_discount_rate)
--   는 변경하지 않는다 — 화이트리스트 배열 값만 확장.
--
-- Dependencies: 385_delivery_fee_discount_tiers_max5.sql, 414_(check 재정의)
-- Author: Stephen Cconzy
-- Date: 2026-09-01

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
  IF NOT (p_condition_types <@ ARRAY['long_term_rental', 'sale_only_purchase', 'rental_item']::text[]) THEN
    RAISE EXCEPTION 'invalid condition_types: %', p_condition_types;
  END IF;
  IF p_discount_rate NOT IN (0, 0.5, 1) THEN
    RAISE EXCEPTION 'invalid discount_rate: %', p_discount_rate;
  END IF;

  IF p_id IS NULL THEN
    SELECT COUNT(*) INTO v_count FROM delivery_fee_discount_tiers WHERE deleted_at IS NULL;
    IF v_count >= 5 THEN
      RAISE EXCEPTION 'max_limit: 배송료 우대설정은 최대 5개까지 등록할 수 있습니다';
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

-- REVOKE/GRANT 반환 타입·시그니처 변경 없음 — 재설정 불필요(374/375/381/385에서 이미 적용됨).

-- ROLLBACK (수동 실행): 385 버전의 화이트리스트(long_term_rental·sale_only_purchase 2종)로
-- CREATE OR REPLACE 되돌리기.
