-- Migration 258: send_rental_chat_notification — 전체 notify_type에 action_url 포함
--
-- 배경(상담채팅 액션카드 전수조사, 2026-08-15): migration 255가 return_remind 타입에만
-- action_url을 추가하고 나머지 6개 타입(reservation_hold·reservation_approval·shipment_notify·
-- rental_confirm·return_registration·rental_complete)은 그대로 방치돼, 해당 카드들의
-- CTA 버튼을 클릭해도 action_url이 null이라 아무 동작도 하지 않는 상태였음(ActionCard.svelte
-- ctaUrl = payload.action_url ?? null).
--
-- 수정: return_remind는 기존 전용 화면(/account/rental/{id}/history) 그대로 유지하고,
-- 나머지 전체 타입은 이미 존재하는 고객용 예약 현황 목록(/account/rental)을 공통 목적지로 지정.
-- 전용 목적지 페이지가 없는 상태에서 "완전 무반응"보다 "예약 현황으로 이동"이 명백한 개선이며,
-- 신규 페이지 설계 없이 P0(action_url 부재) 범위만 좁게 해결.
--
-- 로직 변경 없음 — action_payload 구성 부분만 수정(기존 migration 255 전체 교체)
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot production(vnbpmvxruyciuuaermyh)

CREATE OR REPLACE FUNCTION public.send_rental_chat_notification(
  p_reservation_id bigint,
  p_notify_type    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id        UUID;
  v_product        TEXT;
  v_end_date       DATE;
  v_code           TEXT;
  v_session_id     UUID;
  v_content        TEXT;
  v_card_type      TEXT;
  v_action_payload JSONB;
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
    WHEN 'reservation_hold'     THEN v_product || ' 예약 신청이 접수되었습니다'
    WHEN 'reservation_approval' THEN v_product || ' 예약이 승인되었습니다'
    WHEN 'shipment_notify'      THEN v_product || ' 반출 안내'
    WHEN 'rental_confirm'       THEN v_product || ' 수령이 확인되었습니다'
    WHEN 'return_remind'        THEN v_product || ' 반납 예정 알림'
    WHEN 'return_registration'  THEN v_product || ' 반납 정보 등록 요청'
    WHEN 'rental_complete'      THEN v_product || ' 대여가 완료되었습니다'
    ELSE v_product || ' 알림'
  END;

  v_card_type := CASE p_notify_type
    WHEN 'reservation_hold'     THEN 'reservation_hold'
    WHEN 'reservation_approval' THEN 'reservation_approval'
    WHEN 'shipment_notify'      THEN 'shipment_notify'
    WHEN 'rental_confirm'       THEN 'rental_confirm'
    WHEN 'return_remind'        THEN 'return_remind'
    WHEN 'return_registration'  THEN 'RETURN_REGISTRATION_CARD'
    WHEN 'rental_complete'      THEN 'RESERVATION_STATUS_CARD'
    ELSE p_notify_type
  END;

  -- action_payload 기본값 구성
  v_action_payload := jsonb_build_object(
    'type',            v_card_type,
    'reservation_no',  v_code,
    'product_name',    v_product,
    'return_deadline', v_end_date::TEXT
  );

  -- [Migration 258] 전체 notify_type에 action_url 포함 — return_remind만 전용 이력등록 화면,
  -- 나머지는 공통 예약 현황 목록으로 이동(P0 수정, 전수조사 근거는 파일 상단 주석 참고)
  v_action_payload := v_action_payload ||
    jsonb_build_object(
      'action_url',
      CASE p_notify_type
        WHEN 'return_remind' THEN '/account/rental/' || p_reservation_id::TEXT || '/history'
        ELSE '/account/rental'
      END
    );

  -- [Migration 206] 세션 탐색 1순위: user_id + context_type='general' + open/pending
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
    v_action_payload,
    false
  );

  UPDATE chat_sessions SET updated_at = NOW() WHERE id = v_session_id;

  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id);
END;
$$;

-- ============================================================
-- ROLLBACK: 이전 버전(migration 255)으로 복원하려면 255 파일의
-- CREATE OR REPLACE 를 재실행하면 됨.
-- ============================================================
