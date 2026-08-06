-- Migration #195: is_cms_user() 함수 정의 마이그레이션 파일 백필 (DB-CRIT-5)
--
-- 배경: 40곳 이상에서 호출되는 is_cms_user()가 어떤 마이그레이션 파일에도 정의돼 있지 않음
--       (과거 세션에서 Stage/Production SQL 에디터로 직접 생성되고 파일로 기록되지 않은 것으로 추정 —
--        마이그레이션 169-171 문서에도 동일한 드리프트 패턴이 이미 기록됨).
--       2026-08-06 stage/production 양쪽에서 pg_get_functiondef로 실제 배포된 정의를 직접 조회해
--       완전히 동일함을 확인(드리프트 없음) — 그 정의를 그대로(수정 없이) 등록해 마이그레이션 체인 복원.
--
-- 목적: DB를 마이그레이션 파일만으로 재구축(재해복구·신규 스테이지 브랜치)해야 하는 상황에서
--       이 함수가 없어 전체 체인이 중단되는 것을 방지.

CREATE OR REPLACE FUNCTION public.is_cms_user()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND cms_role IS NOT NULL
  );
$function$;
