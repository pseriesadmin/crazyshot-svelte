-- Migration 211: crazylog_content_stats
-- CMS /cms/promotion/content 대시보드용 사이트 전체 콘텐츠 통계 RPC
-- 의존: user_posts (migration 117, 119 log_type CHECK)
--
-- Rollback (수동 실행):
--   DROP FUNCTION IF EXISTS public.get_crazylog_content_stats();

CREATE OR REPLACE FUNCTION public.get_crazylog_content_stats()
RETURNS TABLE (
  total_posts       BIGINT,
  published_posts   BIGINT,
  total_views       BIGINT,
  posts_by_log_type JSONB,
  top_posts         JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT id, title, log_type, status, is_public, COALESCE(view_count, 0) AS view_count
    FROM user_posts
  ),
  by_type AS (
    SELECT COALESCE(jsonb_object_agg(log_type, cnt), '{}'::jsonb) AS obj
    FROM (
      SELECT log_type, COUNT(*) AS cnt
      FROM base
      WHERE status = 'published' AND is_public = true
      GROUP BY log_type
    ) t
  ),
  top AS (
    SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) AS arr
    FROM (
      SELECT id, title, log_type, view_count
      FROM base
      WHERE status = 'published' AND is_public = true
      ORDER BY view_count DESC
      LIMIT 10
    ) r
  )
  SELECT
    (SELECT COUNT(*) FROM base)::bigint,
    (SELECT COUNT(*) FROM base WHERE status = 'published' AND is_public = true)::bigint,
    (SELECT COALESCE(SUM(view_count), 0) FROM base WHERE status = 'published' AND is_public = true)::bigint,
    (SELECT obj FROM by_type),
    (SELECT arr FROM top);
$$;

GRANT EXECUTE ON FUNCTION public.get_crazylog_content_stats() TO authenticated;
