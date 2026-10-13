-- Migration #704: 예약에 수령 주소 우편번호 저장 + 서버 배송 허용지역 판정을 우편번호 기준으로 (2026-10-13)
-- ① rental_reservations.pickup_postal_code 컬럼 추가 — 장바구니가 이미 알고 있는 우편번호를 예약에 남긴다
--    (두발히어로 접수가 우편번호를 고객 저장 배송지에서 찾던 한계도 해소한다).
-- ② private.is_address_in_delivery_area(road, postal) — 허용지역에 우편번호 카탈로그(#703)가 있으면 그 지역 안의 우편번호만 통과.
--    카탈로그가 없는 지역·우편번호를 모르는 경우는 시군구 단위(기존과 동일). TS deliveryArea.ts isAddressInDeliveryArea와 같은 규칙.
-- ③ set_reservation_shipment_method 11-인자 → 12-인자(p_pickup_postal_code 추가). 라이브 정의에서 정확히 일치하는 곳만 치환한다
--    (앵커가 없으면 중단). 옛 11-인자 함수는 삭제(오버로드 공존 시 PostgREST 모호성 방지).
-- 롤백: 12-인자 함수를 지우고 Migration 701 정의의 11-인자 함수 복원, is_address_in_delivery_area를 700 정의로 복원, 컬럼 DROP.

ALTER TABLE public.rental_reservations
  ADD COLUMN IF NOT EXISTS pickup_postal_code text;

-- ② 2-인자 판정 함수 (1-인자는 새 함수 생성 뒤 삭제)
CREATE OR REPLACE FUNCTION private.is_address_in_delivery_area(p_road text, p_postal text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, private
AS $$
DECLARE
  v_tokens  text[];
  v_sido    text;
  v_sigungu text;
  v_postal  text := nullif(btrim(coalesce(p_postal, '')), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.delivery_service_areas WHERE deleted_at IS NULL) THEN
    RETURN true;
  END IF;

  v_tokens := regexp_split_to_array(btrim(coalesce(p_road, '')), '\s+');
  v_sido := private.normalize_sido(v_tokens[1]);
  IF v_sido IS NULL THEN
    RETURN false;
  END IF;

  IF v_sido <> '세종' AND v_tokens[2] IS NOT NULL AND v_tokens[2] <> '' THEN
    IF v_tokens[2] ~ '시$' AND v_tokens[3] IS NOT NULL AND v_tokens[3] ~ '구$' THEN
      v_sigungu := v_tokens[2] || ' ' || v_tokens[3];
    ELSE
      v_sigungu := v_tokens[2];
    END IF;
  END IF;

  IF v_postal IS NOT NULL AND v_postal !~ '^[0-9]{5}$' THEN
    v_postal := NULL;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.delivery_service_areas a
    WHERE a.deleted_at IS NULL
      AND private.normalize_sido(a.sido) = v_sido
      AND (
        nullif(btrim(coalesce(a.sigungu, '')), '') IS NULL
        OR v_sigungu = btrim(a.sigungu)
        OR v_sigungu LIKE btrim(a.sigungu) || ' %'
      )
      AND (
        -- 우편번호를 모르거나, 시/도 전체 등록이거나, 이 지역에 카탈로그가 없으면 시군구 단위로 통과
        v_postal IS NULL
        OR nullif(btrim(coalesce(a.sigungu, '')), '') IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.delivery_area_zipcodes z
          WHERE z.sido = private.normalize_sido(a.sido) AND z.sigungu = btrim(a.sigungu)
        )
        -- 카탈로그가 있으면 그 지역의 우편번호여야 통과
        OR EXISTS (
          SELECT 1 FROM public.delivery_area_zipcodes z
          WHERE z.postal_code = v_postal
            AND z.sido = private.normalize_sido(a.sido) AND z.sigungu = btrim(a.sigungu)
        )
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION private.is_address_in_delivery_area(text, text) FROM PUBLIC;

-- ③ set_reservation_shipment_method 12-인자 교체 (11-인자 라이브 정의를 치환)
DO $$
DECLARE
  v_oid  oid;
  v_def  text;
  v_new  text;
  v_sig_old text := E'p_return_point_id uuid DEFAULT NULL::uuid)';
  v_sig_new text := E'p_return_point_id uuid DEFAULT NULL::uuid, p_pickup_postal_code text DEFAULT NULL::text)';
  v_guard_old text := 'private.is_address_in_delivery_area(p_pickup_address_road)';
  v_guard_new text := 'private.is_address_in_delivery_area(p_pickup_address_road, p_pickup_postal_code)';
  v_set_old text := E'    pickup_address_detail       = COALESCE(p_pickup_address_detail, pickup_address_detail),\n';
  v_set_new text := E'    pickup_address_detail       = COALESCE(p_pickup_address_detail, pickup_address_detail),\n    pickup_postal_code          = COALESCE(p_pickup_postal_code, pickup_postal_code),\n';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'set_reservation_shipment_method' AND p.pronargs = 11;
  IF v_oid IS NULL THEN
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = 'set_reservation_shipment_method' AND p.pronargs = 12) THEN
      RAISE NOTICE '이미 12-인자 — 건너뜀';
      RETURN;
    END IF;
    RAISE EXCEPTION '대상 함수(11개 인자)를 찾지 못했습니다';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  IF position(v_sig_old IN v_def) = 0 OR position(v_guard_old IN v_def) = 0 OR position(v_set_old IN v_def) = 0 THEN
    RAISE EXCEPTION '앵커를 찾지 못했습니다 — 라이브 정의가 예상과 다릅니다';
  END IF;

  v_new := replace(v_def, v_sig_old, v_sig_new);
  v_new := replace(v_new, v_guard_old, v_guard_new);
  v_new := replace(v_new, v_set_old, v_set_new);

  DROP FUNCTION public.set_reservation_shipment_method(bigint, text, text, text, text, text, text, text, text, uuid, uuid);
  EXECUTE v_new;

  REVOKE ALL ON FUNCTION public.set_reservation_shipment_method(bigint, text, text, text, text, text, text, text, text, uuid, uuid, text) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.set_reservation_shipment_method(bigint, text, text, text, text, text, text, text, text, uuid, uuid, text) FROM anon;
  GRANT EXECUTE ON FUNCTION public.set_reservation_shipment_method(bigint, text, text, text, text, text, text, text, text, uuid, uuid, text) TO authenticated, service_role;
END $$;

-- 1-인자 판정 함수 삭제 (모든 호출부가 2-인자로 바뀐 뒤)
DROP FUNCTION IF EXISTS private.is_address_in_delivery_area(text);
