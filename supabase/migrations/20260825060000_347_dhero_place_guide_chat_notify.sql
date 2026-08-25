-- Migration 347: send_rental_chat_notification — dhero_place_guide 신규 알림타입 추가
--
-- 배경 (2026-08-25, NOW-FIX-2 Item 4):
--   두발히어로 배송접수(createDelivery) 성공 시 응답에 placePageUrl(수령희망위치 등록 URL)이
--   포함된다. 이 URL을 고객 채팅 액션카드로 전달해 고객이 수령 위치를 직접 등록할 수 있도록
--   한다. placePageUrl은 예약마다 다른 동적 외부 URL이므로 RPC에 p_action_url TEXT DEFAULT NULL
--   파라미터를 추가해 호출부에서 전달한다.
--
-- 변경 사항:
--   1. 함수 시그니처에 p_action_url TEXT DEFAULT NULL 추가
--      → 기존 2-param 호출(shipment_notify 등)은 DEFAULT NULL로 그대로 동작
--   2. v_action_payload action_url에 COALESCE(p_action_url, ...) 적용
--   3. dhero_place_guide CASE 분기 추가 (content/card_type/button_label)
--
-- 주의: PostgreSQL에서 DEFAULT 파라미터를 추가한 버전과 2-param 버전이 공존하면
--   2-param 호출 시 PGRST203(모호성) 에러 발생 → 반드시 기존 2-param 버전 DROP 선행.
--
-- service-operations.md §11: find_or_create_general_chat_session RPC 경유 세션 조회 유지.
-- service-operations.md §15: push.ts CUSTOMER_LIFECYCLE_PUSH_COPY에도 dhero_place_guide 동기화 필수.

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: 기존 2-param 버전 DROP (3-param DEFAULT 버전과 오버로드 충돌 방지)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.send_rental_chat_notification(bigint, text);

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: 3-param 버전 생성 (p_action_url DEFAULT NULL — 기존 2-param 호출 하위호환)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_rental_chat_notification(
  p_reservation_id bigint,
  p_notify_type    text,
  p_action_url     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id        UUID;
  v_product        TEXT;
  v_end_date       DATE;
  v_code           TEXT;
  v_locker_password TEXT;
  v_session_id     UUID;
  v_content        TEXT;
  v_card_type      TEXT;
  v_action_payload JSONB;
BEGIN
  SELECT
    rr.user_id,
    p.name,
    rr.end_date::DATE,
    COALESCE(rr.reservation_code, 'CZ-' || LPAD(rr.id::TEXT, 5, '0')),
    rr.locker_password
  INTO v_user_id, v_product, v_end_date, v_code, v_locker_password
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
    WHEN 'reservation_cancelled' THEN v_product || ' 예약이 취소되었습니다'
    WHEN 'damage_claimed'        THEN v_product || ' 파손 신고가 접수되었습니다. 담당자가 확인 후 안내드리겠습니다'
    WHEN 'hold_expired'          THEN v_product || ' 예약 신청이 시간 초과로 취소되었습니다. 다시 예약해 주세요'
    WHEN 'locker_guide'          THEN v_product || ' 무인보관함 이용 비밀번호는 ''' || COALESCE(v_locker_password, '') || '''입니다.'
    WHEN 'dhero_place_guide'     THEN v_product || ' 두발히어로 배송 수령 위치를 등록해 주세요'
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
    WHEN 'reservation_cancelled' THEN 'RESERVATION_STATUS_CARD'
    WHEN 'damage_claimed'        THEN 'RESERVATION_STATUS_CARD'
    WHEN 'hold_expired'          THEN 'RESERVATION_STATUS_CARD'
    WHEN 'locker_guide'          THEN 'RESERVATION_STATUS_CARD'
    WHEN 'dhero_place_guide'     THEN 'RESERVATION_STATUS_CARD'
    ELSE p_notify_type
  END;

  v_action_payload := jsonb_build_object(
    'type',            v_card_type,
    'reservation_no',  v_code,
    'product_name',    v_product,
    'return_deadline', v_end_date::TEXT
  );

  -- action_url: p_action_url이 있으면 그 값 우선(dhero_place_guide처럼 외부 동적 URL),
  --             없으면 기존 정적 로직 그대로(하위호환)
  v_action_payload := v_action_payload ||
    jsonb_build_object(
      'action_url',
      CASE
        WHEN p_action_url IS NOT NULL THEN p_action_url
        WHEN p_notify_type = 'return_remind' THEN '/account/rental/' || p_reservation_id::TEXT || '/history'
        ELSE '/account/rental'
      END
    );

  -- button_label: RESERVATION_STATUS_CARD 시나리오별 라벨 명시 (Migration 329 계승 + dhero_place_guide 추가)
  IF p_notify_type IN ('rental_complete', 'reservation_cancelled', 'damage_claimed', 'hold_expired', 'locker_guide', 'dhero_place_guide') THEN
    v_action_payload := v_action_payload ||
      jsonb_build_object(
        'button_label',
        CASE p_notify_type
          WHEN 'rental_complete'       THEN '대여 완료 확인'
          WHEN 'reservation_cancelled' THEN '예약 취소 확인'
          WHEN 'damage_claimed'        THEN '파손 신고 확인'
          WHEN 'hold_expired'          THEN '예약 신청 취소'
          WHEN 'locker_guide'          THEN '무인보관함 안내 확인'
          WHEN 'dhero_place_guide'     THEN '수령 위치 등록하기'
        END
      );
  END IF;

  -- §11: find_or_create_general_chat_session RPC 경유 — 직접 chat_sessions 조회 금지
  v_session_id := public.find_or_create_general_chat_session(v_user_id, p_reservation_id);

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
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
-- ─────────────────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.send_rental_chat_notification(bigint, text, text);
-- (Migration 329 정의로 복원: 2-param 버전 재생성)
-- CREATE OR REPLACE FUNCTION public.send_rental_chat_notification(p_reservation_id bigint, p_notify_type text)
-- ...Migration 329 본문...
