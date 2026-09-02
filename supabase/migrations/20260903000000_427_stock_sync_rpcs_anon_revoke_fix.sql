-- Migration 427: Migration 424/426의 authenticated 전용 RPC 2종에 대한 anon EXECUTE 권한 명시적 REVOKE
-- 배경: REVOKE ALL ... FROM PUBLIC 만으로는 anon/authenticated에 부여되는 명시적 EXECUTE 권한이
--   제거되지 않음(Migration #364/#409/#423과 동일한 이 프로젝트의 재발 패턴 — public 스키마에
--   postgres/supabase_admin 역할용 default privilege가 설정돼 있어, 신규 함수 생성 시 anon/
--   authenticated/service_role에 자동으로 EXECUTE가 부여되고 REVOKE ALL FROM PUBLIC은 이
--   직접 부여분을 지우지 못함). Migration 421/424/426을 Production에 적용한 직후
--   has_function_privilege()로 직접 조회해 create_hold_reservation_with_shipment·
--   get_unavailable_dates_for_cart 두 함수 모두 anon_exec=true로 남아있는 것을 발견(Stage에도
--   동일하게 이미 존재하던 상태) — Stephen 확인 후 즉시 이 마이그레이션으로 수정.
--
-- 실질 악용 위험은 낮았음(발견 즉시 봉쇄, 실제 악용 사례 없음):
--   get_unavailable_dates_for_cart는 auth.uid() IS NULL이면 즉시 빈 결과만 반환.
--   create_hold_reservation_with_shipment가 호출하는 create_hold_reservation 자체가 이미
--   비회원 예약생성을 차단(Migration 301, block_anonymous_reservation_creation)하고 있어
--   anon이 호출해도 실질적으로 예약을 만들 수 없었음.
--   그럼에도 마이그레이션 파일이 명시한 권한 정책(authenticated 전용)과 실제 DB 상태가
--   어긋나 있었으므로 명확히 일치시킨다.
--
-- get_available_stock_counts(anon+authenticated 둘 다 의도된 정책 — 공개 상품상세 페이지의
-- 비로그인 방문자도 조회 가능해야 함)는 이 수정 대상이 아님.

REVOKE ALL ON FUNCTION public.create_hold_reservation_with_shipment(UUID, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_hold_reservation_with_shipment(UUID, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_unavailable_dates_for_cart(UUID[], INT[], DATE, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unavailable_dates_for_cart(UUID[], INT[], DATE, DATE, DATE) TO authenticated;
