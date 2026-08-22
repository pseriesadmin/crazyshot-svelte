-- Migration 329: send_rental_chat_notification — 시나리오별 button_label 명시
--
-- 배경 (2026-08-21, 세션 전수감사로 발견): 이 RPC는 11개 notify_type을 처리하는데, 그 중 5개
-- (rental_complete/reservation_cancelled/damage_claimed/hold_expired/locker_guide)는 서로
-- 전혀 다른 상황인데도 모두 동일한 카드 타입 'RESERVATION_STATUS_CARD'로 매핑돼 있다. 그런데
-- 관리자 채팅(/cms/chat) CTA 버튼 라벨은 지금까지 ActionCard.svelte의 ctaDefaults()가 타입
-- 하나당 라벨 하나만 고정해서 정했다 — 최근 세션에서 이 5개 중 hold_expired 시나리오("예약
-- 신청이 시간 초과로 취소되었습니다") 하나만 보고 그 타입 전체 기본라벨을 "예약 신청 취소"로
-- 바꿨는데, 실제 Stage DB를 조회해보니 같은 타입을 쓰는 "상담을 시작합니다"(AI 세션시작
-- 요약카드, 취소와 무관) 카드에도 그 라벨이 그대로 적용되고 있었다 — 그리고 아직 실사용
-- 데이터에는 없지만 rental_complete/reservation_cancelled/damage_claimed/locker_guide 4개
-- 시나리오도 같은 문제를 겪게 될 상황이었다(대여완료 알림에 "예약 신청 취소" 버튼이 뜨는 등).
--
-- 해결: contract_link/contract_signed에 이미 적용한 것과 동일한 원칙 — 발신 지점이 자기
-- 시나리오에 맞는 button_label을 payload에 직접 실어 보내고(ActionCard.svelte가 payload.
-- button_label ?? ctaDefaults(type).label 순으로 우선 적용하므로 자동으로 우선 적용됨),
-- 타입 하나에 라벨 하나만 고정하는 ctaDefaults() 폴백에 의존하지 않는다.
--
-- 변경 범위: Migration 321(현재 배포본) 본문 그대로 + v_action_payload 구성부에 button_label
-- CASE 분기 1개 추가. 그 외 로직·시그니처·컬럼 전부 100% 동일 — CREATE OR REPLACE로 충분
-- (파라미터 개수 변경 없음).

CREATE OR REPLACE FUNCTION public.send_rental_chat_notification(p_reservation_id bigint, p_notify_type text)
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
      CASE p_notify_type
        WHEN 'return_remind' THEN '/account/rental/' || p_reservation_id::TEXT || '/history'
        ELSE '/account/rental'
      END
    );

  -- [신규] RESERVATION_STATUS_CARD로 함께 매핑되는 5개 시나리오(rental_complete/
  -- reservation_cancelled/damage_claimed/hold_expired/locker_guide)가 서로 다른 상황인데
  -- 하나의 기본 버튼 라벨(ActionCard.svelte ctaDefaults)을 공유하던 문제 해소 — 시나리오별
  -- 정확한 라벨을 명시. 그 외 타입은 이미 자기 전용 카드타입이 있어 기본 라벨로 충분하므로
  -- button_label을 싣지 않음(ActionCard.svelte가 없으면 ctaDefaults()로 자동 폴백).
  IF p_notify_type IN ('rental_complete', 'reservation_cancelled', 'damage_claimed', 'hold_expired', 'locker_guide') THEN
    v_action_payload := v_action_payload ||
      jsonb_build_object(
        'button_label',
        CASE p_notify_type
          WHEN 'rental_complete'       THEN '대여 완료 확인'
          WHEN 'reservation_cancelled' THEN '예약 취소 확인'
          WHEN 'damage_claimed'        THEN '파손 신고 확인'
          WHEN 'hold_expired'          THEN '예약 신청 취소'
          WHEN 'locker_guide'          THEN '무인보관함 안내 확인'
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
-- Migration 321 정의로 CREATE OR REPLACE 복원(button_label IF 블록 제거)
-- ============================================================
