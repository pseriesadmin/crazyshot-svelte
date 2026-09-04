-- 441_rental_method_delivery_type_toggle_rpc.sql
--
-- ① 신규 RPC: toggle_rental_method_delivery_type — is_delivery_type 전용 토글(440에서 추가한
--    컬럼). toggle_rental_method_bulk_delivery/toggle_rental_method_courier_dependent와 동일한
--    패턴(SECURITY DEFINER + is_cms_user() 게이트 + RETURNING).
--
-- ② 상호배타 가드(Stephen 확정, 2026-09-04): 같은 방식(행) 하나가 is_bulk_delivery와
--    is_delivery_type을 동시에 true로 가질 수 없다 — "일괄적용"(요청 A: 수령=이 방식 선택 시
--    반납 자동강제복사+시간선택 비활성화)이 켜진 방식은 반납이 이미 그 값으로 고정되므로
--    "반납 배송선택 제한" 판정 대상으로 삼는 것 자체가 의미 없다(Stephen 지적). 두 RPC 모두
--    상대쪽 플래그가 이미 true인 행에는 자신을 true로 켜는 것을 차단한다(끄는 것은 항상 허용).
CREATE OR REPLACE FUNCTION public.toggle_rental_method_delivery_type(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row rental_method_options;
  v_current rental_method_options;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  SELECT * INTO v_current FROM rental_method_options WHERE id = p_id AND deleted_at IS NULL;
  IF v_current.id IS NULL THEN
    RAISE EXCEPTION 'not_found: rental_method_option id %', p_id;
  END IF;

  IF NOT v_current.is_delivery_type AND v_current.is_bulk_delivery THEN
    RAISE EXCEPTION 'conflict: bulk_delivery_already_on — 이 방식은 이미 "대여옵션(수령/반납) 일괄적용"이 켜져 있어 "반납 배송선택 제한" 대상으로 동시 지정할 수 없습니다.';
  END IF;

  UPDATE rental_method_options
  SET is_delivery_type = NOT is_delivery_type
  WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.toggle_rental_method_bulk_delivery(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row rental_method_options;
  v_current rental_method_options;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  SELECT * INTO v_current FROM rental_method_options WHERE id = p_id AND deleted_at IS NULL;
  IF v_current.id IS NULL THEN
    RAISE EXCEPTION 'not_found: rental_method_option id %', p_id;
  END IF;

  IF NOT v_current.is_bulk_delivery AND v_current.is_delivery_type THEN
    RAISE EXCEPTION 'conflict: delivery_type_already_on — 이 방식은 이미 "반납 배송선택 제한" 대상으로 지정되어 있어 "대여옵션(수령/반납) 일괄적용"을 동시에 설정할 수 없습니다.';
  END IF;

  UPDATE rental_method_options
  SET is_bulk_delivery = NOT is_bulk_delivery
  WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.toggle_rental_method_delivery_type(uuid) TO authenticated;
