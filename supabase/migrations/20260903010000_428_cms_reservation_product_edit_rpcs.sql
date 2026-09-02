-- Migration 428: CMS 예약상품 편집 RPC 6종
-- (원래 #422로 생성·crazyshot-stage(ezyvffjvuwmtuhpxdjrw)에 적용됐으나, 이 저장소에서 동시
--  진행 중이던 다른 세션의 chat_reply_candidates 마이그레이션과 파일명 번호가 우연히 충돌한
--  것과는 별개로 — 여러 병렬 세션이 같은 워킹디렉토리를 공유하는 과정에서 이 파일 자체가
--  디스크에서 유실된 것이 QA(GATE E) 검수 중 발견됨. Stage DB에는 6개 함수가 이미 정상
--  적용·동작 중임을 curl로 직접 재확인했고, 후속 권한보강 파일 #423도 그대로 유지 —
--  이 파일은 그 유실된 원본 #422의 내용을 파일명만 #428로 재번호해 복원한 것. Migration
--  #306의 선례(동시 세션 번호 충돌 시 내용 변경 없이 재번호)와 동일한 관례를 따름.
--  내용은 원본 그대로 — REVOKE ALL FROM PUBLIC까지만 포함(anon/authenticated 명시 REVOKE는
--  후속 파일 #423 cms_reservation_product_edit_rpcs_revoke_fix.sql이 이미 담당).
--
-- 배경: /cms/reservation RentalDetailPanel에서 관리자가 예약상품 구성(메인상품 추가/삭제,
--   옵션상품 추가/수량수정/삭제, 상품코드 재배정)을 CMS에서 직접 수정하기 위한 RPC.
--   플랜 원문: /Users/stevenmac/.claude/plans/cms-cms-reservation-selected-7972-sprightly-quilt.md
--   (Stage 1 DB/RPC + 확장 기능 DB/RPC 항목)
--
-- 핵심 제약:
--   - rental_reservations 1행 = 실물 재고 1개(원자배정) — qty 컬럼 없음
--   - "수량" = 동일 부모 상품의 rental_reservations 행을 여러 건 생성/삭제로 표현
--   - 편집 허용 범위(①~⑤): status='hold' AND payment_confirmed_at IS NULL 인 예약만
--   - 상품코드 재배정(⑥): status='hold' OR (status='confirmed' AND tracking_number IS NULL)
--   - 전부 SECURITY DEFINER + service_role 전용(고객 auth.uid() 세션에 의존하지 않는 CMS 전용)
--
-- RPC 목록:
--   ① cms_add_reservation_product_unit    — 메인상품 유닛 추가 (재고 원자배정)
--   ② cms_remove_reservation_product_unit — 메인상품 유닛 소프트 취소
--   ③ cms_add_reservation_option          — 옵션상품 추가
--   ④ cms_update_reservation_option_qty   — 옵션상품 수량 수정
--   ⑤ cms_delete_reservation_option       — 옵션상품 삭제
--   ⑥ cms_reassign_reservation_product_code — 상품코드(실물 재고단위) 재배정

-- ═══════════════════════════════════════════════════════════════════
-- ① cms_add_reservation_product_unit
--    원본 예약에서 날짜/방식 상속, 재고 원자배정 후 신규 rental_reservations INSERT.
--    order_items가 존재하면 동일 order에 새 항목 INSERT.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cms_add_reservation_product_unit(
  p_reservation_id BIGINT,
  p_product_id     UUID
)
RETURNS TABLE(success BOOLEAN, new_reservation_id BIGINT, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status          TEXT;
  v_paid_at         TIMESTAMPTZ;
  v_user_id         UUID;
  v_start_date      DATE;
  v_end_date        DATE;
  v_pickup_method   TEXT;
  v_return_method   TEXT;
  v_duration_type   TEXT;
  v_unit_id         UUID;
  v_new_res_id      BIGINT;
  v_order_id        BIGINT;
  v_unit_price      NUMERIC;
BEGIN
  -- 공통 게이트: 대상 예약 재검증 (status='hold' AND payment_confirmed_at IS NULL)
  SELECT status, payment_confirmed_at, user_id, start_date, end_date,
         pickup_method, return_method, duration_type
  INTO   v_status, v_paid_at, v_user_id, v_start_date, v_end_date,
         v_pickup_method, v_return_method, v_duration_type
  FROM   rental_reservations
  WHERE  id = p_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '예약을 찾을 수 없습니다.'; RETURN;
  END IF;
  IF v_status <> 'hold' OR v_paid_at IS NOT NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '이미 계약 또는 결제가 진행되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_start_date IS NULL OR v_end_date IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '원본 예약에 대여 기간 정보가 없습니다.'; RETURN;
  END IF;

  -- 가용 재고 원자 배정 (create_hold_reservation과 동일한 FOR UPDATE SKIP LOCKED 패턴)
  SELECT p.id INTO v_unit_id
  FROM   products p
  WHERE  p.parent_product_id = p_product_id
    AND  p.deleted_at IS NULL
    AND  p.is_active = true
    AND  NOT EXISTS (
      SELECT 1
      FROM   rental_reservations rr
      WHERE  rr.product_id = p.id
        AND  rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired')
        AND  daterange(rr.start_date, rr.end_date, '[]') &&
             daterange(v_start_date, v_end_date, '[]')
    )
  ORDER BY p.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_unit_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '해당 기간에 예약 가능한 재고가 없습니다.'; RETURN;
  END IF;

  -- 신규 rental_reservations INSERT (reservation_code는 트리거 자동 생성)
  INSERT INTO rental_reservations (
    user_id, product_id, status,
    start_date, end_date,
    pickup_method, return_method, duration_type
  )
  VALUES (
    v_user_id, v_unit_id, 'hold',
    v_start_date, v_end_date,
    v_pickup_method, v_return_method, v_duration_type
  )
  RETURNING id INTO v_new_res_id;

  -- order_items 동기화 (체크아웃 완료된 예약이면 동일 order에 추가)
  SELECT oi.order_id INTO v_order_id
  FROM   order_items oi
  WHERE  oi.reservation_id = p_reservation_id
  LIMIT  1;

  IF v_order_id IS NOT NULL THEN
    -- 24h 단가 조회 (부모 상품 기준, 없으면 0)
    SELECT COALESCE(
      (SELECT price FROM price_rules
       WHERE  product_id = p_product_id
         AND  duration_type = '24h'
         AND  is_active = true
         AND  deleted_at IS NULL
       ORDER  BY created_at DESC
       LIMIT  1),
      0
    ) INTO v_unit_price;

    INSERT INTO order_items (order_id, reservation_id, product_id, quantity, unit_price, line_total)
    VALUES (v_order_id, v_new_res_id, v_unit_id, 1, v_unit_price, v_unit_price);
  END IF;

  RETURN QUERY SELECT true, v_new_res_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, NULL::BIGINT, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_add_reservation_product_unit(BIGINT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cms_add_reservation_product_unit(BIGINT, UUID) TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- ② cms_remove_reservation_product_unit
--    대상 예약 행을 소프트 취소(status='cancelled').
--    order에 마지막 남은 상품이면 차단.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cms_remove_reservation_product_unit(
  p_target_reservation_id BIGINT
)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status        TEXT;
  v_paid_at       TIMESTAMPTZ;
  v_order_id      BIGINT;
  v_sibling_count INT;
BEGIN
  -- 공통 게이트: 대상 행 자체의 status/payment_confirmed_at 재검증
  SELECT status, payment_confirmed_at
  INTO   v_status, v_paid_at
  FROM   rental_reservations
  WHERE  id = p_target_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT false, '예약을 찾을 수 없습니다.'; RETURN;
  END IF;
  IF v_status <> 'hold' OR v_paid_at IS NOT NULL THEN
    RETURN QUERY SELECT false, '이미 계약 또는 결제가 진행되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;

  -- order_items 기준 형제 상품 잔존 여부 확인
  SELECT oi.order_id INTO v_order_id
  FROM   order_items oi
  WHERE  oi.reservation_id = p_target_reservation_id
  LIMIT  1;

  IF v_order_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_sibling_count
    FROM   order_items
    WHERE  order_id = v_order_id
      AND  reservation_id <> p_target_reservation_id;

    IF v_sibling_count = 0 THEN
      RETURN QUERY SELECT false, '예약에 남은 상품이 없어 삭제할 수 없습니다. 예약 자체를 취소해주세요.'; RETURN;
    END IF;

    -- 대응 order_items 행 삭제 (집계 오염 방지)
    DELETE FROM order_items WHERE reservation_id = p_target_reservation_id;
  END IF;

  -- 소프트 취소 (하드 DELETE 금지 — 감사 이력 보존)
  UPDATE rental_reservations
  SET    status = 'cancelled'
  WHERE  id = p_target_reservation_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_remove_reservation_product_unit(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cms_remove_reservation_product_unit(BIGINT) TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- ③ cms_add_reservation_option
--    reservation_options에 옵션상품 행 INSERT.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cms_add_reservation_option(
  p_reservation_id    BIGINT,
  p_option_product_id UUID,
  p_option_name       TEXT,
  p_qty               INTEGER,
  p_unit_price        NUMERIC
)
RETURNS TABLE(success BOOLEAN, option_id BIGINT, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status    TEXT;
  v_paid_at   TIMESTAMPTZ;
  v_option_id BIGINT;
BEGIN
  -- 공통 게이트
  SELECT status, payment_confirmed_at
  INTO   v_status, v_paid_at
  FROM   rental_reservations
  WHERE  id = p_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '예약을 찾을 수 없습니다.'; RETURN;
  END IF;
  IF v_status <> 'hold' OR v_paid_at IS NOT NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '이미 계약 또는 결제가 진행되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;

  -- qty 검증 (테이블 CHECK 제약과 이중 방어)
  IF p_qty <= 0 THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '수량은 1 이상이어야 합니다.'; RETURN;
  END IF;

  -- option_name 공백 방어
  IF COALESCE(TRIM(p_option_name), '') = '' THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '옵션상품 이름을 입력해주세요.'; RETURN;
  END IF;

  INSERT INTO reservation_options (reservation_id, option_product_id, option_name, qty, unit_price)
  VALUES (p_reservation_id, p_option_product_id, p_option_name, p_qty, COALESCE(p_unit_price, 0))
  RETURNING id INTO v_option_id;

  RETURN QUERY SELECT true, v_option_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, NULL::BIGINT, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_add_reservation_option(BIGINT, UUID, TEXT, INTEGER, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cms_add_reservation_option(BIGINT, UUID, TEXT, INTEGER, NUMERIC) TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- ④ cms_update_reservation_option_qty
--    옵션의 reservation_id로 게이트 재확인 후 qty 수정.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cms_update_reservation_option_qty(
  p_option_id BIGINT,
  p_qty       INTEGER
)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reservation_id BIGINT;
  v_status         TEXT;
  v_paid_at        TIMESTAMPTZ;
BEGIN
  -- 옵션이 속한 예약 조회
  SELECT reservation_id INTO v_reservation_id
  FROM   reservation_options
  WHERE  id = p_option_id;

  IF v_reservation_id IS NULL THEN
    RETURN QUERY SELECT false, '옵션상품을 찾을 수 없습니다.'; RETURN;
  END IF;

  -- 공통 게이트
  SELECT status, payment_confirmed_at
  INTO   v_status, v_paid_at
  FROM   rental_reservations
  WHERE  id = v_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT false, '예약을 찾을 수 없습니다.'; RETURN;
  END IF;
  IF v_status <> 'hold' OR v_paid_at IS NOT NULL THEN
    RETURN QUERY SELECT false, '이미 계약 또는 결제가 진행되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;

  -- qty 검증 (테이블 CHECK 제약과 이중 방어)
  IF p_qty <= 0 THEN
    RETURN QUERY SELECT false, '수량은 1 이상이어야 합니다.'; RETURN;
  END IF;

  UPDATE reservation_options
  SET    qty = p_qty
  WHERE  id = p_option_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_update_reservation_option_qty(BIGINT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cms_update_reservation_option_qty(BIGINT, INTEGER) TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- ⑤ cms_delete_reservation_option
--    옵션의 reservation_id로 게이트 재확인 후 DELETE.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cms_delete_reservation_option(
  p_option_id BIGINT
)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reservation_id BIGINT;
  v_status         TEXT;
  v_paid_at        TIMESTAMPTZ;
BEGIN
  -- 옵션이 속한 예약 조회
  SELECT reservation_id INTO v_reservation_id
  FROM   reservation_options
  WHERE  id = p_option_id;

  IF v_reservation_id IS NULL THEN
    RETURN QUERY SELECT false, '옵션상품을 찾을 수 없습니다.'; RETURN;
  END IF;

  -- 공통 게이트
  SELECT status, payment_confirmed_at
  INTO   v_status, v_paid_at
  FROM   rental_reservations
  WHERE  id = v_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT false, '예약을 찾을 수 없습니다.'; RETURN;
  END IF;
  IF v_status <> 'hold' OR v_paid_at IS NOT NULL THEN
    RETURN QUERY SELECT false, '이미 계약 또는 결제가 진행되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;

  DELETE FROM reservation_options WHERE id = p_option_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_delete_reservation_option(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cms_delete_reservation_option(BIGINT) TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- ⑥ cms_reassign_reservation_product_code
--    실물 재고단위(품번) 재배정. 별도 게이트 적용:
--      status='hold' OR (status='confirmed' AND tracking_number IS NULL)
--    같은 부모 상품의 형제 유닛으로만 재배정 가능.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cms_reassign_reservation_product_code(
  p_reservation_id BIGINT,
  p_new_unit_id    UUID
)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status           TEXT;
  v_tracking         TEXT;
  v_current_unit_id  UUID;
  v_start_date       DATE;
  v_end_date         DATE;
  v_current_parent   UUID;
  v_new_parent       UUID;
  v_available        UUID;
BEGIN
  -- 재배정 전용 게이트: status='hold' OR (status='confirmed' AND tracking_number IS NULL)
  SELECT status, tracking_number, product_id, start_date, end_date
  INTO   v_status, v_tracking, v_current_unit_id, v_start_date, v_end_date
  FROM   rental_reservations
  WHERE  id = p_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT false, '예약을 찾을 수 없습니다.'; RETURN;
  END IF;

  IF NOT (v_status = 'hold' OR (v_status = 'confirmed' AND v_tracking IS NULL)) THEN
    RETURN QUERY SELECT false, '운송장 등록 후 또는 대여 진행 중인 예약은 재고를 재배정할 수 없습니다.'; RETURN;
  END IF;

  IF v_start_date IS NULL OR v_end_date IS NULL THEN
    RETURN QUERY SELECT false, '예약 기간 정보가 없어 재배정할 수 없습니다.'; RETURN;
  END IF;

  -- 현재 유닛과 새 유닛이 같은 부모인지 확인 (다른 상품으로의 스왑은 이 기능 범위 밖)
  SELECT parent_product_id INTO v_current_parent FROM products WHERE id = v_current_unit_id;
  SELECT parent_product_id INTO v_new_parent     FROM products WHERE id = p_new_unit_id;

  IF v_current_parent IS NULL OR v_new_parent IS NULL THEN
    RETURN QUERY SELECT false, '상품 정보를 확인할 수 없습니다.'; RETURN;
  END IF;

  IF v_current_parent <> v_new_parent THEN
    RETURN QUERY SELECT false, '같은 상품의 다른 재고단위로만 재배정할 수 있습니다.'; RETURN;
  END IF;

  -- 새 유닛이 해당 기간에 실제로 가용한지 원자 재확인 (FOR UPDATE SKIP LOCKED)
  -- 현재 예약 자신은 다른 유닛을 가리키고 있으므로 p_new_unit_id 충돌 체크에서 제외 불필요
  SELECT p.id INTO v_available
  FROM   products p
  WHERE  p.id = p_new_unit_id
    AND  p.deleted_at IS NULL
    AND  p.is_active = true
    AND  NOT EXISTS (
      SELECT 1
      FROM   rental_reservations rr
      WHERE  rr.product_id = p.id
        AND  rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired')
        AND  daterange(rr.start_date, rr.end_date, '[]') &&
             daterange(v_start_date, v_end_date, '[]')
    )
  FOR UPDATE SKIP LOCKED;

  IF v_available IS NULL THEN
    RETURN QUERY SELECT false, '선택한 재고가 이미 다른 예약에 배정되었습니다.'; RETURN;
  END IF;

  -- rental_reservations 유닛 갱신
  UPDATE rental_reservations
  SET    product_id = p_new_unit_id
  WHERE  id = p_reservation_id;

  -- order_items 동기화 (결제정보 탭 정합성 보존)
  UPDATE order_items
  SET    product_id = p_new_unit_id
  WHERE  reservation_id = p_reservation_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_reassign_reservation_product_code(BIGINT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cms_reassign_reservation_product_code(BIGINT, UUID) TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 권한 검증 요약 (적용 후 확인 쿼리)
-- SELECT proname, proacl FROM pg_proc
--   WHERE proname IN (
--     'cms_add_reservation_product_unit',
--     'cms_remove_reservation_product_unit',
--     'cms_add_reservation_option',
--     'cms_update_reservation_option_qty',
--     'cms_delete_reservation_option',
--     'cms_reassign_reservation_product_code'
--   );
-- proacl에 service_role=X 만 보이고 postgres/authenticated/anon 미포함 확인
-- (anon/authenticated 명시 REVOKE는 후속 파일 #423이 담당 — 이미 Stage DB 적용 완료)
-- ═══════════════════════════════════════════════════════════════════
