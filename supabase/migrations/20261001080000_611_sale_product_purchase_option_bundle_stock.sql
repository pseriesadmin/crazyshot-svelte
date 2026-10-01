-- Migration 611 — 판매전용 상품: 구매 유형 선지정 + 옵션·결합상품 판매 금액/재고 차감 (2026-10-01, Stephen 지시)
--
-- 배경(2026-10-01 실사용 보고):
--   ① "구매신청"으로 만든 draft 예약의 duration_type이 비어 있어(create_draft_reservation이 값을 넣지 않고,
--      set_reservation_duration은 status='hold'만 갱신) 장바구니가 대여로 분류 → 대여요금이 없어 "요금 미정"으로 예약 신청 차단.
--   ② 판매전용 상품을 옵션상품으로 쓰면 단가가 0(요금 규칙 없음)이고 재고가 차감되지 않는다.
--   ③ 판매전용 상품을 결합상품으로 쓰면 날짜 겹침 기준으로만 점유돼 같은 유닛이 다른 날짜에 다시 배정되고 재고가 차감되지 않는다.
--
-- 정책(Stephen 확정):
--   · 구매신청(draft 생성) 시점부터 duration_type='purchase'.
--   · 옵션상품(판매전용): 본상품 대여설정(기간·방식)과 무관하게 자체 판매금액×수량을 결제 연산에 포함(서버가 sale_price로 단가 강제),
--     확정(confirmed) 시 수량만큼 재고 유닛 비활성(마커=예약 id), 취소 시 복원.
--   · 결합상품(판매전용): 본상품 날짜와 무관하게 점유·확정 시 재고 차감, 금액은 결합 조건 유지(요금값 제외 — compute 변경 없음).
--
-- 변경:
--   1) create_draft_reservation — 판매전용 상품이면 duration_type='purchase'로 생성
--   2) 기존 NULL 예약 보정(draft/hold 중 판매전용 상품)
--   3) private.apply_sale_stock_on_confirm / restore_sale_stock_on_cancel 신설(옵션·결합 재고 차감/복원)
--   4) update_reservation_status — 확정 시 옵션·결합 판매재고 차감(부족하면 가능한 만큼+sale_stock_shortage 반환), 취소 시 마커 기반 일괄 복원
--   5) set_reservation_options — 판매전용 옵션 단가 서버 강제 + 재고 가드(판매전용은 hold 수량만 점유로 계산해 확정분 이중차감 방지)
--   6) assign_bundle_assets — 판매전용 결합 구성품은 날짜 무관 점유
--   7) promote_draft_reservation·create_hold_reservation — 판매전용 본상품이 결합으로 배정된 유닛을 날짜 무관하게 제외
--   8) get_available_stock_counts — 판매전용 옵션 hold 수량 차감
-- 본상품끼리의 날짜 겹침 규칙은 변경하지 않는다(기존 saleOnlyStockFlow S10 유지).

-- ── 1) create_draft_reservation — 구매 성격 선지정 ──────────────────────────────────────
DO $do$
DECLARE
  v_def TEXT;
  v_new TEXT;
  v_cnt INT;
  v_decl_a TEXT := E'  v_reservation_id BIGINT;\nBEGIN';
  v_decl_b TEXT := E'  v_reservation_id BIGINT;\n  v_is_sale        BOOLEAN;\nBEGIN';
  v_sel_a  TEXT := E'  INSERT INTO rental_reservations (\n    user_id, product_id, status,\n    start_date, end_date,\n    pickup_method, return_method\n  )';
  v_sel_b  TEXT := E'  SELECT (COALESCE(p.sale_only, false) OR COALESCE(par.sale_only, false))\n    INTO v_is_sale\n    FROM products p\n    LEFT JOIN products par ON par.id = p.parent_product_id\n   WHERE p.id = p_product_id AND p.deleted_at IS NULL;\n\n  INSERT INTO rental_reservations (\n    user_id, product_id, status,\n    start_date, end_date,\n    pickup_method, return_method, duration_type\n  )';
  v_val_a  TEXT := E'    NULL, NULL\n  )\n  RETURNING id INTO v_reservation_id;';
  v_val_b  TEXT := E'    NULL, NULL,\n    CASE WHEN v_is_sale THEN ''purchase'' ELSE NULL END\n  )\n  RETURNING id INTO v_reservation_id;';
BEGIN
  SELECT pg_get_functiondef('public.create_draft_reservation(uuid)'::regprocedure) INTO v_def;
  IF position('v_is_sale' IN v_def) > 0 THEN RETURN; END IF; -- 멱등

  FOREACH v_new IN ARRAY ARRAY[v_decl_a, v_sel_a, v_val_a] LOOP
    v_cnt := (length(v_def) - length(replace(v_def, v_new, ''))) / length(v_new);
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'create_draft_reservation anchor mismatch(%): %', v_cnt, left(v_new, 40); END IF;
  END LOOP;

  v_def := replace(replace(replace(v_def, v_decl_a, v_decl_b), v_sel_a, v_sel_b), v_val_a, v_val_b);
  EXECUTE v_def;
END
$do$;

-- ── 2) 기존 NULL 예약 보정 — 판매전용 상품의 draft/hold ───────────────────────────────────
UPDATE public.rental_reservations rr
   SET duration_type = 'purchase'
  FROM public.products c
  LEFT JOIN public.products par ON par.id = c.parent_product_id
 WHERE c.id = rr.product_id
   AND rr.duration_type IS NULL
   AND rr.status IN ('draft', 'hold')
   AND (COALESCE(c.sale_only, false) OR COALESCE(par.sale_only, false));

-- ── 3) 판매전용 옵션·결합 재고 차감/복원 헬퍼 ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.apply_sale_stock_on_confirm(p_reservation_id BIGINT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_shortage INT := 0;
  v_ro       RECORD;
  v_asset    RECORD;
  v_parent   UUID;
  v_n        INT;
BEGIN
  -- (a) 판매전용 옵션상품 — 수량만큼 활성·미점유 유닛을 비활성화(마커=예약 id)
  FOR v_ro IN
    SELECT ro.option_product_id, ro.qty
      FROM reservation_options ro
     WHERE ro.reservation_id = p_reservation_id
       AND ro.option_product_id IS NOT NULL
       AND ro.qty > 0
  LOOP
    SELECT COALESCE(p.parent_product_id, p.id) INTO v_parent FROM products p WHERE p.id = v_ro.option_product_id;
    CONTINUE WHEN v_parent IS NULL;
    CONTINUE WHEN NOT COALESCE((SELECT sale_only FROM products WHERE id = v_parent), false);

    WITH pick AS (
      SELECT c.id
        FROM products c
       WHERE c.parent_product_id = v_parent
         AND c.deleted_at IS NULL
         AND c.is_active = true
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
         )
       ORDER BY c.created_at
       LIMIT v_ro.qty
       FOR UPDATE SKIP LOCKED
    )
    UPDATE products p
       SET is_active = false,
           auto_deactivated_reservation_id = p_reservation_id
      FROM pick
     WHERE p.id = pick.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_shortage := v_shortage + GREATEST(v_ro.qty - v_n, 0);
  END LOOP;

  -- (b) 판매전용 결합 구성품 — 예약 시점에 배정된 실물 유닛을 비활성화(날짜 무관)
  FOR v_asset IN
    SELECT a.asset_product_id
      FROM reservation_bundle_assets a
     WHERE a.reservation_id = p_reservation_id
  LOOP
    IF COALESCE((
      SELECT COALESCE(par.sale_only, c.sale_only, false)
        FROM products c
        LEFT JOIN products par ON par.id = c.parent_product_id
       WHERE c.id = v_asset.asset_product_id
    ), false) THEN
      UPDATE products
         SET is_active = false,
             auto_deactivated_reservation_id = p_reservation_id
       WHERE id = v_asset.asset_product_id
         AND is_active = true;
    END IF;
  END LOOP;

  RETURN v_shortage;
END;
$function$;

CREATE OR REPLACE FUNCTION private.restore_sale_stock_on_cancel(p_reservation_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- 이 예약이 자동으로 끈 유닛(본상품·옵션·결합 구성품 전부)만 복원 — 수동 비활성·타 예약이 끈 유닛은 유지
  UPDATE products
     SET is_active = true,
         auto_deactivated_reservation_id = NULL
   WHERE auto_deactivated_reservation_id = p_reservation_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.apply_sale_stock_on_confirm(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.restore_sale_stock_on_cancel(BIGINT) FROM PUBLIC, anon, authenticated;

-- ── 4) update_reservation_status — 확정 시 옵션·결합 재고 차감, 취소 시 마커 기반 복원 ───────────
CREATE OR REPLACE FUNCTION public.update_reservation_status(p_reservation_id bigint, p_new_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_status TEXT;
  v_pickup_method  TEXT;
  v_return_method  TEXT;
  v_product_id     UUID;
  v_allowed_next   TEXT;
  v_updated_count  INT;
  v_is_sale        BOOLEAN;
  v_shortage       INT := 0;
BEGIN
  SELECT status, pickup_method, return_method, product_id
    INTO v_current_status, v_pickup_method, v_return_method, v_product_id
  FROM rental_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.');
  END IF;

  IF v_current_status IN ('completed', 'cancelled', 'damage_claimed', 'expired') THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 종료된 예약은 상태를 변경할 수 없습니다.');
  END IF;

  IF p_new_status IN ('cancelled', 'damage_claimed') THEN
    UPDATE rental_reservations SET status = p_new_status, updated_at = NOW()
    WHERE id = p_reservation_id;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', '상태 변경에 실패했습니다.');
    END IF;

    IF p_new_status = 'cancelled' THEN
      PERFORM private.restore_sale_stock_on_cancel(p_reservation_id);
    END IF;

    RETURN jsonb_build_object('ok', true);
  END IF;

  v_allowed_next := CASE v_current_status
    WHEN 'pending'           THEN 'hold'
    WHEN 'hold'               THEN 'confirmed'
    WHEN 'confirmed'          THEN CASE WHEN v_pickup_method = 'visit' THEN 'in_use' ELSE 'shipped' END
    WHEN 'shipped'            THEN 'in_use'
    WHEN 'in_use'             THEN CASE WHEN v_return_method = 'visit' THEN 'returned' ELSE 'return_requested' END
    WHEN 'return_requested'   THEN 'returned'
    WHEN 'returned'           THEN 'completed'
    ELSE NULL
  END;

  IF v_allowed_next IS NULL OR p_new_status <> v_allowed_next THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('허용되지 않은 상태 전환입니다. (현재: %s → 요청: %s)', v_current_status, p_new_status)
    );
  END IF;

  UPDATE rental_reservations SET status = p_new_status, updated_at = NOW()
  WHERE id = p_reservation_id;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '상태 변경에 실패했습니다.');
  END IF;

  IF p_new_status = 'confirmed' THEN
    -- 판매전용 본상품: 그 재고(자식 유닛) 자동 비활성(기존 #416/#553 동작)
    IF v_product_id IS NOT NULL THEN
      SELECT COALESCE(sale_only, false) INTO v_is_sale FROM products WHERE id = v_product_id;
      IF v_is_sale THEN
        UPDATE products
           SET is_active = false, auto_deactivated_reservation_id = p_reservation_id
         WHERE id = v_product_id AND is_active = true;
      END IF;
    END IF;

    -- 판매전용 옵션·결합 구성품: 수량/배정 유닛 차감(본상품이 대여여도 동일)
    v_shortage := private.apply_sale_stock_on_confirm(p_reservation_id);
    IF v_shortage > 0 THEN
      RETURN jsonb_build_object('ok', true, 'sale_stock_shortage', v_shortage);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

-- ── 5) set_reservation_options — 판매전용 옵션 단가 서버 강제 + 재고 가드 ─────────────────────────
CREATE OR REPLACE FUNCTION public.set_reservation_options(p_reservation_id bigint, p_options jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item RECORD;
  v_total_active INT;
  v_occupied_by_others INT;
  v_available INT;
  v_main_product_id UUID;
  v_opt_parent UUID;
  v_opt_sale BOOLEAN;
BEGIN
  SELECT COALESCE(p.parent_product_id, rr.product_id) INTO v_main_product_id
  FROM rental_reservations rr
  LEFT JOIN products p ON p.id = rr.product_id
  WHERE rr.id = p_reservation_id AND rr.user_id = auth.uid() AND rr.status IN ('draft', 'hold');

  IF v_main_product_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_item IN
    SELECT
      NULLIF(elem->>'option_product_id', '')::UUID AS option_product_id,
      COALESCE((elem->>'qty')::INTEGER, 0) AS qty
    FROM jsonb_array_elements(p_options) AS elem
    WHERE COALESCE((elem->>'qty')::INTEGER, 0) > 0
  LOOP
    CONTINUE WHEN v_item.option_product_id IS NULL;

    SELECT COALESCE(p.parent_product_id, p.id), COALESCE(par.sale_only, p.sale_only, false)
      INTO v_opt_parent, v_opt_sale
      FROM products p
      LEFT JOIN products par ON par.id = p.parent_product_id
     WHERE p.id = v_item.option_product_id;

    IF COALESCE(v_opt_sale, false) THEN
      -- 판매전용 옵션: 확정분은 이미 유닛이 비활성화돼 있으므로 hold 수량만 점유로 센다(이중 차감 방지).
      -- 본상품/결합으로 이미 점유된 유닛도 제외한다.
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
      WHERE ro.option_product_id IN (v_opt_parent, v_item.option_product_id)
        AND ro.reservation_id != p_reservation_id
        AND rr.status = 'hold';
    ELSE
      SELECT COUNT(*) INTO v_total_active
      FROM products c
      WHERE c.parent_product_id = v_item.option_product_id
        AND c.is_active = true AND c.deleted_at IS NULL;

      SELECT COALESCE(SUM(ro.qty), 0) INTO v_occupied_by_others
      FROM reservation_options ro
      JOIN rental_reservations rr ON rr.id = ro.reservation_id
      WHERE ro.option_product_id = v_item.option_product_id
        AND ro.reservation_id != p_reservation_id
        AND rr.status IN ('hold', 'confirmed', 'shipped', 'in_use', 'return_requested');
    END IF;

    v_available := GREATEST(0, v_total_active - v_occupied_by_others);

    IF v_item.qty > v_available THEN
      RAISE EXCEPTION 'OPTION_STOCK_EXCEEDED:%', v_item.option_product_id;
    END IF;
  END LOOP;

  DELETE FROM reservation_options WHERE reservation_id = p_reservation_id;

  INSERT INTO reservation_options (reservation_id, option_product_id, option_name, qty, unit_price)
  SELECT
    p_reservation_id,
    NULLIF(elem->>'option_product_id', '')::UUID,
    elem->>'option_name',
    (elem->>'qty')::INTEGER,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM product_option_links pol
        WHERE pol.product_id = v_main_product_id
          AND pol.option_product_id = NULLIF(elem->>'option_product_id', '')::UUID
          AND pol.deleted_at IS NULL
          AND pol.is_free = true
      ) THEN 0
      -- 판매전용 옵션 단가는 서버가 sale_price로 강제(본상품 대여설정·클라이언트 값과 무관한 정액)
      WHEN COALESCE(op.is_sale, false) THEN COALESCE(op.sale_price, 0)
      ELSE COALESCE((elem->>'unit_price')::NUMERIC, 0)
    END
  FROM jsonb_array_elements(p_options) AS elem
  LEFT JOIN LATERAL (
    SELECT COALESCE(par.sale_only, p.sale_only, false) AS is_sale,
           COALESCE(par.sale_price, p.sale_price)      AS sale_price
      FROM products p
      LEFT JOIN products par ON par.id = p.parent_product_id
     WHERE p.id = NULLIF(elem->>'option_product_id', '')::UUID
  ) op ON true
  WHERE COALESCE((elem->>'qty')::INTEGER, 0) > 0;
END;
$function$;

-- ── 6) assign_bundle_assets — 판매전용 결합 구성품은 날짜 무관 점유 ─────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_bundle_assets(p_reservation_id bigint, p_package_id uuid, p_start_date date, p_end_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle_id   uuid;
  v_asset_id    uuid;
  v_cand        uuid;
  v_bundle_sale boolean;
BEGIN
  FOR v_bundle_id IN
    SELECT pbl.bundle_product_id
    FROM product_bundle_links pbl
    JOIN products bp ON bp.id = pbl.bundle_product_id AND bp.deleted_at IS NULL
    WHERE pbl.product_id = p_package_id
      AND pbl.deleted_at IS NULL
    ORDER BY pbl.display_order, pbl.bundle_product_id
  LOOP
    v_asset_id := NULL;
    SELECT COALESCE(sale_only, false) INTO v_bundle_sale FROM products WHERE id = v_bundle_id;

    FOR v_cand IN
      SELECT c.id
      FROM products c
      WHERE c.parent_product_id = v_bundle_id
        AND c.deleted_at IS NULL
        AND c.is_active = true
      ORDER BY c.created_at
      FOR UPDATE SKIP LOCKED
    LOOP
      IF v_bundle_sale THEN
        -- 판매전용 구성품: 팔리는 물건이므로 날짜와 무관하게, 비종결 예약(본상품·결합 배정)에 잡힌 유닛은 쓸 수 없다
        IF NOT EXISTS (
          SELECT 1 FROM rental_reservations rr
           WHERE rr.product_id = v_cand
             AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
        ) AND NOT EXISTS (
          SELECT 1
          FROM reservation_bundle_assets a
          JOIN rental_reservations rr2 ON rr2.id = a.reservation_id
          WHERE a.asset_product_id = v_cand
            AND a.reservation_id <> p_reservation_id
            AND rr2.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
        ) THEN
          v_asset_id := v_cand;
          EXIT;
        END IF;
      ELSIF NOT EXISTS (
        SELECT 1
        FROM rental_reservations rr
        WHERE rr.product_id = v_cand
          AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
          AND daterange(rr.start_date, rr.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
      ) AND NOT EXISTS (
        SELECT 1
        FROM reservation_bundle_assets a
        JOIN rental_reservations rr2 ON rr2.id = a.reservation_id
        WHERE a.asset_product_id = v_cand
          AND rr2.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
          AND daterange(rr2.start_date, rr2.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
      ) THEN
        v_asset_id := v_cand;
        EXIT;
      END IF;
    END LOOP;

    IF v_asset_id IS NULL THEN
      RAISE EXCEPTION '구성품 재고가 부족해 예약할 수 없습니다.';
    END IF;

    INSERT INTO reservation_bundle_assets (reservation_id, bundle_product_id, asset_product_id)
    VALUES (p_reservation_id, v_bundle_id, v_asset_id);
  END LOOP;
END;
$function$;

-- ── 7) promote_draft_reservation · create_hold_reservation — 판매전용 본상품은 결합 배정 유닛을 날짜 무관 제외 ──
DO $do$
DECLARE
  v_fn    TEXT;
  v_sig   regprocedure;
  v_parent_expr TEXT;
  v_def   TEXT;
  v_cnt   INT;
  v_decl_a TEXT := E'  v_return_extra    INT;\nBEGIN';
  v_decl_b TEXT := E'  v_return_extra    INT;\n  v_parent_sale     BOOLEAN;\nBEGIN';
  v_sel_a  TEXT := E'  SELECT p.id INTO v_unit_id\n  FROM products p';
  v_pat    TEXT := 'AND daterange\(rr2\.start_date, rr2\.end_date, ''\[\]''\) &&\s+daterange\(v_effective_start, v_effective_end, ''\[\]''\)';
  v_rep    TEXT := 'AND (v_parent_sale OR daterange(rr2.start_date, rr2.end_date, ''[]'') && daterange(v_effective_start, v_effective_end, ''[]''))';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['promote_draft_reservation', 'create_hold_reservation'] LOOP
    IF v_fn = 'promote_draft_reservation' THEN
      v_sig := 'public.promote_draft_reservation(bigint,date,date,text,text)'::regprocedure;
      v_parent_expr := 'v_parent_id';
    ELSE
      v_sig := 'public.create_hold_reservation(uuid,date,date,text,text)'::regprocedure;
      v_parent_expr := 'p_product_id';
    END IF;

    SELECT pg_get_functiondef(v_sig) INTO v_def;
    CONTINUE WHEN position('v_parent_sale' IN v_def) > 0; -- 멱등

    v_cnt := (length(v_def) - length(replace(v_def, v_decl_a, ''))) / length(v_decl_a);
    IF v_cnt <> 1 THEN RAISE EXCEPTION '% decl anchor mismatch: %', v_fn, v_cnt; END IF;
    v_cnt := (length(v_def) - length(replace(v_def, v_sel_a, ''))) / length(v_sel_a);
    IF v_cnt <> 1 THEN RAISE EXCEPTION '% select anchor mismatch: %', v_fn, v_cnt; END IF;
    SELECT count(*) INTO v_cnt FROM regexp_matches(v_def, v_pat, 'g');
    IF v_cnt <> 1 THEN RAISE EXCEPTION '% daterange anchor mismatch: %', v_fn, v_cnt; END IF;

    v_def := replace(v_def, v_decl_a, v_decl_b);
    v_def := replace(
      v_def, v_sel_a,
      format(E'  SELECT COALESCE(sale_only, false) INTO v_parent_sale FROM products WHERE id = %s;\n\n', v_parent_expr) || v_sel_a
    );
    v_def := regexp_replace(v_def, v_pat, v_rep);
    EXECUTE v_def;
  END LOOP;
END
$do$;

-- ── 8) get_available_stock_counts — 판매전용 옵션이 hold로 잡은 수량 차감 ─────────────────────────
DO $do$
DECLARE
  v_def TEXT;
  v_cnt INT;
  v_pat TEXT := '\)::INT AS cnt';
  v_rep TEXT := E')::INT - CASE WHEN COALESCE((SELECT pp.sale_only FROM products pp WHERE pp.id = n.id), false)\n        THEN COALESCE((SELECT SUM(ro.qty) FROM reservation_options ro JOIN rental_reservations rr3 ON rr3.id = ro.reservation_id WHERE ro.option_product_id = n.id AND rr3.status = ''hold''), 0)::INT\n        ELSE 0 END AS cnt';
BEGIN
  SELECT pg_get_functiondef('public.get_available_stock_counts(uuid[])'::regprocedure) INTO v_def;
  IF position('rr3.status' IN v_def) > 0 THEN RETURN; END IF; -- 멱등
  SELECT count(*) INTO v_cnt FROM regexp_matches(v_def, v_pat, 'g');
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'get_available_stock_counts anchor mismatch: %', v_cnt; END IF;
  EXECUTE regexp_replace(v_def, v_pat, v_rep);
END
$do$;

-- 권한: 기존 함수의 ACL은 CREATE OR REPLACE가 보존한다(서버 전용 여부는 각 함수 기존 설정 유지).
-- update_reservation_status·set_reservation_options·assign_bundle_assets 등은 시그니처 불변.

-- ROLLBACK(참고용): 직전 본문은 supabase/migrations 내 각 함수의 최신 정의(#553·#547·#586·#588 등)를 재실행하고
--   private.apply_sale_stock_on_confirm / restore_sale_stock_on_cancel 은 DROP FUNCTION 으로 제거한다.
