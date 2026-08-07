-- Migration 171: update_reservation_status + set_reservation_shipment_method Production 동기화
-- 배경: RPC 전수 비교(migration 170 조사) 중 발견된 추가 드리프트 2건
--
-- ① update_reservation_status: Production이 RETURNS void, Stage는 RETURNS jsonb {ok:true}
--    → src/routes/cms/reservation/+page.server.ts의 approveReservation·updateStatus
--      action이 result.ok를 검사하는데 Production은 result가 항상 null
--      → !res?.ok 가 항상 true → CMS 예약승인·상태변경 버튼이 Production에서 100% "처리 실패"
--    조치: Stage 정의(jsonb 반환)로 동기화
--
-- ② set_reservation_shipment_method(3-arg 오버로드): 내부 service_role 체크 방식만 상이
--    Stage: current_setting('role') = 'service_role'
--    Production: auth.jwt() ->> 'role' = 'service_role'
--    → 클라이언트는 5-arg 오버로드만 호출하므로 현재 실사용 경로에 영향 없음(확인 완료)
--    → 향후 드리프트 방지 차원에서 Stage 기준으로 통일

-- ① update_reservation_status
CREATE OR REPLACE FUNCTION public.update_reservation_status(p_reservation_id bigint, p_new_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  EXECUTE format(
    'UPDATE rental_reservations SET status = %L, updated_at = NOW() WHERE id = %L',
    p_new_status, p_reservation_id
  );

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ② set_reservation_shipment_method (3-arg 오버로드)
CREATE OR REPLACE FUNCTION public.set_reservation_shipment_method(p_reservation_id bigint, p_pickup_method text, p_return_method text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE rental_reservations
  SET
    pickup_method = p_pickup_method,
    return_method = COALESCE(p_return_method, return_method),
    updated_at    = NOW()
  WHERE id = p_reservation_id
    AND status    = 'hold'
    AND (auth.uid() = user_id OR current_setting('role') = 'service_role');
END;
$function$;
