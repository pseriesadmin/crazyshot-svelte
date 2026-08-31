-- ★ MIGRATION: 385_delivery_fee_discount_tiers_max5.sql
-- Description: 배송료 우대설정 최대 등록 개수를 3개 → 5개로 확대(Stephen 확정, 2026-08-30).
--   upsert_delivery_fee_discount_tier RPC의 DB단 카운트 가드만 교체 — 시그니처·나머지
--   검증 로직은 375에서 그대로 유지, CREATE OR REPLACE로 충분(DROP 불필요).
-- Dependencies: 375_delivery_fee_discount_tiers_rpc.sql (또는 381의 TEXT[] 버전)
-- Author: Stephen Cconzy
-- Date: 2026-08-30
--
-- ⚠️ 파일명 이력: 최초 작성 시 "383"으로 번호를 매겼으나, 같은 날 다른 세션이 작성한
--   20260830000000_383_toss_webhook_reconcile_payload_fix.sql과 타임스탬프+번호가 완전히
--   동일해 충돌 — sp3-qa-agent 검수로 발견, 385로 재명명(DB에는 이미 CREATE OR REPLACE로
--   적용된 함수 내용 자체는 무변경 — 파일명·문서 정합성만 정정).

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

-- REVOKE/GRANT 반환 타입·시그니처 변경 없음 — 재설정 불필요(374/375/381에서 이미 적용됨).

-- ROLLBACK (수동 실행): 375/381 버전의 v_count >= 3 조건으로 CREATE OR REPLACE 되돌리기.
