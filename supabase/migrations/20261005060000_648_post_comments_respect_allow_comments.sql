-- Migration #648: 크레이지로그 '댓글 허용' 옵션을 실제로 집행 — 댓글을 막은 글에는 새 댓글을 달 수 없다
-- 배경(2026-10-05, Stephen 지시 "2단계 댓글허용 옵션 연결"): 작성 화면의 '댓글 허용' 스위치는 user_posts.allow_comments 로 저장되지만
--  댓글 등록 경로(create_post_comment RPC·post_comments INSERT 정책) 어디에서도 읽지 않아 꺼도 댓글이 계속 달렸다.
-- 방식: post_comments BEFORE INSERT 트리거 하나로 RPC·직접 INSERT(RLS 정책 우회) 양쪽을 한 번에 막는다.
--  · 이미 달린 댓글은 그대로 남고 보이며(삭제·숨김 없음), 새 댓글만 막힌다.
--  · auth.uid() IS NULL(service_role·SQL 에디터)은 통과 — 서버 신뢰 경로 영향 없음.
--  · 글을 찾을 수 없거나 allow_comments 가 NULL 이면 기존 동작 유지(허용). 컬럼은 NOT NULL DEFAULT true 라 기존 글은 모두 허용 상태.
--  · SECURITY DEFINER: 비공개(is_public=false)·보류 글은 RLS 상 작성자·관리자만 읽을 수 있어, 호출자 권한으로는 allow_comments 를 못 읽는다.

CREATE OR REPLACE FUNCTION public.post_comments_guard_allow_comments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allow BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT allow_comments INTO v_allow
    FROM public.user_posts
   WHERE id = NEW.post_id;

  IF FOUND AND v_allow IS FALSE THEN
    RAISE EXCEPTION '작성자가 댓글을 허용하지 않은 글입니다.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.post_comments_guard_allow_comments() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.post_comments_guard_allow_comments() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_post_comments_guard_allow_comments ON public.post_comments;
CREATE TRIGGER trg_post_comments_guard_allow_comments
  BEFORE INSERT ON public.post_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.post_comments_guard_allow_comments();

-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_post_comments_guard_allow_comments ON public.post_comments;
--   DROP FUNCTION IF EXISTS public.post_comments_guard_allow_comments();
