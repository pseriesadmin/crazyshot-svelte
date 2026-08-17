-- Migration 262: BND-03 cms_promotion_dml_to_rpc
-- 배너·쿠폰 직접DML → RPC 전환 (H-01 원칙 준수)
-- Pattern B: SECURITY DEFINER, is_cms_user() 내부 권한체크, JSONB 반환
-- 호출부: locals.supabase.rpc(...) (세션 클라이언트)
-- 2026-08-17 (재작성: coupons 실제 스키마 대조 후 필드 누락·컬럼명 오류 수정)
--
-- 재작성 사유: 최초 버전은 targeting 컬럼명을 추측(best-guess)으로 썼고(실제와 4개 불일치),
-- createCoupon 액션이 실제로 쓰는 ~26개 필드 중 절반 가까이(type, min_purchase_amount,
-- description, min_rental_amount, min_rental_days, applicable_categories, per_user_limit,
-- total_usage_limit, auto_issue_schedule, distribution_target)를 누락했다 — 그대로 적용했다면
-- 쿠폰 생성 시 이 필드들이 조용히 비어버리는 회귀가 발생했을 것. 실 스키마
-- (information_schema.columns) + coupon/+page.server.ts createCoupon 액션 원문 대조로 재작성.

-- ─── 0. banners 테이블 소프트삭제 컬럼 추가 ────────────────────────────────
ALTER TABLE public.banners
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- ─── 1. cms_create_banner ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_create_banner(
  p_slot_key    TEXT,
  p_title       TEXT,
  p_image_url   TEXT,
  p_link_url    TEXT          DEFAULT NULL,
  p_device_type TEXT          DEFAULT 'all',
  p_sort_order  INTEGER       DEFAULT 0,
  p_valid_from  TIMESTAMPTZ   DEFAULT NULL,
  p_valid_until TIMESTAMPTZ   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  INSERT INTO public.banners (
    slot_key, title, image_url, link_url, device_type,
    sort_order, valid_from, valid_until, is_active
  ) VALUES (
    p_slot_key, p_title, p_image_url, p_link_url, p_device_type,
    p_sort_order, p_valid_from, p_valid_until, TRUE
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- ─── 2. cms_toggle_banner (서버측 NOT is_active) ────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_toggle_banner(
  p_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  UPDATE public.banners
     SET is_active = NOT is_active
   WHERE id = p_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BANNER_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- ─── 3. cms_delete_banner (소프트삭제: deleted_at + is_active=false) ─────────
CREATE OR REPLACE FUNCTION public.cms_delete_banner(
  p_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  UPDATE public.banners
     SET deleted_at = NOW(),
         is_active  = FALSE
   WHERE id = p_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BANNER_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- ─── 4. cms_create_coupon ───────────────────────────────────────────────────
-- 실 스키마(information_schema.columns) + createCoupon 액션 원문(2026-08-17) 대조로
-- 전체 26개 사용자 입력 필드 전부 반영. is_active/usage_count는 신규 생성 시 항상
-- true/0으로 고정되므로(코드도 하드코딩) 파라미터화하지 않음.
CREATE OR REPLACE FUNCTION public.cms_create_coupon(
  p_code                  TEXT,
  p_type                  TEXT,
  p_discount_type         TEXT,
  p_discount_value        NUMERIC,
  p_usage_limit           INTEGER     DEFAULT NULL,
  p_min_purchase_amount   NUMERIC     DEFAULT 0,
  p_valid_from            TIMESTAMPTZ DEFAULT NULL,
  p_valid_until           TIMESTAMPTZ DEFAULT NULL,
  p_description           TEXT        DEFAULT NULL,
  p_min_rental_amount     INTEGER     DEFAULT 0,
  p_min_rental_days       INTEGER     DEFAULT 0,
  p_max_discount_amount   NUMERIC     DEFAULT NULL,
  p_applicable_categories JSONB       DEFAULT NULL,
  p_user_grade_required   TEXT        DEFAULT NULL,
  p_is_first_rental_only  BOOLEAN     DEFAULT FALSE,
  p_per_user_limit        INTEGER     DEFAULT 1,
  p_total_usage_limit     INTEGER     DEFAULT NULL,
  p_is_student_only       BOOLEAN     DEFAULT FALSE,
  p_is_walk_in_only       BOOLEAN     DEFAULT FALSE,
  p_is_subscription_only  BOOLEAN     DEFAULT FALSE,
  p_auto_issue_enabled    BOOLEAN     DEFAULT FALSE,
  p_auto_issue_schedule   JSONB       DEFAULT NULL,
  p_distribution_target   JSONB       DEFAULT NULL,
  p_validity_type         TEXT        DEFAULT 'fixed_period',
  p_allow_with_points     BOOLEAN     DEFAULT TRUE,
  p_allow_stacking        BOOLEAN     DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  INSERT INTO public.coupons (
    code, type, discount_type, discount_value, usage_limit,
    min_purchase_amount, valid_from, valid_until, description,
    is_active, usage_count,
    min_rental_amount, min_rental_days, max_discount_amount,
    applicable_categories, user_grade_required, is_first_rental_only,
    per_user_limit, total_usage_limit,
    is_student_only, is_walk_in_only, is_subscription_only,
    auto_issue_enabled, auto_issue_schedule, distribution_target,
    validity_type, allow_with_points, allow_stacking
  ) VALUES (
    p_code, p_type, p_discount_type, p_discount_value, p_usage_limit,
    p_min_purchase_amount,
    CASE WHEN p_validity_type = 'unlimited' THEN NULL ELSE p_valid_from  END,
    CASE WHEN p_validity_type = 'unlimited' THEN NULL ELSE p_valid_until END,
    p_description,
    TRUE, 0,
    p_min_rental_amount, p_min_rental_days, p_max_discount_amount,
    p_applicable_categories, p_user_grade_required, p_is_first_rental_only,
    p_per_user_limit, p_total_usage_limit,
    p_is_student_only, p_is_walk_in_only, p_is_subscription_only,
    p_auto_issue_enabled, p_auto_issue_schedule, p_distribution_target,
    p_validity_type, p_allow_with_points, p_allow_stacking
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- ─── 5. cms_update_coupon ───────────────────────────────────────────────────
-- updateCoupon 액션은 이 9개 필드만 수정 대상으로 삼음(생성 시 필드 전부가 아님) — 원문과 일치.
CREATE OR REPLACE FUNCTION public.cms_update_coupon(
  p_id                  UUID,
  p_discount_type       TEXT,
  p_discount_value      NUMERIC,
  p_max_discount_amount NUMERIC,
  p_usage_limit         INTEGER,
  p_user_grade_required TEXT,
  p_validity_type       TEXT,
  p_valid_from          TIMESTAMPTZ,
  p_valid_until         TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  UPDATE public.coupons
     SET discount_type       = p_discount_type,
         discount_value      = p_discount_value,
         max_discount_amount = p_max_discount_amount,
         usage_limit         = p_usage_limit,
         user_grade_required = p_user_grade_required,
         validity_type       = p_validity_type,
         valid_from  = CASE WHEN p_validity_type = 'unlimited' THEN NULL ELSE p_valid_from  END,
         valid_until = CASE WHEN p_validity_type = 'unlimited' THEN NULL ELSE p_valid_until END
   WHERE id = p_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- ─── 6. cms_toggle_coupon (서버측 NOT is_active) ────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_toggle_coupon(
  p_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  UPDATE public.coupons
     SET is_active = NOT is_active
   WHERE id = p_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- ─── 7. cms_delete_coupon (소프트삭제 — 기존 DML 로직과 동일) ─────────────
CREATE OR REPLACE FUNCTION public.cms_delete_coupon(
  p_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  UPDATE public.coupons
     SET deleted_at = NOW(),
         is_active  = FALSE
   WHERE id = p_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
