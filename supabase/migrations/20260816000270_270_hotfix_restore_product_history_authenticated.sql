-- Migration #270 (HOTFIX): migration 263 회귀 복구 — /api/cms/product-history
--
-- 배경: migration 263 적용 직후 실서비스 https://crazyshot-svelte.vercel.app/cms/rental/history
-- 에서 GET /api/cms/product-history 500 오류 발생(Stephen 콘솔 로그 제보).
--
-- 원인: 263 감사 당시 "admin.rpc(" / "locals.supabase.rpc(" 리터럴 문자열 패턴으로만 코드베이스를
-- 검색했는데, src/routes/api/cms/product-history/+server.ts는 `const sb: AnyClient =
-- locals.supabase; ... sb.rpc(...)` 형태로 locals.supabase를 변수에 먼저 담아 재사용하는
-- 간접참조 패턴을 쓰고 있어 grep 감사에서 누락됨. 이 라우트는 CMS 로그인 세션(authenticated)으로
-- get_product_history/get_product_history_multi/upsert_product_history_record/
-- delete_product_history_record 4개 함수를 실제로 직접 호출하고 있었음 — 263이 이 4개의
-- authenticated 실행권한을 잘못 회수해 즉시 장애로 이어짐.
--
-- 조치: 4개 함수 authenticated 실행권한 복구(263 이전 상태로 원복). 이 4개는 CMS 관리자만
-- 화면에 접근 가능하고(requireCmsRole 서버측 체크 有) 실사용 패턴이 명확해 authenticated
-- 유지가 타당함 — 이후 재점검 시 재차단 대상에서 제외할 것.

GRANT EXECUTE ON FUNCTION public.get_product_history(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_history_multi(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_product_history_record(uuid, uuid, date, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_product_history_record(uuid, uuid) TO authenticated;
