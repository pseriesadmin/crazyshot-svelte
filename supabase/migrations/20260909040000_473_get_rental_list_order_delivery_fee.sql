-- Migration 473: get_rental_list에 orders.delivery_fee(별칭 order_delivery_fee) 반환 추가
--
-- 배경(2026-09-09, Migration #472 직후 발견): "정산내역" 섹션의 "배송비" 항목은
-- create_reservation_order RPC가 orders.final_amount 산식에 실제로 반영하는
-- orders.delivery_fee 값과 정확히 일치해야 "기본요금 - 등급할인 - 쿠폰 - 포인트 + 배송비"
-- 합계가 최종금액과 맞아떨어진다. 그런데 기존 get_rental_list의 `delivery_fee` 컬럼은
-- orders가 아니라 payment_transactions.delivery_fee(가장 최근 PG 거래 기준) — 결제 전
-- (hold 등) 예약은 PG 거래 자체가 없어 NULL로 나와, 실제로는 배송비가 반영된 최종금액인데
-- "정산내역"에는 배송비가 안 보이는 정합성 불일치가 즉시 발견됐다(적용 직후 SQL 대조로 확인).
-- 기존 `delivery_fee` 컬럼(PG 거래 기준, 다른 화면이 이미 의존 중일 수 있어 의미 변경 금지)은
-- 그대로 두고, orders 기준 값을 별도 컬럼(order_delivery_fee)으로 추가 반환한다.
--
-- ⚠️ RETURNS TABLE 컬럼 구성이 또 바뀌므로(42P13 회피) DROP 후 CREATE.
-- 파라미터(시그니처) 무변경, RETURNS TABLE에 컬럼 1개 추가 + SELECT 목록에
-- o.delivery_fee AS order_delivery_fee 1줄 추가. 그 외 전부 Migration #472와 동일.

DROP FUNCTION IF EXISTS public.get_rental_list(text,text,date,date,integer,integer,text[],text[],boolean,bigint,boolean);

CREATE FUNCTION public.get_rental_list(
  p_status text DEFAULT NULL::text,
  p_search text DEFAULT NULL::text,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_page integer DEFAULT 1,
  p_per_page integer DEFAULT 20,
  p_include_statuses text[] DEFAULT NULL::text[],
  p_exclude_statuses text[] DEFAULT NULL::text[],
  p_require_contract_sent_unsigned boolean DEFAULT NULL::boolean,
  p_reservation_id bigint DEFAULT NULL::bigint,
  p_exclude_contract_sent boolean DEFAULT NULL::boolean
)
RETURNS TABLE(
  reservation_id bigint, reservation_code text, status text, rental_start date, rental_end date,
  rental_days integer, duration_type text, pickup_method text, return_method text,
  pickup_time text, return_time text, user_id uuid, customer_name text, customer_email text,
  customer_phone text, membership_grade text, credit_score smallint, product_id uuid,
  product_name text, product_code text, product_category text, product_image_url text,
  order_id bigint, order_key text, order_amount numeric, discount_amount numeric,
  coupon_discount_amount numeric,
  total_amount numeric, selected_points integer,
  tax_amount numeric, delivery_fee integer, order_delivery_fee integer, payment_status text, contract_id uuid,
  contract_status text, contract_pdf_url text, auto_signed_at timestamp with time zone,
  customer_signed_at timestamp with time zone, signing_sent_at timestamp with time zone,
  signing_token text, created_at timestamp with time zone,
  payment_confirmed_at timestamp with time zone, total_count bigint,
  dhero_status text, dhero_status_code smallint, dhero_return_book_id text,
  dhero_synced_at timestamp with time zone, tracking_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    o.coupon_discount_amount                    AS coupon_discount_amount,
    o.total_amount                              AS total_amount,
    o.selected_points                           AS selected_points,
    o.tax_amount                                AS tax_amount,
    (SELECT pt.delivery_fee
     FROM payment_transactions pt
     WHERE pt.reservation_id = rr.id
        OR pt.reservation_id IN (
             SELECT oi3.reservation_id FROM order_items oi3 WHERE oi3.order_id = oi.order_id
           )
     ORDER BY pt.created_at DESC
     LIMIT 1)                                   AS delivery_fee,
    o.delivery_fee                              AS order_delivery_fee,
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
         up.full_name        ILIKE '%' || p_search || '%'
      OR up.email            ILIKE '%' || p_search || '%'
      OR p.name               ILIKE '%' || p_search || '%'
      OR p.product_code       ILIKE '%' || p_search || '%'
      OR rr.reservation_code  ILIKE '%' || p_search || '%'
    ))
    AND (p_date_from IS NULL OR rr.start_date >= p_date_from)
    AND (p_date_to   IS NULL OR rr.end_date   <= p_date_to)
    AND (p_require_contract_sent_unsigned IS NOT TRUE OR cs.sent_at IS NOT NULL)
    AND (p_exclude_contract_sent IS NOT TRUE OR cs.sent_at IS NULL)
  ORDER BY rr.created_at DESC
  LIMIT p_per_page OFFSET (p_page - 1) * p_per_page;
END;
$function$;
