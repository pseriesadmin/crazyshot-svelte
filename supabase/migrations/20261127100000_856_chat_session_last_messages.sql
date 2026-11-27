-- Migration #856: 상담 목록 카드의 '마지막 메시지' 전용 조회 함수 (Stephen 지시, 2026-11-27)
--
-- 배경: /api/chat/sessions 는 세션 100개의 메시지를 전부 한 번에 가져온 뒤 세션별 첫 건만 골랐다. Supabase API 의 한 번에 가져오는 행 수는
--       기본 1,000건이라(Stage 실측: 전체 1,165건 중 1,000건만 반환) 메시지가 많으면 오래된 세션의 마지막 메시지가 아예 오지 않아
--       카드 미리보기가 비었다(Production 상위 100세션 메시지 1,999건 — 마지막 메시지가 있는 62세션 중 약 13세션이 해당).
-- 변경: 세션별 '마지막으로 보이는 메시지'(admin_only 제외 — 고객에게 보이는 메시지, 기존 규칙 그대로) 1건만 돌려주는 함수.
--       인덱스 (session_id, created_at) 를 그대로 쓴다. 서버(service_role) 전용.
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
-- TDD: src/__tests__/services/chatSessionLastMessagesDb.test.ts
-- ROLLBACK: DROP FUNCTION public.get_chat_session_last_messages(uuid[]);  (코드는 함수 오류 시 기존 조회로 대체하므로 먼저 롤백해도 목록은 유지)

CREATE OR REPLACE FUNCTION public.get_chat_session_last_messages(p_session_ids uuid[])
RETURNS TABLE(session_id uuid, content text, sender_type text, created_at timestamptz)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (m.session_id) m.session_id, m.content, m.sender_type::text, m.created_at
    FROM chat_messages m
   WHERE m.session_id = ANY(p_session_ids)
     AND m.admin_only IS NOT TRUE
   ORDER BY m.session_id, m.created_at DESC, m.id DESC;
$function$;

REVOKE ALL ON FUNCTION public.get_chat_session_last_messages(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_session_last_messages(uuid[]) TO service_role;
