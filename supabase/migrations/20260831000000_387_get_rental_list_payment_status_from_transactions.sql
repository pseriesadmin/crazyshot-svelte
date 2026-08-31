-- Migration 387 — get_rental_list payment_status 소스 교체 (2026-08-31)
--
-- 문제(toss_payments_pg_integration_2026-08-30.md F1 — 라이브 데이터로 재현 확인):
--   CMS "결제정보" 탭 "결제 상태" 필드(payment_status)가 orders.status를 그대로 노출하는데,
--   orders.status는 INSERT 시점에 항상 'pending'으로 고정되고 그 후 어떤 코드 경로도
--   변경하지 않는다(전체 마이그레이션 전수조사 결과 UPDATE orders SET status=... 문 자체가
--   없음). 실제로 결제 완료(payment_transactions.status='done')된 예약(reservation_id=4688,
--   Stage DB 실측)도 CMS에는 "결제 상태: pending"으로 표시되며, 같은 탭 하단의 환불 버튼
--   (payment_transactions.status 기준, 정확함)과 서로 모순되는 정보를 동시에 노출한다.
--
-- 수정: payment_status 소스를 orders.status 대신 payment_transactions.status로 교체.
--   대표 예약(직접 매칭)뿐 아니라 형제 예약(order_items 경유, 같은 주문에 묶인 다른 상품)도
--   같은 주문의 결제 기록을 찾아 반영한다 — cancel_reservation_payment RPC(Migration
--   379/384)의 1a/1b 조회 패턴과 동일한 원리. 결제 시도 자체가 없는 예약(HOLD 등)은 NULL을
--   반환하며, 프론트(RentalDetailPanel.svelte)는 이미 `row.payment_status ?? '-'`로 처리 중
--   이라 추가 프론트 변경 불필요.
--
-- 반환 타입(컬럼 구성) 변경 없음 — CREATE OR REPLACE만으로 충분(Migration 369와 동일 원칙).
--
-- 롤백: 이 파일 이전 버전(Migration 369)의 함수 본문으로 CREATE OR REPLACE 재실행
--   (payment_status를 다시 o.status로 되돌림).

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
     LIMIT 1)                                   AS delivery_fee,
    -- 2026-08-31(Migration 387): orders.status(항상 'pending' 고정) 대신
    -- payment_transactions.status를 직접 조회 — 대표 예약(직접 매칭) 우선, 없으면
    -- order_items 경유로 같은 주문의 형제 예약이 가진 결제 기록을 찾는다.
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
  LEFT JOIN LATERAL (
    SELECT c2.*
    FROM contracts c2
    WHERE c2.reservation_id = rr.id
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
