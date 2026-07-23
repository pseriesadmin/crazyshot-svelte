-- Migration 144: reservation_code 컬럼 + pickup_method + get_rental_list RPC 확장
-- rental_reservations: reservation_code(예약코드), pickup_method(대여방식) 추가
-- orders: order_key / discount_amount / tax_amount get_rental_list 노출
-- Stage DB(ezyvffjvuwmtuhpxdjrw) 검증 → Production(vnbpmvxruyciuuaermyh) 적용

-- ─────────────────────────────────────────────
-- 1. rental_reservations: 신규 컬럼 추가
-- ─────────────────────────────────────────────

ALTER TABLE rental_reservations
  ADD COLUMN IF NOT EXISTS reservation_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS pickup_method    TEXT;

-- ─────────────────────────────────────────────
-- 2. 예약코드 자동 생성 함수 (CZ-YYYYMMDD-XXXXX)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION generate_reservation_code()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_date TEXT := TO_CHAR(NOW(), 'YYYYMMDD');
  v_seq  TEXT;
BEGIN
  SELECT LPAD((COUNT(*) + 1)::TEXT, 5, '0') INTO v_seq
  FROM rental_reservations
  WHERE reservation_code LIKE 'CZ-' || v_date || '-%';
  RETURN 'CZ-' || v_date || '-' || v_seq;
END;
$$;

-- ─────────────────────────────────────────────
-- 3. INSERT 트리거 — 예약코드 자동 할당
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_set_reservation_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reservation_code IS NULL THEN
    NEW.reservation_code := generate_reservation_code();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservation_code_trigger ON rental_reservations;

CREATE TRIGGER reservation_code_trigger
  BEFORE INSERT ON rental_reservations
  FOR EACH ROW EXECUTE FUNCTION trg_set_reservation_code();

-- ─────────────────────────────────────────────
-- 4. 기존 예약 백필 (id 기반 CZ 코드)
-- ─────────────────────────────────────────────

UPDATE rental_reservations
SET reservation_code = 'CZ-' || TO_CHAR(created_at, 'YYYYMMDD') || '-' || LPAD(id::TEXT, 5, '0')
WHERE reservation_code IS NULL;

-- ─────────────────────────────────────────────
-- 5. get_rental_list RPC 재작성 — 신규 컬럼 포함
--    RETURNS TABLE 변경으로 인해 DROP 후 재생성
-- ─────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_rental_list(text, text, date, date, integer, integer);

CREATE OR REPLACE FUNCTION public.get_rental_list(
  p_status    TEXT    DEFAULT NULL,
  p_search    TEXT    DEFAULT NULL,
  p_date_from DATE    DEFAULT NULL,
  p_date_to   DATE    DEFAULT NULL,
  p_page      INTEGER DEFAULT 1,
  p_per_page  INTEGER DEFAULT 30
)
RETURNS TABLE(
  reservation_id      BIGINT,
  reservation_code    TEXT,
  status              TEXT,
  rental_start        DATE,
  rental_end          DATE,
  rental_days         INTEGER,
  pickup_method       TEXT,
  user_id             UUID,
  customer_name       TEXT,
  customer_email      TEXT,
  customer_phone      TEXT,
  membership_grade    TEXT,
  credit_score        SMALLINT,
  product_id          UUID,
  product_name        TEXT,
  product_code        TEXT,
  product_category    TEXT,
  product_image_url   TEXT,
  order_id            BIGINT,
  order_key           TEXT,
  order_amount        NUMERIC,
  discount_amount     NUMERIC,
  tax_amount          NUMERIC,
  payment_status      TEXT,
  contract_id         UUID,
  contract_status     TEXT,
  contract_pdf_url    TEXT,
  auto_signed_at      TIMESTAMP WITH TIME ZONE,
  customer_signed_at  TIMESTAMP WITH TIME ZONE,
  signing_sent_at     TIMESTAMP WITH TIME ZONE,
  signing_token       TEXT,
  created_at          TIMESTAMP WITH TIME ZONE,
  total_count         BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    rr.id                                       AS reservation_id,
    rr.reservation_code                         AS reservation_code,
    rr.status                                   AS status,
    rr.start_date                               AS rental_start,
    rr.end_date                                 AS rental_end,
    rr.rental_days                              AS rental_days,
    rr.pickup_method                            AS pickup_method,
    up.id                                       AS user_id,
    up.full_name                                AS customer_name,
    up.email                                    AS customer_email,
    up.phone                                    AS customer_phone,
    up.membership_grade                         AS membership_grade,
    up.credit_score                             AS credit_score,
    rr.product_id                               AS product_id,
    p.name                                      AS product_name,
    p.product_code::TEXT                        AS product_code,
    p.category                                  AS product_category,
    (p.image_urls ->> 0)                        AS product_image_url,
    o.id                                        AS order_id,
    o.order_key                                 AS order_key,
    o.final_amount                              AS order_amount,
    o.discount_amount                           AS discount_amount,
    o.tax_amount                                AS tax_amount,
    o.status                                    AS payment_status,
    c.id                                        AS contract_id,
    c.status                                    AS contract_status,
    c.document_url                              AS contract_pdf_url,
    c.signed_at                                 AS auto_signed_at,
    cs.signed_at                                AS customer_signed_at,
    cs.sent_at                                  AS signing_sent_at,
    cs.token::TEXT                              AS signing_token,
    rr.created_at                               AS created_at,
    COUNT(*) OVER ()                            AS total_count
  FROM rental_reservations rr
  JOIN products p ON p.id = rr.product_id
  JOIN user_profiles up ON up.id = rr.user_id
  LEFT JOIN order_items oi ON oi.reservation_id = rr.id
  LEFT JOIN orders o ON o.id = oi.order_id
  LEFT JOIN contracts c ON c.reservation_id = rr.id
  LEFT JOIN contract_signings cs ON cs.contract_id = c.id
  WHERE (p_status IS NULL OR rr.status = p_status)
    AND (p_search IS NULL OR (
         up.full_name   ILIKE '%' || p_search || '%'
      OR up.email       ILIKE '%' || p_search || '%'
      OR p.name         ILIKE '%' || p_search || '%'
      OR p.product_code ILIKE '%' || p_search || '%'
    ))
    AND (p_date_from IS NULL OR rr.start_date >= p_date_from)
    AND (p_date_to   IS NULL OR rr.end_date   <= p_date_to)
  ORDER BY rr.created_at DESC
  LIMIT p_per_page OFFSET (p_page - 1) * p_per_page;
END;
$$;
