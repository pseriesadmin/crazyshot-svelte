-- Migration 293: 쿠폰 지연채번 — RPC 통합 (B-3·B-5·B-6)
--   B-3: use_coupon → generate_user_coupon_redeemed_code PERFORM 추가
--   B-5: cms_create_coupon → p_code nullable + p_code_series / p_code_mode 파라미터 추가
--   B-6: approve_pending_coupon_gift → sequenced 모드 NULL code 처리 분기
-- 2026-08-18

-- ─────────────────────────────────────────────────────────
-- B-3: use_coupon 확장 — 채번 스텝 1줄 추가
--   기존 used_at/used_count 세팅 로직은 한 글자도 바뀌지 않음
--   결제 호출 지점(api/checkout/confirm-mock/+server.ts)도 변경 없음
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.use_coupon(
  p_user_id        UUID,
  p_user_coupon_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uc RECORD;
BEGIN
  SELECT uc.id, uc.coupon_id, uc.used_at, c.is_active, c.deleted_at, c.valid_from, c.valid_until
  INTO v_uc
  FROM user_coupons uc
  JOIN coupons c ON c.id = uc.coupon_id
  WHERE uc.id = p_user_coupon_id AND uc.user_id = p_user_id
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

  IF v_uc.valid_until IS NOT NULL AND v_uc.valid_until < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_EXPIRED');
  END IF;

  UPDATE user_coupons
  SET used_at = now(), used_count = used_count + 1
  WHERE id = p_user_coupon_id;

  UPDATE coupons
  SET usage_count = usage_count + 1
  WHERE id = v_uc.coupon_id;

  -- B-3 추가: sequenced 모드 쿠폰에만 redeemed_code 채번 (manual은 NULL 반환으로 무동작)
  PERFORM public.generate_user_coupon_redeemed_code(p_user_coupon_id);

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.use_coupon(UUID, UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────
-- B-5: cms_create_coupon 파라미터 확장
--   p_code: nullable (sequenced 모드에서 NULL 허용)
--   p_code_series: JSONB 신규 (sequenced 모드의 패턴 저장)
--   p_code_mode: TEXT 신규, DEFAULT 'manual' (기존 호출자 하위호환)
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_create_coupon(
  p_code                  TEXT        DEFAULT NULL,   -- B-5: NULL 허용 (sequenced 모드)
  p_type                  TEXT        DEFAULT 'all',
  p_discount_type         TEXT        DEFAULT 'fixed',
  p_discount_value        NUMERIC     DEFAULT 0,
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
  p_allow_stacking        BOOLEAN     DEFAULT FALSE,
  p_code_series           JSONB       DEFAULT NULL,   -- B-5 신규
  p_code_mode             TEXT        DEFAULT 'manual' -- B-5 신규
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

  -- B-5 서버사이드 검증: code_mode별 필수 필드 체크
  IF p_code_mode = 'manual' AND (p_code IS NULL OR p_code = '') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'manual 모드에서는 쿠폰 코드가 필수입니다.');
  END IF;

  IF p_code_mode = 'sequenced' AND p_code_series IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sequenced 모드에서는 code_series가 필수입니다.');
  END IF;

  IF p_code_mode NOT IN ('manual', 'sequenced') THEN
    RETURN jsonb_build_object('ok', false, 'error', '유효하지 않은 code_mode입니다.');
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
    validity_type, allow_with_points, allow_stacking,
    code_series, code_mode                                   -- B-5 신규 컬럼
  ) VALUES (
    NULLIF(TRIM(p_code), ''),        -- sequenced 모드는 NULL, manual은 트림된 코드
    p_type, p_discount_type, p_discount_value, p_usage_limit,
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
    p_validity_type, p_allow_with_points, p_allow_stacking,
    p_code_series, p_code_mode                               -- B-5 신규
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- ─────────────────────────────────────────────────────────
-- B-6: approve_pending_coupon_gift — sequenced 모드 NULL code 처리
--   기존: v_coupon_code = coupons.code (sequenced 모드에서 NULL → chat card에 'null' 노출)
--   수정: code_mode 기준 분기 → sequenced면 안내 문구, manual이면 기존 코드 표시
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_pending_coupon_gift(
  p_message_id  UUID,
  p_admin_id    UUID,
  p_reject      BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload       JSONB;
  v_session_id    UUID;
  v_coupon_id     UUID;
  v_user_id       UUID;
  v_coupon_code   TEXT;
  v_code_mode     TEXT;
  v_discount_type TEXT;
  v_discount_val  NUMERIC;
  v_discount_lbl  TEXT;
  v_display_code  TEXT;   -- B-6: 채팅 카드에 표시할 코드/안내문구
  v_dist_result   JSONB;
BEGIN
  IF NOT is_cms_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', '관리자 권한이 필요합니다');
  END IF;

  SELECT action_payload, session_id
  INTO v_payload, v_session_id
  FROM chat_messages
  WHERE id = p_message_id;

  IF NOT FOUND OR v_payload IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '메시지를 찾을 수 없습니다');
  END IF;

  IF v_payload->>'approval_status' IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 처리된 쿠폰 카드입니다');
  END IF;

  IF p_reject THEN
    UPDATE chat_messages
    SET action_payload = jsonb_set(v_payload, '{approval_status}', '"rejected"')
    WHERE id = p_message_id;
    RETURN jsonb_build_object('ok', true, 'rejected', true);
  END IF;

  v_coupon_id := (v_payload->>'coupon_id')::UUID;
  IF v_coupon_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '쿠폰 정보가 없습니다');
  END IF;

  SELECT user_id INTO v_user_id
  FROM chat_sessions
  WHERE id = v_session_id;

  IF NOT FOUND OR v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '대상 고객을 찾을 수 없습니다');
  END IF;

  -- B-6: code와 code_mode를 함께 조회
  SELECT code, code_mode, discount_type, discount_value
  INTO v_coupon_code, v_code_mode, v_discount_type, v_discount_val
  FROM coupons
  WHERE id = v_coupon_id
    AND is_active = TRUE
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '쿠폰을 찾을 수 없거나 비활성 상태입니다');
  END IF;

  -- B-6: sequenced 모드는 배포 시점에 code가 없음 → 안내 문구로 대체
  IF v_code_mode = 'sequenced' THEN
    v_display_code := '쿠폰이 발급되었습니다. 결제 시 자동으로 적용됩니다.';
  ELSE
    v_display_code := COALESCE(v_coupon_code, '');
  END IF;

  IF v_discount_type = 'percentage' THEN
    v_discount_lbl := v_discount_val::INT::TEXT || '% 할인';
  ELSE
    v_discount_lbl := TO_CHAR(v_discount_val, 'FM999,999,999') || '원 할인';
  END IF;

  v_dist_result := distribute_coupon(
    v_coupon_id,
    'specific_user',
    jsonb_build_object('user_ids', jsonb_build_array(v_user_id::TEXT)),
    p_admin_id
  );

  IF NOT (v_dist_result->>'ok')::BOOLEAN THEN
    RETURN jsonb_build_object('ok', false, 'error', '쿠폰 발급에 실패했습니다: ' || COALESCE(v_dist_result->>'error', '알 수 없는 오류'));
  END IF;

  UPDATE chat_messages
  SET action_payload = v_payload
    || jsonb_build_object(
         'approval_status', 'approved',
         'coupon_code',     v_display_code,     -- B-6: sequenced/manual 분기된 표시값
         'discount_label',  v_discount_lbl,
         'action_url',      '/account/profile?tab=coupon'
       )
  WHERE id = p_message_id;

  RETURN jsonb_build_object('ok', true, 'coupon_code', v_display_code);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_pending_coupon_gift(UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_pending_coupon_gift(UUID, UUID, BOOLEAN)
  TO authenticated;

-- ─────────────────────────────────────────────────────────
-- ROLLBACK
-- ─────────────────────────────────────────────────────────
-- 각 함수를 이전 버전으로 CREATE OR REPLACE (migration 262/266/267 원본)
