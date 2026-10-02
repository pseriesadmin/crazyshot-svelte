-- Migration 618: get_rental_list "주문 1건 = 목록 1행" 묶음 모드(p_group_by_order) + 실행권한 service_role 전용 잠금
-- (2026-10-02)
--
-- 배경: 장바구니에 담은 여러 본상품은 주문(orders) 1건·예약코드 1개(Migration 400)로 묶이지만,
-- rental_reservations 행은 상품 수만큼 존재하고 get_rental_list가 예약 행 1개당 1행을 반환해
-- CMS 예약목록·대여현황이 같은 코드품번을 여러 행으로 쪼개 보여줬다(예약 235/236 사례).
-- Stephen 확정: 예약신청~계약·결제(예약목록)와 반출·반납(대여현황) 모두 "하나의 코드품번 = 하나의 행"으로
-- 시작해서 끝나야 한다. 재고 배정·QR 스캔은 상품별 예약 행 단위를 그대로 유지한다.
--
-- 변경:
--   ① 신규 파라미터 p_group_by_order boolean DEFAULT false — false(기본)면 기존과 완전히 동일한 동작
--      (간트차트·단건 조회 등 기존 호출부 무회귀). true면 같은 주문(order_items)의 예약들을 대표 1행으로 반환.
--   ② 대표 행 = 주문 내 활성(취소·만료 제외) 예약 중 MIN(예약 id). 활성 예약이 없으면 전체 MIN(id)(예약코드 대표
--      규칙 Migration 400과 같은 계열 — 취소된 상품이 대표가 돼 버튼·QR이 죽은 예약에 걸리는 것을 방지).
--      주문에 속하지 않은 예약은 자기 자신이 1행.
--   ③ 묶음 모드의 status = 주문 상태 = 취소·만료를 제외한 형제 중 "가장 덜 진행된" 단계(Q2 확정).
--      전부 취소·만료면 그 중 가장 앞선 순위(cancelled → expired 순)의 상태. 상태·검색·날짜 필터와 total_count/페이지네이션도 주문 단위.
--   ④ 반환 컬럼 3개 추가: own_status(대표 자신의 실제 상태) / order_item_count(주문 내 예약 수) /
--      status_mixed(활성 형제의 진행 단계가 서로 다른가 — "일부 진행" 표기용). 기존 컬럼은 전부 유지.
--   ⑤ 묶음 모드의 payment_confirmed_at은 주문 내 최대값(결제는 주문 단위 — 대표 행만 보고 판단하지 않도록).
--   ⑥ p_reservation_id + 묶음 모드: 비대표 형제 id를 줘도 그 주문의 대표 행을 반환(딥링크 호환).
--
-- ⚠️ 권한: Migration 263이 이 함수의 authenticated 실행권한을 회수했으나, 이후 Migration 471·472·473·480이
-- DROP/CREATE하면서 기본 ACL(anon·authenticated 포함)이 다시 열렸다(운영 DB 조회로 확인 — 비로그인도 고객
-- 이름·이메일·전화번호를 반환하는 이 함수를 호출 가능했음). 모든 호출부(cms/reservation·cms/rentals·
-- api/cms/reservations/[id]/detail·api/cms/dashboard/gantt-window·테스트)가 service_role 클라이언트이므로
-- 새 함수는 service_role 전용으로 명시 잠금한다(service-operations.md §23 패턴).
--
-- RETURNS TABLE과 파라미터 목록이 바뀌므로 CREATE OR REPLACE 불가 — DROP 후 CREATE.

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
  p_exclude_contract_sent boolean DEFAULT NULL::boolean,
  p_group_by_order boolean DEFAULT false
)
RETURNS TABLE(
  reservation_id bigint, reservation_code text, status text, rental_start date, rental_end date,
  rental_days integer, duration_type text, pickup_method text, return_method text,
  pickup_time text, return_time text, user_id uuid, customer_name text, customer_email text,
  customer_phone text, membership_grade text, credit_score smallint, product_id uuid,
  product_name text, product_code text, product_category text, product_image_url text,
  order_id bigint, order_key text, order_amount numeric, discount_amount numeric,
  coupon_discount_amount numeric, total_amount numeric, selected_points integer,
  tax_amount numeric, delivery_fee integer, order_delivery_fee integer, payment_status text,
  contract_id uuid, contract_status text, contract_pdf_url text,
  auto_signed_at timestamp with time zone, customer_signed_at timestamp with time zone,
  signing_sent_at timestamp with time zone, signing_token text, created_at timestamp with time zone,
  payment_confirmed_at timestamp with time zone, total_count bigint,
  dhero_status text, dhero_status_code smallint, dhero_return_book_id text,
  dhero_synced_at timestamp with time zone, tracking_number text,
  pickup_point_name text, return_point_name text,
  own_status text, order_item_count integer, status_mixed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(p_group_by_order, false) THEN
    -- ── 기존 동작(예약 1건 = 1행) — Migration 480 정의와 동일, own_status/order_item_count/status_mixed만 추가 ──
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
      pp1.name::TEXT                              AS pickup_point_name,
      pp2.name::TEXT                              AS return_point_name,
      rr.status                                   AS own_status,
      COALESCE((SELECT COUNT(*) FROM order_items oi5 WHERE oi5.order_id = oi.order_id), 1)::INTEGER
                                                  AS order_item_count,
      FALSE                                       AS status_mixed
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
  ELSE
    -- ── 묶음 모드(주문 1건 = 1행) ──
    -- base: 필터 없이 전 예약의 행 데이터(기존과 동일한 조인·표현식) + 주문 키·진행 단계 순위·필터 일치 여부.
    -- g: 주문(gk) 단위 윈도 집계(대표 id·주문 상태·혼합 여부·검색/날짜 일치·결제확인 시각).
    -- 최종 SELECT: 대표 행만 남기고 주문 상태 기준으로 상태 필터·페이지네이션을 적용한다.
    RETURN QUERY
    WITH base AS (
      SELECT
        rr.id                                       AS b_rid,
        rr.reservation_code                         AS b_reservation_code,
        rr.status                                   AS b_own_status,
        rr.start_date                               AS b_rental_start,
        rr.end_date                                 AS b_rental_end,
        rr.rental_days                              AS b_rental_days,
        rr.duration_type                            AS b_duration_type,
        rr.pickup_method                            AS b_pickup_method,
        rr.return_method                            AS b_return_method,
        rr.pickup_time                              AS b_pickup_time,
        rr.return_time                              AS b_return_time,
        up.id                                       AS b_user_id,
        up.full_name                                AS b_customer_name,
        up.email                                    AS b_customer_email,
        up.phone                                    AS b_customer_phone,
        up.membership_grade                         AS b_membership_grade,
        up.credit_score                             AS b_credit_score,
        rr.product_id                               AS b_product_id,
        p.name                                      AS b_product_name,
        p.product_code::TEXT                        AS b_product_code,
        p.category                                  AS b_product_category,
        (p.image_urls ->> 0)                        AS b_product_image_url,
        o.id                                        AS b_order_id,
        o.order_key                                 AS b_order_key,
        o.final_amount                              AS b_order_amount,
        o.discount_amount                           AS b_discount_amount,
        o.coupon_discount_amount                    AS b_coupon_discount_amount,
        o.total_amount                              AS b_total_amount,
        o.selected_points                           AS b_selected_points,
        o.tax_amount                                AS b_tax_amount,
        (SELECT pt.delivery_fee
         FROM payment_transactions pt
         WHERE pt.reservation_id = rr.id
            OR pt.reservation_id IN (
                 SELECT oi3.reservation_id FROM order_items oi3 WHERE oi3.order_id = oi.order_id
               )
         ORDER BY pt.created_at DESC
         LIMIT 1)                                   AS b_delivery_fee,
        o.delivery_fee                              AS b_order_delivery_fee,
        (SELECT pt2.status::TEXT
         FROM payment_transactions pt2
         WHERE pt2.reservation_id = rr.id
            OR pt2.reservation_id IN (
                 SELECT oi2.reservation_id FROM order_items oi2 WHERE oi2.order_id = oi.order_id
               )
         ORDER BY pt2.created_at DESC
         LIMIT 1)                                   AS b_payment_status,
        c.id                                        AS b_contract_id,
        c.status                                    AS b_contract_status,
        c.document_url                              AS b_contract_pdf_url,
        c.signed_at                                 AS b_auto_signed_at,
        cs.signed_at                                AS b_customer_signed_at,
        cs.sent_at                                  AS b_signing_sent_at,
        cs.token::TEXT                              AS b_signing_token,
        rr.created_at                               AS b_created_at,
        rr.payment_confirmed_at                     AS b_payment_confirmed_at,
        rr.dhero_status                             AS b_dhero_status,
        rr.dhero_status_code                        AS b_dhero_status_code,
        rr.dhero_return_book_id                     AS b_dhero_return_book_id,
        rr.dhero_synced_at                          AS b_dhero_synced_at,
        rr.tracking_number                          AS b_tracking_number,
        pp1.name::TEXT                              AS b_pickup_point_name,
        pp2.name::TEXT                              AS b_return_point_name,
        COALESCE(oi.order_id::TEXT, 'r' || rr.id::TEXT) AS gk,
        (rr.status NOT IN ('cancelled', 'expired'))     AS is_active,
        CASE rr.status
          WHEN 'draft' THEN -1 WHEN 'pending' THEN 0 WHEN 'hold' THEN 1 WHEN 'confirmed' THEN 2
          WHEN 'shipped' THEN 3 WHEN 'in_use' THEN 4 WHEN 'return_requested' THEN 5
          WHEN 'returned' THEN 6 WHEN 'completed' THEN 7 WHEN 'damage_claimed' THEN 8
          WHEN 'cancelled' THEN 90 WHEN 'expired' THEN 91 ELSE 50
        END                                             AS rk,
        (p_search IS NULL OR (
             up.full_name        ILIKE '%' || p_search || '%'
          OR up.email            ILIKE '%' || p_search || '%'
          OR p.name               ILIKE '%' || p_search || '%'
          OR p.product_code       ILIKE '%' || p_search || '%'
          OR rr.reservation_code  ILIKE '%' || p_search || '%'
        ))                                              AS m_search,
        ((p_date_from IS NULL OR rr.start_date >= p_date_from)
          AND (p_date_to IS NULL OR rr.end_date <= p_date_to)) AS m_date
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
      -- 단건(p_reservation_id) 조회는 그 예약이 속한 주문만 계산(전 예약 윈도 집계 회피 — 상세 API·채팅카드 클릭 경로)
      WHERE p_reservation_id IS NULL
         OR rr.id = p_reservation_id
         OR rr.id IN (
              SELECT oi8.reservation_id FROM order_items oi8
              WHERE oi8.order_id = (SELECT oi7.order_id FROM order_items oi7 WHERE oi7.reservation_id = p_reservation_id LIMIT 1)
            )
    ),
    g AS (
      SELECT
        base.*,
        COUNT(*) OVER (PARTITION BY base.gk)                         AS g_n,
        COALESCE(MIN(base.b_rid) FILTER (WHERE base.is_active) OVER (PARTITION BY base.gk),
                 MIN(base.b_rid) OVER (PARTITION BY base.gk))        AS g_min_id,
        FIRST_VALUE(base.b_own_status) OVER (
          PARTITION BY base.gk ORDER BY (NOT base.is_active), base.rk, base.b_rid
        )                                                            AS g_status,
        (MIN(base.rk) FILTER (WHERE base.is_active) OVER (PARTITION BY base.gk)
          IS DISTINCT FROM
         MAX(base.rk) FILTER (WHERE base.is_active) OVER (PARTITION BY base.gk)) AS g_mixed,
        BOOL_OR(base.m_search) OVER (PARTITION BY base.gk)           AS g_search,
        BOOL_OR(base.m_date) OVER (PARTITION BY base.gk)             AS g_date,
        MAX(base.b_payment_confirmed_at) OVER (PARTITION BY base.gk) AS g_paid_at
      FROM base
    )
    SELECT
      g.b_rid                  AS reservation_id,
      g.b_reservation_code     AS reservation_code,
      g.g_status               AS status,
      g.b_rental_start         AS rental_start,
      g.b_rental_end           AS rental_end,
      g.b_rental_days          AS rental_days,
      g.b_duration_type        AS duration_type,
      g.b_pickup_method        AS pickup_method,
      g.b_return_method        AS return_method,
      g.b_pickup_time          AS pickup_time,
      g.b_return_time          AS return_time,
      g.b_user_id              AS user_id,
      g.b_customer_name        AS customer_name,
      g.b_customer_email       AS customer_email,
      g.b_customer_phone       AS customer_phone,
      g.b_membership_grade     AS membership_grade,
      g.b_credit_score         AS credit_score,
      g.b_product_id           AS product_id,
      g.b_product_name         AS product_name,
      g.b_product_code         AS product_code,
      g.b_product_category     AS product_category,
      g.b_product_image_url    AS product_image_url,
      g.b_order_id             AS order_id,
      g.b_order_key            AS order_key,
      g.b_order_amount         AS order_amount,
      g.b_discount_amount      AS discount_amount,
      g.b_coupon_discount_amount AS coupon_discount_amount,
      g.b_total_amount         AS total_amount,
      g.b_selected_points      AS selected_points,
      g.b_tax_amount           AS tax_amount,
      g.b_delivery_fee         AS delivery_fee,
      g.b_order_delivery_fee   AS order_delivery_fee,
      g.b_payment_status       AS payment_status,
      g.b_contract_id          AS contract_id,
      g.b_contract_status      AS contract_status,
      g.b_contract_pdf_url     AS contract_pdf_url,
      g.b_auto_signed_at       AS auto_signed_at,
      g.b_customer_signed_at   AS customer_signed_at,
      g.b_signing_sent_at      AS signing_sent_at,
      g.b_signing_token        AS signing_token,
      g.b_created_at           AS created_at,
      g.g_paid_at              AS payment_confirmed_at,
      COUNT(*) OVER ()         AS total_count,
      g.b_dhero_status         AS dhero_status,
      g.b_dhero_status_code    AS dhero_status_code,
      g.b_dhero_return_book_id AS dhero_return_book_id,
      g.b_dhero_synced_at      AS dhero_synced_at,
      g.b_tracking_number      AS tracking_number,
      g.b_pickup_point_name    AS pickup_point_name,
      g.b_return_point_name    AS return_point_name,
      g.b_own_status           AS own_status,
      g.g_n::INTEGER           AS order_item_count,
      COALESCE(g.g_mixed, FALSE) AS status_mixed
    FROM g
    WHERE g.b_rid = g.g_min_id
      AND (p_status IS NULL OR g.g_status = p_status)
      AND (p_include_statuses IS NULL OR g.g_status = ANY(p_include_statuses))
      AND (p_exclude_statuses IS NULL OR NOT (g.g_status = ANY(p_exclude_statuses)))
      AND (p_reservation_id IS NULL
           OR g.gk = (SELECT g2.gk FROM g g2 WHERE g2.b_rid = p_reservation_id LIMIT 1))
      AND g.g_search
      AND g.g_date
      AND (p_require_contract_sent_unsigned IS NOT TRUE OR g.b_signing_sent_at IS NOT NULL)
      AND (p_exclude_contract_sent IS NOT TRUE OR g.b_signing_sent_at IS NULL)
    ORDER BY g.b_created_at DESC
    LIMIT p_per_page OFFSET (p_page - 1) * p_per_page;
  END IF;
END;
$function$;

-- 권한: 서버(service_role) 전용 — DROP/CREATE로 초기화된 기본 ACL(anon·authenticated 포함)을 명시적으로 회수한다.
REVOKE ALL ON FUNCTION public.get_rental_list(text,text,date,date,integer,integer,text[],text[],boolean,bigint,boolean,boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_rental_list(text,text,date,date,integer,integer,text[],text[],boolean,bigint,boolean,boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_rental_list(text,text,date,date,integer,integer,text[],text[],boolean,bigint,boolean,boolean) TO service_role;

-- ============================================================
-- ROLLBACK: Migration 480(저장소 20260910020000_480_*.sql) 정의로 DROP/CREATE 후 필요 시 권한 재설정.
-- ============================================================
