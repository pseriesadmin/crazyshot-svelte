-- Migration 282: 상담채팅 자동알림 세션 상태 단절 복구 (결함 A + 결함 B)
--
-- 배경: Stephen 제보("예약승인 알림 카드는 도착했는데 세션이 '대기' 탭에 그대로 남아있다") +
-- 전사 점검(Explore 에이전트 3개 병렬 조사 + Stage DB 직접 검증, 2026-08-17) 결과 확정된
-- 2개의 SQL 결함을 단일 헬퍼 함수로 통합해 재발을 구조적으로 차단한다.
--
-- 결함 A — 세션이 이미 'pending'이면 알림 도착해도 'open'으로 승격되지 않음
--   send_rental_chat_notification / _batch / notify_late_fee_payment_request 3개 함수 전부
--   세션 탐색 1순위 쿼리가 status IN ('open','pending')으로 pending도 매치해버려서,
--   "closed일 때만 open으로 되돌리는" 2순위 UPDATE 분기가 실행되지 않았다. 메시지는 정상
--   INSERT되지만 chat_sessions.status는 그대로 pending에 머물러 CMS 대시보드 "대기" 탭에
--   갇힌다(2026-08-17 Stage DB 재현: 예약 1633으로 검증, 메시지 1건 INSERT + status는
--   pending 유지 확인).
--
-- 결함 B — 고객 첫 상담(세션 이력 0건)이면 알림 자체가 저장조차 안 됨
--   send_rental_chat_notification / notify_late_fee_payment_request 2개 함수의 "3순위: 신규
--   세션 생성" 분기가 context_id(UUID 컬럼)에 예약ID를 ::TEXT로 캐스팅해 넣으려다
--   타입 오류로 함수 트랜잭션 전체가 롤백된다(2026-08-17 Stage DB 재현: 예약 1634로 검증,
--   "column context_id is of type uuid but expression is of type text" 오류로 세션 0건·
--   메시지 0건 확정 — reservation_hold 알림 100% 유실).
--
-- 수정: 공용 헬퍼 find_or_create_general_chat_session()을 신설해 3개 함수의 중복 세션
-- 탐색/생성 로직을 단일 지점으로 통합. Migration 279가 신설한 context_reservation_id
-- (bigint, rental_reservations FK) 컬럼을 사용해 context_id(uuid)는 항상 NULL로 고정한다
-- (타입 모순 원천 차단). 3개 함수는 시그니처·반환값 완전 동일 유지 — 호출부(TypeScript) 변경 없음.
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot production(vnbpmvxruyciuuaermyh)

-- ============================================================
-- 1. 공용 헬퍼: find_or_create_general_chat_session
-- ============================================================

CREATE OR REPLACE FUNCTION public.find_or_create_general_chat_session(
  p_user_id UUID,
  p_reservation_id BIGINT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_session_id             UUID;
  v_status                 chat_session_status_enum;
  v_context_reservation_id BIGINT;
BEGIN
  -- 1순위: 상태 무관 최신 general 세션 탐색 (결함A 수정 — pending도 여기서 함께 처리)
  SELECT id, status, context_reservation_id
  INTO v_session_id, v_status, v_context_reservation_id
  FROM chat_sessions
  WHERE user_id = p_user_id
    AND context_type = 'general'::chat_context_type_enum
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_session_id IS NOT NULL THEN
    IF v_status <> 'open' THEN
      UPDATE chat_sessions
      SET status = 'open', updated_at = NOW()
      WHERE id = v_session_id;
    END IF;

    IF v_context_reservation_id IS NULL AND p_reservation_id IS NOT NULL THEN
      UPDATE chat_sessions
      SET context_reservation_id = p_reservation_id
      WHERE id = v_session_id;
    END IF;

    RETURN v_session_id;
  END IF;

  -- 2순위: 신규 생성 (결함B 수정 — context_id는 항상 NULL 고정, 예약 연결은
  -- context_reservation_id 전용 컬럼만 사용)
  INSERT INTO chat_sessions (user_id, status, context_type, context_id, context_reservation_id)
  VALUES (p_user_id, 'open', 'general'::chat_context_type_enum, NULL, p_reservation_id)
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.find_or_create_general_chat_session(UUID, BIGINT) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 2. send_rental_chat_notification — 세션 탐색 블록을 헬퍼 호출로 교체
-- ============================================================

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

  -- [Migration 282] 세션 탐색/생성 — 공용 헬퍼로 통합(결함A·B 동시 해소)
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
$$;

-- ============================================================
-- 3. send_rental_chat_notification_batch — 동일 패턴 교체
-- ============================================================

CREATE OR REPLACE FUNCTION public.send_rental_chat_notification_batch(
  p_reservation_ids bigint[],
  p_notify_type     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id        UUID;
  v_session_id     UUID;
  v_content        TEXT;
  v_items          JSONB := '[]'::jsonb;
  v_first_product  TEXT;
  v_first_code     TEXT;
  v_first_deadline DATE;
  v_first_id       BIGINT;
  v_count          INT;
  v_action_payload JSONB;
  rec              RECORD;
BEGIN
  IF p_reservation_ids IS NULL OR array_length(p_reservation_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약 ID가 필요합니다.');
  END IF;

  FOR rec IN
    SELECT rr.id, rr.user_id, p.name AS product_name, rr.end_date::DATE AS end_date,
           COALESCE(rr.reservation_code, 'CZ-' || LPAD(rr.id::TEXT, 5, '0')) AS code
    FROM rental_reservations rr
    JOIN products p ON p.id = rr.product_id
    WHERE rr.id = ANY(p_reservation_ids)
    ORDER BY rr.id
  LOOP
    IF v_user_id IS NULL THEN
      v_user_id := rec.user_id;
    ELSIF v_user_id IS DISTINCT FROM rec.user_id THEN
      RETURN jsonb_build_object('ok', false, 'error', '서로 다른 사용자의 예약을 함께 처리할 수 없습니다.');
    END IF;

    v_items := v_items || jsonb_build_object(
      'reservation_no',  rec.code,
      'product_name',    rec.product_name,
      'return_deadline', rec.end_date::TEXT
    );

    IF v_first_product IS NULL THEN
      v_first_product  := rec.product_name;
      v_first_code     := rec.code;
      v_first_deadline := rec.end_date;
      v_first_id       := rec.id;
    END IF;
  END LOOP;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.');
  END IF;

  v_count := jsonb_array_length(v_items);

  v_content := CASE
    WHEN p_notify_type = 'reservation_approval' AND v_count > 1
      THEN v_first_product || ' 외 ' || (v_count - 1)::TEXT || '건 예약이 승인되었습니다'
    WHEN p_notify_type = 'reservation_approval'
      THEN v_first_product || ' 예약이 승인되었습니다'
    WHEN v_count > 1
      THEN v_first_product || ' 외 ' || (v_count - 1)::TEXT || '건 알림'
    ELSE v_first_product || ' 알림'
  END;

  v_action_payload := jsonb_build_object(
    'type',            p_notify_type,
    'reservation_no',  v_first_code,
    'product_name',    v_first_product,
    'return_deadline', v_first_deadline::TEXT,
    'items',           v_items,
    'action_url',      '/account/rental'
  );

  -- [Migration 282] 세션 탐색/생성 — 공용 헬퍼로 통합. 배치는 대표로 첫 예약 id를 연결에 사용.
  v_session_id := public.find_or_create_general_chat_session(v_user_id, v_first_id);

  INSERT INTO chat_messages (
    session_id, sender_type, message_type, content, action_payload, is_read
  ) VALUES (
    v_session_id, 'admin', 'action_card', v_content, v_action_payload, false
  );

  UPDATE chat_sessions SET updated_at = NOW() WHERE id = v_session_id;

  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id, 'count', v_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_rental_chat_notification_batch(bigint[], text) FROM PUBLIC, authenticated;

-- ============================================================
-- 4. notify_late_fee_payment_request — 동일 패턴 교체
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_late_fee_payment_request(
  p_late_fee_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fee         RECORD;
  v_user_id     UUID;
  v_session_id  UUID;
BEGIN
  SELECT lf.id, lf.reservation_id, lf.fee_amount, lf.hours_late
  INTO   v_fee
  FROM   late_fees lf
  WHERE  lf.id = p_late_fee_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT rr.user_id INTO v_user_id
  FROM   rental_reservations rr
  WHERE  rr.id = v_fee.reservation_id;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- [Migration 282] 세션 탐색/생성 — 공용 헬퍼로 통합(결함A·B 동시 해소)
  v_session_id := public.find_or_create_general_chat_session(v_user_id, v_fee.reservation_id);

  INSERT INTO chat_messages (
    session_id,
    sender_type,
    content,
    message_type,
    action_payload,
    is_read
  ) VALUES (
    v_session_id,
    'admin',
    '연체료 결제 요청',
    'action_card',
    jsonb_build_object(
      'type',         'PAYMENT_REQUEST_CARD',
      'late_fee_id',  p_late_fee_id::TEXT,
      'fee_amount',   v_fee.fee_amount,
      'hours_late',   v_fee.hours_late,
      'action_url',   '/pay/late-fee/' || p_late_fee_id::TEXT
    ),
    false
  );

  UPDATE chat_sessions SET updated_at = NOW() WHERE id = v_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_late_fee_payment_request(UUID) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- ROLLBACK: 이전 버전으로 되돌리려면 258·275·269번 마이그레이션의
-- CREATE OR REPLACE 블록을 각각 재실행하고, 아래로 헬퍼 함수를 제거한다.
-- DROP FUNCTION IF EXISTS public.find_or_create_general_chat_session(UUID, BIGINT);
-- ============================================================
