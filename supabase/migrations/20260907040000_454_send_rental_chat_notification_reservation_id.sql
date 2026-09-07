-- Migration 454: send_rental_chat_notification() — action_payload에 reservation_id 추가
--
-- 배경(2026-09-07): HOLD 정책 전면 개편(Migration 453)에 맞춰 "예약신청완료"(reservation_hold)
-- 채팅카드가 실시간으로 만료/취소 여부를 재확인할 수 있어야 한다(ActionCard.svelte의
-- returnRemindBlocked와 동일한 패턴으로 /api/chat/reservation-status/[id]를 호출하려면
-- payload에 예약의 실제 id가 필요 — reservation_no는 표시용 코드일 뿐 API 파라미터로 쓸 수
-- 없음). ActionPayload 타입(src/lib/types/chat.ts)에는 이미 reservation_id?: string이
-- 정의돼 있으나, 이 RPC는 어떤 notify_type에 대해서도 이 필드를 채운 적이 없었다.
--
-- 변경 범위: 모든 notify_type이 공유하는 기본 payload 빌드 지점(jsonb_build_object) 한 곳에
-- p_reservation_id를 추가 — 이미 함수 스코프에 있는 파라미터를 노출하는 것뿐이라 다른 로직·
-- 시그니처 변경 없음. reservation_hold뿐 아니라 전체 notify_type이 함께 이 필드를 받게 되어
-- 향후 다른 카드 타입의 실시간 상태 재확인 기능 확장에도 재사용 가능(부작용 없음 — 기존
-- ActionPayload 타입이 이미 optional로 선언돼 있어 타입 변경 불필요).

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
    'reservation_id',  p_reservation_id::TEXT,
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
-- Migration 406의 정의(action_payload에 reservation_id 없음)로 CREATE OR REPLACE 복원
-- ============================================================
