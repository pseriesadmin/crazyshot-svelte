-- Migration 154: duration_type + delivery_fee 컬럼 추가 + get_rental_list RPC 업데이트
--   A. rental_reservations — duration_type TEXT 추가 (12h/24h/1day/monthly)
--   B. payment_transactions — delivery_fee INTEGER 추가
--   C. get_rental_list RPC 재작성 — 두 필드 노출

-- ─────────────────────────────────────────────────────────────
-- A. rental_reservations — duration_type
-- ─────────────────────────────────────────────────────────────

ALTER TABLE rental_reservations
  ADD COLUMN IF NOT EXISTS duration_type TEXT
    CHECK (duration_type IN ('12h', '24h', '1day', 'monthly'));

-- ─────────────────────────────────────────────────────────────
-- B. payment_transactions — delivery_fee
-- ─────────────────────────────────────────────────────────────

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS delivery_fee INTEGER;

-- ─────────────────────────────────────────────────────────────
-- C. get_rental_list RPC 재작성 (migration 147 기준 확장)
--    추가: duration_type (rental_reservations)
--          delivery_fee  (payment_transactions — reservation 기준 최신 1건)
-- ─────────────────────────────────────────────────────────────

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
  duration_type       TEXT,
  pickup_method       TEXT,
  return_method       TEXT,
  pickup_time         TEXT,
  return_time         TEXT,
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
  delivery_fee        INTEGER,
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
    rr.duration_type                            AS duration_type,
    rr.pickup_method                            AS pickup_method,
    rr.return_method                            AS return_method,
    rr.pickup_time                              AS pickup_time,
    rr.return_time                              AS return_time,
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
    (SELECT pt.delivery_fee
     FROM payment_transactions pt
     WHERE pt.reservation_id = rr.id
     LIMIT 1)                                   AS delivery_fee,
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

REVOKE ALL ON FUNCTION public.get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER) TO authenticated;
