-- Migration 170: send_rental_chat_notification Production 동기화
-- 배경: Stage/Production 간 함수 정의가 서로 다르게 드리프트됨 (파일 미저장 이력)
--   · Production 버전: sender_type = 'system' 사용 → chat_sender_type_enum에 'system' 값이
--     존재하지 않아(user/admin/ai만 존재) 호출 시 매번 enum 오류로 실패하는 잠재 버그
--   · Production 버전: content 컬럼에 JSONB를 직접 삽입 (컬럼 타입은 text) + action_payload
--     컬럼 미사용 → ActionCard.svelte가 기대하는 payload 구조(type/reservation_no/
--     product_name/return_deadline)와 불일치하여 카드 렌더링 불가
--   · Stage 버전: sender_type='admin' (유효), content=text 메시지 + action_payload=jsonb
--     별도 컬럼 사용 → ActionCard.svelte 기대 구조와 정확히 일치 (검증된 정상 버전)
-- 조치: Stage의 함수 정의를 정본으로 Production에 이식

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
