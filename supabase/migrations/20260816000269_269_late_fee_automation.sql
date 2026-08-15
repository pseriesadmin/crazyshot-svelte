-- Migration 269: 연체료 자동 감지 + 결제 요청 알림 + 결제 처리 RPC
--
-- 목적:
--   1. auto_detect_late_fees()   — 매일 KST 자정(00:00) = UTC 15:00 실행
--      → 반납일 초과 예약에 late_fees 행 INSERT + notify_late_fee_payment_request 즉시 호출
--      → 감지 비교는 (NOW() AT TIME ZONE 'Asia/Seoul')::DATE 기준(KST 날짜 경계 정렬,
--        bare CURRENT_DATE 사용 시 최대 24시간 감지 지연 — 메인세션 재검증 시 발견·수정)
--   2. notify_late_fee_payment_request(p_late_fee_id UUID)
--      → 고객 채팅 세션에 PAYMENT_REQUEST_CARD action_card 발송
--   3. pay_late_fee_mock(p_late_fee_id UUID, p_user_id TEXT)
--      → 연체료 결제(임시 자동승인) — is_paid=true, paid_at=NOW() 처리
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot production(vnbpmvxruyciuuaermyh)
-- 2026-08-16

-- ============================================================
-- 1. notify_late_fee_payment_request
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
  -- late_fees 조회
  SELECT lf.id, lf.reservation_id, lf.fee_amount, lf.hours_late
  INTO   v_fee
  FROM   late_fees lf
  WHERE  lf.id = p_late_fee_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- reservation → user_id 확인
  SELECT rr.user_id INTO v_user_id
  FROM   rental_reservations rr
  WHERE  rr.id = v_fee.reservation_id;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- 채팅 세션 탐색 — send_rental_chat_notification(migration 258)과 동일한 3단계 로직
  -- 1순위: open/pending 세션
  SELECT id INTO v_session_id
  FROM chat_sessions
  WHERE user_id = v_user_id
    AND context_type = 'general'::chat_context_type_enum
    AND status IN ('open', 'pending')
  ORDER BY updated_at DESC LIMIT 1;

  -- 2순위: closed 세션 재활성화
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

  -- 3순위: 신규 생성
  IF v_session_id IS NULL THEN
    INSERT INTO chat_sessions (user_id, status, context_type, context_id)
    VALUES (v_user_id, 'open', 'general'::chat_context_type_enum, v_fee.reservation_id::TEXT)
    RETURNING id INTO v_session_id;
  END IF;

  -- action_card INSERT (sender_type='admin' — 시스템 자동발송)
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

-- PUBLIC/anon/authenticated 전부 REVOKE — 내부에서만 호출
REVOKE ALL ON FUNCTION public.notify_late_fee_payment_request(UUID) FROM PUBLIC, anon, authenticated;
-- service_role은 기본적으로 모든 권한 보유 (별도 GRANT 불필요)

-- ============================================================
-- 2. auto_detect_late_fees
-- ============================================================

CREATE OR REPLACE FUNCTION public.auto_detect_late_fees()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation   RECORD;
  v_late_fee_rate NUMERIC;
  v_hours_late    INT;
  v_fee_amount    NUMERIC;
  v_new_fee_id    UUID;
BEGIN
  FOR v_reservation IN
    SELECT
      rr.id,
      rr.end_date,
      rr.product_id
    FROM rental_reservations rr
    -- KST 달력 기준 날짜와 비교 — bare CURRENT_DATE(세션 기본 UTC)를 쓰면 cron 실행 시각(UTC 15:00
    -- = KST 자정)에 이미 KST로는 새 날짜인데 UTC 날짜는 아직 하루 전이라 최대 24시간 감지 지연 발생
    WHERE rr.end_date < (NOW() AT TIME ZONE 'Asia/Seoul')::DATE
      AND rr.status NOT IN ('returned', 'completed', 'cancelled', 'damage_claimed')
      -- rental_reservations에는 deleted_at 컬럼 자체가 없음(소프트삭제 미지원 테이블) —
      -- 메인세션 재검증 시 존재하지 않는 컬럼 참조 발견·제거(원래는 매 cron 실행마다 SQL 에러로 실패했을 버그)
      -- 중복방지: 이미 미납 연체료가 있는 예약 제외 (예약당 최대 1건)
      AND NOT EXISTS (
        SELECT 1
        FROM   late_fees lf
        WHERE  lf.reservation_id = rr.id
          AND  lf.is_paid = false
      )
  LOOP
    -- 연체 시간 계산 (정수 내림)
    v_hours_late := FLOOR(
      EXTRACT(EPOCH FROM (NOW() - (v_reservation.end_date::TIMESTAMP))) / 3600
    )::INT;

    -- 연체료율 조회: products.md §7 — 24h 기준 부모 price_rules 사용
    SELECT pr.late_fee_per_hour
    INTO   v_late_fee_rate
    FROM   price_rules pr
    JOIN   products p ON p.id = pr.product_id
    WHERE  (
      pr.product_id = COALESCE(
        (SELECT parent_product_id FROM products WHERE id = v_reservation.product_id),
        v_reservation.product_id
      )
    )
      AND pr.duration_type  = '24h'
      AND pr.is_active      = true
      AND pr.deleted_at     IS NULL
    LIMIT 1;

    -- 연체료율 미설정(NULL) 또는 0 → 조용히 스킵
    IF v_late_fee_rate IS NULL OR v_late_fee_rate = 0 THEN
      CONTINUE;
    END IF;

    v_fee_amount := v_hours_late * v_late_fee_rate;

    -- late_fees INSERT
    INSERT INTO late_fees (
      reservation_id,
      hours_late,
      fee_amount,
      is_paid
    ) VALUES (
      v_reservation.id,
      v_hours_late,
      v_fee_amount,
      false
    )
    RETURNING id INTO v_new_fee_id;

    -- 즉시 채팅 알림 발송 (한 트랜잭션 안에서)
    PERFORM public.notify_late_fee_payment_request(v_new_fee_id);
  END LOOP;
END;
$$;

-- pg_cron 전용 — PUBLIC/anon/authenticated 전부 REVOKE
REVOKE ALL ON FUNCTION public.auto_detect_late_fees() FROM PUBLIC, anon, authenticated;
-- service_role 기본 권한으로 pg_cron 실행 가능

-- pg_cron 잡 등록 (기존 잡 있으면 먼저 제거 — idempotent)
SELECT cron.unschedule('auto-detect-late-fees')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-detect-late-fees'
);

-- KST 00:00 = UTC 15:00 전날 (UTC-9... 아니고 KST=UTC+9이므로 KST 00:00 = UTC 15:00)
-- migration 256(auto-return-remind)는 KST 09:00 = UTC 00:00으로 잡혀있음
-- 연체료 감지는 자정(KST 00:00 = UTC 15:00)에 실행 — 반납일 마감 직후 첫 감지
SELECT cron.schedule(
  'auto-detect-late-fees',
  '0 15 * * *',
  $$SELECT public.auto_detect_late_fees();$$
);

-- ============================================================
-- 3. pay_late_fee_mock — 연체료 결제 처리 RPC
-- ============================================================
-- 2026-08-16 QA 재검증 수정: 원래 p_user_id(TEXT)를 호출자가 직접 넘겨 소유권을 판정했는데,
-- 이는 이 프로젝트의 다른 고객 전용 RPC(get_product_history_for_customer 등)가 전부 지키는
-- "auth.uid() 기반 소유권 검증" 원칙과 어긋남 — 타인의 user_id(UUID)를 알면 그 사람의 연체료를
-- 대신 "결제완료" 처리할 수 있는 구조적 약점이었음. p_user_id 파라미터를 제거하고 auth.uid()를
-- 직접 사용하도록 수정(호출부도 locals.supabase로 auth.uid()가 채워지도록 함께 변경 필요).

DROP FUNCTION IF EXISTS public.pay_late_fee_mock(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.pay_late_fee_mock(
  p_late_fee_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fee        RECORD;
  v_owner_id   UUID;
  v_caller_id  UUID := auth.uid();
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '로그인이 필요합니다.', 'status', 401);
  END IF;

  -- late_fees 조회
  SELECT lf.id, lf.reservation_id, lf.fee_amount, lf.hours_late, lf.is_paid
  INTO   v_fee
  FROM   late_fees lf
  WHERE  lf.id = p_late_fee_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '연체료를 찾을 수 없습니다.', 'status', 404);
  END IF;

  -- 이미 결제됨
  IF v_fee.is_paid THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 결제된 연체료입니다.', 'status', 409);
  END IF;

  -- 소유권 검증 — auth.uid() 기준(호출자가 전달하는 값이 아님)
  SELECT rr.user_id INTO v_owner_id
  FROM   rental_reservations rr
  WHERE  rr.id = v_fee.reservation_id;

  IF v_owner_id IS NULL OR v_owner_id <> v_caller_id THEN
    RETURN jsonb_build_object('ok', false, 'error', '접근 권한이 없습니다.', 'status', 403);
  END IF;

  -- 결제 처리
  UPDATE late_fees
  SET    is_paid  = true,
         paid_at  = NOW()
  WHERE  id = p_late_fee_id;

  RETURN jsonb_build_object('ok', true, 'fee_amount', v_fee.fee_amount);
END;
$$;

-- authenticated 사용자만 GRANT (고객만 호출 가능)
REVOKE ALL ON FUNCTION public.pay_late_fee_mock(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pay_late_fee_mock(UUID) TO authenticated;

-- ============================================================
-- 권한 패턴 요약 (메인 세션 재검증용)
-- ============================================================
-- notify_late_fee_payment_request : REVOKE FROM PUBLIC, anon, authenticated — 내부 전용
-- auto_detect_late_fees           : REVOKE FROM PUBLIC, anon, authenticated — pg_cron 전용
-- pay_late_fee_mock               : REVOKE FROM PUBLIC, anon / GRANT TO authenticated
--
-- ⚠️ 이전 세션(266·268)에서 발견된 함정: REVOKE FROM anon만으로는 부족 — PUBLIC도 함께 REVOKE
--    → notify_late_fee_payment_request, auto_detect_late_fees 둘 다 PUBLIC까지 REVOKE 적용됨

-- ============================================================
-- ROLLBACK
-- ============================================================
-- SELECT cron.unschedule('auto-detect-late-fees');
-- DROP FUNCTION IF EXISTS public.auto_detect_late_fees();
-- DROP FUNCTION IF EXISTS public.notify_late_fee_payment_request(UUID);
-- DROP FUNCTION IF EXISTS public.pay_late_fee_mock(UUID);
-- ============================================================
