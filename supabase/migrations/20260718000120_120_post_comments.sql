-- Migration #120: post_comments 테이블 + RPC
-- crazylog 포스트 댓글 저장 (인증 사용자 전용)

CREATE TABLE IF NOT EXISTS public.post_comments (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id      UUID        NOT NULL REFERENCES public.user_posts(id) ON DELETE CASCADE,
  user_id      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name  TEXT,
  content      TEXT        NOT NULL,
  is_public    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT post_comments_content_length CHECK (char_length(content) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS post_comments_post_id_idx ON public.post_comments (post_id, created_at);

ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

-- 공개 댓글은 누구나 읽기 가능
CREATE POLICY "public_select_post_comments"
  ON public.post_comments FOR SELECT
  USING (is_public = true);

-- 인증 사용자만 본인 댓글 작성
CREATE POLICY "authenticated_insert_post_comments"
  ON public.post_comments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RPC: 댓글 등록 (SECURITY DEFINER — auth.uid() 내부 검증)
CREATE OR REPLACE FUNCTION public.create_post_comment(
  p_post_id UUID,
  p_content  TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id       UUID;
  v_user_id  UUID := auth.uid();
  v_name     TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;

  IF char_length(trim(p_content)) = 0 THEN
    RAISE EXCEPTION '댓글 내용을 입력해주세요.';
  END IF;

  SELECT full_name INTO v_name
    FROM public.user_profiles WHERE id = v_user_id;

  INSERT INTO public.post_comments (post_id, user_id, author_name, content)
    VALUES (p_post_id, v_user_id, COALESCE(v_name, '익명'), trim(p_content))
    RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
