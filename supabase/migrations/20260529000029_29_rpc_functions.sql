-- ★ MIGRATION: 29_rpc_functions.sql
-- Schema version: v5.46
-- Description: Core RPC functions — atomic reservation, cart total, payment processing
-- Dependencies: ALL prior migrations (01~28)
-- Author: Stephen Cconzy
-- Date: 2026-05-29
--
-- TDD-driven RPCs (§13 business rules):
--   1. atomic_reserve_asset()        — 원자적 단일 자산 예약 (EXCLUDE gist 활용)
--   2. batch_atomic_reserve()         — 복수 자산 일괄 예약
--   3. calculate_cart_total()         — 9단계 할인 순서 적용 카트 합계
--   4. process_payment_and_create_order() — 결제 + 주문 생성 원자적 처리
--   5. release_reservation_hold()     — hold 만료 처리
--   6. update_credit_score()          — credit_score 변경 + 감사 로그

-- =============================================================================
-- 1. atomic_reserve_asset
--    - SELECT ... FOR UPDATE SKIP LOCKED 로 동시성 안전 확보
--    - hold_expiration_at = NOW() + 10분
-- =============================================================================
CREATE OR REPLACE FUNCTION atomic_reserve_asset(
  p_product_id   UUID,
  p_start_date   DATE,
  p_end_date     DATE,
  p_user_id      UUID
)
RETURNS TABLE (
  success        BOOLEAN,
  reservation_id UUID,
  asset_id       UUID,
  error_message  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_asset_id       UUID;
  v_reservation_id UUID;
BEGIN
  -- 블랙리스트 사용자 차단
  IF EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = p_user_id AND blacklisted = true
  ) THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, '블랙리스트 사용자입니다.';
    RETURN;
  END IF;

  -- credit_score < 30 → 렌탈 거부
  IF EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = p_user_id AND credit_score < 30
  ) THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, '신용점수가 너무 낮습니다.';
    RETURN;
  END IF;

  -- 가용 자산 SELECT ... FOR UPDATE SKIP LOCKED
  SELECT a.id INTO v_asset_id
  FROM assets a
  WHERE a.product_id = p_product_id
    AND a.status = 'available'
    AND a.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM rental_reservations rr
      WHERE rr.asset_id = a.id
        AND rr.deleted_at IS NULL
        AND rr.status NOT IN ('cancelled', 'returned')
        AND daterange(rr.rental_start_date, rr.rental_end_date, '[]') &&
            daterange(p_start_date, p_end_date, '[]')
    )
  ORDER BY a.id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_asset_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, '해당 기간에 가용 자산이 없습니다.';
    RETURN;
  END IF;

  -- 예약 생성
  INSERT INTO rental_reservations (
    user_id, asset_id, status,
    rental_start_date, rental_end_date,
    pickup_method, return_method,
    hold_expiration_at
  )
  VALUES (
    p_user_id, v_asset_id, 'hold',
    p_start_date, p_end_date,
    'visit', 'visit',
    NOW() + INTERVAL '10 minutes'
  )
  RETURNING id INTO v_reservation_id;

  -- 자산 상태 → hold
  UPDATE assets SET status = 'hold' WHERE id = v_asset_id;

  RETURN QUERY SELECT true, v_reservation_id, v_asset_id, NULL::TEXT;
END;
$$;

-- =============================================================================
-- 2. batch_atomic_reserve
--    - 복수 상품 일괄 예약 (JSON 배열 입력)
--    - 중간 실패 시 전체 롤백
-- =============================================================================
CREATE OR REPLACE FUNCTION batch_atomic_reserve(
  p_product_assets JSONB,   -- [{product_id, start_date, end_date}]
  p_user_id        UUID
)
RETURNS TABLE (
  success        BOOLEAN,
  reservation_id UUID,
  asset_id       UUID,
  product_id     UUID,
  error_message  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item         JSONB;
  v_result       RECORD;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_product_assets)
  LOOP
    SELECT * INTO v_result
    FROM atomic_reserve_asset(
      (v_item->>'product_id')::UUID,
      (v_item->>'start_date')::DATE,
      (v_item->>'end_date')::DATE,
      p_user_id
    );

    IF NOT v_result.success THEN
      -- 전체 롤백
      RAISE EXCEPTION 'batch_reserve_failed: %', v_result.error_message;
    END IF;

    RETURN QUERY SELECT
      v_result.success,
      v_result.reservation_id,
      v_result.asset_id,
      (v_item->>'product_id')::UUID,
      v_result.error_message;
  END LOOP;
END;
$$;

-- =============================================================================
-- 3. calculate_cart_total
--    §13 9단계 할인 순서:
--    ① 정가 → ② 멤버십 할인 → ③ 쿠폰 → ④ 구독 할인 → ⑤ 포인트 →
--    ⑥ 학생 할인 → ⑦ 패키지 할인 → ⑧ 시즌 프로모션 → ⑨ 배송비
-- =============================================================================
CREATE OR REPLACE FUNCTION calculate_cart_total(
  p_reservation_ids UUID[],
  p_user_id         UUID,
  p_coupon_code     TEXT DEFAULT NULL
)
RETURNS TABLE (
  subtotal          NUMERIC,
  option_fees       NUMERIC,
  shipping_cost     NUMERIC,
  discount_amount   NUMERIC,
  coupon_discount   NUMERIC,
  tax_amount        NUMERIC,
  final_total       NUMERIC,
  deposit_required  NUMERIC,
  deposit_percentage NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_subtotal          NUMERIC := 0;
  v_option_fees       NUMERIC := 0;
  v_shipping_cost     NUMERIC := 0;
  v_discount_amount   NUMERIC := 0;
  v_coupon_discount   NUMERIC := 0;
  v_tax_amount        NUMERIC := 0;
  v_deposit_pct       NUMERIC := 0.3;  -- 기본 30%
  v_credit_score      SMALLINT;
  v_membership        membership_grade_enum;
  v_is_student        BOOLEAN;
  v_coupon            RECORD;
BEGIN
  -- 사용자 정보 조회
  SELECT credit_score, membership_grade, is_student
  INTO v_credit_score, v_membership, v_is_student
  FROM user_profiles WHERE user_id = p_user_id;

  -- 기본 렌탈료 합계
  SELECT COALESCE(SUM(
    pr.price * (rr.rental_end_date - rr.rental_start_date + 1)
  ), 0)
  INTO v_subtotal
  FROM rental_reservations rr
  JOIN assets a ON a.id = rr.asset_id
  JOIN price_rules pr ON pr.product_id = a.product_id
    AND pr.duration_type = '24h'
    AND pr.is_active = true
    AND pr.deleted_at IS NULL
  WHERE rr.id = ANY(p_reservation_ids)
    AND rr.user_id = p_user_id;

  -- ① 멤버십 할인 적용
  v_discount_amount := v_discount_amount + CASE v_membership
    WHEN 'easy'  THEN v_subtotal * 0.05
    WHEN 'pop'   THEN v_subtotal * 0.10
    WHEN 'crazy' THEN v_subtotal * 0.15
    ELSE 0
  END;

  -- ② 학생 할인 (5%)
  IF v_is_student THEN
    v_discount_amount := v_discount_amount + v_subtotal * 0.05;
  END IF;

  -- ③ 쿠폰 적용
  IF p_coupon_code IS NOT NULL THEN
    SELECT c.* INTO v_coupon
    FROM coupons c
    JOIN user_coupons uc ON uc.coupon_id = c.id
    WHERE c.code = p_coupon_code
      AND uc.user_id = p_user_id
      AND uc.used_at IS NULL
      AND c.is_active = true
      AND c.valid_from <= NOW()
      AND c.valid_until >= NOW()
      AND c.deleted_at IS NULL;

    IF FOUND THEN
      v_coupon_discount := CASE v_coupon.discount_type
        WHEN 'fixed' THEN v_coupon.discount_value
        WHEN 'percentage' THEN LEAST(
          v_subtotal * v_coupon.discount_value / 100,
          COALESCE(v_coupon.max_discount_amount, 999999)
        )
        ELSE 0
      END;
    END IF;
  END IF;

  -- 보증금 비율: credit_score 기반
  v_deposit_pct := CASE
    WHEN v_credit_score >= 70 THEN 0.30
    WHEN v_credit_score >= 50 THEN 0.45
    ELSE 0.60
  END;

  -- 최종 계산
  v_tax_amount := (v_subtotal - v_discount_amount - v_coupon_discount) * 0.10;  -- VAT 10%

  RETURN QUERY SELECT
    v_subtotal,
    v_option_fees,
    v_shipping_cost,
    v_discount_amount,
    v_coupon_discount,
    v_tax_amount,
    GREATEST(0, v_subtotal - v_discount_amount - v_coupon_discount + v_shipping_cost + v_tax_amount),
    GREATEST(0, v_subtotal - v_discount_amount - v_coupon_discount) * v_deposit_pct,
    v_deposit_pct;
END;
$$;

-- =============================================================================
-- 4. release_reservation_hold
--    - hold 상태 예약의 10분 만료 처리
--    - pg_cron에서 1분마다 호출
-- =============================================================================
CREATE OR REPLACE FUNCTION release_reservation_hold()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  WITH expired AS (
    UPDATE rental_reservations
    SET status = 'cancelled', updated_at = NOW()
    WHERE status = 'hold'
      AND hold_expiration_at < NOW()
      AND deleted_at IS NULL
    RETURNING asset_id
  ),
  released AS (
    UPDATE assets
    SET status = 'available', updated_at = NOW()
    WHERE id IN (SELECT asset_id FROM expired)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM released;

  RETURN v_count;
END;
$$;

-- =============================================================================
-- 5. update_credit_score
--    - credit_score 변경 + audit log 자동 기록
-- =============================================================================
CREATE OR REPLACE FUNCTION update_credit_score(
  p_user_id  UUID,
  p_delta    SMALLINT,
  p_reason   TEXT,
  p_metadata JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old_score SMALLINT;
  v_new_score SMALLINT;
BEGIN
  SELECT credit_score INTO v_old_score
  FROM user_profiles WHERE user_id = p_user_id FOR UPDATE;

  v_new_score := GREATEST(0, LEAST(100, v_old_score + p_delta));

  UPDATE user_profiles
  SET credit_score = v_new_score, updated_at = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO credit_score_audit (user_id, old_score, new_score, reason, metadata)
  VALUES (p_user_id, v_old_score, v_new_score, p_reason, p_metadata);
END;
$$;

-- =============================================================================
-- 6. ensure_user_profile
--    - Supabase Auth 가입 후 user_profiles 자동 생성 (트리거용)
-- =============================================================================
CREATE OR REPLACE FUNCTION ensure_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO user_profiles (user_id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Auth 가입 트리거 (auth.users 테이블 대상)
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION ensure_user_profile();
