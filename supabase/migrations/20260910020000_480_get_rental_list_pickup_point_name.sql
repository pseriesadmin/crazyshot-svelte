-- Migration 480: get_rental_list에 pickup_point_name/return_point_name 반환 추가
--
-- 배경(2026-09-10, Stephen 확정) — Migration #479로 rental_reservations.pickup_point_id/
-- return_point_id가 실제로 채워지기 시작해도, CMS "대여정보" 탭(RentalDetailPanel.svelte
-- "수령방식"/"반납방식" 행)이 그 지점명을 표시하려면 목록 조회 자체에 지점명이 함께
-- 실려야 한다(get_rental_list가 이 화면의 유일한 데이터 소스, 중복 쿼리/조인 로직 작성
-- 금지 원칙). pickup_points를 LEFT JOIN해 이름만 추가 반환 — 기존 컬럼·조인·필터 로직은
-- 전혀 건드리지 않는다.
--
-- ⚠️ RETURNS TABLE 컬럼 구성이 바뀌므로(42P13 회피) DROP 후 CREATE.
-- 파라미터(시그니처) 무변경, RETURNS TABLE에 컬럼 2개 추가 + SELECT 목록에 2줄 추가 +
-- FROM 절에 LEFT JOIN 2개 추가. 그 외 전부 Migration #473과 동일.

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
  dhero_synced_at timestamp with time zone, tracking_number text,
  pickup_point_name text, return_point_name text
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
    rr.tracking_number                          AS tracking_number,
    pp1.name::TEXT                               AS pickup_point_name,
    pp2.name::TEXT                               AS return_point_name
  FROM rental_reservations rr
  JOIN products p ON p.id = rr.product_id
  JOIN user_profiles up ON up.id = rr.user_id
  LEFT JOIN order_items oi ON oi.reservation_id = rr.id
  LEFT JOIN orders o ON o.id = oi.order_id
  LEFT JOIN pickup_points pp1 ON pp1.id = rr.pickup_point_id
  LEFT JOIN pickup_points pp2 ON pp2.id = rr.return_point_id
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

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration 473의 정의(pickup_point_name/return_point_name 컬럼 없음)로 복원하려면:
-- 1) DROP FUNCTION IF EXISTS public.get_rental_list(text,text,date,date,integer,integer,text[],text[],boolean,bigint,boolean);
-- 2) Migration 20260909040000_473_get_rental_list_order_delivery_fee.sql의
--    CREATE FUNCTION 블록(19~158행)을 그대로 재실행
-- ============================================================
