-- Migration #413: promote_draft_reservation·set_reservation_options anon EXECUTE 회수
--
-- 배경: Migration #412 적용 직후 production에서 grants를 직접 조회한 결과, 두 함수 모두
-- anon 역할에 EXECUTE 권한이 남아있는 것이 확인됨 — REVOKE ALL FROM PUBLIC은 PUBLIC
-- 의사역할에만 적용되고 anon은 별개의 명시적 권한 주체라 영향을 받지 않는다(Supabase
-- 프로젝트의 ALTER DEFAULT PRIVILEGES가 신규 함수에 anon EXECUTE를 기본 부여하는 것으로
-- 추정 — set_reservation_options는 신규 생성이 아니라 CREATE OR REPLACE였는데도 동일하게
-- anon 권한이 남아있었음, 정확한 유입 경위는 특정 불가).
--
-- 두 함수 모두 Migration #262(global_anon_rpc_lockdown, 2026-08-15)의 명시적 잠금 대상
-- 목록에 이미 포함돼 있던 함수다 — "명시적으로 REVOKE하지 않은 모든 함수가 기본적으로
-- 익명 호출 가능한 상태였다"는 이 프로젝트의 반복된 결함 패턴과 동일 클래스이므로 동일하게
-- anon EXECUTE를 명시적으로 회수한다. 내부적으로 auth.uid() IS NULL 체크가 있어 실질적
-- 악용 경로는 아니었으나(§262 코멘트와 동일하게 방어적 계층 원칙 적용), 프로젝트 컨벤션에
-- 맞춰 RPC 권한 자체도 authenticated 전용으로 잠근다.

REVOKE EXECUTE ON FUNCTION public.promote_draft_reservation(BIGINT, DATE, DATE) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_reservation_options(bigint, jsonb) FROM anon;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- GRANT EXECUTE ON FUNCTION public.promote_draft_reservation(BIGINT, DATE, DATE) TO anon;
-- GRANT EXECUTE ON FUNCTION public.set_reservation_options(bigint, jsonb) TO anon;
-- ============================================================
