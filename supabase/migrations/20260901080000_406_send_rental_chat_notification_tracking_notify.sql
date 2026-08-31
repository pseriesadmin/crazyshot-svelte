-- Migration 406: send_rental_chat_notification — tracking_notify 타입 추가
--
-- RSV-B-B4 (2026-08-31): 운송장 번호 발송 알림 chat card 타입 신설.
-- 채팅카드(이 RPC)와 브라우저 푸시(push.ts CUSTOMER_LIFECYCLE_PUSH_COPY)를 세트로 추가한다 —
-- service-operations.md §15 "채팅카드 ≠ 브라우저 푸시 별개 시스템, 수동 동기화 필요" 원칙 준수.
-- push.ts 측 동기화: src/lib/server/push.ts(tracking_notify 엔트리 추가, 동일 세션 완료).
--
-- ⚠️ 2026-08-31 수정: 최초 작성본은 Migration 329 기준(p_reservation_id, p_notify_type 2-param)
-- 으로 작성됐으나, 그 사이 병렬 세션이 이미 이 함수를 3-param(p_action_url 추가) +
-- 'dhero_place_guide' 분기 포함 버전으로 갱신해둔 상태였다(Stage DB pg_proc 직접 조회로 확인).
-- 2-param으로 그대로 적용하면 시그니처가 달라 오버로드가 생겨 PostgREST 호출 모호성 에러가
-- 발생하고, dhero_place_guide 분기가 통째로 사라지는 회귀가 났을 것 — 적용 직전 발견해 아래처럼
-- 현재 Stage DB의 3-param 정의 위에 tracking_notify 분기만 추가하는 것으로 정정했다.
--
-- 변경 범위: 현재 Stage DB 라이브 정의(3-param, dhero_place_guide 포함) + tracking_notify
-- WHEN 분기 3곳 추가. 그 외 로직·시그니처·컬럼 전부 100% 동일.

CREATE OR REPLACE FUNCTION public.send_rental_chat_notification(
  p_reservation_id bigint,
  p_notify_type text,
  p_action_url text DEFAULT NULL::text
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
    -- RSV-B-B4: 운송장 번호 발송 알림
    WHEN 'tracking_notify'       THEN v_product || ' 운송장 번호가 등록되었습니다. 채팅에서 배송 정보를 확인해주세요'
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
    -- RSV-B-B4: tracking_notify는 전용 카드 타입 사용
    WHEN 'tracking_notify'       THEN 'tracking_notify'
    ELSE p_notify_type
  END;

  v_action_payload := jsonb_build_object(
    'type',            v_card_type,
    'reservation_no',  v_code,
    'product_name',    v_product,
    'return_deadline', v_end_date::TEXT
  );

  v_action_payload := v_action_payload ||
    jsonb_build_object(
      'action_url',
      CASE
        WHEN p_action_url IS NOT NULL THEN p_action_url
        WHEN p_notify_type = 'return_remind' THEN '/account/rental/' || p_reservation_id::TEXT || '/history'
        ELSE '/account/rental'
      END
    );

  IF p_notify_type IN ('rental_complete', 'reservation_cancelled', 'damage_claimed', 'hold_expired', 'locker_guide', 'dhero_place_guide', 'tracking_notify') THEN
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
          -- RSV-B-B4: tracking_notify 전용 버튼 라벨
          WHEN 'tracking_notify'       THEN '배송 정보 확인'
        END
      );
  END IF;

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

-- ============================================================
-- ROLLBACK
-- ============================================================
-- 3-param 정의(dhero_place_guide 포함, tracking_notify 분기 제거)로 CREATE OR REPLACE 복원
-- ============================================================
