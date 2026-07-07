-- migration #59: payment_transactions + deposit_holds + raw_webhook_logs
-- S1-M3 Payment Integration — TDD 기반 결제 도메인
-- 의존성: auth.users, rental_reservations

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. payment_transactions 테이블 (실결제 기록)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_transactions (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reservation_id    UUID NOT NULL REFERENCES rental_reservations(id) ON DELETE RESTRICT,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  -- 토스페이먼츠 식별자
  payment_key       TEXT NOT NULL,
  order_id          TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  -- 금액 분리 (혼합결제)
  total_amount      INTEGER NOT NULL CHECK (total_amount > 0),
  paid_amount       INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  point_amount      INTEGER NOT NULL DEFAULT 0 CHECK (point_amount >= 0),
  coupon_discount   INTEGER NOT NULL DEFAULT 0 CHECK (coupon_discount >= 0),
  -- 결제 메타
  payment_method    VARCHAR(30),          -- card / virtualAccount / transfer 등
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'cancelled', 'partial_cancelled', 'failed')),
  toss_response     JSONB,                -- 토스 승인 API 원본 응답
  calc_at           TIMESTAMPTZ,          -- calculate_cart_total 호출 시각 (30초 유효성 검증용)
  confirmed_at      TIMESTAMPTZ,          -- 결제 최종 승인 시각
  cancelled_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  -- 멱등성: 동일 주문 중복 결제 물리 차단
  CONSTRAINT uq_payment_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT uq_payment_order_id        UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_reservation_id
  ON payment_transactions(reservation_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_id
  ON payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status
  ON payment_transactions(status);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_payment_key
  ON payment_transactions(payment_key);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_payment_transactions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_transactions_updated_at ON payment_transactions;
CREATE TRIGGER trg_payment_transactions_updated_at
  BEFORE UPDATE ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION update_payment_transactions_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. deposit_holds 테이블 (보증금 — 실결제와 분리)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deposit_holds (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reservation_id         UUID NOT NULL REFERENCES rental_reservations(id) ON DELETE RESTRICT,
  user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  payment_transaction_id UUID REFERENCES payment_transactions(id) ON DELETE SET NULL,
  -- 보증금 금액 및 비율
  deposit_amount    INTEGER NOT NULL CHECK (deposit_amount >= 0),
  deposit_rate      NUMERIC(4,2) NOT NULL DEFAULT 0
    CHECK (deposit_rate >= 0 AND deposit_rate <= 1),  -- 0.00 ~ 1.00
  -- 크레이지스코어 기반 비율 결정
  crazyshot_score   INTEGER,
  -- 상태
  status            VARCHAR(20) NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'released', 'forfeited')),
  held_at           TIMESTAMPTZ DEFAULT now(),
  released_at       TIMESTAMPTZ,
  -- 환불 계좌 정보 (보증금 환급 시)
  refund_bank_code  VARCHAR(10),
  refund_account    TEXT,
  refund_holder     TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deposit_holds_reservation_id
  ON deposit_holds(reservation_id);
CREATE INDEX IF NOT EXISTS idx_deposit_holds_user_id
  ON deposit_holds(user_id);
CREATE INDEX IF NOT EXISTS idx_deposit_holds_status
  ON deposit_holds(status);

CREATE OR REPLACE FUNCTION update_deposit_holds_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deposit_holds_updated_at ON deposit_holds;
CREATE TRIGGER trg_deposit_holds_updated_at
  BEFORE UPDATE ON deposit_holds
  FOR EACH ROW EXECUTE FUNCTION update_deposit_holds_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. raw_webhook_logs 테이블 (토스 웹훅 원본 저장 — 즉시 200 OK 패턴)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS raw_webhook_logs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source          VARCHAR(20) NOT NULL DEFAULT 'toss'
    CHECK (source IN ('toss')),
  event_type      TEXT,                   -- PAYMENT_STATUS_CHANGED 등 (파싱 후 저장)
  payload         JSONB NOT NULL,         -- 원본 웹훅 페이로드 전체
  signature       TEXT,                   -- toss-payments-signature 헤더값
  processed       BOOLEAN NOT NULL DEFAULT false,
  processed_at    TIMESTAMPTZ,
  process_result  JSONB,                  -- pg_cron 처리 결과 기록용
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raw_webhook_logs_processed
  ON raw_webhook_logs(processed) WHERE processed = false;
CREATE INDEX IF NOT EXISTS idx_raw_webhook_logs_received_at
  ON raw_webhook_logs(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_webhook_logs_event_type
  ON raw_webhook_logs(event_type);

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. RLS 정책
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_holds         ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_webhook_logs      ENABLE ROW LEVEL SECURITY;

-- payment_transactions RLS
CREATE POLICY "user_own_payment_select"
  ON payment_transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "cms_payment_select"
  ON payment_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND cms_role IS NOT NULL
    )
  );

-- 고객은 직접 INSERT/UPDATE 불가 — RPC 경유만 허용
-- (service_role key로 서버사이드 RPC 함수가 처리)

-- deposit_holds RLS
CREATE POLICY "user_own_deposit_select"
  ON deposit_holds FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "cms_deposit_select"
  ON deposit_holds FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND cms_role IS NOT NULL
    )
  );

-- raw_webhook_logs RLS — 관리자만 조회 (웹훅 원본은 보안 민감)
CREATE POLICY "cms_webhook_logs_select"
  ON raw_webhook_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND cms_role IS NOT NULL
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. confirm_payment_and_update_reservation RPC
--    결제 승인 완료 후 원자적으로 실행: payment_transactions INSERT + reservation UPDATE
--    service_role 로직 — 직접 DML 대신 이 RPC를 /api/payment/confirm에서 호출
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION confirm_payment_and_update_reservation(
  p_reservation_id      UUID,
  p_user_id             UUID,
  p_payment_key         TEXT,
  p_order_id            TEXT,
  p_idempotency_key     TEXT,
  p_total_amount        INTEGER,
  p_paid_amount         INTEGER,
  p_point_amount        INTEGER DEFAULT 0,
  p_coupon_discount     INTEGER DEFAULT 0,
  p_payment_method      TEXT DEFAULT NULL,
  p_toss_response       JSONB DEFAULT NULL,
  p_calc_at             TIMESTAMPTZ DEFAULT NULL,
  p_deposit_amount      INTEGER DEFAULT 0,
  p_deposit_rate        NUMERIC DEFAULT 0,
  p_crazyshot_score     INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment_id UUID;
  v_deposit_id UUID;
BEGIN
  -- 멱등성 체크: 이미 처리된 주문이면 기존 결과 반환
  SELECT id INTO v_payment_id
  FROM payment_transactions
  WHERE idempotency_key = p_idempotency_key;

  IF v_payment_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'payment_id', v_payment_id,
      'idempotent', true
    );
  END IF;

  -- payment_transactions INSERT
  INSERT INTO payment_transactions (
    reservation_id, user_id, payment_key, order_id, idempotency_key,
    total_amount, paid_amount, point_amount, coupon_discount,
    payment_method, status, toss_response, calc_at, confirmed_at
  ) VALUES (
    p_reservation_id, p_user_id, p_payment_key, p_order_id, p_idempotency_key,
    p_total_amount, p_paid_amount, p_point_amount, p_coupon_discount,
    p_payment_method, 'done', p_toss_response, p_calc_at, now()
  )
  RETURNING id INTO v_payment_id;

  -- reservation 상태 confirmed 전환
  UPDATE rental_reservations
  SET status = 'confirmed',
      updated_at = now()
  WHERE id = p_reservation_id
    AND user_id = p_user_id
    AND status IN ('temp', 'pending');

  -- 보증금이 있을 경우 deposit_holds INSERT
  IF p_deposit_amount > 0 THEN
    INSERT INTO deposit_holds (
      reservation_id, user_id, payment_transaction_id,
      deposit_amount, deposit_rate, crazyshot_score, status, held_at
    ) VALUES (
      p_reservation_id, p_user_id, v_payment_id,
      p_deposit_amount, p_deposit_rate, p_crazyshot_score, 'held', now()
    )
    RETURNING id INTO v_deposit_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'deposit_id', v_deposit_id,
    'idempotent', false
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_code', SQLSTATE
  );
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. cancel_payment_and_release_hold RPC
--    결제 실패/취소 시 원자적으로 실행: reservation cancelled + HOLD 해제
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cancel_payment_and_release_hold(
  p_reservation_id UUID,
  p_user_id        UUID,
  p_reason         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- reservation cancelled 전환 (HOLD 해제)
  UPDATE rental_reservations
  SET status = 'cancelled',
      updated_at = now()
  WHERE id = p_reservation_id
    AND user_id = p_user_id
    AND status IN ('temp', 'pending', 'confirmed');

  -- payment_transactions가 있다면 failed/cancelled 처리
  UPDATE payment_transactions
  SET status = 'failed',
      updated_at = now()
  WHERE reservation_id = p_reservation_id
    AND status = 'pending';

  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 완료 확인
-- ──────────────────────────────────────────────────────────────────────────────
-- payment_transactions: idempotency_key UNIQUE, order_id UNIQUE
-- deposit_holds: status CHECK (held/released/forfeited)
-- raw_webhook_logs: processed 인덱스 (false only — 미처리 웹훅 빠른 조회)
-- RLS: 고객 SELECT only / CMS 전체 SELECT / 직접 DML 불가
-- RPC 2종: confirm_payment_and_update_reservation / cancel_payment_and_release_hold
