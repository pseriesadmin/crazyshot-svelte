-- Migration 369: get_rental_list — contract_signings 중복 제거
--
-- 배경: /cms/reservation 화면에서 Svelte each_key_duplicate 런타임 에러 발생
--   ("Keyed each block has duplicate key `2655` at indexes 5 and 6").
--
-- 원인: contracts는 이미 Migration 313에서 LEFT JOIN LATERAL(ORDER BY created_at DESC
--   LIMIT 1)로 예약당 1건만 남도록 중복제거됐는데, 바로 아래 contract_signings는
--   `LEFT JOIN contract_signings cs ON cs.contract_id = c.id`로 단순 JOIN만 되어 있어
--   같은 계약서가 여러 번 재전송돼 contract_signings 행이 2건 이상이면 그 예약의 행이
--   그 개수만큼 그대로 늘어남. Stage DB 직접 조회로 실제 재현 확인:
--   예약 2655의 contracts는 1건인데 그 contract_id에 연결된 contract_signings는 3건
--   (재전송 이력) — 결과적으로 get_rental_list가 reservation_id=2655 행을 3번 반환해
--   cms/reservation/+page.svelte의 {#each data.rentals as row (row.reservation_id)}
--   키드 each 블록에서 중복 키 에러 발생. order_items는 Migration 280에서 예약당 부분
--   유니크 인덱스가 이미 걸려 있어 원인 아님을 확인.
--
-- 수정: contract_signings JOIN을 contracts와 동일한 LATERAL 패턴으로 전환 — 계약서당
--   가장 최근 재전송 1건(sent_at DESC)만 남긴다. 재전송 이력이 여러 건이어도 화면에는
--   "현재 유효한 최신 서명 상태"만 보여주는 것이 올바른 비즈니스 의미(오래된 재전송
--   기록은 이미 대체된 과거 상태) — p_require_contract_sent_unsigned 필터도 자연히
--   "최신 재전송 기준 미서명 여부"로 정정됨(과거엔 여러 signings 중 하나라도 조건에
--   맞으면 매칭되는 부정확한 상태였음).
--
-- 반환 타입(컬럼 구성) 변경 없음 — CREATE OR REPLACE만으로 충분(Migration 344와 달리
-- DROP 불필요, 쿼리 본문만 수정).
--
-- 롤백: 이 파일 이전 버전(Migration 344)의 함수 본문으로 CREATE OR REPLACE 재실행.

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
  -- 2026-08-28(Migration 369): contract_signings도 contracts와 동일하게 LATERAL로
  -- 중복제거 — 같은 계약서가 여러 번 재전송됐어도 가장 최근 1건(sent_at DESC)만 반영
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
