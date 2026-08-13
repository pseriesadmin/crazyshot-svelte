-- Migration 231: chat_message_bookmarks 테이블 신설
-- GSD-11: P3-2 상담 중 북마크(즐겨찾기) 기능

CREATE TABLE IF NOT EXISTS chat_message_bookmarks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  message_id  uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  admin_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, admin_id)  -- 동일 메시지를 동일 관리자가 중복 북마크 불가
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_chat_message_bookmarks_session ON chat_message_bookmarks(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_message_bookmarks_admin  ON chat_message_bookmarks(admin_id);
CREATE INDEX IF NOT EXISTS idx_chat_message_bookmarks_message ON chat_message_bookmarks(message_id);

-- RLS: CMS 관리자(is_cms_user())만 CRUD
ALTER TABLE chat_message_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bookmarks_cms_all" ON chat_message_bookmarks
  FOR ALL
  USING (is_cms_user())
  WITH CHECK (is_cms_user());

-- RPC: toggle_message_bookmark — idempotent (이미 있으면 삭제, 없으면 추가)
CREATE OR REPLACE FUNCTION public.toggle_message_bookmark(
  p_message_id uuid,
  p_session_id uuid,
  p_admin_id   uuid,
  p_note       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
BEGIN
  SELECT id INTO v_existing
  FROM chat_message_bookmarks
  WHERE message_id = p_message_id AND admin_id = p_admin_id;

  IF v_existing IS NOT NULL THEN
    DELETE FROM chat_message_bookmarks WHERE id = v_existing;
    RETURN jsonb_build_object('action', 'removed', 'bookmark_id', v_existing);
  ELSE
    INSERT INTO chat_message_bookmarks(session_id, message_id, admin_id, note)
    VALUES (p_session_id, p_message_id, p_admin_id, p_note)
    ON CONFLICT (message_id, admin_id) DO NOTHING;
    SELECT id INTO v_existing FROM chat_message_bookmarks WHERE message_id = p_message_id AND admin_id = p_admin_id;
    RETURN jsonb_build_object('action', 'added', 'bookmark_id', v_existing);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_message_bookmark(uuid, uuid, uuid, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.toggle_message_bookmark(uuid, uuid, uuid, text) FROM anon, authenticated;

-- RPC: get_session_bookmarks — 세션 북마크 목록
CREATE OR REPLACE FUNCTION public.get_session_bookmarks(p_admin_id uuid, p_session_id uuid DEFAULT NULL)
RETURNS TABLE (
  bookmark_id  uuid,
  message_id   uuid,
  session_id   uuid,
  note         text,
  created_at   timestamptz,
  message_content text,
  message_type text
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
    m.message_type::text
  FROM chat_message_bookmarks b
  JOIN chat_messages m ON m.id = b.message_id
  WHERE b.admin_id = p_admin_id
    AND (p_session_id IS NULL OR b.session_id = p_session_id)
  ORDER BY b.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_session_bookmarks(uuid, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_session_bookmarks(uuid, uuid) FROM anon, authenticated;
