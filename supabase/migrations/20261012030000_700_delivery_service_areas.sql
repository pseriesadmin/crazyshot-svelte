-- Migration #700: 배송 허용지역(delivery_service_areas) + 판정 함수 + 등록·삭제 RPC (2026-10-12)
-- 정책: 허용지역이 1건 이상 등록돼 있을 때만 제한이 적용된다(0건이면 전체 허용).
-- 판정 규칙은 src/lib/utils/deliveryArea.ts(isAddressInDeliveryArea)와 같아야 한다 — 두 곳을 함께 바꿀 것.
-- 롤백: DROP FUNCTION public.cms_add_delivery_area, public.cms_delete_delivery_area,
--       private.is_address_in_delivery_area, private.normalize_sido; DROP TABLE public.delivery_service_areas;

CREATE TABLE IF NOT EXISTS public.delivery_service_areas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sido        text NOT NULL,
  sigungu     text,
  lat         double precision,
  lng         double precision,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_service_areas_active_uq
  ON public.delivery_service_areas (sido, (coalesce(sigungu, '')))
  WHERE deleted_at IS NULL;

ALTER TABLE public.delivery_service_areas ENABLE ROW LEVEL SECURITY;

-- 읽기만 공개(지역 이름뿐, 개인정보 없음). 쓰기 정책은 없다 — 등록·삭제는 service_role RPC만.
DROP POLICY IF EXISTS delivery_service_areas_read ON public.delivery_service_areas;
CREATE POLICY delivery_service_areas_read ON public.delivery_service_areas
  FOR SELECT TO anon, authenticated USING (deleted_at IS NULL);

-- 시/도 이름 → 약칭
CREATE OR REPLACE FUNCTION private.normalize_sido(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE regexp_replace(coalesce(p_raw, ''), '\s+', '', 'g')
    WHEN '서울' THEN '서울' WHEN '서울시' THEN '서울' WHEN '서울특별시' THEN '서울'
    WHEN '부산' THEN '부산' WHEN '부산시' THEN '부산' WHEN '부산광역시' THEN '부산'
    WHEN '대구' THEN '대구' WHEN '대구시' THEN '대구' WHEN '대구광역시' THEN '대구'
    WHEN '인천' THEN '인천' WHEN '인천시' THEN '인천' WHEN '인천광역시' THEN '인천'
    WHEN '광주' THEN '광주' WHEN '광주시' THEN '광주' WHEN '광주광역시' THEN '광주'
    WHEN '대전' THEN '대전' WHEN '대전시' THEN '대전' WHEN '대전광역시' THEN '대전'
    WHEN '울산' THEN '울산' WHEN '울산시' THEN '울산' WHEN '울산광역시' THEN '울산'
    WHEN '세종' THEN '세종' WHEN '세종시' THEN '세종' WHEN '세종특별자치시' THEN '세종'
    WHEN '경기' THEN '경기' WHEN '경기도' THEN '경기'
    WHEN '강원' THEN '강원' WHEN '강원도' THEN '강원' WHEN '강원특별자치도' THEN '강원'
    WHEN '충북' THEN '충북' WHEN '충청북도' THEN '충북'
    WHEN '충남' THEN '충남' WHEN '충청남도' THEN '충남'
    WHEN '전북' THEN '전북' WHEN '전라북도' THEN '전북' WHEN '전북특별자치도' THEN '전북'
    WHEN '전남' THEN '전남' WHEN '전라남도' THEN '전남'
    WHEN '경북' THEN '경북' WHEN '경상북도' THEN '경북'
    WHEN '경남' THEN '경남' WHEN '경상남도' THEN '경남'
    WHEN '제주' THEN '제주' WHEN '제주도' THEN '제주' WHEN '제주특별자치도' THEN '제주'
    ELSE NULL
  END;
$$;

-- 도로명 주소가 배송 허용지역 안인지. 허용지역이 없으면 true.
CREATE OR REPLACE FUNCTION private.is_address_in_delivery_area(p_road text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, private
AS $$
DECLARE
  v_tokens  text[];
  v_sido    text;
  v_sigungu text;
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
  );
END;
$$;

-- 등록 (service_role 전용). 같은 지역이 이미 있으면 duplicate.
CREATE OR REPLACE FUNCTION public.cms_add_delivery_area(
  p_sido text,
  p_sigungu text,
  p_lat double precision,
  p_lng double precision,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_sido text := private.normalize_sido(p_sido);
  v_sigungu text := nullif(btrim(coalesce(p_sigungu, '')), '');
  v_id uuid;
BEGIN
  IF v_sido IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_sido');
  END IF;
  IF v_sido = '세종' THEN
    v_sigungu := NULL;
  END IF;

  INSERT INTO public.delivery_service_areas (sido, sigungu, lat, lng, created_by)
  VALUES (v_sido, v_sigungu, p_lat, p_lng, p_user_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'duplicate');
END;
$$;

-- 삭제(소프트). service_role 전용.
CREATE OR REPLACE FUNCTION public.cms_delete_delivery_area(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  UPDATE public.delivery_service_areas SET deleted_at = now()
  WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cms_add_delivery_area(text, text, double precision, double precision, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cms_add_delivery_area(text, text, double precision, double precision, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_add_delivery_area(text, text, double precision, double precision, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.cms_delete_delivery_area(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cms_delete_delivery_area(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_delete_delivery_area(uuid) TO service_role;

-- private 스키마 함수는 set_reservation_shipment_method(SECURITY DEFINER) 내부에서만 호출
REVOKE ALL ON FUNCTION private.normalize_sido(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_address_in_delivery_area(text) FROM PUBLIC;
