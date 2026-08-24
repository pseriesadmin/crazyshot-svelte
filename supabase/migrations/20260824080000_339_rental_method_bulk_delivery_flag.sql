-- Migration #339: rental_method_options에 '배송대여 수령/반납 일괄 지정' 플래그 추가
--
-- 배경: 요청 A(반납방식 고정 + 시간선택 비활성화)의 "배송" 판정 대상(delivery·crazydelivery)이
-- cart/+page.svelte에 하드코딩돼 있어 CMS에서 확인·변경할 방법이 없었다. Stephen 요청으로
-- /cms/set/rental에 콤보 버튼 UI를 추가해, 등록된 대여방식 중 어떤 것을 "배송대여 수령/반납
-- 일괄 지정"(반납방식 강제고정 + 시간선택 비활성) 대상으로 삼을지 관리자가 직접 토글하도록
-- 전환한다.

ALTER TABLE rental_method_options
  ADD COLUMN IF NOT EXISTS is_bulk_delivery BOOLEAN NOT NULL DEFAULT false;

-- 기존 하드코딩 규칙(Stephen 확정 — delivery·crazydelivery)을 시딩값으로 그대로 이관
UPDATE rental_method_options
SET is_bulk_delivery = true
WHERE method_key IN ('delivery', 'crazydelivery') AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.toggle_rental_method_bulk_delivery(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row rental_method_options;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  UPDATE rental_method_options
  SET is_bulk_delivery = NOT is_bulk_delivery
  WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: rental_method_option id %', p_id;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_rental_method_bulk_delivery(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.toggle_rental_method_bulk_delivery(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.toggle_rental_method_bulk_delivery(UUID) TO authenticated;
