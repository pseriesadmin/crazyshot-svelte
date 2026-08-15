-- Migration 255: send_rental_chat_notification — return_remind action_payload에 action_url 추가
--
-- 버그: ActionCard.svelte에서 ctaUrl = payload.action_url ?? null
--   → RPC가 action_url을 포함하지 않아 항상 null이어서
--     "반납 등록하기" CTA 클릭 시 아무 동작 없음.
--
-- 수정: return_remind 타입에 action_url 필드 추가
--   → '/account/rental/{reservation_id}/history'
--   → 고객이 클릭하면 반납 이력 등록 화면으로 이동 (신규 탭)
--
-- 기존 마이그레이션 206 전체 교체 (CREATE OR REPLACE)
-- 로직 변경 없음 — action_payload 구성 부분만 수정
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

  -- [Migration 255] return_remind에만 action_url 추가 — "반납 등록하기" CTA 목적지
  IF p_notify_type = 'return_remind' THEN
    v_action_payload := v_action_payload ||
      jsonb_build_object(
        'action_url', '/account/rental/' || p_reservation_id::TEXT || '/history'
      );
  END IF;

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
-- ROLLBACK: 이전 버전(migration 206)으로 복원하려면 206 파일의
-- CREATE OR REPLACE 를 재실행하면 됨.
-- ============================================================
