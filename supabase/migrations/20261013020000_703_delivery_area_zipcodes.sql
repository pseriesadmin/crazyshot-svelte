-- Migration #703: 배송 가능 우편번호 카탈로그(두발히어로 서울·경기·인천 배송가능지역) (2026-10-13)
-- 두발히어로가 배송 가능한 우편번호·동·지역그룹 원본 목록. 시/군/구 허용지역(delivery_service_areas) 안에서
-- 실제 배송 가능한 동네(우편번호)만 통과시키는 정밀 판정과, CMS "더보기" 주소지 목록 모달의 근거 데이터다.
-- 데이터 적재는 scripts/import-delivery-zipcodes.mjs (service_role) — 이 파일은 구조·읽기 함수만 만든다.
-- 롤백: DROP FUNCTION public.get_delivery_zip_ranges(); DROP TABLE public.delivery_area_zipcodes;

CREATE TABLE IF NOT EXISTS public.delivery_area_zipcodes (
  postal_code  char(5) PRIMARY KEY,
  sido         text NOT NULL,
  sigungu      text NOT NULL,
  dong         text NOT NULL,
  group_name   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_area_zipcodes_postal_digits CHECK (postal_code ~ '^[0-9]{5}$')
);

CREATE INDEX IF NOT EXISTS delivery_area_zipcodes_region_idx
  ON public.delivery_area_zipcodes (sido, sigungu);

ALTER TABLE public.delivery_area_zipcodes ENABLE ROW LEVEL SECURITY;

-- 우편번호·동 이름뿐인 공개 참고 데이터 — 읽기만 공개, 쓰기는 service_role(RLS 우회)만
DROP POLICY IF EXISTS delivery_area_zipcodes_read ON public.delivery_area_zipcodes;
CREATE POLICY delivery_area_zipcodes_read ON public.delivery_area_zipcodes
  FOR SELECT TO anon, authenticated USING (true);

-- 시/군/구별 연속 우편번호 구간(gaps-and-islands) — 화면의 범위 표시와 장바구니 정밀 판정이 같은 구간을 쓴다
CREATE OR REPLACE FUNCTION public.get_delivery_zip_ranges()
RETURNS TABLE (sido text, sigungu text, range_start integer, range_end integer, zip_count integer)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH numbered AS (
    SELECT z.sido, z.sigungu, z.postal_code::integer AS n,
           z.postal_code::integer - (ROW_NUMBER() OVER (PARTITION BY z.sido, z.sigungu ORDER BY z.postal_code))::integer AS grp
    FROM public.delivery_area_zipcodes z
  )
  SELECT numbered.sido, numbered.sigungu,
         MIN(numbered.n) AS range_start, MAX(numbered.n) AS range_end, COUNT(*)::integer AS zip_count
  FROM numbered
  GROUP BY numbered.sido, numbered.sigungu, numbered.grp
  ORDER BY numbered.sido, numbered.sigungu, MIN(numbered.n);
$$;

GRANT EXECUTE ON FUNCTION public.get_delivery_zip_ranges() TO anon, authenticated, service_role;
