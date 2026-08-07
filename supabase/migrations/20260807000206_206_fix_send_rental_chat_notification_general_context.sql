-- Migration 206: send_rental_chat_notification — context_type을 항상 'general'로 통일
--
-- 배경(Stephen 실사용 테스트 중 발견, 2026-08-07): return_remind 알림 발송 시
-- migration 180의 context_type 매핑(return_remind/return_registration → 'return')이
-- 해당 고객에게 'return' 세션이 없으면 "알림 유실 방지 폴백"(컨텍스트 무관 기존
-- open/pending 세션 재사용)으로 넘어가 'reservation' 컨텍스트 세션에 삽입되는 사례 발생.
--
-- 반면 고객이 실제로 채팅을 여는 진입점(FloatingBar.svelte)은 기본값
-- contextType='general'로 세션을 조회/생성 — 관리자 알림과 고객이 보는 스레드가
-- 서로 다른 세션으로 갈라져 알림이 "수신 안 됨"으로 체감되는 근본 원인.
--
-- 조치(Stephen 확정 — 구조 단순화): notify_type별 context_type 구분(migration 180 §B3)을
-- 제거하고 모든 알림을 고객이 실제로 보는 'general' 세션에 통일 삽입.

CREATE OR REPLACE FUNCTION public.send_rental_chat_notification(p_reservation_id bigint, p_notify_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id      UUID;
  v_product      TEXT;
  v_end_date     DATE;
  v_code         TEXT;
  v_session_id   UUID;
  v_content      TEXT;
  v_card_type    TEXT;
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
    WHEN 'reservation_hold'    THEN v_product || ' 예약 신청이 접수되었습니다'
    WHEN 'reservation_approval' THEN v_product || ' 예약이 승인되었습니다'
    WHEN 'shipment_notify'     THEN v_product || ' 반출 안내'
    WHEN 'rental_confirm'      THEN v_product || ' 수령이 확인되었습니다'
    WHEN 'return_remind'       THEN v_product || ' 반납 예정 알림'
    WHEN 'return_registration' THEN v_product || ' 반납 정보 등록 요청'
    WHEN 'rental_complete'     THEN v_product || ' 대여가 완료되었습니다'
    ELSE v_product || ' 알림'
  END;

  v_card_type := CASE p_notify_type
    WHEN 'reservation_hold'    THEN 'reservation_hold'
    WHEN 'reservation_approval' THEN 'reservation_approval'
    WHEN 'shipment_notify'     THEN 'shipment_notify'
    WHEN 'rental_confirm'      THEN 'rental_confirm'
    WHEN 'return_remind'       THEN 'return_remind'
    WHEN 'return_registration' THEN 'RETURN_REGISTRATION_CARD'
    WHEN 'rental_complete'     THEN 'RESERVATION_STATUS_CARD'
    ELSE p_notify_type
  END;

  -- [Migration 206] 세션 탐색 1순위: user_id + context_type='general' + open/pending
  -- (고객이 채팅을 여는 실제 진입점 FloatingBar.svelte의 기본 컨텍스트와 항상 일치시킴)
  SELECT id INTO v_session_id
  FROM chat_sessions
  WHERE user_id = v_user_id
    AND context_type = 'general'::chat_context_type_enum
    AND status IN ('open', 'pending')
  ORDER BY updated_at DESC LIMIT 1;

  -- 2순위: closed 'general' 세션 재활성화
  IF v_session_id IS NULL THEN
    UPDATE chat_sessions
    SET status = 'open', updated_at = NOW()
    WHERE id = (
      SELECT id FROM chat_sessions
      WHERE user_id = v_user_id
        AND context_type = 'general'::chat_context_type_enum
        AND status = 'closed'
      ORDER BY updated_at DESC LIMIT 1
    )
    RETURNING id INTO v_session_id;
  END IF;

  -- 3순위: 신규 생성 ('general' 고정)
  IF v_session_id IS NULL THEN
    INSERT INTO chat_sessions (user_id, status, context_type, context_id)
    VALUES (v_user_id, 'open', 'general'::chat_context_type_enum, p_reservation_id::TEXT)
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
