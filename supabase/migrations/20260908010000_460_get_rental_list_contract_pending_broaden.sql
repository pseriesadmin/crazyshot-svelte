-- Migration #460: get_rental_list — "계약대기" 필터 범위 확정 + "신청대기" 상호배타 처리
--
-- 배경(2026-09-08, Stephen 확정): '계약대기' 필터(p_require_contract_sent_unsigned)는
-- "전자계약을 발송했지만 아직 서명 안 한 건"만 골라내고 있었다. 그런데 서명은 완료됐지만
-- 결제가 아직 안 끝나(payment_confirmed_at NULL) confirmed로 전환되지 못한 예약은 이
-- 조건에서 빠져 다시 '신청대기'(단순 status='hold') 목록에만 보였다 — 관리자 입장에서는
-- "전자계약을 이미 보낸 건인데 왜 신청대기 목록에 있지?"로 오인하게 되는 문제였다.
--
-- Stephen 확정 정책: "전자계약을 보낸 건은 서명 여부와 무관하게 전부 '계약대기'"로 넓힌다.
-- 반대로 '신청대기' 탭은 "전자계약을 아직 보낸 적 없는 hold 예약"만 남도록 배타적으로
-- 만든다(두 탭이 서로 겹치지 않는 파티션이 되도록) — +page.server.ts에서 '신청대기' 칩
-- 선택 시에만 새 파라미터 p_exclude_contract_sent=true를 전달한다.
--
-- 변경:
--   ① p_require_contract_sent_unsigned의 WHERE 조건에서 "AND cs.signed_at IS NULL"을
--      제거 — 이제 "발송된 적이 있는가(sent_at IS NOT NULL)"만 확인한다. 파라미터 이름은
--      기존 호출부 호환을 위해 그대로 유지(CREATE OR REPLACE는 파라미터명 변경 불가 —
--      Postgres 제약)하되, 의미가 "미서명" 한정이 아니게 됐음을 주석으로 명시한다.
--   ② p_exclude_contract_sent(신규, DEFAULT NULL) 추가 — true일 때 "발송된 적이 없는"
--      (cs.sent_at IS NULL) 예약만 남긴다. '신청대기' 칩 전용.
--
-- 기존 호출부(RETURNS TABLE 등 나머지 전부) 무변경 — WHERE 절 2줄만 교체.

CREATE OR REPLACE FUNCTION public.get_rental_list(
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
  tax_amount numeric, delivery_fee integer, payment_status text, contract_id uuid,
  contract_status text, contract_pdf_url text, auto_signed_at timestamp with time zone,
  customer_signed_at timestamp with time zone, signing_sent_at timestamp with time zone,
  signing_token text, created_at timestamp with time zone,
  payment_confirmed_at timestamp with time zone, total_count bigint, dhero_status text,
  dhero_status_code smallint, dhero_return_book_id text, dhero_synced_at timestamp with time zone,
  tracking_number text
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
         up.full_name   ILIKE '%' || p_search || '%'
      OR up.email       ILIKE '%' || p_search || '%'
      OR p.name         ILIKE '%' || p_search || '%'
      OR p.product_code ILIKE '%' || p_search || '%'
    ))
    AND (p_date_from IS NULL OR rr.start_date >= p_date_from)
    AND (p_date_to   IS NULL OR rr.end_date   <= p_date_to)
    -- '계약대기' 칩(2026-09-08 확정 — 파라미터명은 하위호환 유지, 의미는 "발송된 적
    -- 있음"으로 확장. 서명 여부는 더 이상 조건에 포함하지 않는다):
    AND (p_require_contract_sent_unsigned IS NOT TRUE OR cs.sent_at IS NOT NULL)
    -- '신청대기' 칩(신규) — 전자계약을 아예 보낸 적 없는 예약만 남긴다(위 칩과 상호배타):
    AND (p_exclude_contract_sent IS NOT TRUE OR cs.sent_at IS NULL)
  ORDER BY rr.created_at DESC
  LIMIT p_per_page OFFSET (p_page - 1) * p_per_page;
END;
$function$;

-- ⚠️ 파라미터를 추가하면 Postgres가 "같은 함수 교체"가 아니라 새 오버로드로 인식해
-- CREATE OR REPLACE가 기존 10-param 버전을 남겨둔 채 11-param 버전을 별도로 추가한다 —
-- 그 결과 PostgREST/직접 SQL 호출 모두 "함수가 not unique"로 실패한다(실제 Stage 적용
-- 중 재현·확인). 이전 시그니처를 명시적으로 제거해야 한다.
DROP FUNCTION IF EXISTS public.get_rental_list(text,text,date,date,integer,integer,text[],text[],boolean,bigint);

-- ============================================================
-- ROLLBACK
-- ============================================================
-- 이전 정의(migration #??? 최초 정의 기준, p_exclude_contract_sent 파라미터 제거 +
-- p_require_contract_sent_unsigned를 "발송·미서명" 조건으로 복원)로 되돌리려면 이 파일의
-- WHERE 절 마지막 2줄을 아래로 교체 후 CREATE OR REPLACE 재실행:
--   AND (p_require_contract_sent_unsigned IS NOT TRUE
--        OR (cs.sent_at IS NOT NULL AND cs.signed_at IS NULL))
-- (p_exclude_contract_sent 파라미터 자체는 DEFAULT NULL이라 남겨둬도 호출부에 영향 없음 —
--  제거하려면 CREATE OR REPLACE로는 안 되므로 DROP FUNCTION 후 재생성 필요)
-- ============================================================
