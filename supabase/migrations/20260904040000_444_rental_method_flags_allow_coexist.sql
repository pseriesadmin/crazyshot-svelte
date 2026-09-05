-- Migration #444: is_bulk_delivery / is_delivery_type 상호배타 가드 제거
--
-- 배경(2026-09-04, Stephen 확정): 크레이지샷배송처럼 "이 방식이 수령방식으로 선택되면
-- 반납도 강제로 같은 방식+시간선택숨김+날짜기준 순수청구"(요청 A, is_bulk_delivery)와
-- "이 방식이 수령이 아닐 때 반납 콤보에서 제외"(반납 배송선택 제한, is_delivery_type)는
-- 서로 배타적인 개념이 아니라 같은 방식에 동시에 필요한 두 개의 독립된 동작이다 —
-- is_bulk_delivery는 "이 방식이 수령일 때"의 동작을 규정하고, is_delivery_type은
-- "이 방식이 수령이 아닐 때(반납 옵션 목록에서)"의 노출을 규정하므로 애초에 겹치는
-- 상황이 없다. Migration #441이 도입한 상호배타 가드("한쪽이 true면 다른 쪽을 켜는 것을
-- 차단")는 이 전제를 잘못 이해한 것이었음 — 제거한다.
--
-- 변경 내용: 두 RPC에서 "IF NOT v_current.X AND v_current.Y THEN RAISE EXCEPTION ..." 충돌
-- 검사 블록만 제거. 그 외 로직(권한검증, not_found 처리, UPDATE, 반환)은 완전히 동일.

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

  UPDATE rental_method_options
  SET is_bulk_delivery = NOT is_bulk_delivery
  WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$function$;

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

  UPDATE rental_method_options
  SET is_delivery_type = NOT is_delivery_type
  WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$function$;
