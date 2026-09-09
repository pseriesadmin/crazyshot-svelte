-- Migration 471: get_rental_list에 orders.coupon_discount_amount(Migration 470-adjacent
-- 신규 컬럼, create_reservation_order RPC 재작성 시 함께 도입) 반환 추가
--
-- 배경(2026-09-09): create_reservation_order RPC가 쿠폰 할인을 실제로 계산해
-- orders.coupon_discount_amount/final_amount에 반영하도록 고쳤고, 전자계약(contract-data
-- 엔드포인트)은 이 값을 정상 표시하도록 함께 수정했다. 그런데 CMS "결제정보" 탭("주문 정보"
-- 섹션, RentalDetailPanel.svelte)은 get_rental_list RPC 결과(row.discount_amount — 등급할인
-- 전용)만 표시해, 쿠폰 할인이 실제로 반영된 최종금액(row.order_amount)만 보이고 "왜 그
-- 금액인지" 설명하는 쿠폰 할인 내역 자체가 관리자 화면 어디에도 없는 공백이 있었다(Stephen
-- 지적 — "계약서에만 반영되고 결제정보 탭엔 없는 게 심각한 것 아니냐"). 이 마이그레이션은
-- 그 공백의 데이터 소스만 추가한다 — 화면 표시(새 "쿠폰 할인" 행)는 별도 클라이언트 수정.
--
-- ⚠️ RETURNS TABLE의 OUT 파라미터 구성이 바뀌므로(컬럼 1개 추가) CREATE OR REPLACE만으로는
-- 42P13(반환 타입 변경 불가) 에러가 난다 — DROP 후 CREATE 필요(함수 파라미터 시그니처
-- 자체는 무변경이라 호출부 영향 없음).
-- 파라미터(시그니처) 무변경, RETURNS TABLE에 컬럼 1개 추가 + SELECT 목록에
-- o.coupon_discount_amount 1줄 추가. 그 외 전부 기존과 동일.

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
  tax_amount numeric, delivery_fee integer, payment_status text, contract_id uuid,
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
