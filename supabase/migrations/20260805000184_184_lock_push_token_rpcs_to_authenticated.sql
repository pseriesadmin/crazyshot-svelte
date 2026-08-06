-- Migration #184: register_push_token / unregister_push_token PUBLIC 권한 회수
-- 배경: Postgres는 함수 생성 시 기본적으로 PUBLIC(anon 포함)에 EXECUTE를 부여함.
--   #183에서 GRANT ... TO authenticated만 추가하고 REVOKE를 누락해 anon도 호출 가능한 상태로 남음.
--   두 함수 모두 내부에서 auth.uid() 검증을 하므로 실질적 악용 경로는 없으나(#172 "서버 전용 RPC
--   service_role 잠금" 원칙과 동일하게) 의도한 권한만 명시적으로 남기기 위해 정리.

REVOKE EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unregister_push_token(TEXT) FROM PUBLIC, anon;

-- rollback:
-- GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) TO PUBLIC, anon;
-- GRANT EXECUTE ON FUNCTION public.unregister_push_token(TEXT) TO PUBLIC, anon;
