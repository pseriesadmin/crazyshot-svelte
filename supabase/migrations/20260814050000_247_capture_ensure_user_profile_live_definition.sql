-- ★ MIGRATION: 247_capture_ensure_user_profile_live_definition.sql
-- Schema version: v5.55
-- Description: ensure_user_profile() 라이브 정의를 마이그레이션 이력에 캡처(IaC 드리프트 해소)
-- Dependencies: (없음 — 함수는 이미 stage/production 양쪽에 이 형태로 배포돼 있음)
-- Author: Stephen Cconzy
-- Date: 2026-08-14
--
-- 배경: 원본 20260529000029_29_rpc_functions.sql은 ensure_user_profile()을
-- `RETURNS TRIGGER`(auth.users AFTER INSERT 트리거 전용, NEW.id/NEW.email 참조)로 정의했다.
-- 그러나 stage(ezyvffjvuwmtuhpxdjrw)·production(vnbpmvxruyciuuaermyh) 라이브 DB를 직접
-- pg_get_functiondef로 조회한 결과, 이미 두 환경 모두 아래와 동일하게 `RETURNS uuid`인
-- 독립 호출 가능한 SECURITY DEFINER 함수로 재정의되어 있음을 확인했다(어느 커밋/세션에서
-- 이 변경이 일어났는지는 마이그레이션 이력에 남아있지 않음 — 저장소 파일과 라이브 DB 상태가
-- 이미 어긋나 있던 기존 드리프트, 이번 세션이 만든 문제 아님).
--
-- 이 파일은 라이브 정의를 그대로 재적용(CREATE OR REPLACE)해 저장소-DB 정합을 맞추는 것이
-- 목적이며, 동작을 바꾸지 않는다(원본 29번 파일도 손대지 않음, GP-10 준수).
--
-- 사용처: src/lib/stores/auth.ts performSignUp() — 익명(게스트) 채팅 이용 후 회원가입 전환
-- (updateUser) 시 handle_new_user() INSERT 트리거가 실행되지 않아 누락되는 user_profiles
-- 행을 이 RPC로 직접 보정한다(버그 수정, 2026-08-14).

CREATE OR REPLACE FUNCTION public.ensure_user_profile()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  INSERT INTO public.user_profiles (id, email)
  VALUES (v_user_id, auth.jwt() ->> 'email')
  ON CONFLICT (id) DO NOTHING;

  RETURN v_user_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ensure_user_profile() TO authenticated;

-- ROLLBACK:
-- 원본 29번 파일의 트리거 전용 정의로 되돌리는 것은 위험(현재 라이브 동작을 깨뜨림) — 필요 시
-- Stephen 직접 검토 후 대응. 이 함수를 완전히 제거하려면:
-- DROP FUNCTION IF EXISTS public.ensure_user_profile();
