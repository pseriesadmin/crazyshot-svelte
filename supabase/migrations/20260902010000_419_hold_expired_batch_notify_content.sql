-- Migration 419: send_rental_chat_notification_batch — hold_expired 전용 문구/카드타입 추가
-- 배경: 같은 상품을 다중수량(같은 주문의 형제 예약) 예약했다가 HOLD가 같은 배치에서 함께
-- 만료되면, 승인 알림(reservation_approval)과 달리 hold_expired는 release_reservation_hold가
-- 예약 건별로 send_rental_chat_notification을 각각 호출해 거의 동일한 카드가 채팅창에
-- 중복 노출됐다(2026-09-02 Stephen 리포트로 발견). 이 함수는 이미 reservation_approval에서
-- "N건 통합 카드 1건" 패턴으로 쓰이고 있어(service-operations.md §4), hold_expired에도
-- 동일 패턴을 적용하기 위해 문구·카드타입·button_label만 추가한다(그 외 로직은 무변경).
--
-- send_rental_chat_notification(단건, Migration 394)의 hold_expired 분기와 동일한
-- card_type(RESERVATION_STATUS_CARD)·button_label(예약 신청 취소)을 사용해 ActionCard.svelte
-- 렌더링이 단건/통합 양쪽에서 동일하게 보이도록 맞춘다.

CREATE OR REPLACE FUNCTION public.send_rental_chat_notification_batch(p_reservation_ids bigint[], p_notify_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id        UUID;
  v_session_id     UUID;
  v_content        TEXT;
  v_card_type      TEXT;
  v_items          JSONB := '[]'::jsonb;
  v_first_product  TEXT;
  v_first_code     TEXT;
  v_first_deadline DATE;
  v_first_id       BIGINT;
  v_count          INT;
  v_action_payload JSONB;
  rec              RECORD;
BEGIN
  IF p_reservation_ids IS NULL OR array_length(p_reservation_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약 ID가 필요합니다.');
  END IF;

  FOR rec IN
    SELECT rr.id, rr.user_id, p.name AS product_name, rr.end_date::DATE AS end_date,
           COALESCE(rr.reservation_code, 'CZ-' || LPAD(rr.id::TEXT, 5, '0')) AS code
    FROM rental_reservations rr
    JOIN products p ON p.id = rr.product_id
    WHERE rr.id = ANY(p_reservation_ids)
    ORDER BY rr.id
  LOOP
    IF v_user_id IS NULL THEN
      v_user_id := rec.user_id;
    ELSIF v_user_id IS DISTINCT FROM rec.user_id THEN
      RETURN jsonb_build_object('ok', false, 'error', '서로 다른 사용자의 예약을 함께 처리할 수 없습니다.');
    END IF;

    v_items := v_items || jsonb_build_object(
      'reservation_no',  rec.code,
      'product_name',    rec.product_name,
      'return_deadline', rec.end_date::TEXT
    );

    IF v_first_product IS NULL THEN
      v_first_product  := rec.product_name;
      v_first_code     := rec.code;
      v_first_deadline := rec.end_date;
      v_first_id       := rec.id;
    END IF;
  END LOOP;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.');
  END IF;

  v_count := jsonb_array_length(v_items);

  v_content := CASE
    WHEN p_notify_type = 'reservation_approval' AND v_count > 1
      THEN v_first_product || ' 외 ' || (v_count - 1)::TEXT || '건 예약이 승인되었습니다'
    WHEN p_notify_type = 'reservation_approval'
      THEN v_first_product || ' 예약이 승인되었습니다'
    WHEN p_notify_type = 'hold_expired' AND v_count > 1
      THEN v_first_product || ' 외 ' || (v_count - 1)::TEXT || '건 예약 신청이 시간 초과로 취소되었습니다. 다시 예약해 주세요'
    WHEN p_notify_type = 'hold_expired'
      THEN v_first_product || ' 예약 신청이 시간 초과로 취소되었습니다. 다시 예약해 주세요'
    WHEN v_count > 1
      THEN v_first_product || ' 외 ' || (v_count - 1)::TEXT || '건 알림'
    ELSE v_first_product || ' 알림'
  END;

  v_card_type := CASE
    WHEN p_notify_type = 'hold_expired' THEN 'RESERVATION_STATUS_CARD'
    ELSE p_notify_type
  END;

  v_action_payload := jsonb_build_object(
    'type',            v_card_type,
    'reservation_no',  v_first_code,
    'product_name',    v_first_product,
    'return_deadline', v_first_deadline::TEXT,
    'items',           v_items,
    'action_url',      '/account/rental'
  );

  IF p_notify_type = 'hold_expired' THEN
    v_action_payload := v_action_payload || jsonb_build_object('button_label', '예약 신청 취소');
  END IF;

  v_session_id := public.find_or_create_general_chat_session(v_user_id, v_first_id);

  INSERT INTO chat_messages (
    session_id, sender_type, message_type, content, action_payload, is_read
  ) VALUES (
    v_session_id, 'admin', 'action_card', v_content, v_action_payload, false
  );

  UPDATE chat_sessions SET updated_at = NOW() WHERE id = v_session_id;

  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id, 'count', v_count);
END;
$function$;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- 이 파일 이전 버전(send_rental_chat_notification_batch 원본, reservation_approval 전용
-- 문구만 있던 버전)으로 CREATE OR REPLACE
-- ============================================================
