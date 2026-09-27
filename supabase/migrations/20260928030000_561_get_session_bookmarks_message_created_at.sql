-- Migration #561: get_session_bookmarks — message_created_at 추가
--
-- 배경: 북마크 목록(BookmarkListView.svelte)에 표시되는 시간이 원본 메시지의 발신 시각이
-- 아니라 "그 메시지를 북마크로 체크한 시각"(chat_message_bookmarks.created_at)이었다 —
-- RPC가 JOIN하면서도 원본 chat_messages.created_at을 SELECT하지 않았기 때문(Stephen
-- 실사용 재보고). 반환 타입(RETURNS TABLE 컬럼 목록)이 바뀌므로 DROP 후 재생성 필요
-- (get_customer_list Migration #364 PII노출 전례와 동일하게, 기존 권한을 반드시 재적용).

DROP FUNCTION IF EXISTS public.get_session_bookmarks(uuid, uuid);

CREATE FUNCTION public.get_session_bookmarks(p_admin_id uuid, p_session_id uuid DEFAULT NULL)
RETURNS TABLE (
  bookmark_id         uuid,
  message_id          uuid,
  session_id          uuid,
  note                text,
  created_at          timestamptz,
  message_content     text,
  message_type        text,
  message_created_at  timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id         AS bookmark_id,
    b.message_id,
    b.session_id,
    b.note,
    b.created_at,
    m.content    AS message_content,
    m.message_type::text,
    m.created_at AS message_created_at
  FROM chat_message_bookmarks b
  JOIN chat_messages m ON m.id = b.message_id
  WHERE b.admin_id = p_admin_id
    AND (p_session_id IS NULL OR b.session_id = p_session_id)
  ORDER BY b.created_at DESC;
$$;

-- 기존 권한 재적용 (Migration #231 최초 정의 + #233/#235 lock-down 누적분과 동일 기준)
GRANT EXECUTE ON FUNCTION public.get_session_bookmarks(uuid, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_session_bookmarks(uuid, uuid) FROM PUBLIC, anon, authenticated;
