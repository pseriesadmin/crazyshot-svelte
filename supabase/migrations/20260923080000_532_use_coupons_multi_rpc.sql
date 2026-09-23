-- Migration 532: use_coupon 검증+소진 로직을 private._validate_and_consume_coupon으로
-- 추출 + 다중쿠폰 동시소진 RPC use_coupons 신설
--   (쿠폰 다중중첩 체크아웃 구조 전환 — Phase 1 of 6)
--
-- ⛔ use_coupon(p_user_id, p_user_coupon_id, p_order_id) 기존 시그니처·반환값(jsonb
-- {ok, error, redeemed_code})은 절대 변경하지 않는다 — couponEligibilityValidation.test.ts/
-- couponLazySequencing.test.ts가 이 RPC를 직접 호출하므로 그대로 보호된다. 이번 마이그레이션은
-- Migration 519(use_coupon 최신본)의 로직 전체를 그대로 private._validate_and_consume_coupon
-- 내부함수로 옮기고, use_coupon은 그 내부함수를 호출하는 얇은 래퍼로 전환한다(동작 100% 동일).
--
-- 신규 use_coupons(p_user_id, p_order_id, p_user_coupon_ids UUID[])는 여러 장을 한 번에
-- 검증+소진한다. p_user_coupon_ids를 오름차순 정렬 후 순서대로 내부함수를 호출해 교착을
-- 방지하고(각 호출 내부의 SELECT ... FOR UPDATE OF uc가 해당 행을 잠근다), 하나라도 실패하면
-- RAISE EXCEPTION으로 이 RPC 호출 전체를 롤백한다(all-or-nothing, 부분성공 없음 — 이미 결제
-- 전 정산이 "선택 쿠폰 전부 유효"를 전제로 금액을 확정하므로 부분성공은 금액 불일치를 유발).
--
-- 전부 성공하면 order_coupons에 최소 정보로 선삽입(ON CONFLICT DO NOTHING — 이미
-- create_reservation_order가 만들어둔 행이 있으면 건드리지 않음) 후, 정산 정본인
-- sync_order_after_composition_change(Migration 534, order_coupons 기준 §할인계산정책
-- 순차 산식 전체를 이미 구현)를 그대로 호출해 order_coupons.discount_amount와
-- orders(total_amount/discount_amount/coupon_discount_amount/final_amount)를 한 번에
-- 정확히 재계산한다 — 동일한 순차 산식(fixed 합산 → percentage coupon_id 오름차순
-- 순차적용 → free_shipping 배송비 캡)을 이 함수 안에 다시 구현(3중 중복)하지 않고
-- 단일 정본을 재사용한다.

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 1: private 스키마 신설(최초) — 이 프로젝트 최초의 내부전용 스키마.
-- PUBLIC/anon/authenticated에 USAGE 권한을 부여하지 않는다 — SECURITY DEFINER
-- 함수(use_coupon/use_coupons)가 함수 소유자 권한으로 내부 호출할 때만 접근된다.
-- ────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 2: private._validate_and_consume_coupon — Migration 519 use_coupon 로직 그대로 추출
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private._validate_and_consume_coupon(
  p_user_id        UUID,
  p_order_id       BIGINT,
  p_user_coupon_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uc           RECORD;   -- user_coupon 행 + coupons 자격조건 컬럼 포함
  v_order_amount NUMERIC;  -- orders.total_amount (Q3 기준)
  v_min_days     INT;      -- 주문 내 최단 대여일수 (Q1 전체AND)
  v_all_visit    BOOLEAN;  -- 주문 내 모든 예약이 pickup_method='visit' (Q1 전체AND)
  v_redeemed_code TEXT;
  v_used_count_by_user INT;
BEGIN
  -- ① 기본 검증: user_coupon 행 취득 + 행 레벨 잠금(FOR UPDATE OF uc)
  SELECT
    uc.id,
    uc.coupon_id,
    uc.used_at,
    uc.first_viewed_at,      -- relative_days 만료 기준: 카운트다운 시작 시각
    c.is_active,
    c.deleted_at,
    c.validity_type,         -- 만료 분기 판단용
    c.valid_from,
    c.valid_until,
    c.valid_days,            -- relative_days 모드: 만료까지 남은 일수
    c.min_purchase_amount,
    c.min_rental_amount,
    c.min_rental_days,
    c.is_first_rental_only,
    c.is_student_only,
    c.is_subscription_only,
    c.is_walk_in_only,
    c.per_user_limit,
    c.type,
    c.applicable_categories,
    c.discount_type,
    c.discount_value,
    c.max_discount_amount
  INTO v_uc
  FROM user_coupons uc
  JOIN coupons c ON c.id = uc.coupon_id
  WHERE uc.id = p_user_coupon_id
    AND uc.user_id = p_user_id
  FOR UPDATE OF uc;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_NOT_FOUND');
  END IF;

  IF v_uc.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_USED');
  END IF;

  IF NOT v_uc.is_active OR v_uc.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_INACTIVE');
  END IF;

  -- 유효기간 만료 체크 (validity_type별 분기)
  IF v_uc.validity_type = 'relative_days' THEN
    IF v_uc.first_viewed_at IS NOT NULL
       AND v_uc.valid_days IS NOT NULL
       AND (v_uc.first_viewed_at + (v_uc.valid_days || ' days')::INTERVAL) < now()
    THEN
      RETURN jsonb_build_object('ok', false, 'error', 'COUPON_EXPIRED');
    END IF;
  ELSE
    IF v_uc.valid_until IS NOT NULL AND v_uc.valid_until < now() THEN
      RETURN jsonb_build_object('ok', false, 'error', 'COUPON_EXPIRED');
    END IF;
  END IF;

  -- ② 주문의존 자격조건 검증
  IF COALESCE(v_uc.min_purchase_amount, 0) > 0
     OR COALESCE(v_uc.min_rental_amount, 0) > 0
     OR COALESCE(v_uc.min_rental_days, 0) > 0
     OR v_uc.is_walk_in_only
     OR (v_uc.type = 'category' AND v_uc.applicable_categories IS NOT NULL AND jsonb_array_length(v_uc.applicable_categories) > 0)
  THEN
    IF p_order_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ORDER_CONTEXT_REQUIRED');
    END IF;

    SELECT o.total_amount INTO v_order_amount
    FROM orders o
    WHERE o.id = p_order_id;

    IF COALESCE(v_uc.min_purchase_amount, 0) > 0
       AND (v_order_amount IS NULL OR v_order_amount < v_uc.min_purchase_amount)
    THEN
      RETURN jsonb_build_object('ok', false, 'error', 'MIN_AMOUNT_NOT_MET');
    END IF;

    IF COALESCE(v_uc.min_rental_amount, 0) > 0
       AND (v_order_amount IS NULL OR v_order_amount < v_uc.min_rental_amount)
    THEN
      RETURN jsonb_build_object('ok', false, 'error', 'MIN_AMOUNT_NOT_MET');
    END IF;

    IF COALESCE(v_uc.min_rental_days, 0) > 0 OR v_uc.is_walk_in_only THEN
      SELECT
        MIN(COALESCE(
          rr.rental_days,
          (rr.end_date::date - rr.start_date::date + 1)
        )),
        BOOL_AND(rr.pickup_method = 'visit')
      INTO v_min_days, v_all_visit
      FROM order_items oi
      JOIN rental_reservations rr ON rr.id = oi.reservation_id
      WHERE oi.order_id = p_order_id;

      IF COALESCE(v_uc.min_rental_days, 0) > 0
         AND (v_min_days IS NULL OR v_min_days < v_uc.min_rental_days)
      THEN
        RETURN jsonb_build_object('ok', false, 'error', 'MIN_DAYS_NOT_MET');
      END IF;

      IF v_uc.is_walk_in_only
         AND (v_all_visit IS NULL OR NOT v_all_visit)
      THEN
        RETURN jsonb_build_object('ok', false, 'error', 'WALK_IN_ONLY');
      END IF;
    END IF;

    IF v_uc.type = 'category' AND v_uc.applicable_categories IS NOT NULL AND jsonb_array_length(v_uc.applicable_categories) > 0 THEN
      IF NOT EXISTS (
        SELECT 1
        FROM order_items oi
        JOIN rental_reservations rr ON rr.id = oi.reservation_id
        JOIN products p ON p.id = rr.product_id
        WHERE oi.order_id = p_order_id
          AND p.category IN (SELECT jsonb_array_elements_text(v_uc.applicable_categories))
      ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'CATEGORY_NOT_APPLICABLE');
      END IF;
    END IF;
  END IF;

  -- ③ 사용자의존 자격조건 검증
  IF v_uc.is_first_rental_only THEN
    IF EXISTS (
      SELECT 1
      FROM rental_reservations
      WHERE user_id = p_user_id
        AND status NOT IN ('hold', 'draft', 'cancelled', 'expired')
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'FIRST_RENTAL_ONLY');
    END IF;
  END IF;

  IF v_uc.is_student_only THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = p_user_id AND is_student = true
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'STUDENT_ONLY');
    END IF;
  END IF;

  IF v_uc.is_subscription_only THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_subscriptions
      WHERE user_id = p_user_id
        AND status = 'active'
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'SUBSCRIPTION_ONLY');
    END IF;
  END IF;

  IF COALESCE(v_uc.per_user_limit, 0) > 0 THEN
    SELECT count(*) INTO v_used_count_by_user
    FROM user_coupons
    WHERE user_id = p_user_id
      AND coupon_id = v_uc.coupon_id
      AND used_at IS NOT NULL;

    IF v_used_count_by_user >= v_uc.per_user_limit THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PER_USER_LIMIT_EXCEEDED');
    END IF;
  END IF;

  -- ④ 모든 검증 통과 → 실제 소진 처리
  UPDATE user_coupons
  SET used_at    = now(),
      used_count = used_count + 1,
      order_id   = p_order_id
  WHERE id = p_user_coupon_id;

  UPDATE coupons
  SET usage_count = usage_count + 1
  WHERE id = v_uc.coupon_id;

  SELECT public.generate_user_coupon_redeemed_code(p_user_coupon_id)
  INTO v_redeemed_code;

  RETURN jsonb_build_object(
    'ok', true,
    'redeemed_code', v_redeemed_code,
    'coupon_id', v_uc.coupon_id,
    'discount_type', v_uc.discount_type,
    'discount_value', v_uc.discount_value,
    'max_discount_amount', v_uc.max_discount_amount
  );
END;
$function$;

REVOKE ALL ON FUNCTION private._validate_and_consume_coupon(UUID, BIGINT, UUID) FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 3: use_coupon — 내부함수를 호출하는 얇은 래퍼로 전환 (시그니처·반환값 불변)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.use_coupon(p_user_id uuid, p_user_coupon_id uuid, p_order_id bigint DEFAULT NULL::bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  v_result := private._validate_and_consume_coupon(p_user_id, p_order_id, p_user_coupon_id);
  -- 기존 반환 shape({ok, error, redeemed_code})만 유지 — 신규 확장 필드(coupon_id 등)는
  -- 단일쿠폰 호출부(pay-mock/confirm-mock/pay-result)가 참조하지 않으므로 그대로 노출해도
  -- 무해하나, 기존 테스트가 정확히 이 3개 키만 기대하므로 그대로 전체를 반환한다.
  RETURN v_result;
END;
$function$;

-- 기존 GRANT와 동일 (파라미터 시그니처 불변 — PGRST203 방지)
GRANT EXECUTE ON FUNCTION public.use_coupon(UUID, UUID, BIGINT) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 4: use_coupons — 다중쿠폰 동시 검증+소진 (all-or-nothing)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.use_coupons(
  p_user_id         UUID,
  p_order_id        BIGINT,
  p_user_coupon_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sorted_ids    UUID[];
  v_id            UUID;
  v_step_result   JSONB;
  v_results       JSONB := '[]'::jsonb;
BEGIN
  IF p_user_coupon_ids IS NULL OR array_length(p_user_coupon_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_COUPONS_SELECTED');
  END IF;

  -- 오름차순 정렬 후 순서대로 검증+소진(각 호출의 FOR UPDATE OF uc가 그 순서로 행을 잠금
  -- → 서로 다른 트랜잭션이 겹치는 쿠폰 집합을 동시에 처리해도 교착 방지)
  SELECT array_agg(x ORDER BY x) INTO v_sorted_ids
  FROM unnest(p_user_coupon_ids) AS x;

  FOREACH v_id IN ARRAY v_sorted_ids LOOP
    v_step_result := private._validate_and_consume_coupon(p_user_id, p_order_id, v_id);

    IF COALESCE((v_step_result->>'ok')::boolean, false) = false THEN
      -- all-or-nothing: 하나라도 실패하면 이 RPC 호출 전체를 롤백(예외 전파)
      RAISE EXCEPTION 'COUPON_STACK_REJECTED:%:%', v_id, COALESCE(v_step_result->>'error', 'UNKNOWN')
        USING ERRCODE = 'P0001';
    END IF;

    -- order_coupons에 아직 행이 없으면(예: create_reservation_order를 거치지 않고
    -- use_coupons를 바로 호출하는 경로) 최소 정보로 선삽입 — discount_amount는 아래
    -- sync_order_after_composition_change 호출이 정확히 재계산해 덮어쓴다.
    INSERT INTO order_coupons (order_id, user_coupon_id, coupon_id, discount_amount)
    VALUES (p_order_id, v_id, (v_step_result->>'coupon_id')::UUID, 0)
    ON CONFLICT (order_id, user_coupon_id) DO NOTHING;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'user_coupon_id', v_id,
        'ok', true,
        'redeemed_code', v_step_result->>'redeemed_code'
      )
    );
  END LOOP;

  -- 전부 성공 → 정산 정본(sync_order_after_composition_change, Migration 534)이
  -- order_coupons 전체를 §할인계산정책 순차 산식으로 재계산 + orders 합계까지 확정한다.
  PERFORM sync_order_after_composition_change(p_order_id);

  RETURN jsonb_build_object('ok', true, 'results', v_results);
END;
$function$;

REVOKE ALL ON FUNCTION public.use_coupons(UUID, BIGINT, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.use_coupons(UUID, BIGINT, UUID[]) TO authenticated;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- 1. DROP FUNCTION IF EXISTS public.use_coupons(UUID, BIGINT, UUID[]);
-- 2. Migration 519의 CREATE OR REPLACE FUNCTION public.use_coupon 블록을 재실행해
--    래퍼 이전 상태로 되돌릴 것(private 내부함수 호출 제거).
-- 3. DROP FUNCTION IF EXISTS private._validate_and_consume_coupon(UUID, BIGINT, UUID);
-- 4. DROP SCHEMA IF EXISTS private;
-- ============================================================
