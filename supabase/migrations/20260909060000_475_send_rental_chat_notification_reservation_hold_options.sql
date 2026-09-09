-- Migration 475: send_rental_chat_notification() — reservation_hold 카드에 옵션상품 반영
-- (파일명 번호 471 충돌로 2026-09-09 475로 재명명 — 다른 세션이 동일 시각대에 별도로
-- "471_get_rental_list_coupon_discount_amount"를 사용해 충돌 발견, DB에는 apply_migration
-- 호출 시점의 별도 version 타임스탬프로 각각 기록되어 있어 재명명이 기존 적용 이력에는
-- 영향 없음)
--
-- 배경(2026-09-09): "예약신청완료"(reservation_hold) 채팅카드가 reservation_options
-- 테이블을 전혀 조회하지 않아, 고객이 함께 예약한 옵션상품(예: SONY PXW-Z90)이 실제
-- 채팅 알림 카드에는 전혀 표시되지 않는 설계 공백이 발견됨(Stephen 실사용 확인).
-- reservation_options은 Migration 176(2026-07-28)에 신설됐으나, 그보다 먼저 도입된
-- 이 함수(Migration 150, 2026-07-23)는 이후 20회 넘게 수정되면서도 한 번도 옵션상품을
-- payload에 반영한 적이 없었다 — 회귀가 아니라 최초부터 있던 누락.
--
-- 변경 범위: p_notify_type = 'reservation_hold'일 때만 reservation_options을 조회해
-- action_payload.options(jsonb 배열: [{name, qty}, ...])를 추가한다. 다른 notify_type
-- 로직·시그니처는 전혀 건드리지 않음(요청 범위 = reservation_hold 카드 한정).
-- ActionPayload 타입(src/lib/types/chat.ts)에 options?: Array<{ name; qty }> 필드 추가,
-- ActionCard.svelte에 표시 UI 추가는 앱코드 쪽에서 별도 커밋으로 반영.

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

  -- 2026-09-09 신규: reservation_hold 카드에 옵션상품 반영 (요청 범위 한정)
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
-- Migration 454의 정의(reservation_hold 옵션 반영 없음)로 CREATE OR REPLACE 복원
-- ============================================================
