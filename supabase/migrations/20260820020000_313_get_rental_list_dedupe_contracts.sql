-- ============================================================
-- Migration 313: get_rental_list — 예약 1건당 계약서(contracts) 다건 존재 시 방어처리
--
-- 배경 (2026-08-20 발견):
--   get_rental_list는 "예약 1건당 계약서는 항상 최대 1건"이라는 전제로
--   `LEFT JOIN contracts c ON c.reservation_id = rr.id`를 사용해왔다(contract.md —
--   계약 발행은 idempotent, 기존 있으면 재사용). 그런데 Stage DB에 QA 검증 중 생성된
--   테스트 계약서가 예약 1건(reservation_id=2150)에 2건 남아있었고, 이 LEFT JOIN이
--   그대로 2개 행을 반환하면서 CMS 목록(/cms/reservation)의 `{#each ... (row.reservation_id)}`가
--   Svelte `each_key_duplicate`로 크래시했다(GNB를 포함한 루트 레이아웃 전체가 죽는 형태로
--   확대됨 — 프로젝트 전역에 +error.svelte가 없어 렌더링 예외가 앱 루트까지 전파).
--
--   해당 중복 테스트 데이터 자체는 이 마이그레이션과 별개로 정리했지만(오래된 쪽 삭제),
--   "예약 1건 : 계약서 1건" 전제가 향후 버그·경쟁상황 등으로 다시 깨질 가능성 자체는
--   남아있으므로 RPC 레벨에서도 방어적으로 고친다 — 예약당 가장 최근(created_at DESC)
--   계약서 1건만 가져오도록 LATERAL 서브쿼리로 교체.
--
-- 변경 범위: contracts LEFT JOIN → LEFT JOIN LATERAL(최신 1건) 로 교체.
--   그 외 컬럼·WHERE·정렬·페이지네이션 로직은 Migration 284(현재 배포본) 기준 100% 동일 유지.
--   RETURNS TABLE 시그니처 변경 없음 — CREATE OR REPLACE로 충분(DROP 불필요).
-- ============================================================

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
  ORDER BY rr.created_at DESC
  LIMIT p_per_page OFFSET (p_page - 1) * p_per_page;
END;
$$;

-- CREATE OR REPLACE는 시그니처가 동일하므로 기존 ACL(REVOKE/GRANT)이 유지되지만,
-- 프로젝트 관례대로 명시적으로 재선언해 의도를 고정한다(Migration 284와 동일 패턴).
REVOKE ALL ON FUNCTION public.get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER, TEXT[], TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER, TEXT[], TEXT[]) TO service_role;
