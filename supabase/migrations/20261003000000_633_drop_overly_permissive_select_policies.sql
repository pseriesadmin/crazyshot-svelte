-- Migration 633: Production에만 남아 있던 "누구나 조회 허용" 규칙 2건 제거 (Stage와 동일 상태로 정렬)
--
-- 배경(2026-10-03 Stage↔Production 구조 점검): Production에는 초기 구축 때 생성된
-- 기본 조회 규칙 2건이 남아 있어, 로그인하지 않은 사용자(anon)도 아래 데이터를 읽을 수 있었다
-- (비로그인 조회로 실제 확인).
--   · assets_select           — 장비 자산대장 50건(시리얼번호·구입가격·구입일·창고위치·상태메모)
--   · subscription_plans_select — 구독 플랜 7개 중 비활성·삭제된 4개까지 노출
--     (이미 "활성+미삭제만 공개"하는 subscription_plans_public_read 규칙이 따로 있어 중복·과다 허용)
-- Stage에는 두 규칙이 없다(assets는 규칙 없음=잠금, subscription_plans는 public_read만).
--
-- 영향 점검(제거해도 동작 변화 없음):
--   · assets 조회 코드 4곳은 전부 service_role(admin) 클라이언트 — RLS 무관
--   · subscription_plans 고객 화면(/members·/subscribe)은 모두 status='active' AND deleted_at IS NULL
--     조건 또는 service_role — public_read 규칙으로 충족. CMS 화면은 subscription_plans_admin_write
--     (is_cms_user()) 규칙으로 전체 조회 유지
--   · 두 테이블을 참조하는 다른 정책·SECURITY INVOKER 함수·뷰 없음
--
-- 남기는 것: assets_insert/update/delete(항상 false)·subscription_plans_insert/update/delete(항상 false)
-- 등 무해한 "쓰기 금지" 규칙은 변경하지 않는다(최소 변경 원칙).
-- Stage는 이미 이 상태이므로 DROP POLICY IF EXISTS는 no-op이다.

DROP POLICY IF EXISTS assets_select ON public.assets;
DROP POLICY IF EXISTS subscription_plans_select ON public.subscription_plans;

-- ============================================================
-- ROLLBACK (Production 원복이 필요할 때만 수동 실행)
-- ============================================================
-- CREATE POLICY assets_select ON public.assets FOR SELECT TO public USING (true);
-- CREATE POLICY subscription_plans_select ON public.subscription_plans FOR SELECT TO public USING (true);
-- ============================================================
