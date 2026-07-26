-- Migration 149: 대여 액션 로그 + 상태 변경 RPC
--   A. rental_action_logs 테이블 생성 (콤보 버튼 실행 시간 로그)
--   B. log_rental_action RPC (로그 INSERT + 상태 변경 단일 트랜잭션)
--   C. update_reservation_status RPC (H-01 준수 — 기존 직접 DML 교체용)

-- ─────────────────────────────────────────────────────────────
-- A. rental_action_logs 테이블
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rental_action_logs (
  id              BIGINT      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  reservation_id  BIGINT      NOT NULL REFERENCES public.rental_reservations(id) ON DELETE CASCADE,
  action_type     TEXT        NOT NULL,
  -- 허용 action_type 값:
  --   'visit_pickup'           방문 반출 완료
  --   'visit_return'           방문 반납 완료
  --   'crazy_delivery_pickup'  크레이지배송 반출 완료
  --   'crazy_delivery_return'  크레이지배송 반납 완료
  performed_by    UUID        REFERENCES auth.users(id),
  performed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note            TEXT
);

CREATE INDEX IF NOT EXISTS idx_ral_reservation_id
  ON public.rental_action_logs (reservation_id);

ALTER TABLE public.rental_action_logs ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER RPC 만 접근 허용 (직접 클라이언트 접근 차단)
-- 정책 없음 = 일반 authenticated/anon 접근 불가
-- service_role 및 SECURITY DEFINER 함수는 RLS 우회

-- ─────────────────────────────────────────────────────────────
-- B. log_rental_action RPC
--    콤보 버튼 단일 트랜잭션:
--    1) rental_action_logs INSERT
--    2) reservation status 변경 (action_type에 따라)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_rental_action(
  p_reservation_id BIGINT,
  p_action_type    TEXT,
  p_admin_id       UUID,
  p_note           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current    TEXT;
  v_new_status TEXT;
BEGIN
  -- 현재 상태 조회
  SELECT status::TEXT INTO v_current
  FROM rental_reservations
  WHERE id = p_reservation_id;

  IF v_current IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.');
  END IF;

  -- action_type별 status 전환 매핑
  v_new_status := CASE
    WHEN p_action_type IN ('visit_pickup', 'crazy_delivery_pickup')  THEN 'shipped'
    WHEN p_action_type IN ('visit_return', 'crazy_delivery_return')  THEN 'returned'
    ELSE NULL
  END;

  -- 로그 기록
  INSERT INTO rental_action_logs (reservation_id, action_type, performed_by, note)
  VALUES (p_reservation_id, p_action_type, p_admin_id, p_note);

  -- 상태 변경 (v_new_status가 NULL이면 로그만 기록)
  IF v_new_status IS NOT NULL THEN
    EXECUTE format(
      'UPDATE rental_reservations SET status = %L, updated_at = NOW() WHERE id = %L',
      v_new_status, p_reservation_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',   true,
    'from', v_current,
    'to',   COALESCE(v_new_status, v_current)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_rental_action(BIGINT, TEXT, UUID, TEXT) FROM PUBLIC;
-- service_role 전용

-- ─────────────────────────────────────────────────────────────
-- C. update_reservation_status RPC
--    기존 H-01 위반 직접 DML 교체용
--    approveReservation / updateStatus 액션에서 호출
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_reservation_status(
  p_reservation_id BIGINT,
  p_new_status     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  EXECUTE format(
    'UPDATE rental_reservations SET status = %L, updated_at = NOW() WHERE id = %L',
    p_new_status, p_reservation_id
  );

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.update_reservation_status(BIGINT, TEXT) FROM PUBLIC;
-- service_role 전용
