-- Migration #494: send_rental_chat_notification() — payment_cancelled_reissue notify_type 추가
-- 플랜: /Users/stevenmac/.claude/plans/launch-selected-element-element-tag-div-lexical-wand.md §4
--
-- 목적: CMS "예약변경" 버튼 흐름에서 발송되는 채팅 알림 타입을 추가한다.
--   changeReservation 액션: Toss 결제취소 → revert_reservation_order_to_hold 완료 후
--   고객에게 "기존 결제가 취소되고 hold(예약신청) 상태로 변경됐습니다"를 안내하는 카드.
--
-- 기존 'reservation_cancelled': 예약이 완전히 취소됨 (예약코드 폐기)
-- 신규 'payment_cancelled_reissue': 결제만 취소되고 hold로 재진입 (예약코드 유지, 재결제 대기)
--   → 고객 관점: "취소된 게 아니라 재조정 중입니다" 안내
--
-- 변경 범위:
--   1. v_content CASE: payment_cancelled_reissue 문구 추가
--   2. v_card_type CASE: RESERVATION_STATUS_CARD 매핑
--   3. button_label IN + CASE: "예약변경 확인" 버튼 라벨 추가
--
-- ⚠️ 채팅카드와 브라우저 푸시(push.ts CUSTOMER_LIFECYCLE_PUSH_COPY)는 별개 시스템
--    (service-operations.md §15) — push.ts에도 payment_cancelled_reissue 문구를 함께 추가해야 함.
--    push.ts 수정은 앱코드 커밋에서 changeReservation 액션과 함께 반영.
--
-- 함수 시그니처 (Migration 475 이후 3-arg 버전 유지):
--   send_rental_chat_notification(p_reservation_id bigint, p_notify_type text, p_action_url text DEFAULT NULL)

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
  v_options        JSONB;
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
    WHEN 'reservation_hold'          THEN v_product || ' 예약 신청이 접수되었습니다'
    WHEN 'reservation_approval'      THEN v_product || ' 예약이 승인되었습니다'
    WHEN 'shipment_notify'           THEN v_product || ' 반출 안내'
    WHEN 'rental_confirm'            THEN v_product || ' 수령이 확인되었습니다'
    WHEN 'return_remind'             THEN v_product || ' 반납 예정 알림'
    WHEN 'return_registration'       THEN v_product || ' 반납 정보 등록 요청'
    WHEN 'rental_complete'           THEN v_product || ' 대여가 완료되었습니다'
    WHEN 'reservation_cancelled'     THEN v_product || ' 예약이 취소되었습니다'
    WHEN 'damage_claimed'            THEN v_product || ' 파손 신고가 접수되었습니다. 담당자가 확인 후 안내드리겠습니다'
    WHEN 'hold_expired'              THEN v_product || ' 예약 신청이 시간 초과로 취소되었습니다. 다시 예약해 주세요'
    WHEN 'locker_guide'              THEN v_product || ' 무인보관함 이용 비밀번호는 ''' || COALESCE(v_locker_password, '') || '''입니다.'
    WHEN 'dhero_place_guide'         THEN v_product || ' 두발히어로 배송 수령 위치를 등록해 주세요'
    WHEN 'tracking_notify'           THEN v_product || ' 운송장 번호가 등록되었습니다. 채팅에서 배송 정보를 확인해주세요'
    -- Migration #494: 예약변경 — 결제취소 후 hold 재진입 안내
    WHEN 'payment_cancelled_reissue' THEN v_product || ' 예약변경이 진행중입니다. 기존 결제가 취소되어 예약 신청 상태로 변경되었습니다. 잠시 후 새 계약서가 발송됩니다'
    ELSE v_product || ' 알림'
  END;

  v_card_type := CASE p_notify_type
    WHEN 'reservation_hold'          THEN 'reservation_hold'
    WHEN 'reservation_approval'      THEN 'reservation_approval'
    WHEN 'shipment_notify'           THEN 'shipment_notify'
    WHEN 'rental_confirm'            THEN 'rental_confirm'
    WHEN 'return_remind'             THEN 'return_remind'
    WHEN 'return_registration'       THEN 'RETURN_REGISTRATION_CARD'
    WHEN 'rental_complete'           THEN 'RESERVATION_STATUS_CARD'
    WHEN 'reservation_cancelled'     THEN 'RESERVATION_STATUS_CARD'
    WHEN 'damage_claimed'            THEN 'RESERVATION_STATUS_CARD'
    WHEN 'hold_expired'              THEN 'RESERVATION_STATUS_CARD'
    WHEN 'locker_guide'              THEN 'RESERVATION_STATUS_CARD'
    WHEN 'dhero_place_guide'         THEN 'RESERVATION_STATUS_CARD'
    WHEN 'tracking_notify'           THEN 'tracking_notify'
    -- Migration #494
    WHEN 'payment_cancelled_reissue' THEN 'RESERVATION_STATUS_CARD'
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

  -- button_label: 명시적 확인 버튼이 필요한 타입 목록 (Migration #494: payment_cancelled_reissue 추가)
  IF p_notify_type IN (
    'rental_complete', 'reservation_cancelled', 'damage_claimed', 'hold_expired',
    'locker_guide', 'dhero_place_guide', 'tracking_notify',
    'payment_cancelled_reissue'
  ) THEN
    v_action_payload := v_action_payload ||
      jsonb_build_object(
        'button_label',
        CASE p_notify_type
          WHEN 'rental_complete'           THEN '대여 완료 확인'
          WHEN 'reservation_cancelled'     THEN '예약 취소 확인'
          WHEN 'damage_claimed'            THEN '파손 신고 확인'
          WHEN 'hold_expired'              THEN '예약 신청 취소'
          WHEN 'locker_guide'              THEN '무인보관함 안내 확인'
          WHEN 'dhero_place_guide'         THEN '수령 위치 등록하기'
          WHEN 'tracking_notify'           THEN '배송 정보 확인'
          -- Migration #494
          WHEN 'payment_cancelled_reissue' THEN '예약변경 확인'
        END
      );
  END IF;

  -- reservation_hold 카드 옵션상품 반영 (Migration 475 유지)
  IF p_notify_type = 'reservation_hold' THEN
    SELECT jsonb_agg(
             jsonb_build_object('name', ro.option_name, 'qty', ro.qty)
             ORDER BY ro.created_at
           )
    INTO v_options
    FROM reservation_options ro
    WHERE ro.reservation_id = p_reservation_id;

    IF v_options IS NOT NULL THEN
      v_action_payload := v_action_payload || jsonb_build_object('options', v_options);
    END IF;
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
-- Migration 475의 정의(payment_cancelled_reissue 없음)로 CREATE OR REPLACE 복원
-- ============================================================
