-- Migration 141: get_rental_list RPC 3종 버그 수정
-- 1. is_cms_admin() 체크 제거 — service_role 호출 전용, CMS 인증은 SvelteKit layer에서 처리됨
-- 2. rr.deleted_at 참조 제거 — rental_reservations에 deleted_at 컬럼 없음
-- 3. orders JOIN 경로 수정 — orders에 reservation_id 없음, order_items 경유로 수정
-- 4. service_role GRANT 추가 — SvelteKit admin 클라이언트(service_role)에서 실행 가능하도록

CREATE OR REPLACE FUNCTION get_rental_list(
  p_status    TEXT    DEFAULT NULL,
  p_search    TEXT    DEFAULT NULL,
  p_date_from DATE    DEFAULT NULL,
  p_date_to   DATE    DEFAULT NULL,
  p_page      INTEGER DEFAULT 1,
  p_per_page  INTEGER DEFAULT 30
)
RETURNS TABLE (
  reservation_id      BIGINT,
  status              TEXT,
  rental_start        DATE,
  rental_end          DATE,
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
  order_amount        NUMERIC,
  payment_status      TEXT,
  contract_id         UUID,
  contract_status     TEXT,
  contract_pdf_url    TEXT,
  auto_signed_at      TIMESTAMPTZ,
  customer_signed_at  TIMESTAMPTZ,
  signing_sent_at     TIMESTAMPTZ,
  signing_token       TEXT,
  created_at          TIMESTAMPTZ,
  total_count         BIGINT
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    rr.id                                       AS reservation_id,
    rr.status                                   AS status,
    rr.start_date                               AS rental_start,
    rr.end_date                                 AS rental_end,
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
    o.final_amount                              AS order_amount,
    o.status                                    AS payment_status,
    c.id                                        AS contract_id,
    c.status                                    AS contract_status,
    c.document_url                              AS contract_pdf_url,
    c.signed_at                                 AS auto_signed_at,
    cs.signed_at                                AS customer_signed_at,
    cs.sent_at                                  AS signing_sent_at,
    cs.token                                    AS signing_token,
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

-- 기존 PUBLIC 권한 제거 후 service_role 전용 허용
REVOKE ALL ON FUNCTION get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER) TO service_role;
