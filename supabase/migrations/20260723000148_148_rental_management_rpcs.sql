-- Migration 148: 대여 관리 조회 RPC 2종
--   A. get_user_rental_stats  — /account 페이지 대여 통계 (rentalStats TODO 교체)
--   B. get_active_rentals     — /cms/rentals 대여현황 카드 조회 (confirmed+ 상태만)

-- ─────────────────────────────────────────────────────────────
-- A. get_user_rental_stats
--    사용자 대여 통계 카운트 (account 페이지용)
--    authenticated: p_user_id가 auth.uid()와 다르면 접근 차단
--    service_role: p_user_id 제한 없음 (auth.uid() = NULL)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_user_rental_stats(
  p_user_id UUID
)
RETURNS TABLE(
  total_count    BIGINT,
  active_count   BIGINT,
  shipping_count BIGINT,
  done_count     BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- service_role 호출 시 auth.uid() = NULL → 스킵
  IF auth.uid() IS NOT NULL AND p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE status NOT IN ('hold', 'cancelled'))::BIGINT AS total_count,
    COUNT(*) FILTER (WHERE status = 'in_use')::BIGINT                  AS active_count,
    COUNT(*) FILTER (WHERE status = 'shipped')::BIGINT                 AS shipping_count,
    COUNT(*) FILTER (WHERE status IN ('returned', 'completed'))::BIGINT AS done_count
  FROM rental_reservations
  WHERE user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_rental_stats(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_rental_stats(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- B. get_active_rentals
--    confirmed 이상 예약 + rental_action_logs 포함 조회
--    CMS /cms/rentals 대여현황 탭 전용 (service_role only)
--    주의: rental_action_logs 테이블은 migration #149에서 생성됨
--          PL/pgSQL 함수는 런타임 바인딩이므로 테이블 없이 생성 가능
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_active_rentals(
  p_page     INTEGER DEFAULT 1,
  p_search   TEXT    DEFAULT NULL,
  p_status   TEXT    DEFAULT NULL,
  p_per_page INTEGER DEFAULT 20
)
RETURNS TABLE(
  reservation_id    BIGINT,
  reservation_code  TEXT,
  status            TEXT,
  rental_start      DATE,
  rental_end        DATE,
  rental_days       INTEGER,
  pickup_method     TEXT,
  return_method     TEXT,
  pickup_time       TEXT,
  return_time       TEXT,
  user_id           UUID,
  customer_name     TEXT,
  customer_phone    TEXT,
  product_name      TEXT,
  product_code      TEXT,
  product_category  TEXT,
  product_image_url TEXT,
  action_logs       JSONB,
  total_count       BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    rr.id                                                      AS reservation_id,
    COALESCE(rr.reservation_code,
      'CZ-' || LPAD(rr.id::TEXT, 5, '0'))                     AS reservation_code,
    rr.status::TEXT                                            AS status,
    rr.start_date::DATE                                        AS rental_start,
    rr.end_date::DATE                                          AS rental_end,
    rr.rental_days                                             AS rental_days,
    rr.pickup_method::TEXT                                     AS pickup_method,
    rr.return_method::TEXT                                     AS return_method,
    rr.pickup_time                                             AS pickup_time,
    rr.return_time                                             AS return_time,
    rr.user_id                                                 AS user_id,
    up.full_name                                               AS customer_name,
    up.phone                                                   AS customer_phone,
    p.name                                                     AS product_name,
    p.product_code::TEXT                                       AS product_code,
    p.category::TEXT                                           AS product_category,
    (p.image_urls ->> 0)                                       AS product_image_url,
    COALESCE(
      (SELECT jsonb_agg(
          jsonb_build_object(
            'type',         ral.action_type,
            'performed_at', ral.performed_at,
            'note',         ral.note
          )
          ORDER BY ral.performed_at
        )
        FROM rental_action_logs ral
        WHERE ral.reservation_id = rr.id
      ),
      '[]'::JSONB
    )                                                          AS action_logs,
    COUNT(*) OVER ()                                           AS total_count
  FROM rental_reservations rr
  JOIN products        p  ON p.id  = rr.product_id
  JOIN user_profiles   up ON up.id = rr.user_id
  WHERE rr.status NOT IN ('hold', 'cancelled')
    AND (p_status IS NULL OR rr.status::TEXT = p_status)
    AND (
      p_search IS NULL
      OR up.full_name   ILIKE '%' || p_search || '%'
      OR p.name         ILIKE '%' || p_search || '%'
      OR p.product_code ILIKE '%' || p_search || '%'
    )
  ORDER BY
    CASE rr.status::TEXT
      WHEN 'confirmed'         THEN 1
      WHEN 'shipped'           THEN 2
      WHEN 'in_use'            THEN 3
      WHEN 'return_requested'  THEN 4
      WHEN 'returned'          THEN 5
      WHEN 'completed'         THEN 6
      ELSE 7
    END,
    rr.start_date ASC
  LIMIT  p_per_page
  OFFSET (p_page - 1) * p_per_page;
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_rentals(INTEGER, TEXT, TEXT, INTEGER) FROM PUBLIC;
-- service_role 전용 (CMS 서버사이드 admin 클라이언트 호출)
