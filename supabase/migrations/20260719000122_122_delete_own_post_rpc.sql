-- Migration #122: delete_own_post RPC
-- 작성자가 자신의 포스트를 소프트 삭제할 수 있는 RPC
-- update_post_status는 is_cms_user() 전용이므로 별도 함수 필요

CREATE OR REPLACE FUNCTION public.delete_own_post(
  p_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID;
  v_post_user UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- 소유자 확인
  SELECT user_id INTO v_post_user
    FROM public.user_posts
   WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;

  -- 본인 포스트가 아니면 거부 (관리자는 update_post_status 사용)
  IF v_post_user <> v_user_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- 소프트 삭제
  UPDATE public.user_posts
     SET status = 'deleted'
   WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_own_post TO authenticated;
