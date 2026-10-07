-- Migration #654: 옵션상품 실물 배정 테이블 + 재배정 (reservation_option_assets)
-- 2026-10-06 | Stephen 지시("옵션 별 실물 배정 테이블 신설, 옵션도 부모상품으로서 가용 자식재고 품번코드 재배정 가능") |
-- TDD: src/__tests__/services/optionAssetAssign.test.ts
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
--
-- 배경: reservation_options는 "1행 + qty 정수"만 기록하고 실물 재고(자식) 연결이 없었다(Production 32행·Stage 57행 전부 부모 상품 참조).
--       결합상품(#547)처럼 옵션도 qty만큼 실물을 배정·표시·재배정할 수 있게 한다.
--
-- 규칙:
--  1) 옵션 1행(reservation_options) × qty = 실물 배정 qty건(reservation_option_assets). 옵션 상품이 부모면 그 활성 자식 중에서 배정.
--  2) 배정은 best-effort — 가용 실물이 qty보다 적으면 가능한 만큼만 배정하고 주문·저장은 막지 않는다(기존 옵션 재고 검사 OPTION_STOCK_EXCEEDED는 무변경).
--  3) 배정 시점: ① set_reservation_options 끝(예약 status='hold'일 때, 실패해도 옵션 저장은 성공) ② cms_ensure_reservation_option_assets(관리자 상세 조회 시 보정).
--     배정 대상 상태는 hold·confirmed만 — 반출 이후(shipped 이상) 예약은 과거에 실제로 나간 옵션 실물을 알 수 없어 임의 배정하지 않는다(미추적).
--  4) 판매전용(sale_only) 옵션은 제외 — 확정 시 재고 비활성+마커 방식(#611)이 이미 있다.
--  5) 점유 판정(private.option_unit_is_free): 다른 비종결 예약(종결·draft 제외)의 메인 배정·결합 배정·옵션 배정과 기간 겹침('[]') 없음.
--     결합상품 재배정 판정(private.bundle_asset_is_free, #652)에도 옵션 배정 점유를 추가해 세 점유원이 서로를 본다.
--  6) 재배정(cms_reassign_option_asset): hold·confirmed만, 같은 옵션 부모의 활성 자식, 이 예약의 다른 옵션 항목에 이미 쓰인 실물 제외.
--  7) 옵션 저장은 delete+insert라 옵션 행 id가 새로 생긴다 — 배정은 FK CASCADE로 지워지고 다시 배정된다(고객이 옵션을 다시 저장하면 수동 재배정은 초기화).
--  8) 기존 hold·confirmed 예약은 마이그레이션 끝에서 한 번 백필한다(예약별 fail-soft).
--
-- ROLLBACK: DROP TABLE reservation_option_assets CASCADE; 함수 DROP; set_reservation_options·private.bundle_asset_is_free를 직전 정의로 복원.

-- ============================================================
-- 1. 배정 기록표
-- ============================================================
CREATE TABLE IF NOT EXISTS public.reservation_option_assets (
  id                    BIGSERIAL   PRIMARY KEY,
  reservation_id        BIGINT      NOT NULL REFERENCES public.rental_reservations(id) ON DELETE CASCADE,
  reservation_option_id BIGINT      NOT NULL REFERENCES public.reservation_options(id) ON DELETE CASCADE,
  option_product_id     UUID        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE, -- 옵션 상품(부모)
  asset_product_id      UUID        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE, -- 배정된 실물(자식)
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reservation_option_id, asset_product_id),
  UNIQUE (reservation_id, asset_product_id)
);

CREATE INDEX IF NOT EXISTS idx_reservation_option_assets_asset ON public.reservation_option_assets (asset_product_id);
CREATE INDEX IF NOT EXISTS idx_reservation_option_assets_reservation ON public.reservation_option_assets (reservation_id);

-- RLS 활성 + 정책 없음 = RPC(SECURITY DEFINER)·service_role 전용
ALTER TABLE public.reservation_option_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_option_assets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.reservation_option_assets TO service_role;
REVOKE ALL ON SEQUENCE public.reservation_option_assets_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.reservation_option_assets_id_seq TO service_role;

-- ============================================================
-- 2. 점유 판정 — 옵션 실물(비판매)
-- ============================================================
CREATE OR REPLACE FUNCTION private.option_unit_is_free(
  p_asset_id            UUID,
  p_start_date          DATE,
  p_end_date            DATE,
  p_exclude_reservation BIGINT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT NOT EXISTS (
           SELECT 1 FROM rental_reservations rr
            WHERE rr.product_id = p_asset_id
              AND rr.id <> p_exclude_reservation
              AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
              AND daterange(rr.start_date, rr.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
         )
     AND NOT EXISTS (
           SELECT 1
             FROM reservation_bundle_assets a
             JOIN rental_reservations rr2 ON rr2.id = a.reservation_id
            WHERE a.asset_product_id = p_asset_id
              AND a.reservation_id <> p_exclude_reservation
              AND rr2.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
              AND daterange(rr2.start_date, rr2.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
         )
     AND NOT EXISTS (
           SELECT 1
             FROM reservation_option_assets oa
             JOIN rental_reservations rr3 ON rr3.id = oa.reservation_id
            WHERE oa.asset_product_id = p_asset_id
              AND oa.reservation_id <> p_exclude_reservation
              AND rr3.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
              AND daterange(rr3.start_date, rr3.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
         );
$$;

REVOKE ALL ON FUNCTION private.option_unit_is_free(UUID, DATE, DATE, BIGINT) FROM PUBLIC, anon, authenticated;

-- 결합상품 재배정 판정(#652)에도 옵션 배정 점유를 추가 — 비판매 분기만(판매전용 옵션은 배정 대상이 아님)
CREATE OR REPLACE FUNCTION private.bundle_asset_is_free(
  p_asset_id             UUID,
  p_sale_only            BOOLEAN,
  p_start_date           DATE,
  p_end_date             DATE,
  p_exclude_reservation  BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
BEGIN
  IF p_sale_only THEN
    RETURN NOT EXISTS (
             SELECT 1 FROM rental_reservations rr
              WHERE rr.product_id = p_asset_id
                AND rr.id <> p_exclude_reservation
                AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
           )
       AND NOT EXISTS (
             SELECT 1
               FROM reservation_bundle_assets a
               JOIN rental_reservations rr2 ON rr2.id = a.reservation_id
              WHERE a.asset_product_id = p_asset_id
                AND a.reservation_id <> p_exclude_reservation
                AND rr2.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
           );
  END IF;

  RETURN NOT EXISTS (
           SELECT 1 FROM rental_reservations rr
            WHERE rr.product_id = p_asset_id
              AND rr.id <> p_exclude_reservation
              AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
              AND daterange(rr.start_date, rr.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
         )
     AND NOT EXISTS (
           SELECT 1
             FROM reservation_bundle_assets a
             JOIN rental_reservations rr2 ON rr2.id = a.reservation_id
            WHERE a.asset_product_id = p_asset_id
              AND a.reservation_id <> p_exclude_reservation
              AND rr2.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
              AND daterange(rr2.start_date, rr2.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
         )
     AND NOT EXISTS (
           SELECT 1
             FROM reservation_option_assets oa
             JOIN rental_reservations rr3 ON rr3.id = oa.reservation_id
            WHERE oa.asset_product_id = p_asset_id
              AND oa.reservation_id <> p_exclude_reservation
              AND rr3.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
              AND daterange(rr3.start_date, rr3.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
         );
END;
$$;

REVOKE ALL ON FUNCTION private.bundle_asset_is_free(UUID, BOOLEAN, DATE, DATE, BIGINT) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3. 배정 함수 — 옵션 행마다 qty만큼 (best-effort)
-- ============================================================
CREATE OR REPLACE FUNCTION private.assign_option_assets(p_reservation_id BIGINT)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_status TEXT;
  v_start  DATE;
  v_end    DATE;
  v_opt    RECORD;
  v_have   INTEGER;
  v_need   INTEGER;
  v_cand   UUID;
BEGIN
  SELECT status, start_date, end_date INTO v_status, v_start, v_end
    FROM rental_reservations WHERE id = p_reservation_id FOR UPDATE;

  -- hold·confirmed만. 반출 이후는 실제로 나간 옵션 실물을 알 수 없어 배정하지 않는다(미추적).
  IF v_status IS NULL OR v_status NOT IN ('hold', 'confirmed') OR v_start IS NULL OR v_end IS NULL THEN
    RETURN;
  END IF;

  FOR v_opt IN
    SELECT ro.id AS option_id, ro.qty, COALESCE(p.parent_product_id, p.id) AS parent_id
      FROM reservation_options ro
      JOIN products p ON p.id = ro.option_product_id
      LEFT JOIN products par ON par.id = p.parent_product_id
     WHERE ro.reservation_id = p_reservation_id
       AND NOT COALESCE(par.sale_only, p.sale_only, false)
     ORDER BY ro.id
  LOOP
    SELECT COUNT(*) INTO v_have FROM reservation_option_assets WHERE reservation_option_id = v_opt.option_id;

    IF v_have > v_opt.qty THEN
      DELETE FROM reservation_option_assets
       WHERE id IN (SELECT id FROM reservation_option_assets
                     WHERE reservation_option_id = v_opt.option_id
                     ORDER BY id DESC LIMIT (v_have - v_opt.qty));
      v_have := v_opt.qty;
    END IF;

    v_need := v_opt.qty - v_have;
    CONTINUE WHEN v_need <= 0;

    FOR v_cand IN
      SELECT c.id
        FROM products c
       WHERE c.parent_product_id = v_opt.parent_id
         AND c.deleted_at IS NULL
         AND c.is_active = true
         AND NOT EXISTS (
           SELECT 1 FROM reservation_option_assets x
            WHERE x.reservation_id = p_reservation_id AND x.asset_product_id = c.id
         )
       ORDER BY c.created_at, c.id
       FOR UPDATE SKIP LOCKED
    LOOP
      IF private.option_unit_is_free(v_cand, v_start, v_end, p_reservation_id) THEN
        INSERT INTO reservation_option_assets (reservation_id, reservation_option_id, option_product_id, asset_product_id)
        VALUES (p_reservation_id, v_opt.option_id, v_opt.parent_id, v_cand);
        v_need := v_need - 1;
        EXIT WHEN v_need = 0;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION private.assign_option_assets(BIGINT) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 4. set_reservation_options — 기존 본문 그대로 + 끝에서 배정(실패해도 옵션 저장은 성공)
-- ============================================================
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

  -- 옵션 실물 배정(Migration 654) — best-effort: 실패해도 옵션 저장·주문은 막지 않는다
  BEGIN
    PERFORM private.assign_option_assets(p_reservation_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$function$;

-- ============================================================
-- 5. CMS용 RPC (service_role 전용)
-- ============================================================
CREATE OR REPLACE FUNCTION public.cms_ensure_reservation_option_assets(p_reservation_id BIGINT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM private.assign_option_assets(p_reservation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.cms_ensure_reservation_option_assets(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_ensure_reservation_option_assets(BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.cms_list_option_asset_candidates(
  p_reservation_id  BIGINT,
  p_option_asset_id BIGINT
)
RETURNS TABLE(id UUID, product_code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_start   DATE;
  v_end     DATE;
  v_parent  UUID;
  v_current UUID;
BEGIN
  SELECT rr.start_date, rr.end_date INTO v_start, v_end
    FROM rental_reservations rr WHERE rr.id = p_reservation_id;

  SELECT oa.option_product_id, oa.asset_product_id INTO v_parent, v_current
    FROM reservation_option_assets oa
   WHERE oa.id = p_option_asset_id AND oa.reservation_id = p_reservation_id;

  IF v_start IS NULL OR v_end IS NULL OR v_current IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT c.id, c.product_code::TEXT
    FROM products c
   WHERE c.parent_product_id = v_parent
     AND c.deleted_at IS NULL
     AND c.is_active = true
     AND c.id <> v_current
     AND NOT EXISTS (
       SELECT 1 FROM reservation_option_assets x
        WHERE x.reservation_id = p_reservation_id AND x.asset_product_id = c.id
     )
     AND private.option_unit_is_free(c.id, v_start, v_end, p_reservation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.cms_list_option_asset_candidates(BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_list_option_asset_candidates(BIGINT, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.cms_reassign_option_asset(
  p_reservation_id  BIGINT,
  p_option_asset_id BIGINT,
  p_new_asset_id    UUID
)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status    TEXT;
  v_start     DATE;
  v_end       DATE;
  v_parent    UUID;
  v_cur_asset UUID;
  v_new_ok    UUID;
BEGIN
  SELECT status, start_date, end_date INTO v_status, v_start, v_end
    FROM rental_reservations WHERE id = p_reservation_id FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT false, '예약을 찾을 수 없습니다.'; RETURN;
  END IF;
  IF v_status = 'expired' THEN
    RETURN QUERY SELECT false, '예약이 만료되어 재고를 재배정할 수 없습니다.'; RETURN;
  END IF;
  IF v_status = 'cancelled' THEN
    RETURN QUERY SELECT false, '취소된 예약은 재고를 재배정할 수 없습니다.'; RETURN;
  END IF;
  IF NOT (v_status = 'hold' OR v_status = 'confirmed') THEN
    RETURN QUERY SELECT false, '반출 이후(대여 진행 중) 예약은 재고를 재배정할 수 없습니다.'; RETURN;
  END IF;
  IF v_start IS NULL OR v_end IS NULL THEN
    RETURN QUERY SELECT false, '예약 기간 정보가 없어 재배정할 수 없습니다.'; RETURN;
  END IF;

  SELECT oa.option_product_id, oa.asset_product_id INTO v_parent, v_cur_asset
    FROM reservation_option_assets oa
   WHERE oa.id = p_option_asset_id AND oa.reservation_id = p_reservation_id
   FOR UPDATE;

  IF v_cur_asset IS NULL THEN
    RETURN QUERY SELECT false, '이 예약의 옵션상품 배정 기록을 찾을 수 없습니다.'; RETURN;
  END IF;
  IF v_cur_asset = p_new_asset_id THEN
    RETURN QUERY SELECT false, '이미 배정된 재고입니다.'; RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM products c
     WHERE c.id = p_new_asset_id
       AND c.parent_product_id = v_parent
       AND c.deleted_at IS NULL
       AND c.is_active = true
  ) THEN
    RETURN QUERY SELECT false, '같은 옵션상품의 다른 재고단위로만 재배정할 수 있습니다.'; RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM reservation_option_assets x
     WHERE x.reservation_id = p_reservation_id AND x.asset_product_id = p_new_asset_id
  ) THEN
    RETURN QUERY SELECT false, '이 예약의 다른 옵션 항목에 이미 배정된 재고입니다.'; RETURN;
  END IF;

  SELECT c.id INTO v_new_ok
    FROM products c WHERE c.id = p_new_asset_id
   FOR UPDATE SKIP LOCKED;

  IF v_new_ok IS NULL
     OR NOT private.option_unit_is_free(p_new_asset_id, v_start, v_end, p_reservation_id) THEN
    RETURN QUERY SELECT false, '선택한 재고가 이미 다른 예약에 배정되었습니다.'; RETURN;
  END IF;

  UPDATE reservation_option_assets
     SET asset_product_id = p_new_asset_id
   WHERE id = p_option_asset_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_reassign_option_asset(BIGINT, BIGINT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_reassign_option_asset(BIGINT, BIGINT, UUID) TO service_role;

-- ============================================================
-- 6. 백필 — 기존 hold·confirmed 예약(예약별 fail-soft)
-- ============================================================
DO $$
DECLARE
  v_id BIGINT;
BEGIN
  FOR v_id IN
    SELECT DISTINCT rr.id
      FROM rental_reservations rr
      JOIN reservation_options ro ON ro.reservation_id = rr.id
     WHERE rr.status IN ('hold', 'confirmed')
     ORDER BY rr.id
  LOOP
    BEGIN
      PERFORM private.assign_option_assets(v_id);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END;
$$;
