-- Migration 430: Migration 428(cms_reservation_product_edit_rpcs)의 6개 RPC에 대한
-- anon/authenticated EXECUTE 권한 명시적 REVOKE.
--
-- ⚠️ 재번호 경위(2026-09-03): 원래 #423으로 생성됐으나(당시엔 이 RPC들을 만드는 파일이 #422였음),
-- 그 #422 파일이 세션 도중 디스크에서 유실돼(다른 병렬 세션이 동일 번호를 선점) #428로
-- 재작성됐다. 그 결과 파일명 순서상 #423(REVOKE, 이 파일)이 #428(CREATE FUNCTION)보다 먼저
-- 리플레이되는 순서 역전이 생겼음 — REVOKE ON FUNCTION은 대상 함수가 이미 존재해야 성공하므로,
-- 빈 DB에 파일 순서대로 리플레이하면(신규 환경 구축·production 최초 적용 등) 이 파일이
-- "함수가 존재하지 않습니다" 에러로 실패하는 상태였다. Migration #306의 선례와 동일한 방식으로
-- 내용 변경 없이 #428 이후 번호(#430)로 재배치해 해소 — Stage DB(ezyvffjvuwmtuhpxdjrw)에는
-- 이미 올바른 순서로 적용·검증 완료돼 있어 재적용 불필요, 파일 순서만 정정.
--
-- 원본 배경: REVOKE ALL ... FROM PUBLIC 만으로는 anon/authenticated에 남아있던 명시적 EXECUTE
--   권한이 제거되지 않음(Migration #364 사고와 동일한 재발 패턴, #409의 방지 주석 참고).
--   #428 적용 직후 pg_proc.proacl을 직접 조회한 결과 anon=X, authenticated=X가 그대로 남아있는
--   것을 확인 — 이 RPC들은 auth.uid() 기반 소유권 검증이 없는 service_role 전용 설계라 anon/
--   authenticated가 직접 호출 가능하면 임의 예약에 상품 추가/삭제/재배정이 가능한 실제 보안
--   취약점이 됨. crazyshot-stage 적용 직후 발견·즉시 이 마이그레이션으로 수정 완료(수정 전
--   실제 악용 사례 없음, 발견 즉시 봉쇄).

REVOKE ALL ON FUNCTION public.cms_add_reservation_product_unit(BIGINT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_add_reservation_product_unit(BIGINT, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.cms_remove_reservation_product_unit(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_remove_reservation_product_unit(BIGINT) TO service_role;

REVOKE ALL ON FUNCTION public.cms_add_reservation_option(BIGINT, UUID, TEXT, INTEGER, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_add_reservation_option(BIGINT, UUID, TEXT, INTEGER, NUMERIC) TO service_role;

REVOKE ALL ON FUNCTION public.cms_update_reservation_option_qty(BIGINT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_update_reservation_option_qty(BIGINT, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.cms_delete_reservation_option(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_delete_reservation_option(BIGINT) TO service_role;

REVOKE ALL ON FUNCTION public.cms_reassign_reservation_product_code(BIGINT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_reassign_reservation_product_code(BIGINT, UUID) TO service_role;
