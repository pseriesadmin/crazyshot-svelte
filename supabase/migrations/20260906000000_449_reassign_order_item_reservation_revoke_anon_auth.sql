-- Migration 449: reassign_order_item_reservation 권한 보완 — anon/authenticated 회수
--
-- 배경(2026-09-06 발견): Migration 448이 `REVOKE ALL ... FROM PUBLIC`만 실행했는데, 이
-- 프로젝트는 anon/authenticated에게 PUBLIC과 별개로 자체 기본권한이 걸려 있어 PUBLIC
-- 회수만으로는 이 두 역할의 EXECUTE 권한이 그대로 남는다 — pg_proc.proacl 원본 대조로
-- 확인: {postgres=X,anon=X,authenticated=X,service_role=X} (Stage·Production 둘 다 동일).
-- 같은 성격의 기존 함수 update_reservation_status는 Migration #172에서 처음부터
-- `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`처럼 역할을 전부 명시해 정상
-- 회수돼 있었다({postgres=X,service_role=X}) — 이번에 그 관례를 그대로 따른다.
--
-- reassign_order_item_reservation 함수 자체는 호출자 소유권 검증이 없어(서버
-- 엔드포인트가 이미 검증했다는 전제로 설계됨), anon/authenticated 권한이 남아있으면
-- 누구나 직접 RPC 호출로 임의의 order_items.reservation_id를 바꿔치기할 수 있는
-- 데이터 정합성 취약점이었다.

REVOKE EXECUTE ON FUNCTION public.reassign_order_item_reservation(BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- ROLLBACK (역순 실행)
-- ============================================================
-- GRANT EXECUTE ON FUNCTION public.reassign_order_item_reservation(BIGINT, BIGINT) TO anon, authenticated;
-- ============================================================
