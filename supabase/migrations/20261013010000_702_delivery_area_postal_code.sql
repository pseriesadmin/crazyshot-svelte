-- Migration #702: 배송 허용지역에 "등록 때 고른 주소의 우편번호" 저장 (2026-10-13)
-- 주소 검색으로 등록한 지역은 그때 고른 주소의 우편번호(표시용 참고값)를 저장하고, 지도 클릭 등록·"시/도 전체" 등록·기존 행은 NULL(화면에는 '-').
-- 판정(private.is_address_in_delivery_area)에는 쓰지 않는다 — 표시 전용.
-- 등록 함수는 인자가 늘어 시그니처가 바뀌므로 옛 5-인자 함수를 지우고 새로 만든다(오버로드 공존 시 PostgREST 모호성 방지).
-- 롤백: ALTER TABLE ... DROP COLUMN postal_code; 옛 5-인자 cms_add_delivery_area를 Migration 700 정의로 복원.

ALTER TABLE public.delivery_service_areas
  ADD COLUMN IF NOT EXISTS postal_code text;

DROP FUNCTION IF EXISTS public.cms_add_delivery_area(text, text, double precision, double precision, uuid);

CREATE OR REPLACE FUNCTION public.cms_add_delivery_area(
  p_sido text,
  p_sigungu text,
  p_lat double precision,
  p_lng double precision,
  p_user_id uuid,
  p_postal_code text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_sido text := private.normalize_sido(p_sido);
  v_sigungu text := nullif(btrim(coalesce(p_sigungu, '')), '');
  v_postal text := nullif(btrim(coalesce(p_postal_code, '')), '');
  v_id uuid;
BEGIN
  IF v_sido IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_sido');
  END IF;
  IF v_sido = '세종' THEN
    v_sigungu := NULL;
  END IF;
  -- 우편번호는 숫자 5자리일 때만 저장(아니면 NULL)
  IF v_postal IS NOT NULL AND v_postal !~ '^[0-9]{5}$' THEN
    v_postal := NULL;
  END IF;

  INSERT INTO public.delivery_service_areas (sido, sigungu, lat, lng, created_by, postal_code)
  VALUES (v_sido, v_sigungu, p_lat, p_lng, p_user_id, v_postal)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'duplicate');
END;
$$;

REVOKE ALL ON FUNCTION public.cms_add_delivery_area(text, text, double precision, double precision, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cms_add_delivery_area(text, text, double precision, double precision, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_add_delivery_area(text, text, double precision, double precision, uuid, text) TO service_role;
