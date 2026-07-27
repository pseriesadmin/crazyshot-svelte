-- Migration 174: send_rental_chat_notification — 'rental_confirm'(대여확인) notify_type 추가
-- 배경: 2026-07-27 CMS 상담채팅 알림 정합성 감사(BL-CHAT-C2)에서 발견 —
--   in_use(대여시작) 진입 시 자동 발송되는 유일한 타입이 return_remind("반납 예정 알림")뿐이라
--   "상품을 정상 수령했고 대여가 시작되었다"는 사용자 확인용 알림이 존재하지 않았음.
--   (return_remind는 라벨/의미상 반납예정 리마인드용 — 대여시작 확인과 다른 이벤트)
-- 조치: v_content CASE에 'rental_confirm' 분기만 추가(기존 4개 분기 무변경).
--   v_card_type은 별도 분기 없이 기존 ELSE p_notify_type 경로를 그대로 타서 'rental_confirm'
--   card_type으로 자연히 매핑됨 (reservation_hold/reservation_approval과 동일한 패턴) —
--   ActionCard.svelte에 'rental_confirm' case만 추가하면 카드 렌더링됨.

CREATE OR REPLACE FUNCTION public.send_rental_chat_notification(p_reservation_id bigint, p_notify_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    UUID;
  v_product    TEXT;
  v_end_date   DATE;
  v_code       TEXT;
  v_session_id UUID;
  v_content    TEXT;
  v_card_type  TEXT;
BEGIN
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

  v_content := CASE p_notify_type
    WHEN 'shipment_notify'     THEN v_product || ' 반출 안내'
    WHEN 'rental_confirm'      THEN v_product || ' 수령 확인 — 대여가 시작되었습니다'
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

  -- 1) open/pending 세션
  SELECT id INTO v_session_id
  FROM chat_sessions
  WHERE user_id = v_user_id AND status IN ('open', 'pending')
  ORDER BY updated_at DESC LIMIT 1;

  -- 2) closed 세션 재활성화
  IF v_session_id IS NULL THEN
    UPDATE chat_sessions
    SET status = 'open', updated_at = NOW()
    WHERE id = (
      SELECT id FROM chat_sessions
      WHERE user_id = v_user_id AND status = 'closed'
      ORDER BY updated_at DESC LIMIT 1
    )
    RETURNING id INTO v_session_id;
  END IF;

  -- 3) 신규 생성
  IF v_session_id IS NULL THEN
    INSERT INTO chat_sessions (user_id, status, context_type, context_id)
    VALUES (v_user_id, 'open', 'reservation', p_reservation_id::TEXT)
    RETURNING id INTO v_session_id;
  END IF;

  INSERT INTO chat_messages (
    session_id, sender_type, message_type, content, action_payload, is_read
  ) VALUES (
    v_session_id, 'admin', 'action_card', v_content,
    jsonb_build_object(
      'type',            v_card_type,
      'reservation_no',  v_code,
      'product_name',    v_product,
      'return_deadline', v_end_date::TEXT
    ),
    false
  );

  UPDATE chat_sessions SET updated_at = NOW() WHERE id = v_session_id;

  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id);
END;
$function$;
