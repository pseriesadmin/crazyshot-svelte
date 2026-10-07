-- Migration #652: 결합상품 실물 "재배정" (CMS 예약/대여 상세 '상품 정보' 결합상품 행의 [재배정])
-- 2026-10-06 | Stephen GATE B 승인("B안으로 Phase A 전체 진행") | TDD: src/__tests__/services/bundleAssetReassign.test.ts
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
-- ⚠️ Production 적용은 Stage 라이브 테스트·sp3-qa 통과 + Stephen 승인 후. 코드 배포와 DB 적용은 별개 액션.
--
-- 규칙(메인 상품 재배정 cms_reassign_reservation_product_code와 같은 틀 + 결합 점유 규칙):
--  1) 대상 = reservation_bundle_assets 한 줄(예약 × 결합상품). 새 실물은 "같은 결합상품(부모)의 활성·미삭제 자식".
--  2) 예약 상태 hold·confirmed만(반출 이후 금지 — QR 스티커 불일치 방지).
--  3) 점유 판정은 assign_bundle_assets(Migration 547/611)와 같은 규칙 하나로 통일 —
--     비판매 결합상품: 다른 예약의 메인 배정 + 다른 예약의 결합 배정과 기간 겹침이 없어야 한다('[]' 양끝 포함, 종결·draft 제외).
--     판매전용 결합상품: 기간 무관, 비종결 예약의 메인/결합 배정에 쓰이지 않아야 한다.
--  4) 후보 조회와 교체가 같은 판정(private.bundle_asset_is_free)을 쓴다 — 화면에 나온 후보가 교체 때 거부되는 불일치 방지.
--  5) 메인 재배정 RPC(#465)·assign_bundle_assets는 변경하지 않는다(범위 외).
--
-- ROLLBACK: DROP FUNCTION public.cms_reassign_bundle_asset(BIGINT, UUID, UUID);
--           DROP FUNCTION public.cms_list_bundle_asset_candidates(BIGINT, UUID);
--           DROP FUNCTION private.bundle_asset_is_free(UUID, BOOLEAN, DATE, DATE, BIGINT);

-- ============================================================
-- 1. 점유 판정 헬퍼 (assign_bundle_assets 규칙과 동일)
-- ============================================================
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
         );
END;
$$;

REVOKE ALL ON FUNCTION private.bundle_asset_is_free(UUID, BOOLEAN, DATE, DATE, BIGINT) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 2. 후보 목록 — 이 예약의 결합상품 한 줄을 교체할 수 있는 같은 결합상품의 빈 실물
-- ============================================================
CREATE OR REPLACE FUNCTION public.cms_list_bundle_asset_candidates(
  p_reservation_id    BIGINT,
  p_bundle_product_id UUID
)
RETURNS TABLE(id UUID, product_code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_start    DATE;
  v_end      DATE;
  v_current  UUID;
  v_sale     BOOLEAN;
BEGIN
  SELECT rr.start_date, rr.end_date INTO v_start, v_end
    FROM rental_reservations rr WHERE rr.id = p_reservation_id;

  SELECT a.asset_product_id INTO v_current
    FROM reservation_bundle_assets a
   WHERE a.reservation_id = p_reservation_id AND a.bundle_product_id = p_bundle_product_id;

  IF v_start IS NULL OR v_end IS NULL OR v_current IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(bp.sale_only, false) INTO v_sale FROM products bp WHERE bp.id = p_bundle_product_id;

  RETURN QUERY
  SELECT c.id, c.product_code::TEXT
    FROM products c
   WHERE c.parent_product_id = p_bundle_product_id
     AND c.deleted_at IS NULL
     AND c.is_active = true
     AND c.id <> v_current
     AND private.bundle_asset_is_free(c.id, COALESCE(v_sale, false), v_start, v_end, p_reservation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.cms_list_bundle_asset_candidates(BIGINT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_list_bundle_asset_candidates(BIGINT, UUID) TO service_role;

-- ============================================================
-- 3. 교체
-- ============================================================
CREATE OR REPLACE FUNCTION public.cms_reassign_bundle_asset(
  p_reservation_id    BIGINT,
  p_bundle_product_id UUID,
  p_new_asset_id      UUID
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
  v_cur_asset UUID;
  v_sale      BOOLEAN;
  v_new_ok    UUID;
BEGIN
  SELECT status, start_date, end_date
    INTO v_status, v_start, v_end
    FROM rental_reservations
   WHERE id = p_reservation_id
   FOR UPDATE;

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

  SELECT a.asset_product_id INTO v_cur_asset
    FROM reservation_bundle_assets a
   WHERE a.reservation_id = p_reservation_id AND a.bundle_product_id = p_bundle_product_id
   FOR UPDATE;

  IF v_cur_asset IS NULL THEN
    RETURN QUERY SELECT false, '이 예약의 결합상품 배정 기록을 찾을 수 없습니다.'; RETURN;
  END IF;
  IF v_cur_asset = p_new_asset_id THEN
    RETURN QUERY SELECT false, '이미 배정된 재고입니다.'; RETURN;
  END IF;

  -- 같은 결합상품(부모)의 활성·미삭제 자식만
  IF NOT EXISTS (
    SELECT 1 FROM products c
     WHERE c.id = p_new_asset_id
       AND c.parent_product_id = p_bundle_product_id
       AND c.deleted_at IS NULL
       AND c.is_active = true
  ) THEN
    RETURN QUERY SELECT false, '같은 결합상품의 다른 재고단위로만 재배정할 수 있습니다.'; RETURN;
  END IF;

  SELECT COALESCE(bp.sale_only, false) INTO v_sale FROM products bp WHERE bp.id = p_bundle_product_id;

  -- 후보 행을 먼저 잠근 뒤(SKIP LOCKED) 별도 문장에서 점유를 재확인한다 — assign_bundle_assets와 같은 순서.
  SELECT c.id INTO v_new_ok
    FROM products c
   WHERE c.id = p_new_asset_id
   FOR UPDATE SKIP LOCKED;

  IF v_new_ok IS NULL
     OR NOT private.bundle_asset_is_free(p_new_asset_id, COALESCE(v_sale, false), v_start, v_end, p_reservation_id) THEN
    RETURN QUERY SELECT false, '선택한 재고가 이미 다른 예약에 배정되었습니다.'; RETURN;
  END IF;

  UPDATE reservation_bundle_assets
     SET asset_product_id = p_new_asset_id
   WHERE reservation_id = p_reservation_id
     AND bundle_product_id = p_bundle_product_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_reassign_bundle_asset(BIGINT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_reassign_bundle_asset(BIGINT, UUID, UUID) TO service_role;
