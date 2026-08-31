-- Migration 399 — get_rental_list의 계약(contract) 조회를 '예약(=주문)' 단위로 통일
-- (2026-08-31, CMS 감사 에이전트 HIGH 발견)
--
-- 문제: contracts/contract_signings LATERAL 조인이 `c2.reservation_id = rr.id`로만
-- 매칭한다. init-contract가 "같은 주문에 이미 계약이 있으면 재사용"으로 바뀌어(주문당
-- 계약 1건, 대표 예약에만 anchor) 형제 예약(같은 주문의 다른 상품)은 실제로 서명 완료된
-- 계약이 있어도 이 RPC에서 contract_id=NULL로 나와 CMS "계약서" 탭이 "계약서 미생성"
-- 배너를 잘못 표시한다(RentalContractViewer.svelte). Migration 387(payment_status)과
-- 동일한 order_items 경유 형제 매칭 패턴으로 계약 조회도 통일한다.
--
-- 부수 수정(MEDIUM, 같은 감사에서 발견): delivery_fee 서브쿼리가 ORDER BY 없이 LIMIT 1만
-- 써서(여러 payment_transactions 행이 있으면 비결정적) + payment_status 수정 때 준 형제
-- 매칭 폴백이 이 서브쿼리에는 빠져 있었음 — 같은 패턴으로 통일.
--
-- 반환 타입(컬럼 구성) 변경 없음 — CREATE OR REPLACE만으로 충분.

CREATE OR REPLACE FUNCTION public.get_rental_list(
  p_status                        TEXT    DEFAULT NULL,
  p_search                        TEXT    DEFAULT NULL,
  p_date_from                     DATE    DEFAULT NULL,
  p_date_to                       DATE    DEFAULT NULL,
  p_page                          INTEGER DEFAULT 1,
  p_per_page                      INTEGER DEFAULT 20,
  p_include_statuses              TEXT[]  DEFAULT NULL,
  p_exclude_statuses              TEXT[]  DEFAULT NULL,
  p_require_contract_sent_unsigned BOOLEAN DEFAULT NULL,
  p_reservation_id                BIGINT  DEFAULT NULL
)
RETURNS TABLE(
  reservation_id        BIGINT,
  reservation_code      TEXT,
  status                 TEXT,
  rental_start           DATE,
  rental_end             DATE,
  rental_days            INTEGER,
  duration_type          TEXT,
  pickup_method          TEXT,
  return_method          TEXT,
  pickup_time            TEXT,
  return_time            TEXT,
  user_id                UUID,
  customer_name          TEXT,
  customer_email         TEXT,
  customer_phone         TEXT,
  membership_grade       TEXT,
  credit_score            SMALLINT,
  product_id              UUID,
  product_name            TEXT,
  product_code            TEXT,
  product_category        TEXT,
  product_image_url       TEXT,
  order_id                BIGINT,
  order_key                TEXT,
  order_amount             NUMERIC,
  discount_amount          NUMERIC,
  tax_amount                NUMERIC,
  delivery_fee              INTEGER,
  payment_status             TEXT,
  contract_id                UUID,
  contract_status             TEXT,
  contract_pdf_url            TEXT,
  auto_signed_at               TIMESTAMP WITH TIME ZONE,
  customer_signed_at           TIMESTAMP WITH TIME ZONE,
  signing_sent_at               TIMESTAMP WITH TIME ZONE,
  signing_token                  TEXT,
  created_at                     TIMESTAMP WITH TIME ZONE,
  payment_confirmed_at           TIMESTAMP WITH TIME ZONE,
  total_count                     BIGINT,
  dhero_status                   TEXT,
  dhero_status_code              SMALLINT,
  dhero_return_book_id           TEXT,
  dhero_synced_at                TIMESTAMP WITH TIME ZONE,
  tracking_number                TEXT
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
        OR pt.reservation_id IN (
             SELECT oi3.reservation_id FROM order_items oi3 WHERE oi3.order_id = oi.order_id
           )
     ORDER BY pt.created_at DESC
     LIMIT 1)                                   AS delivery_fee,
    (SELECT pt2.status::TEXT
     FROM payment_transactions pt2
     WHERE pt2.reservation_id = rr.id
        OR pt2.reservation_id IN (
             SELECT oi2.reservation_id FROM order_items oi2 WHERE oi2.order_id = oi.order_id
           )
     ORDER BY pt2.created_at DESC
     LIMIT 1)                                   AS payment_status,
    c.id                                        AS contract_id,
    c.status                                    AS contract_status,
    c.document_url                              AS contract_pdf_url,
    c.signed_at                                 AS auto_signed_at,
    cs.signed_at                                AS customer_signed_at,
    cs.sent_at                                  AS signing_sent_at,
    cs.token::TEXT                              AS signing_token,
    rr.created_at                               AS created_at,
    rr.payment_confirmed_at                     AS payment_confirmed_at,
    COUNT(*) OVER ()                            AS total_count,
    rr.dhero_status                             AS dhero_status,
    rr.dhero_status_code                        AS dhero_status_code,
    rr.dhero_return_book_id                     AS dhero_return_book_id,
    rr.dhero_synced_at                          AS dhero_synced_at,
    rr.tracking_number                          AS tracking_number
  FROM rental_reservations rr
  JOIN products p ON p.id = rr.product_id
  JOIN user_profiles up ON up.id = rr.user_id
  LEFT JOIN order_items oi ON oi.reservation_id = rr.id
  LEFT JOIN orders o ON o.id = oi.order_id
  -- 2026-08-31(Migration 399): 이 예약 자신이 소유한 계약뿐 아니라, 같은 주문(order_items
  -- 경유)의 형제 예약이 소유한 계약도 함께 봄 — init-contract가 주문당 계약 1건만 만들도록
  -- 바뀌었기 때문(대표 예약에만 anchor, 형제 예약은 직접 소유하지 않음).
  LEFT JOIN LATERAL (
    SELECT c2.*
    FROM contracts c2
    WHERE c2.reservation_id = rr.id
       OR c2.reservation_id IN (
            SELECT oi4.reservation_id FROM order_items oi4 WHERE oi4.order_id = oi.order_id
          )
    ORDER BY c2.created_at DESC
    LIMIT 1
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT cs2.*
    FROM contract_signings cs2
    WHERE cs2.contract_id = c.id
    ORDER BY cs2.sent_at DESC
    LIMIT 1
  ) cs ON true
  WHERE (p_status IS NULL OR rr.status = p_status)
    AND (p_include_statuses IS NULL OR rr.status = ANY(p_include_statuses))
    AND (p_exclude_statuses IS NULL OR NOT (rr.status = ANY(p_exclude_statuses)))
    AND (p_reservation_id IS NULL OR rr.id = p_reservation_id)
    AND (p_search IS NULL OR (
         up.full_name   ILIKE '%' || p_search || '%'
      OR up.email       ILIKE '%' || p_search || '%'
      OR p.name         ILIKE '%' || p_search || '%'
      OR p.product_code ILIKE '%' || p_search || '%'
    ))
    AND (p_date_from IS NULL OR rr.start_date >= p_date_from)
    AND (p_date_to   IS NULL OR rr.end_date   <= p_date_to)
    AND (p_require_contract_sent_unsigned IS NOT TRUE
         OR (cs.sent_at IS NOT NULL AND cs.signed_at IS NULL))
  ORDER BY rr.created_at DESC
  LIMIT p_per_page OFFSET (p_page - 1) * p_per_page;
END;
$$;

REVOKE ALL ON FUNCTION public.get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER, TEXT[], TEXT[], BOOLEAN, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER, TEXT[], TEXT[], BOOLEAN, BIGINT) TO service_role;
