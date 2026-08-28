-- Migration #372: 반납 배송선택 제한 — /cart 반납 설정에서 '배송' 반납방식 노출 여부 전역 토글
--
-- 배경: Stephen 요청 — CMS "/cms/set/rental > 대여옵션(수령/반납) 일괄적용" 아래에
-- "대여 제한옵션" 섹션을 신설하고 "반납 배송선택 제한" 콤보 버튼을 추가한다. ON이면
-- /cart 반납 설정에서 배송(rental_method_options.is_bulk_delivery=true인 방식) 반납
-- 옵션 자체가 선택 목록에서 사라지고, OFF면 기존처럼 그대로 노출된다.
--
-- 저장 위치: rental_shipping_settings 싱글톤(이미 CMS·cart 양쪽 load()에 로드돼 있어
-- 신규 쿼리 배선 없이 재사용 가능)에 컬럼만 추가 — 새 테이블 불필요.

ALTER TABLE rental_shipping_settings
  ADD COLUMN IF NOT EXISTS restrict_return_delivery BOOLEAN NOT NULL DEFAULT false;

-- toggle_rental_method_bulk_delivery(Migration 339)와 동일한 단순 토글 패턴 — 다만
-- 대상이 per-row가 아니라 싱글톤 전체이므로 id 파라미터 없이 WHERE true로 갱신
-- (upsert_rental_shipping_settings와 동일한 싱글톤 갱신 방식).
CREATE OR REPLACE FUNCTION public.toggle_return_delivery_restriction()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row rental_shipping_settings;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  UPDATE rental_shipping_settings
  SET restrict_return_delivery = NOT restrict_return_delivery
  WHERE true
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: rental_shipping_settings singleton row missing';
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_return_delivery_restriction() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.toggle_return_delivery_restriction() FROM anon;
GRANT EXECUTE ON FUNCTION public.toggle_return_delivery_restriction() TO authenticated;
