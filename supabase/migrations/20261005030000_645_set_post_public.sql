-- Migration #645: set_post_public — 크레이지로그 '비공개' 토글(작성자 본인 또는 CMS 관리자)
-- 배경(2026-10-05, Stephen 지시): 콘텐츠 상세(작성자)·콘텐츠 목록(관리자)에서 글을 '비공개'로 전환/복원하는 콤보 버튼 필요.
--  · 비공개 = user_posts.is_public=false (기존 '작성자 설정' 컬럼 — 공개 목록·메인·검색에서 빠지고 작성자 본인·관리자만 계속 봄).
--    관리자 전용 status='hidden'(update_post_status)과는 별개 개념이라 서로 간섭하지 않는다.
--  · 직접 DML 금지(H-01) — RPC로만 변경. 작성자 본인 또는 is_cms_user()만 허용, 삭제된 글은 거부.
--  · 신규 함수는 anon 차단(REVOKE) 후 authenticated만 허용(#262 anon 락다운 원칙).

CREATE OR REPLACE FUNCTION public.set_post_public(p_id UUID, p_public BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_owner  UUID;
  v_status TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF p_public IS NULL THEN
    RAISE EXCEPTION 'invalid_value';
  END IF;

  SELECT user_id, status INTO v_owner, v_status
    FROM public.user_posts
   WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;

  IF v_owner <> v_uid AND NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_status = 'deleted' THEN
    RAISE EXCEPTION 'post_deleted';
  END IF;

  UPDATE public.user_posts
     SET is_public = p_public
   WHERE id = p_id;

  RETURN p_public;
END;
$$;

REVOKE ALL ON FUNCTION public.set_post_public(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_post_public(UUID, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_post_public(UUID, BOOLEAN) TO authenticated;

-- ROLLBACK: DROP FUNCTION public.set_post_public(UUID, BOOLEAN);
