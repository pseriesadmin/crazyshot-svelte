-- Migration 210: crazylog_banner_settings
-- cms_settings 테이블에 /crazylog 배너 카드 3슬롯 설정 키 추가
-- 의존: cms_settings 테이블 (migration 41), is_cms_user() (migration 34), user_posts (migration 117)
--
-- Rollback (수동 실행):
--   DROP FUNCTION IF EXISTS public.search_crazylog_posts(TEXT, INTEGER);
--   DROP FUNCTION IF EXISTS public.get_crazylog_posts_by_ids(UUID[]);
--   DROP FUNCTION IF EXISTS public.upsert_crazylog_banner_setting(TEXT, JSONB);
--   DROP FUNCTION IF EXISTS public.get_crazylog_banner_settings();
--   DELETE FROM cms_settings WHERE key IN
--     ('crazylog_banner_slot1', 'crazylog_banner_slot2', 'crazylog_banner_slot3');

-- 1. 기본값 삽입 (이미 존재하면 무시)
INSERT INTO cms_settings (key, value) VALUES
  ('crazylog_banner_slot1', '{"posts":[],"mode":"random"}'::jsonb),
  ('crazylog_banner_slot2', '{"posts":[],"mode":"random"}'::jsonb),
  ('crazylog_banner_slot3', '{"posts":[],"mode":"random"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 2. 슬롯 설정 전체 조회 RPC (anon 허용 — /crazylog SSR에서 사용)
CREATE OR REPLACE FUNCTION public.get_crazylog_banner_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
  FROM cms_settings
  WHERE key IN (
    'crazylog_banner_slot1',
    'crazylog_banner_slot2',
    'crazylog_banner_slot3'
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_crazylog_banner_settings() TO anon, authenticated;

-- 3. 슬롯 설정 저장 RPC (CMS 유저 전용, 풀 최대 8개 제한)
CREATE OR REPLACE FUNCTION public.upsert_crazylog_banner_setting(
  p_key TEXT,
  p_value JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  IF p_key NOT IN (
    'crazylog_banner_slot1',
    'crazylog_banner_slot2',
    'crazylog_banner_slot3'
  ) THEN
    RAISE EXCEPTION 'invalid key: %', p_key;
  END IF;

  IF jsonb_array_length(COALESCE(p_value->'posts', '[]'::jsonb)) > 8 THEN
    RAISE EXCEPTION 'too many posts: max 8 per slot';
  END IF;

  INSERT INTO cms_settings (key, value, updated_at)
  VALUES (p_key, p_value, now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_crazylog_banner_setting(TEXT, JSONB) TO authenticated;

-- 4. ID 배열로 포스트 조회 RPC (배너 렌더링·모달 복원 공용, anon 허용)
CREATE OR REPLACE FUNCTION public.get_crazylog_posts_by_ids(p_ids UUID[])
RETURNS TABLE (
  id            UUID,
  title         TEXT,
  log_type      TEXT,
  thumbnail_url TEXT,
  view_count    INTEGER,
  status        TEXT,
  is_public     BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.title,
    p.log_type,
    p.thumbnail_url,
    COALESCE(p.view_count, 0)::integer,
    p.status,
    p.is_public
  FROM user_posts p
  WHERE p.id = ANY(p_ids)
    AND p.status = 'published'
    AND p.is_public = true;
$$;

GRANT EXECUTE ON FUNCTION public.get_crazylog_posts_by_ids(UUID[]) TO anon, authenticated;

-- 5. 배너 픽커 검색 RPC (CMS 유저 전용, SuggestPicker 연동)
CREATE OR REPLACE FUNCTION public.search_crazylog_posts(
  p_query TEXT,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id            UUID,
  title         TEXT,
  log_type      TEXT,
  thumbnail_url TEXT,
  view_count    INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.title,
    p.log_type,
    p.thumbnail_url,
    COALESCE(p.view_count, 0)::integer
  FROM user_posts p
  WHERE p.status = 'published'
    AND p.is_public = true
    AND p.title ILIKE '%' || p_query || '%'
  ORDER BY p.created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_crazylog_posts(TEXT, INTEGER) TO authenticated;
