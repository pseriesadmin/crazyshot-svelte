-- Migration 284: 계약서 서명 완료를 예약승인(confirmed) 필수조건으로 게이팅
--
-- 배경: reservation_id 1629(CS2608475)를 추적한 결과, hold 생성 1.2초 만에 계약서 발송·서명
-- 없이 목업결제(confirm-mock)만으로 자동 confirmed 전환된 것을 확인했다. Stage DB 실측 결과
-- confirmed 이상 예약 30건 중 28건(93%)이 계약서를 아예 발송한 적이 없다. 이는
-- rental-lifecycle.md가 2026-07-23부터 "❌ 미구현"으로 문서화해온 갭이 재현된 것이다.
--
-- Stephen 확정 정책: 모든 예약에 계약서·서명을 필수로 게이팅하되, 관리자 수동 "승인하기"
-- 버튼(approveReservation, update_reservation_status 직접 호출)은 계약 여부와 무관하게
-- 즉시 승인 가능한 우회 기능으로 그대로 유지한다.
--
-- 설계: status enum에 새 값을 추가하지 않는다. rental_reservations.payment_confirmed_at
-- (신규 TIMESTAMPTZ 컬럼)만으로 "결제완료" 시각을 기록하고, "결제완료 AND 계약서명완료"
-- 둘 다 충족했을 때만 신규 RPC try_confirm_reservation이 기존 update_reservation_status를
-- 호출해 hold→confirmed 전이시킨다. update_reservation_status 자체의 상태전이 CASE문은
-- 변경하지 않는다(중복 재검증 로직 없음).

-- ============================================================
-- 1) payment_confirmed_at 컬럼 추가
-- ============================================================
ALTER TABLE public.rental_reservations
  ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMPTZ NULL;

-- ============================================================
-- 2) try_confirm_reservation — 결제완료 AND 계약서명완료 둘 다 충족해야 hold→confirmed
--    멱등 — 조건 미충족 시 아무것도 바꾸지 않고 FALSE 반환. 여러 번 호출해도 안전.
-- ============================================================
CREATE OR REPLACE FUNCTION public.try_confirm_reservation(p_reservation_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status               TEXT;
  v_payment_confirmed_at TIMESTAMPTZ;
  v_signed                BOOLEAN;
  v_result                JSONB;
BEGIN
  SELECT status, payment_confirmed_at INTO v_status, v_payment_confirmed_at
  FROM public.rental_reservations
  WHERE id = p_reservation_id;

  IF NOT FOUND OR v_status IS DISTINCT FROM 'hold' OR v_payment_confirmed_at IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.contracts c
    JOIN public.contract_signings cs ON cs.contract_id = c.id
    WHERE c.reservation_id = p_reservation_id
      AND cs.signed_at IS NOT NULL
  ) INTO v_signed;

  IF NOT v_signed THEN
    RETURN FALSE;
  END IF;

  v_result := public.update_reservation_status(p_reservation_id, 'confirmed');
  RETURN COALESCE((v_result ->> 'ok')::boolean, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.try_confirm_reservation(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_confirm_reservation(BIGINT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_confirm_reservation(BIGINT) TO service_role;

-- ============================================================
-- 3) mark_reservation_payment_confirmed — 결제완료 확정 경로(confirm-mock/실결제)가 호출
--    payment_confirmed_at을 기록한 뒤 즉시 try_confirm_reservation을 시도한다.
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_reservation_payment_confirmed(p_reservation_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.rental_reservations
  SET payment_confirmed_at = NOW()
  WHERE id = p_reservation_id
    AND payment_confirmed_at IS NULL;

  RETURN public.try_confirm_reservation(p_reservation_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_reservation_payment_confirmed(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_reservation_payment_confirmed(BIGINT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_reservation_payment_confirmed(BIGINT) TO service_role;

-- ============================================================
-- 4) confirm_payment_and_update_reservation 리팩터링 — 실결제(Toss) 경로.
--    현재 S1-M3 BLOCKED로 미사용이나 코드는 존재 — 나중에 Toss 연동이 열렸을 때 이 갭이
--    재발하지 않도록 이번에 함께 정리한다(리스크 낮음 — 비활성 경로). 파라미터 시그니처
--    (순서·타입·기본값)는 절대 변경하지 않는다 — CREATE OR REPLACE로 기존 ACL 보존.
-- ============================================================
CREATE OR REPLACE FUNCTION public.confirm_payment_and_update_reservation(
  p_reservation_id bigint,
  p_user_id uuid,
  p_payment_key text,
  p_order_id text,
  p_idempotency_key text,
  p_total_amount integer,
  p_paid_amount integer,
  p_point_amount integer DEFAULT 0,
  p_coupon_discount integer DEFAULT 0,
  p_payment_method text DEFAULT NULL,
  p_toss_response jsonb DEFAULT NULL,
  p_calc_at timestamp with time zone DEFAULT NULL,
  p_deposit_amount integer DEFAULT 0,
  p_deposit_rate numeric DEFAULT 0,
  p_crazyshot_score integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payment_id UUID;
  v_deposit_id UUID;
BEGIN
  SELECT id INTO v_payment_id FROM payment_transactions WHERE idempotency_key = p_idempotency_key;
  IF v_payment_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'idempotent', true);
  END IF;

  INSERT INTO payment_transactions (
    reservation_id, user_id, payment_key, order_id, idempotency_key,
    total_amount, paid_amount, point_amount, coupon_discount,
    payment_method, status, toss_response, calc_at, confirmed_at
  ) VALUES (
    p_reservation_id, p_user_id, p_payment_key, p_order_id, p_idempotency_key,
    p_total_amount, p_paid_amount, p_point_amount, p_coupon_discount,
    p_payment_method, 'done', p_toss_response, p_calc_at, now()
  ) RETURNING id INTO v_payment_id;

  -- 기존: UPDATE ... SET status = 'confirmed' 직접 대입 → payment_confirmed_at 기록 +
  -- try_confirm_reservation 경유로 교체(계약서명 완료 여부까지 확인해야 confirmed 전이)
  UPDATE rental_reservations
  SET payment_confirmed_at = now(), updated_at = now()
  WHERE id = p_reservation_id AND user_id = p_user_id AND status IN ('temp', 'pending')
    AND payment_confirmed_at IS NULL;

  PERFORM public.try_confirm_reservation(p_reservation_id);

  IF p_deposit_amount > 0 THEN
    INSERT INTO deposit_holds (
      reservation_id, user_id, payment_transaction_id,
      deposit_amount, deposit_rate, crazyshot_score, status, held_at
    ) VALUES (
      p_reservation_id, p_user_id, v_payment_id,
      p_deposit_amount, p_deposit_rate, p_crazyshot_score, 'held', now()
    ) RETURNING id INTO v_deposit_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'deposit_id', v_deposit_id, 'idempotent', false);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'error_code', SQLSTATE);
END;
$function$;

-- Migration 172가 이미 부여한 ACL을 그대로 재적용(CREATE OR REPLACE는 시그니처가 동일하면
-- 기존 ACL을 자동 보존하지만, 명시적으로 재선언해 의도를 고정한다).
REVOKE EXECUTE ON FUNCTION public.confirm_payment_and_update_reservation(
  bigint, uuid, text, text, text, integer, integer, integer, integer, text, jsonb, timestamptz, integer, numeric, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_and_update_reservation(
  bigint, uuid, text, text, text, integer, integer, integer, integer, text, jsonb, timestamptz, integer, numeric, integer
) TO service_role;

-- ============================================================
-- 5) get_rental_list — RETURNS TABLE에 payment_confirmed_at 컬럼 1개 추가.
--    PostgreSQL은 RETURNS TABLE 컬럼 추가 시 CREATE OR REPLACE가 불가 — DROP 후 재생성.
--    WHERE/JOIN/정렬 등 나머지 로직은 Migration 201(현재 배포본) 기준 100% 동일 유지.
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

-- DROP+CREATE는 이 프로젝트 public 스키마의 ALTER DEFAULT PRIVILEGES(신규 함수 생성 시
-- anon·authenticated·service_role 전부 자동 EXECUTE 부여) 때문에 Migration 263이 회수했던
-- authenticated 권한이 되살아난다 — get_rental_list는 admin(service_role) 클라이언트로만
-- 호출되므로(src/routes/cms/**/*.server.ts 전수 확인) 재생성 직후 다시 명시적으로 회수한다.
REVOKE ALL ON FUNCTION public.get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER, TEXT[], TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER, TEXT[], TEXT[]) TO service_role;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS public.try_confirm_reservation(BIGINT);
-- DROP FUNCTION IF EXISTS public.mark_reservation_payment_confirmed(BIGINT);
-- ALTER TABLE public.rental_reservations DROP COLUMN IF EXISTS payment_confirmed_at;
-- (confirm_payment_and_update_reservation / get_rental_list는 이전 정의로 되돌리려면
--  각각 Migration 172 / Migration 201 정의를 CREATE OR REPLACE / DROP+CREATE로 재적용)
-- ============================================================
