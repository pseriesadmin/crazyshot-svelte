-- migration #580: delete_own_post_comment RPC — 크레이지로그 댓글 "본인 댓글 영구 삭제"
-- 그동안 post_comments에는 DELETE 정책·RPC가 없어 본인 댓글도 지울 수 없었다.
-- H-01(직접 DML 금지) 원칙에 따라 RLS DELETE 정책을 열지 않고 SECURITY DEFINER RPC로만 제공한다.
--  · 로그인(auth.uid() 필수) 사용자가 본인(user_id = auth.uid())이 작성한 댓글만 삭제 가능
--  · 남의 댓글·존재하지 않는 id는 아무 것도 지우지 않고 FALSE 반환
--  · anon 실행 불가(authenticated만)

CREATE OR REPLACE FUNCTION public.delete_own_post_comment(p_comment_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_count   INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;

  DELETE FROM public.post_comments
   WHERE id = p_comment_id
     AND user_id = v_user_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_own_post_comment(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_own_post_comment(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_own_post_comment(UUID) TO authenticated;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.delete_own_post_comment(UUID);
