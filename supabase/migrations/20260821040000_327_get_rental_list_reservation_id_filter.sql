-- ============================================================
-- Migration 327: get_rental_list — p_reservation_id 단건 필터 파라미터 추가
--
-- 배경 (2026-08-21, Stephen 요청): CMS 채팅(/cms/chat) 대화카드의 "예약 상세 보기"/
-- "예약 신청 확인" CTA를 관리자가 클릭했을 때, 지금까지는 <iframe>으로 /cms/reservation
-- 페이지 전체(목록·필터 툴바·GNB 포함)를 통째로 불러와 보여주고 있었다. 요구사항은
-- "RentalDetailPanel 레이아웃만" 보여주는 것이었는데, iframe은 URL 단위로만 로드 가능해
-- 페이지 안의 컴포넌트 하나만 골라 보여줄 방법이 없어 이 방식으로는 구조적으로 요구사항을
-- 충족할 수 없었다(설계 오류, 세션 대화로 확인됨).
--
-- 해결: RentalDetailPanel.svelte를 iframe 없이 모달 안에 직접 마운트하는 방식으로 전환한다.
-- 이 컴포넌트는 row prop으로 예약 1건의 상세 데이터(RentalListRow 형태 — 고객정보·결제정보·
-- 계약서 정보 포함)를 요구하는데, 이 shape을 만드는 get_rental_list RPC는 지금까지 "목록"
-- 조회 전용으로만 설계돼 있어 이름/이메일/상품명/품번으로만 검색 가능하고 "이 예약 1건만
-- 정확히" 가져오는 필터가 없었다(예약코드로도 검색 안 됨, p_search 조건 참고). 여러 건이
-- 검색될 수 있는 문자열 검색 대신, 이미 알고 있는 정확한 reservation_id로 정확히 1건만
-- 가져오도록 필터 파라미터를 추가한다.
--
-- 변경 범위: 함수 시그니처 끝에 p_reservation_id(기본값 NULL, 하위호환) 파라미터 1개 추가 +
-- WHERE 절에 조건 1개 추가. 그 외 컬럼·JOIN·정렬·페이지네이션 로직은 Migration 314(현재
-- 배포본) 기준 100% 동일 유지. RETURNS TABLE 시그니처(반환 컬럼)는 변경 없음.
--
-- ⚠️ CREATE OR REPLACE 대신 DROP 후 CREATE 사용: 파라미터 개수가 9개→10개로 바뀌면
-- PostgreSQL이 이를 "다른 시그니처"로 취급해 CREATE OR REPLACE가 기존 9-param 함수를
-- 대체하지 않고 10-param 오버로드를 별도로 추가한다 — PostgREST가 named-parameter 호출 시
-- 어느 오버로드를 쓸지 몰라 PGRST203(오버로드 모호성) 에러가 재발한다(Migration 314와 동일한
-- 이유로 동일한 DROP+CREATE 패턴 적용). 기존 8-param 호출부(cms/reservation·cms/rentals
-- +page.server.ts)는 신규 파라미터가 DEFAULT NULL이라 전혀 영향 없음 — 새 파라미터를
-- 넘기지 않는 한 이전과 100% 동일하게 동작.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER, TEXT[], TEXT[], BOOLEAN);

CREATE FUNCTION public.get_rental_list(
  p_status            TEXT    DEFAULT NULL,
  p_search            TEXT    DEFAULT NULL,
  p_date_from         DATE    DEFAULT NULL,
  p_date_to           DATE    DEFAULT NULL,
  p_page              INTEGER DEFAULT 1,
  p_per_page          INTEGER DEFAULT 30,
  p_include_statuses  TEXT[]  DEFAULT NULL,
  p_exclude_statuses  TEXT[]  DEFAULT NULL,
  p_require_contract_sent_unsigned BOOLEAN DEFAULT NULL,
  p_reservation_id    BIGINT  DEFAULT NULL
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
    -- 단건 조회: reservation_id가 주어지면 다른 필터와 무관하게 정확히 그 예약 1건만
    -- (status/exclude/include 필터로 인해 걸러지지 않도록, id 조건은 다른 조건들과 독립적으로
    -- AND 결합 — status 등이 안 맞으면 여전히 0건이 반환될 수 있으므로 호출부는 status를
    -- 비워서(전체) 호출해야 한다는 점은 기존과 동일)
    AND (p_reservation_id IS NULL OR rr.id = p_reservation_id)
  ORDER BY rr.created_at DESC
  LIMIT p_per_page OFFSET (p_page - 1) * p_per_page;
END;
$$;

-- named-parameter 호출부(기존 9개 파라미터만 넘기는 /cms/reservation·/cms/rentals 호출 포함)는
-- 신규 파라미터가 DEFAULT NULL이라 그대로 하위호환. 새 시그니처 기준으로 ACL 명시 재선언
-- (Migration 284·313·314와 동일 관례).
REVOKE ALL ON FUNCTION public.get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER, TEXT[], TEXT[], BOOLEAN, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER, TEXT[], TEXT[], BOOLEAN, BIGINT) TO service_role;

-- ============================================================
-- ROLLBACK: 이전 버전(Migration 314, 9-param)으로 복원하려면
--   DROP FUNCTION IF EXISTS public.get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER, TEXT[], TEXT[], BOOLEAN, BIGINT);
--   그 후 supabase/migrations/20260820030000_314_get_rental_list_contract_pending_filter.sql
--   본문(CREATE FUNCTION ~ GRANT까지)을 재실행하면 됨.
-- ============================================================
