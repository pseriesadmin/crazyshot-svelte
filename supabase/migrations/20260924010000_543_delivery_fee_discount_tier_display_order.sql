-- Migration #543: 배송료 우대설정(delivery_fee_discount_tiers) 드래그 재정렬 지원
--
-- 배경(Stephen 요청, 2026-09-24): CMS /cms/set/rental "배송료 우대설정" 목록에 다른 목록
-- (대여기간·대여방식·동의문)과 같은 드래그 이동 핸들을 추가. 이 테이블은 그동안 display_order가
-- 없어 created_at 순으로만 표시됐다. 여러 조합이 동시 매칭되면 가장 유리한 1개만 적용되는 로직
-- (스태킹 없음)이라 순서는 표시 전용 — 장바구니 요금 계산에는 영향 없음.

ALTER TABLE public.delivery_fee_discount_tiers
  ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 0;

-- 기존 행: 지금까지의 표시 순서(created_at)를 그대로 보존
WITH ranked AS (
  SELECT id, (ROW_NUMBER() OVER (ORDER BY created_at) - 1)::INT AS rn
  FROM public.delivery_fee_discount_tiers
)
UPDATE public.delivery_fee_discount_tiers t
SET display_order = ranked.rn
FROM ranked
WHERE t.id = ranked.id;

-- upsert: 시그니처 무변경(CREATE OR REPLACE) — 신규 INSERT 시 맨 끝 순서로 추가
CREATE OR REPLACE FUNCTION public.upsert_delivery_fee_discount_tier(
  p_id uuid,
  p_min_rental_amount integer,
  p_condition_types text[],
  p_discount_rate numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

    INSERT INTO delivery_fee_discount_tiers (min_rental_amount, condition_types, discount_rate, display_order)
    VALUES (
      p_min_rental_amount, p_condition_types, p_discount_rate,
      COALESCE((SELECT MAX(display_order) + 1 FROM delivery_fee_discount_tiers WHERE deleted_at IS NULL), 0)
    )
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
$function$;

REVOKE ALL ON FUNCTION public.upsert_delivery_fee_discount_tier(uuid, integer, text[], numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_delivery_fee_discount_tier(uuid, integer, text[], numeric) TO authenticated;

-- 재정렬 RPC — reorder_rental_method_options 등과 동일 패턴
CREATE OR REPLACE FUNCTION public.reorder_delivery_fee_discount_tiers(p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_i INT;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  FOR v_i IN 1..array_length(p_ids, 1) LOOP
    UPDATE delivery_fee_discount_tiers
    SET display_order = v_i - 1
    WHERE id = p_ids[v_i] AND deleted_at IS NULL;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.reorder_delivery_fee_discount_tiers(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_delivery_fee_discount_tiers(uuid[]) TO authenticated;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION public.reorder_delivery_fee_discount_tiers(uuid[]);
-- upsert_delivery_fee_discount_tier: 이 파일 이전(display_order 미참조) 정의로 CREATE OR REPLACE
-- ALTER TABLE public.delivery_fee_discount_tiers DROP COLUMN IF EXISTS display_order;
-- ============================================================
