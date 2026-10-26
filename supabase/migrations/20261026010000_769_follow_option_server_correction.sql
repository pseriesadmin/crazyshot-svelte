-- Migration #769: 옵션상품 설정의 서버 보정 — 수량 본상품 연동 + 배송 대여 불가 최종 점검 (2026-10-26, Stephen 지시)
--
-- 배경: CMS 옵션상품 설정(product_option_links)의 두 설정이 화면에서만 지켜지고 서버가 강제하지 않았다.
--   · qty_follows_main("수량 본상품 연동"): 상품상세는 본상품 수량을 옵션에 맞췄지만, 장바구니에서 본상품 수량을 바꾸면 새 예약행이 옵션 없이 추가될 뿐이라
--     연동 옵션 수량이 그대로 남았고, set_reservation_options 는 보낸 수량을 그대로 저장했다.
--   · delivery_rental_disabled("배송 대여 불가"): 장바구니 화면이 배송형 방식 탭을 숨길 뿐, 서버는 옛 화면·직접 호출로 배송 방식 주문이 만들어져도 막지 않았다.
-- 변경(함수 본문은 라이브 정의에서 정확히 1곳씩만 치환 — 불일치 시 롤백, 멱등 아님: 이미 적용된 정의는 거절):
--   ① set_reservation_options — 연동 옵션은 장바구니 그룹 크기(같은 사용자·같은 상태·같은 부모상품, hold 는 같은 날짜)로 수량을 보정한다.
--      재고가 모자라면 min(그룹 크기, 가용 재고), 가용 재고가 0이면 기존처럼 OPTION_STOCK_EXCEEDED. 연동이 아닌 옵션은 변경 없음.
--      payload 에 qty>0 으로 담긴 연동 옵션(필수·선택 모두)에 같은 규칙을 적용한다 — 필수 옵션이라도 qty 0 으로 보내 payload 에서 빠진 항목은 보정 없이 저장되지 않는 기존 동작 그대로다.
--      (2026-10-26 주석 정정 — sp3 검수 MINOR, SQL 본문 변경 없음. 그룹 범위 보정은 Migration #770: 이미 제출된 형제 예약은 그룹에서 제외)
--   ② create_reservation_order(service_role 전용) — 주문 직전, 아직 주문에 묶이지 않은 예약의 연동 옵션 수량을 현재 그룹 크기로 다시 맞춘다
--      (장바구니 수량이 바뀐 뒤 옵션이 갱신되지 않은 낡은 요청 보정). 가용 재고가 0이면 건드리지 않는다(재고 오류는 담을 때 이미 검사).
--   ③ create_reservation_order — 배송형(rental_method_options.is_delivery_type) 방식으로 수령·반납하는 예약의 그룹에 "배송 대여 불가" 옵션(qty>0)이 있으면
--      OPTION_DELIVERY_DISABLED 로 거절한다(구매 duration_type='purchase' 라인은 제외 — 장바구니가 구매 라인의 배송 방식을 고정하므로 화면 규칙과 같다).
--      판정 기준은 장바구니 화면과 같은 is_delivery_type 이다(퀵·무인보관함은 CMS 에서 배송형으로 지정하지 않았다면 대상이 아니다).
-- 새 보조 함수(private 스키마, 서버 소유 SECURITY DEFINER 함수에서만 호출 — anon·authenticated 실행 불가):
--   private.cart_group_size / private.option_available_qty / private.follow_option_qty / private.group_has_delivery_disabled_option
--   ⚠️ private.option_available_qty 는 set_reservation_options 안의 가용 재고 계산(판매전용/대여 두 갈래)과 같은 식이다 — 한쪽을 고치면 다른 쪽도 고칠 것.
-- 테스트: src/__tests__/services/followOptionServerCorrection.test.ts (Stage 라이브 12건)

-- ① 그룹 크기 — 장바구니 카드 병합 규칙(cartLineGrouping.ts·find_matching_cart_reservation_group)과 같다
CREATE OR REPLACE FUNCTION private.cart_group_size(p_reservation_id bigint)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT COUNT(*)::int
    FROM rental_reservations me
    LEFT JOIN products mp ON mp.id = me.product_id
    JOIN rental_reservations g
      ON g.user_id = me.user_id
     AND g.status  = me.status
     AND (me.status <> 'hold' OR (g.start_date = me.start_date AND g.end_date = me.end_date))
    LEFT JOIN products gp ON gp.id = g.product_id
   WHERE me.id = p_reservation_id
     AND COALESCE(gp.parent_product_id, g.product_id) = COALESCE(mp.parent_product_id, me.product_id);
$fn$;

-- ② 옵션상품 가용 재고 — set_reservation_options 안의 계산과 같은 식(판매전용은 활성 자식 중 미점유 수, 대여는 활성 자식 수 - 다른 예약이 점유한 옵션 수량)
CREATE OR REPLACE FUNCTION private.option_available_qty(p_option_product_id uuid, p_exclude_reservation_id bigint)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  v_opt_parent UUID;
  v_opt_sale BOOLEAN;
  v_total_active INT;
  v_occupied_by_others INT;
BEGIN
  SELECT COALESCE(p.parent_product_id, p.id), COALESCE(par.sale_only, p.sale_only, false)
    INTO v_opt_parent, v_opt_sale
    FROM products p
    LEFT JOIN products par ON par.id = p.parent_product_id
   WHERE p.id = p_option_product_id;

  IF COALESCE(v_opt_sale, false) THEN
    SELECT COUNT(*) INTO v_total_active
    FROM products c
    WHERE c.parent_product_id = v_opt_parent
      AND c.is_active = true AND c.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM rental_reservations rr
         WHERE rr.product_id = c.id
           AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
      )
      AND NOT EXISTS (
        SELECT 1 FROM reservation_bundle_assets a
          JOIN rental_reservations rr2 ON rr2.id = a.reservation_id
         WHERE a.asset_product_id = c.id
           AND rr2.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
      );

    SELECT COALESCE(SUM(ro.qty), 0) INTO v_occupied_by_others
    FROM reservation_options ro
    JOIN rental_reservations rr ON rr.id = ro.reservation_id
    WHERE ro.option_product_id IN (v_opt_parent, p_option_product_id)
      AND ro.reservation_id != p_exclude_reservation_id
      AND rr.status = 'hold';
  ELSE
    SELECT COUNT(*) INTO v_total_active
    FROM products c
    WHERE c.parent_product_id = p_option_product_id
      AND c.is_active = true AND c.deleted_at IS NULL;

    SELECT COALESCE(SUM(ro.qty), 0) INTO v_occupied_by_others
    FROM reservation_options ro
    JOIN rental_reservations rr ON rr.id = ro.reservation_id
    WHERE ro.option_product_id = p_option_product_id
      AND ro.reservation_id != p_exclude_reservation_id
      AND rr.status IN ('hold', 'confirmed', 'shipped', 'in_use', 'return_requested');
  END IF;

  RETURN GREATEST(0, v_total_active - v_occupied_by_others);
END;
$fn$;

-- ③ 연동 옵션 보정 수량(주문 생성용, 예외를 던지지 않음) — 연동 대상이 아니거나 재고가 없으면 받은 수량 그대로
CREATE OR REPLACE FUNCTION private.follow_option_qty(p_reservation_id bigint, p_option_product_id uuid, p_qty integer)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  v_main UUID;
  v_follow BOOLEAN;
  v_required BOOLEAN;
  v_available INT;
BEGIN
  SELECT COALESCE(p.parent_product_id, rr.product_id) INTO v_main
    FROM rental_reservations rr
    LEFT JOIN products p ON p.id = rr.product_id
   WHERE rr.id = p_reservation_id;
  IF v_main IS NULL OR p_option_product_id IS NULL THEN
    RETURN p_qty;
  END IF;

  SELECT pol.qty_follows_main, pol.is_required INTO v_follow, v_required
    FROM product_option_links pol
   WHERE pol.product_id = v_main
     AND pol.option_product_id = p_option_product_id
     AND pol.deleted_at IS NULL
   LIMIT 1;

  IF NOT COALESCE(v_follow, false) THEN
    RETURN p_qty;
  END IF;
  IF NOT (COALESCE(v_required, false) OR p_qty > 0) THEN
    RETURN p_qty;
  END IF;

  v_available := private.option_available_qty(p_option_product_id, p_reservation_id);
  IF v_available < 1 THEN
    RETURN p_qty;
  END IF;

  RETURN LEAST(private.cart_group_size(p_reservation_id), v_available);
END;
$fn$;

-- ④ 같은 그룹에 "배송 대여 불가" 옵션(qty>0)이 담겨 있는가
CREATE OR REPLACE FUNCTION private.group_has_delivery_disabled_option(p_reservation_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM rental_reservations me
      LEFT JOIN products mp ON mp.id = me.product_id
      JOIN rental_reservations g
        ON g.user_id = me.user_id
       AND g.status  = me.status
       AND (me.status <> 'hold' OR (g.start_date = me.start_date AND g.end_date = me.end_date))
      LEFT JOIN products gp ON gp.id = g.product_id
      JOIN reservation_options ro
        ON ro.reservation_id = g.id AND ro.qty > 0 AND ro.option_product_id IS NOT NULL
      JOIN product_option_links pol
        ON pol.product_id = COALESCE(mp.parent_product_id, me.product_id)
       AND pol.option_product_id = ro.option_product_id
       AND pol.deleted_at IS NULL
       AND pol.delivery_rental_disabled = true
     WHERE me.id = p_reservation_id
       AND COALESCE(gp.parent_product_id, g.product_id) = COALESCE(mp.parent_product_id, me.product_id)
  );
$fn$;

REVOKE ALL ON FUNCTION private.cart_group_size(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.option_available_qty(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.follow_option_qty(bigint, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.group_has_delivery_disabled_option(bigint) FROM PUBLIC, anon, authenticated;

-- ⑤ set_reservation_options — 라이브 정의에서 3곳만 치환
DO $mig$
DECLARE
  v_def TEXT;
  m1 TEXT := $m$  v_opt_sale BOOLEAN;
BEGIN
$m$;
  n1 TEXT := $m$  v_opt_sale BOOLEAN;
  v_qty INT;
  v_follow BOOLEAN;
  v_fixed JSONB := '{}'::jsonb;
BEGIN
$m$;
  m2 TEXT := $m$    v_available := GREATEST(0, v_total_active - v_occupied_by_others);

    IF v_item.qty > v_available THEN
$m$;
  n2 TEXT := $m$    v_available := GREATEST(0, v_total_active - v_occupied_by_others);
    v_qty := v_item.qty;

    -- 수량 본상품 연동(qty_follows_main, 본상품=부모 기준 링크): 장바구니 그룹 크기로 보정, 재고가 모자라면 min(그룹 크기, 재고), 재고 0이면 기존처럼 거절
    SELECT pol.qty_follows_main INTO v_follow
      FROM product_option_links pol
     WHERE pol.product_id = v_main_product_id
       AND pol.option_product_id = v_item.option_product_id
       AND pol.deleted_at IS NULL
     LIMIT 1;
    IF COALESCE(v_follow, false) THEN
      IF v_available < 1 THEN
        RAISE EXCEPTION 'OPTION_STOCK_EXCEEDED:%', v_item.option_product_id;
      END IF;
      v_qty := LEAST(private.cart_group_size(p_reservation_id), v_available);
      v_fixed := v_fixed || jsonb_build_object(v_item.option_product_id::text, v_qty);
    END IF;

    IF v_qty > v_available THEN
$m$;
  m3 TEXT := $m$    (elem->>'qty')::INTEGER,
    CASE
$m$;
  n3 TEXT := $m$    COALESCE((v_fixed->>((NULLIF(elem->>'option_product_id', '')::UUID)::text))::INTEGER, (elem->>'qty')::INTEGER),
    CASE
$m$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'set_reservation_options';
  IF v_def IS NULL THEN RAISE EXCEPTION 'set_reservation_options 를 찾지 못했다'; END IF;
  IF position('v_fixed' IN v_def) > 0 THEN RAISE EXCEPTION 'set_reservation_options 는 이미 #769 형태다'; END IF;
  IF position(m1 IN v_def) = 0 OR position(m2 IN v_def) = 0 OR position(m3 IN v_def) = 0 THEN
    RAISE EXCEPTION 'set_reservation_options 라이브 정의가 예상과 달라 치환하지 못했다(치환 위치 불일치)';
  END IF;
  v_def := replace(v_def, m1, n1);
  v_def := replace(v_def, m2, n2);
  v_def := replace(v_def, m3, n3);
  EXECUTE v_def;
END;
$mig$;

-- ⑥ create_reservation_order — 라이브 정의에서 3곳만 치환(선언·배송 대여 불가 점검·연동 옵션 정규화)
DO $mig$
DECLARE
  v_def TEXT;
  m1 TEXT := $m$  r               RECORD;
  line            RECORD;
BEGIN
$m$;
  n1 TEXT := $m$  r               RECORD;
  line            RECORD;
  fo              RECORD;
  v_fixed_qty     INT;
BEGIN
$m$;
  m2 TEXT := $m$    RAISE EXCEPTION '본인 소유의 신청대기(hold) 예약만 주문으로 묶을 수 있습니다.';
  END IF;
$m$;
  n2 TEXT := $m$    RAISE EXCEPTION '본인 소유의 신청대기(hold) 예약만 주문으로 묶을 수 있습니다.';
  END IF;

  -- 배송 대여 불가 옵션이 담긴 그룹은 배송형(is_delivery_type) 방식으로 주문할 수 없다 (구매 라인은 제외)
  IF EXISTS (
    SELECT 1
    FROM rental_reservations rr
    WHERE rr.id = ANY(p_reservation_ids)
      AND COALESCE(rr.duration_type, '') <> 'purchase'
      AND (
        EXISTS (SELECT 1 FROM rental_method_options m
                 WHERE m.method_key = rr.pickup_method AND m.is_delivery_type = true AND m.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM rental_method_options m
                 WHERE m.method_key = rr.return_method AND m.is_delivery_type = true AND m.deleted_at IS NULL)
      )
      AND private.group_has_delivery_disabled_option(rr.id)
  ) THEN
    RAISE EXCEPTION 'OPTION_DELIVERY_DISABLED: 배송 대여가 불가능한 옵션상품이 포함되어 있어 배송 방식으로 신청할 수 없습니다.';
  END IF;
$m$;
  m3 TEXT := $m$  FOR r IN
    SELECT rr.id, rr.product_id
    FROM rental_reservations rr
    WHERE rr.id = ANY(p_reservation_ids)
      AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.reservation_id = rr.id)
  LOOP
$m$;
  n3 TEXT := $m$  -- 수량 본상품 연동 옵션 정규화: 아직 주문에 묶이지 않은 예약의 연동 옵션 수량을 현재 장바구니 그룹 크기에 맞춘다
  FOR fo IN
    SELECT ro.id AS ro_id, ro.reservation_id, ro.option_product_id, ro.qty
    FROM reservation_options ro
    WHERE ro.reservation_id = ANY(p_reservation_ids)
      AND ro.option_product_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.reservation_id = ro.reservation_id)
  LOOP
    v_fixed_qty := private.follow_option_qty(fo.reservation_id, fo.option_product_id, fo.qty);
    IF v_fixed_qty IS DISTINCT FROM fo.qty THEN
      UPDATE reservation_options SET qty = v_fixed_qty WHERE id = fo.ro_id;
      BEGIN
        PERFORM private.assign_option_assets(fo.reservation_id);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END LOOP;

  FOR r IN
    SELECT rr.id, rr.product_id
    FROM rental_reservations rr
    WHERE rr.id = ANY(p_reservation_ids)
      AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.reservation_id = rr.id)
  LOOP
$m$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'create_reservation_order';
  IF v_def IS NULL THEN RAISE EXCEPTION 'create_reservation_order 를 찾지 못했다'; END IF;
  IF position('OPTION_DELIVERY_DISABLED' IN v_def) > 0 THEN RAISE EXCEPTION 'create_reservation_order 는 이미 #769 형태다'; END IF;
  IF position(m1 IN v_def) = 0 OR position(m2 IN v_def) = 0 OR position(m3 IN v_def) = 0 THEN
    RAISE EXCEPTION 'create_reservation_order 라이브 정의가 예상과 달라 치환하지 못했다(치환 위치 불일치)';
  END IF;
  v_def := replace(v_def, m1, n1);
  v_def := replace(v_def, m2, n2);
  v_def := replace(v_def, m3, n3);
  EXECUTE v_def;
END;
$mig$;

-- ROLLBACK (되돌리면 연동 옵션 수량·배송 대여 불가가 다시 화면 규칙에만 의존한다):
--   set_reservation_options / create_reservation_order 는 위 치환의 역순(n→m)으로 CREATE OR REPLACE 하거나, #769 적용 직전(Migration #657·#587 등) 정의로 복원한다.
--   DROP FUNCTION private.cart_group_size(bigint), private.option_available_qty(uuid, bigint),
--                 private.follow_option_qty(bigint, uuid, integer), private.group_has_delivery_disabled_option(bigint);
