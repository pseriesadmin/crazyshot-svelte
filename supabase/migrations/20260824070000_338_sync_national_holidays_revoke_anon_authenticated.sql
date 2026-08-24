-- Migration #338: sync_national_holidays — anon/authenticated EXECUTE 명시적 회수
--
-- #337의 REVOKE ALL FROM PUBLIC만으로는 부족했다 — Supabase 프로젝트는 public 스키마
-- 신규 함수에 대해 ALTER DEFAULT PRIVILEGES로 anon·authenticated에 EXECUTE를 별도
-- 자동 부여한다(PUBLIC 의사역할과 무관한 별개 권한). 라이브 테스트(deliveryCutoffHolidays.
-- test.ts)로 anon/authenticated 둘 다 여전히 EXECUTE 가능함을 직접 확인 후 명시적으로 회수.
-- has_function_privilege()로 회수 후 재확인 완료 — anon/authenticated=false, service_role=true.

REVOKE EXECUTE ON FUNCTION public.sync_national_holidays(JSONB, DATE, DATE) FROM anon, authenticated;

-- 같은 확인으로 #335의 나머지 3개 RPC도 anon에 EXECUTE가 자동 부여돼 있음을 발견 —
-- is_cms_user() 내부 체크가 실질 방어선이라 기능적 구멍은 아니지만(비인증 anon 호출도
-- auth.uid() IS NULL이라 결국 거부됨), authenticated 세션이 필요한 CMS 전용 RPC를 굳이
-- anon까지 실행 가능하게 둘 이유가 없어 동일하게 회수(defense-in-depth 일관성).
REVOKE EXECUTE ON FUNCTION public.upsert_delivery_cutoff_settings(BOOLEAN, BOOLEAN, BOOLEAN) FROM anon;
REVOKE EXECUTE ON FUNCTION public.upsert_manual_holiday(UUID, DATE, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_manual_holiday(UUID) FROM anon;
