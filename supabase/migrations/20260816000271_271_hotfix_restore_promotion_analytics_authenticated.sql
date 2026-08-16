-- Migration #271 (HOTFIX): migration 263 회귀 복구 — /cms/promotion/analytics
--
-- 배경: 264 적용 직후, 263 감사 방법론(리터럴 문자열 grep)의 동일한 사각지대가 더 있는지
-- 전체 재점검(변수 별칭 패턴 포함) 중 두 번째 사례 발견.
--
-- 원인: src/routes/cms/promotion/analytics/+page.server.ts에서
-- `const db = locals.supabase as unknown as any` 형태로 authenticated 세션을 db 변수에 담아
-- get_promotion_analytics RPC를 직접 호출하고 있었음 — 263이 이 함수의 authenticated 실행권한을
-- 잘못 회수해 /cms/promotion/analytics 화면 장애 유발(발견 즉시 배포 전 조치, 실사용자 영향
-- 확인 안 됨).
--
-- 조치: authenticated 실행권한 복구. 이후 재점검 시 재차단 대상에서 제외할 것.

GRANT EXECUTE ON FUNCTION public.get_promotion_analytics() TO authenticated;
