-- ============================================================
-- Migration 314: get_rental_list — "계약대기"(계약 발송됨 + 미서명) 필터 파라미터 추가
--
-- 배경 (2026-08-20, Stephen 요청): 예약현황(/cms/reservation) 필터칩에 '신청대기' 우측으로
-- '계약대기'를 신설한다 — status='hold'인 예약 중, 전자계약이 이미 발송됐지만(contract_
-- signings.sent_at IS NOT NULL) 아직 고객 서명이 완료되지 않은(signed_at IS NULL) 건만
-- 골라 보여주는 필터. 기존 status 기준 필터(p_status)만으로는 이 조건을 표현할 수 없어
-- 신규 파라미터를 추가한다.
--
-- 변경 범위: 함수 시그니처 끝에 p_require_contract_sent_unsigned(기본값 NULL, 하위호환)
-- 파라미터 1개 추가 + WHERE 절에 조건 1개 추가. 그 외 컬럼·JOIN·정렬·페이지네이션 로직은
-- Migration 313(현재 배포본, contracts LATERAL dedupe 포함) 기준 100% 동일 유지.
-- RETURNS TABLE 시그니처(반환 컬럼)는 변경 없음.
--
-- ⚠️ CREATE OR REPLACE 대신 DROP 후 CREATE 사용: 파라미터 개수가 8개→9개로 바뀌면
-- PostgreSQL은 이를 "다른 시그니처"로 취급해 CREATE OR REPLACE가 기존 8-param 함수를
-- 대체하지 않고 9-param 오버로드를 별도로 추가한다 — PostgREST가 named-parameter 호출 시
-- 두 오버로드 중 무엇을 쓸지 모호해 PGRST203(오버로드 모호성) 에러가 재발한다(products.md
-- generate_product_code 사례와 동일 원인). Migration 284가 컬럼 추가 시 썼던 것과 동일한
-- DROP+CREATE 패턴을 파라미터 추가에도 동일하게 적용.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER, TEXT[], TEXT[]);

CREATE FUNCTION public.get_rental_list(
  p_status            TEXT    DEFAULT NULL,
  p_search            TEXT    DEFAULT NULL,
  p_date_from         DATE    DEFAULT NULL,
  p_date_to           DATE    DEFAULT NULL,
  p_page              INTEGER DEFAULT 1,
  p_per_page          INTEGER DEFAULT 30,
  p_include_statuses  TEXT[]  DEFAULT NULL,
  p_exclude_statuses  TEXT[]  DEFAULT NULL,
  p_require_contract_sent_unsigned BOOLEAN DEFAULT NULL
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
  total_count                     BIGINT
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
    rr.payment_confirmed_at                     AS payment_confirmed_at,
    COUNT(*) OVER ()                            AS total_count
  FROM rental_reservations rr
  JOIN products p ON p.id = rr.product_id
  JOIN user_profiles up ON up.id = rr.user_id
  LEFT JOIN order_items oi ON oi.reservation_id = rr.id
  LEFT JOIN orders o ON o.id = oi.order_id
  -- 예약 1건당 계약서는 정상적으로는 최대 1건이지만(idempotent 발행), 데이터 이상으로
  -- 여러 건이 남아있어도 목록 쿼리가 행을 중복 반환하지 않도록 최신 1건만 방어적으로 채택
  LEFT JOIN LATERAL (
    SELECT c2.*
    FROM contracts c2
    WHERE c2.reservation_id = rr.id
    ORDER BY c2.created_at DESC
    LIMIT 1
  ) c ON true
  LEFT JOIN contract_signings cs ON cs.contract_id = c.id
  WHERE (p_status IS NULL OR rr.status = p_status)
    AND (p_include_statuses IS NULL OR rr.status = ANY(p_include_statuses))
    AND (p_exclude_statuses IS NULL OR NOT (rr.status = ANY(p_exclude_statuses)))
    AND (p_search IS NULL OR (
         up.full_name   ILIKE '%' || p_search || '%'
      OR up.email       ILIKE '%' || p_search || '%'
      OR p.name         ILIKE '%' || p_search || '%'
      OR p.product_code ILIKE '%' || p_search || '%'
    ))
    AND (p_date_from IS NULL OR rr.start_date >= p_date_from)
    AND (p_date_to   IS NULL OR rr.end_date   <= p_date_to)
    -- '계약대기' 필터: 계약이 발송됐지만(sent_at 있음) 아직 서명되지 않은(signed_at 없음) 건만
    AND (p_require_contract_sent_unsigned IS NOT TRUE
         OR (cs.sent_at IS NOT NULL AND cs.signed_at IS NULL))
  ORDER BY rr.created_at DESC
  LIMIT p_per_page OFFSET (p_page - 1) * p_per_page;
END;
$$;

-- named-parameter 호출부(기존 8개 파라미터만 넘기는 /cms/reservation·/cms/rentals 호출 포함)는
-- 신규 파라미터가 DEFAULT NULL이라 그대로 하위호환. 새 시그니처 기준으로 ACL 명시 재선언
-- (Migration 284·313과 동일 관례).
REVOKE ALL ON FUNCTION public.get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER, TEXT[], TEXT[], BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER, TEXT[], TEXT[], BOOLEAN) TO service_role;
