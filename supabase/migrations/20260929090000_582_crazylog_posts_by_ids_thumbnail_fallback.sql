-- migration #582: get_crazylog_posts_by_ids — 대표 이미지(thumbnail_url)가 없는 게시글은 본문 첫 이미지로 대체
-- 홈 "크레이지로그" 카드와 /crazylog 헤더 배너가 이 RPC의 thumbnail_url만 쓰기 때문에, 대표 이미지가
-- 없는 글은 카드가 빈 배경으로 표시됐다(/crazylog 목록 카드는 본문 첫 이미지로 대체하고 있어 불일치).
--  · 시그니처·반환 컬럼·권한(anon 포함, #262)·필터 조건은 그대로, thumbnail_url 값만 COALESCE로 대체
--  · 대체 규칙은 앱의 extractFirstImageUrl과 동일: content_blocks 중 type='image' 첫 블록의 images[0].url

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
    COALESCE(
      NULLIF(p.thumbnail_url, ''),
      jsonb_path_query_first(p.content_blocks, '$[*] ? (@.type == "image").images[0].url') #>> '{}'
    ),
    COALESCE(p.view_count, 0)::integer,
    p.status,
    p.is_public
  FROM user_posts p
  WHERE p.id = ANY(p_ids)
    AND p.status = 'published'
    AND p.is_public = true;
$$;

-- ROLLBACK: #210의 정의(thumbnail_url을 p.thumbnail_url 그대로 반환)로 CREATE OR REPLACE 재실행
