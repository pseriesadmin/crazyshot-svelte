-- Migration #560: approve_pending_coupon_gift — display_name 우선 반영
--
-- 배경: 발송된 쿠폰 채팅카드·푸시 문구가 discount_type/value로 조립한 "X원 할인" 고정
-- 문구만 쓰고, 관리자가 등록한 고객노출용 이름(coupons.display_name, Migration #466/#468)을
-- 전혀 읽지 않고 있었다(direct-send·chatActionEnrich는 이번 세션에서 함께 수정, 이 RPC가
-- 마지막 지점). 반환 타입(JSONB) 무변경이라 CREATE OR REPLACE만으로 충분 — DROP 불필요.

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
  v_display_name  TEXT;
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

  -- Migration #560: display_name도 함께 조회
  SELECT code, code_mode, display_name, discount_type, discount_value
  INTO v_coupon_code, v_code_mode, v_display_name, v_discount_type, v_discount_val
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

  -- Migration #560: 고객노출용 이름(display_name)이 있으면 우선 사용
  v_discount_lbl := COALESCE(v_display_name, v_discount_lbl);

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
