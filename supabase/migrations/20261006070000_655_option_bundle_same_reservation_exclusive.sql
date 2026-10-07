-- Migration #655: 한 예약 안에서 같은 실물이 결합 구성품과 옵션 두 역할을 맡지 못하게 점유 판정 보정
-- 2026-10-06 | #654(옵션 실물 배정) 후속 — TDD: src/__tests__/services/optionAssetAssign.test.ts (P15·P16)
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh) — #654 다음에 적용
--
-- 결함(#654): private.option_unit_is_free / private.bundle_asset_is_free가 "자기 예약"을 통째로 제외해,
--   같은 상품이 한 예약에서 결합 구성품이자 옵션으로 담기면 같은 실물이 두 역할에 배정될 수 있었다.
-- 수정:
--   · option_unit_is_free — 자기 예약의 메인·결합 배정도 점유로 본다(옵션 배정만 자기 예약 제외: 같은 옵션 안의 중복은 호출 쪽이 따로 막음).
--   · bundle_asset_is_free(비판매 분기) — 자기 예약의 옵션 배정도 점유로 본다(결합 배정은 자기 현재 배정을 교체하는 중이라 자기 예약 제외 유지).
-- ROLLBACK: #654의 두 함수 정의로 되돌린다.

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
              AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
              AND daterange(rr.start_date, rr.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
         )
     AND NOT EXISTS (
           SELECT 1
             FROM reservation_bundle_assets a
             JOIN rental_reservations rr2 ON rr2.id = a.reservation_id
            WHERE a.asset_product_id = p_asset_id
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
              AND rr3.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
              AND daterange(rr3.start_date, rr3.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
         );
END;
$$;

REVOKE ALL ON FUNCTION private.bundle_asset_is_free(UUID, BOOLEAN, DATE, DATE, BIGINT) FROM PUBLIC, anon, authenticated;
