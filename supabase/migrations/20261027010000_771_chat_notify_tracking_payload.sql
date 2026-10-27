-- Migration 771: send_rental_chat_notification — 반출·운송장 알림 카드에 택배사·운송장 번호 포함
--
-- 배경(2026-10-26 Stephen 지시): 운송장 등록/반출 채팅카드에 운송장 번호·택배사(두발히어로)가 없어 고객이 어디서도 배송 정보를 확인할 수 없었다.
-- ActionCard.svelte 는 이미 payload.carrier · payload.tracking_number 를 표시하므로(`{#if payload.tracking_number}`) payload 에 값만 실으면 된다.
--
-- 변경 범위: 현재 Stage·Production 라이브 정의(두 DB 정의 md5 동일: 8c4a2207e055ed049b1fcdeea020f0a7, 2026-10-27 조회)를
-- 그대로 복사하고 아래 2곳만 추가한다. 그 외 로직·시그니처·컬럼은 100% 동일하다.
--   1) DECLARE: v_tracking, v_courier
--   2) action_url 병합 직후: shipment_notify·tracking_notify 일 때 같은 주문의 등록된 운송장·택배사를 payload 에 병합
--      (두발히어로 접수는 주문 단위라 알림 대상 예약에 없으면 같은 주문의 다른 예약 값을 쓴다. 번호가 없으면 필드를 싣지 않는다.)
-- 롤백: 이 함수를 위 md5 정의(직전 정의)로 되돌린다(마이그레이션 #694~#695·#658 계열 정의와 동일한 본문).

CREATE OR REPLACE FUNCTION public.send_rental_chat_notification(p_reservation_id bigint, p_notify_type text, p_action_url text DEFAULT NULL::text)
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
  v_locker_number  TEXT;
  v_return_time    TEXT;
  v_entrance       TEXT;
  -- locker-guide-card-694
  v_content_override TEXT;
  -- locker-guide-content-695
  v_session_id     UUID;
  v_content        TEXT;
  v_card_type      TEXT;
  v_action_payload JSONB;
  v_options        JSONB;
  -- tracking-payload-771
  v_tracking       TEXT;
  v_courier        TEXT;
BEGIN
  SELECT
    rr.user_id,
    COALESCE(ppar.name, p.name),
    rr.end_date::DATE,
    COALESCE(rr.reservation_code, 'CZ-' || LPAD(rr.id::TEXT, 5, '0')),
    rr.locker_password,
    rr.locker_number,
    rr.return_time
  INTO v_user_id, v_product, v_end_date, v_code, v_locker_password, v_locker_number, v_return_time
  FROM rental_reservations rr
  JOIN products p ON p.id = rr.product_id LEFT JOIN products ppar ON ppar.id = p.parent_product_id
  WHERE rr.id = p_reservation_id;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.');
  END IF;

  IF p_notify_type = 'locker_guide' THEN
    SELECT NULLIF(btrim(value->>'password'), '') INTO v_entrance FROM cms_settings WHERE key = 'locker_entrance_password';
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
    WHEN 'locker_guide'              THEN v_product || ' 무인보관함 이용 ' || CASE WHEN NULLIF(btrim(COALESCE(v_locker_number, '')), '') IS NOT NULL THEN btrim(v_locker_number) || '번함 ' ELSE '' END || '비밀번호는 ''' || COALESCE(v_locker_password, '') || '''입니다.' || CASE WHEN v_entrance IS NOT NULL THEN E'\\n중앙현관 비밀번호: ' || v_entrance ELSE '' END
    WHEN 'dhero_place_guide'         THEN v_product || ' 두발히어로 배송 수령 위치를 등록해 주세요'
    WHEN 'tracking_notify'           THEN v_product || ' 운송장 번호가 등록되었습니다. 채팅에서 배송 정보를 확인해주세요'
    WHEN 'payment_cancelled_reissue' THEN v_product || ' 예약변경이 진행중입니다. 기존 결제가 취소되어 예약 신청 상태로 변경되었습니다. 잠시 후 새 계약서가 발송됩니다'
    ELSE v_product || ' 알림'
  END;

  IF p_notify_type = 'locker_guide' THEN
    v_content_override := NULLIF(btrim(COALESCE(current_setting('app.locker_guide_content', true), '')), '');
    IF v_content_override IS NOT NULL THEN
      v_content := left(v_content_override, 2000);
    END IF;
  END IF;

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
    WHEN 'payment_cancelled_reissue' THEN 'RESERVATION_STATUS_CARD'
    ELSE p_notify_type
  END;

  v_action_payload := jsonb_build_object(
    'type',            v_card_type,
    'reservation_id',  p_reservation_id::TEXT,
    'reservation_no',  v_code,
    'product_name',    v_product,
    'return_deadline', CASE WHEN p_notify_type = 'locker_guide' AND NULLIF(btrim(COALESCE(v_return_time, '')), '') IS NOT NULL THEN v_end_date::TEXT || ' ' || btrim(v_return_time) ELSE v_end_date::TEXT END
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

  -- tracking-payload-771: 반출·운송장 알림 카드에 택배사·운송장 번호(ActionCard 가 `{carrier} · {tracking_number}` 로 표시)
  IF p_notify_type IN ('shipment_notify', 'tracking_notify') THEN
    SELECT NULLIF(btrim(rr2.tracking_number), ''), NULLIF(btrim(COALESCE(rr2.courier_code, '')), '')
      INTO v_tracking, v_courier
    FROM rental_reservations rr2
    WHERE NULLIF(btrim(COALESCE(rr2.tracking_number, '')), '') IS NOT NULL
      AND (
        rr2.id = p_reservation_id
        OR rr2.id IN (
          SELECT oi2.reservation_id FROM order_items oi2
          WHERE oi2.order_id = (SELECT oi.order_id FROM order_items oi WHERE oi.reservation_id = p_reservation_id LIMIT 1)
        )
      )
    ORDER BY (rr2.id = p_reservation_id) DESC, rr2.id
    LIMIT 1;

    IF v_tracking IS NOT NULL THEN
      v_action_payload := v_action_payload || jsonb_build_object('tracking_number', v_tracking);
      IF v_courier IS NOT NULL THEN
        v_action_payload := v_action_payload || jsonb_build_object('carrier', v_courier);
      END IF;
    END IF;
  END IF;

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
          WHEN 'payment_cancelled_reissue' THEN '예약변경 확인'
        END
      );
  END IF;

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
