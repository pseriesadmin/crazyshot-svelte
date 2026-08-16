-- Migration #272 (HOTFIX): migration 263 회귀 3번째 사례 — @sp3-qa-agent 재검수에서 발견
--
-- 배경: 270/271로 product-history·promotion-analytics 회귀를 복구한 뒤 @sp3-qa-agent에게
-- "나머지 65개 함수는 admin/db 리시버 변수명 기준으로 전수 재확인해 전부 정상"이라는 결론을
-- 독립 재검증하도록 요청했는데, 그 전제 자체가 두 번째로 틀렸음이 드러남.
--
-- 원인: src/routes/cms/promotion/segment/+page.server.ts,
-- src/routes/api/cms/segment/refresh/+server.ts 둘 다 `const admin = locals.supabase`처럼
-- 변수명은 admin이지만 실제로는 authenticated 세션(service_role이 아님). 리시버 변수명이
-- admin/db이면 service_role일 것이라고 가정한 재감사 방법론 자체의 허점 — 이름이 아니라
-- 정의부(locals.supabase vs createClient(...SERVICE_ROLE_KEY...))를 추적해야 정확함.
--
-- 영향: get_segment_stats/get_segment_users/refresh_user_segments 3개 함수가 263에서
-- authenticated 회수됨 → /cms/promotion/segment 화면(통계·세그먼트 사용자 조회) 및
-- POST /api/cms/segment/refresh(세그먼트 새로고침) 장애. 둘 다 서버측 cms_role 체크가
-- 존재해(segment/refresh는 함수 내부 명시적 체크, segment 페이지는 /cms/+layout.server.ts
-- 상위 게이트) authenticated 복구가 보안 회귀는 아님 — 순수 가용성 회귀 복구.
--
-- 재발방지: 이후 authenticated 권한 재점검 시 리시버 변수명이 아니라 할당 우변(locals.supabase
-- 원본 여부)을 반드시 추적할 것.

GRANT EXECUTE ON FUNCTION public.get_segment_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_segment_users(varchar, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_user_segments() TO authenticated;
