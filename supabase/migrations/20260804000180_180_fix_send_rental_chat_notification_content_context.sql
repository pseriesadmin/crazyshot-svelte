-- Migration 180: send_rental_chat_notification — 알림 본문 텍스트 보완 + 세션 context_type 우선 매핑
--
-- [BL-CHAT-B1] v_content CASE 누락 수정
--   현재: reservation_hold / reservation_approval / rental_confirm 은 ELSE 분기 → '{상품명} 알림'
--   수정: 각 notify_type에 어울리는 한국어 본문 텍스트 추가
--   (v_card_type 은 ActionCard.svelte 가 기대하는 소문자 직접 타입 유지 — 라벨 구분 렌더링 보존)
--
-- [BL-CHAT-B3] 세션 조회 context_type 우선 매핑
--   현재: user_id + status IN ('open','pending') 만으로 가장 최근 세션 선택 → context_type 무시
--         → return_remind/return_registration 알림이 reservation 세션에 삽입되는 문제
--   수정 (알림 유실 방지 폴백 포함):
--     1순위: user_id + context_type(매핑값) + open/pending
--     2순위: user_id + any open/pending (context_type 무관 — 기존 동작 보존)
--     3순위: closed 재활성화 (context_type 무관)
--     4순위: 신규 생성 (매핑된 context_type 사용)
--   notify_type → context_type 매핑:
--     return_remind, return_registration → 'return'
--     나머지 전부                        → 'reservation'
--
-- (stage 적용 중 발견·수정: v_context_type이 TEXT라 chat_context_type_enum 컬럼과 직접
--  비교 시 "operator does not exist" 런타임 오류 발생 — 비교/INSERT 지점에 ::chat_context_type_enum
--  명시 캐스트 추가. 최초 초안에는 없었음, stage 실행 테스트로 확인 후 반영)

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
  v_context_type TEXT;
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

  -- [B1] 알림 본문 텍스트 — notify_type별 명확한 메시지
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

  -- 액션 카드 타입 — ActionCard.svelte 의 ctaDefaults() 케이스와 일치시킴
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

  -- [B3] notify_type → context_type 매핑
  v_context_type := CASE p_notify_type
    WHEN 'return_remind'       THEN 'return'
    WHEN 'return_registration' THEN 'return'
    ELSE 'reservation'
  END;

  -- 세션 탐색 1순위: user_id + context_type 일치 + open/pending
  SELECT id INTO v_session_id
  FROM chat_sessions
  WHERE user_id = v_user_id
    AND context_type = v_context_type::chat_context_type_enum
    AND status IN ('open', 'pending')
  ORDER BY updated_at DESC LIMIT 1;

  -- 세션 탐색 2순위: user_id + any open/pending (context_type 무관 — 알림 유실 방지 폴백)
  IF v_session_id IS NULL THEN
    SELECT id INTO v_session_id
    FROM chat_sessions
    WHERE user_id = v_user_id AND status IN ('open', 'pending')
    ORDER BY updated_at DESC LIMIT 1;
  END IF;

  -- 세션 탐색 3순위: closed 세션 재활성화 (context_type 무관)
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

  -- 세션 탐색 4순위: 신규 생성 (매핑된 context_type 사용)
  IF v_session_id IS NULL THEN
    INSERT INTO chat_sessions (user_id, status, context_type, context_id)
    VALUES (v_user_id, 'open', v_context_type::chat_context_type_enum, p_reservation_id::TEXT)
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
