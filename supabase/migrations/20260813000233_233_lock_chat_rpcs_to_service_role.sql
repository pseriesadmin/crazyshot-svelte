-- Migration 233: 상담(채팅) 신규 RPC 4종 PUBLIC 권한 회수 (보안 수정)
-- 배경: 2026-08-13 마이그레이션 226/229~232 적용 직후 get_advisors로 발견 —
--   229~231에서 REVOKE EXECUTE ... FROM anon, authenticated만 실행하고 PUBLIC은 빠뜨림.
--   PostgreSQL은 CREATE FUNCTION 시 기본적으로 PUBLIC에 EXECUTE 권한을 부여하므로,
--   anon/authenticated에 대한 REVOKE만으로는 실제 접근이 막히지 않음(PUBLIC role을 통해
--   여전히 실행 가능) — anon_security_definer_function_executable /
--   authenticated_security_definer_function_executable WARN으로 확인.
--   특히 get_chat_customer_detail은 이름·전화번호·본인인증 서류 URL 등 PII를 반환하므로
--   PUBLIC 노출 시 임의의 p_user_id로 타인 정보 조회가 가능한 심각한 문제.
--
-- 조치: 기존 서버 전용 RPC 잠금 마이그레이션(172_lock_server_only_rpcs_to_service_role)과
--   동일한 패턴으로 PUBLIC, anon, authenticated 전체에서 회수 후 service_role에만 재부여.
-- auto_pending_inactive_sessions()는 226에서 CREATE OR REPLACE로 본문만 갱신했을 뿐 GRANT/REVOKE는
--   건드리지 않았음 — 원 정의(migration 38)의 권한 설정이 이미 존재하므로 이번 수정 범위에서는
--   함께 잠그지 않음(별도 확인 필요 시 Stephen 논의 후 진행).

REVOKE EXECUTE ON FUNCTION public.get_chat_customer_detail(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_customer_detail(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.set_chat_session_manual_mode(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_chat_session_manual_mode(uuid, boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.toggle_message_bookmark(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_message_bookmark(uuid, uuid, uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_session_bookmarks(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_bookmarks(uuid, uuid) TO service_role;
