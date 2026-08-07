-- Migration 201: get_rental_list — 화면별 상태 스코프(라이프사이클/예약단계) SQL 레벨 필터 추가
--
-- 배경(2026-08-07 /cms/rentals ↔ /cms/reservation 정합성 감사):
--   두 화면 모두 get_rental_list를 호출한 뒤, 반환된 30건을 status 소속
--   (RENTAL_STATUSES / RENTAL_VIEW_STATUSES)으로 클라이언트에서 다시 걸러 표시한다.
--   p_status(상태칩 단일 필터)가 비어 있는 "전체" 보기(두 화면의 기본 진입 상태)에서는
--   LIMIT/OFFSET과 total_count(COUNT(*) OVER())가 이 화면 스코프 구분과 무관하게 "전체 예약"
--   기준으로 계산돼:
--     · "총 N건" 배지가 실제 표시 건수보다 부풀려짐
--     · 페이지마다 실제 표시 건수가 0~29건으로 들쭉날쭉
--     · 페이지네이션 페이지 수가 실제 목록과 어긋남(빈 페이지 또는 조기 종료)
--   이 문제를 일으켰다.
--
-- 조치: p_include_statuses / p_exclude_statuses(둘 다 신규 trailing 파라미터, DEFAULT NULL —
--   기존 호출부 하위호환 유지)를 WHERE 절에 추가해 LIMIT/OFFSET/COUNT(*) OVER()가 화면
--   스코프까지 반영된 뒤 계산되도록 한다.
--     · /cms/rentals(대여현황)   → p_include_statuses = 대여 라이프사이클 7종
--     · /cms/reservation(예약목록) → p_exclude_statuses = 위 7종 + draft
--   함수 본체의 나머지 SELECT 목록·조인·기존 필터(p_status/p_search/p_date_from/p_date_to)는
--   현재 배포본(154_duration_type_and_delivery_fee 반영分)과 동일 — 신규 조건 2개만 추가.

CREATE OR REPLACE FUNCTION public.get_rental_list(
  p_status            TEXT    DEFAULT NULL,
  p_search            TEXT    DEFAULT NULL,
  p_date_from         DATE    DEFAULT NULL,
  p_date_to           DATE    DEFAULT NULL,
  p_page              INTEGER DEFAULT 1,
  p_per_page          INTEGER DEFAULT 30,
  p_include_statuses  TEXT[]  DEFAULT NULL,
  p_exclude_statuses  TEXT[]  DEFAULT NULL
)
RETURNS TABLE(
  reservation_id      BIGINT,
  reservation_code    TEXT,
  status               TEXT,
  rental_start         DATE,
  rental_end           DATE,
  rental_days          INTEGER,
  duration_type        TEXT,
  pickup_method        TEXT,
  return_method        TEXT,
  pickup_time          TEXT,
  return_time          TEXT,
  user_id              UUID,
  customer_name        TEXT,
  customer_email       TEXT,
  customer_phone       TEXT,
  membership_grade     TEXT,
  credit_score         SMALLINT,
  product_id           UUID,
  product_name         TEXT,
  product_code         TEXT,
  product_category     TEXT,
  product_image_url    TEXT,
  order_id             BIGINT,
  order_key            TEXT,
  order_amount         NUMERIC,
  discount_amount      NUMERIC,
  tax_amount           NUMERIC,
  delivery_fee         INTEGER,
  payment_status       TEXT,
  contract_id          UUID,
  contract_status      TEXT,
  contract_pdf_url     TEXT,
  auto_signed_at       TIMESTAMP WITH TIME ZONE,
  customer_signed_at   TIMESTAMP WITH TIME ZONE,
  signing_sent_at      TIMESTAMP WITH TIME ZONE,
  signing_token        TEXT,
  created_at           TIMESTAMP WITH TIME ZONE,
  total_count          BIGINT
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
  ORDER BY rr.created_at DESC
  LIMIT p_per_page OFFSET (p_page - 1) * p_per_page;
END;
$$;
