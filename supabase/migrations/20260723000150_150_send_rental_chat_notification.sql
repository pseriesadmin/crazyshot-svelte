-- Migration 150: 대여 채팅 알림 RPC
--   send_rental_chat_notification — CMS 관리자 채팅 알림 발송
--   PRD §13 rule #11: 세션 재활성화 우선 정책 적용
--     1) open/pending 세션 있으면 사용
--     2) closed 세션 있으면 open으로 재활성화
--     3) 없으면 신규 세션 생성

CREATE OR REPLACE FUNCTION public.send_rental_chat_notification(
  p_reservation_id BIGINT,
  p_notify_type    TEXT
  -- 허용 값:
  --   'shipment_notify'     → 반출 안내 액션카드
  --   'return_remind'       → 반납 예정 알림 액션카드
  --   'return_registration' → 반납 정보 등록 요청 액션카드
  --   'rental_complete'     → 대여 완료 안내 액션카드
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id    UUID;
  v_product    TEXT;
  v_end_date   DATE;
  v_code       TEXT;
  v_session_id UUID;
  v_content    TEXT;
  v_card_type  TEXT;
BEGIN
  -- 예약 정보 조회
  SELECT
    rr.user_id,
    p.name,
    rr.end_date::DATE,
    COALESCE(rr.reservation_code, 'CZ-' || LPAD(rr.id::TEXT, 5, '0'))
  INTO v_user_id, v_product, v_end_date, v_code
  FROM rental_reservations rr
  JOIN products p ON p.id = rr.product_id
  WHERE rr.id = p_reservation_id;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.');
  END IF;

  -- 메시지 컨텐츠 및 카드 타입 매핑
  v_content   := CASE p_notify_type
    WHEN 'shipment_notify'     THEN v_product || ' 반출 안내'
    WHEN 'return_remind'       THEN v_product || ' 반납 예정 알림'
    WHEN 'return_registration' THEN v_product || ' 반납 정보 등록 요청'
    WHEN 'rental_complete'     THEN v_product || ' 대여가 완료되었습니다'
    ELSE v_product || ' 알림'
  END;

  v_card_type := CASE p_notify_type
    WHEN 'shipment_notify'     THEN 'shipment_notify'
    WHEN 'return_remind'       THEN 'return_remind'
    WHEN 'return_registration' THEN 'RETURN_REGISTRATION_CARD'
    WHEN 'rental_complete'     THEN 'RESERVATION_STATUS_CARD'
    ELSE p_notify_type
  END;

  -- 세션 찾기: open/pending 우선
  SELECT id INTO v_session_id
  FROM chat_sessions
  WHERE user_id = v_user_id
    AND status IN ('open', 'pending')
  ORDER BY updated_at DESC
  LIMIT 1;

  -- closed 세션 재활성화
  IF v_session_id IS NULL THEN
    UPDATE chat_sessions
    SET status     = 'open',
        updated_at = NOW()
    WHERE id = (
      SELECT id
      FROM chat_sessions
      WHERE user_id = v_user_id
        AND status  = 'closed'
      ORDER BY updated_at DESC
      LIMIT 1
    )
    RETURNING id INTO v_session_id;
  END IF;

  -- 세션 없으면 신규 생성
  IF v_session_id IS NULL THEN
    INSERT INTO chat_sessions (user_id, status, context_type, context_id)
    VALUES (v_user_id, 'open', 'reservation', p_reservation_id::TEXT)
    RETURNING id INTO v_session_id;
  END IF;

  -- 액션 카드 메시지 INSERT
  INSERT INTO chat_messages (
    session_id,
    sender_type,
    message_type,
    content,
    action_payload,
    is_read
  ) VALUES (
    v_session_id,
    'admin',
    'action_card',
    v_content,
    jsonb_build_object(
      'type',           v_card_type,
      'reservation_no', v_code,
      'product_name',   v_product,
      'return_deadline', v_end_date::TEXT
    ),
    false
  );

  -- 세션 updated_at 갱신
  UPDATE chat_sessions
  SET updated_at = NOW()
  WHERE id = v_session_id;

  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id);
END;
$$;

REVOKE ALL ON FUNCTION public.send_rental_chat_notification(BIGINT, TEXT) FROM PUBLIC;
-- service_role 전용 (CMS 서버사이드만 호출)
