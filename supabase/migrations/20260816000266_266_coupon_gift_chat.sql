-- migration 266: COUPON_GIFT_CARD 승인 RPC
-- approve_pending_coupon_gift: 관리자 승인 → distribute_coupon 호출 + 메시지 페이로드 갱신
--                               관리자 거절 → 메시지 페이로드에 rejected 기록
-- 호출 방식: locals.supabase(관리자 실세션) 전용 — service_role 호출 시 is_cms_user() 거부됨

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
  v_discount_type TEXT;
  v_discount_val  NUMERIC;
  v_discount_lbl  TEXT;
  v_dist_result   JSONB;
BEGIN
  -- 관리자 권한 확인 (auth.uid() 기반 — locals.supabase 호출 시에만 통과)
  IF NOT is_cms_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', '관리자 권한이 필요합니다');
  END IF;

  -- 메시지 조회
  SELECT action_payload, session_id
  INTO v_payload, v_session_id
  FROM chat_messages
  WHERE id = p_message_id;

  IF NOT FOUND OR v_payload IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '메시지를 찾을 수 없습니다');
  END IF;

  -- 이미 처리된 카드인지 확인
  IF v_payload->>'approval_status' IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 처리된 쿠폰 카드입니다');
  END IF;

  -- ── 거절 경로 ──────────────────────────────────────────────────────────────
  IF p_reject THEN
    UPDATE chat_messages
    SET action_payload = jsonb_set(v_payload, '{approval_status}', '"rejected"')
    WHERE id = p_message_id;

    RETURN jsonb_build_object('ok', true, 'rejected', true);
  END IF;

  -- ── 승인 경로 ──────────────────────────────────────────────────────────────
  -- coupon_id 추출
  v_coupon_id := (v_payload->>'coupon_id')::UUID;
  IF v_coupon_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '쿠폰 정보가 없습니다');
  END IF;

  -- 세션에서 고객 user_id 조회
  SELECT user_id INTO v_user_id
  FROM chat_sessions
  WHERE id = v_session_id;

  IF NOT FOUND OR v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '대상 고객을 찾을 수 없습니다');
  END IF;

  -- 쿠폰 정보 조회
  SELECT code, discount_type, discount_value
  INTO v_coupon_code, v_discount_type, v_discount_val
  FROM coupons
  WHERE id = v_coupon_id
    AND is_active = TRUE
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '쿠폰을 찾을 수 없거나 비활성 상태입니다');
  END IF;

  -- 할인 레이블 생성
  IF v_discount_type = 'percentage' THEN
    v_discount_lbl := v_discount_val::INT::TEXT || '% 할인';
  ELSE
    v_discount_lbl := TO_CHAR(v_discount_val, 'FM999,999,999') || '원 할인';
  END IF;

  -- distribute_coupon 호출 (auth.uid() = 관리자 UID → is_cms_user() 통과)
  v_dist_result := distribute_coupon(
    v_coupon_id,
    'specific_user',
    jsonb_build_object('user_ids', jsonb_build_array(v_user_id::TEXT)),
    p_admin_id
  );

  IF NOT (v_dist_result->>'ok')::BOOLEAN THEN
    RETURN jsonb_build_object('ok', false, 'error', '쿠폰 발급에 실패했습니다: ' || COALESCE(v_dist_result->>'error', '알 수 없는 오류'));
  END IF;

  -- 메시지 페이로드 갱신 (approval_status + 쿠폰 정보)
  UPDATE chat_messages
  SET action_payload = v_payload
    || jsonb_build_object(
         'approval_status', 'approved',
         'coupon_code',     v_coupon_code,
         'discount_label',  v_discount_lbl,
         'action_url',      '/account/profile?tab=coupon'
       )
  WHERE id = p_message_id;

  RETURN jsonb_build_object('ok', true, 'coupon_code', v_coupon_code);
END;
$$;

-- 권한: authenticated(관리자 세션)에서 호출 가능 — anon은 금지
-- PUBLIC에서 먼저 전부 회수해야 함 — anon은 PUBLIC의 암묵적 멤버라 anon만 REVOKE하면
-- 함수 생성 시 자동 부여되는 PUBLIC EXECUTE 권한이 그대로 남아 무력화됨
REVOKE ALL ON FUNCTION public.approve_pending_coupon_gift(UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_pending_coupon_gift(UUID, UUID, BOOLEAN)
  TO authenticated;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS public.approve_pending_coupon_gift(UUID, UUID, BOOLEAN);
-- ============================================================
