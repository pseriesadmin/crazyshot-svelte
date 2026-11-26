-- migration #851: 크레이지로그 글 조회수 집계 (2026-11-26)
-- 배경: user_posts.view_count 칸은 있었지만(Migration #117) 올리는 코드가 없어 값이 전부 0이었다.
--       상세 화면 하단 '같은 분류에서 많이 본 로그' 목록(조회수 순)을 위해 조회수를 올리는 서버 전용 함수를 만든다.
--  · increment_crazylog_post_view(p_post_id): 게시(published)·공개(is_public)인 글의 view_count 를 1 올린다.
--    SECURITY DEFINER 라 RLS 를 거치지 않고, 앱 서버(service_role)만 호출한다 — 고객 브라우저가 조회수를 조작하지 못하게 anon·authenticated 권한은 회수(#761의 column lockdown 과 같은 방향).
--    같은 사람의 새로고침 중복 제외는 앱 서버가 쿠키로 처리한다.
--  · trg_user_posts_updated_at 은 모든 UPDATE 때 updated_at 을 now()로 바꾼다 → 조회수만 바뀌는 UPDATE 에서는 건드리지 않도록
--    트리거에 WHEN 조건을 추가해 다시 만든다(글 수정 시각이 조회 때마다 갱신되는 부작용 방지). 글을 고치는 UPDATE 는 view_count 가 그대로라 기존과 같이 동작한다.

CREATE OR REPLACE FUNCTION public.increment_crazylog_post_view(p_post_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.user_posts
     SET view_count = COALESCE(view_count, 0) + 1
   WHERE id = p_post_id
     AND status = 'published'
     AND is_public = true;
$$;

REVOKE ALL ON FUNCTION public.increment_crazylog_post_view(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_crazylog_post_view(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_crazylog_post_view(UUID) TO service_role;

DROP TRIGGER IF EXISTS trg_user_posts_updated_at ON public.user_posts;
CREATE TRIGGER trg_user_posts_updated_at
  BEFORE UPDATE ON public.user_posts
  FOR EACH ROW
  WHEN (OLD.view_count IS NOT DISTINCT FROM NEW.view_count)
  EXECUTE FUNCTION public.set_updated_at();

-- 조회수 순 목록 조회용 인덱스(분류별 상위 N개)
CREATE INDEX IF NOT EXISTS idx_user_posts_type_views
  ON public.user_posts (log_type, view_count DESC, created_at DESC)
  WHERE status = 'published' AND is_public = true;

-- ROLLBACK:
--   DROP INDEX IF EXISTS public.idx_user_posts_type_views;
--   DROP TRIGGER IF EXISTS trg_user_posts_updated_at ON public.user_posts;
--   CREATE TRIGGER trg_user_posts_updated_at BEFORE UPDATE ON public.user_posts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--   DROP FUNCTION IF EXISTS public.increment_crazylog_post_view(UUID);
