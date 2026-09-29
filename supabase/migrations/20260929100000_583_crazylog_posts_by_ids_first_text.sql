-- migration #583: get_crazylog_posts_by_ids — 본문 첫 텍스트 요약(first_text) 컬럼 추가
-- /crazylog 헤더 배너 카드의 부제가 게시글과 무관한 하드코딩 문구였고(desc는 항상 null), 홈 카드에는 부제 자체가 없었다.
-- 두 화면이 게시글 실제 내용을 표시하도록 본문 첫 text 블록의 태그 제거 텍스트(최대 120자)를 함께 반환한다.
--  · 규칙은 앱의 extractFirstText와 동일: content_blocks 중 type='text' 첫 블록의 html에서 태그 제거·trim·120자
--  · 반환 컬럼이 늘어 CREATE OR REPLACE 불가 → DROP 후 재생성(#582의 thumbnail 대체 로직 유지, 권한 재부여)
--  · 기존 컬럼·필터·SECURITY DEFINER는 그대로

DROP FUNCTION IF EXISTS public.get_crazylog_posts_by_ids(UUID[]);

CREATE FUNCTION public.get_crazylog_posts_by_ids(p_ids UUID[])
RETURNS TABLE (
  id            UUID,
  title         TEXT,
  log_type      TEXT,
  thumbnail_url TEXT,
  view_count    INTEGER,
  status        TEXT,
  is_public     BOOLEAN,
  first_text    TEXT
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
    p.is_public,
    left(
      btrim(regexp_replace(
        COALESCE(jsonb_path_query_first(p.content_blocks, '$[*] ? (@.type == "text").html') #>> '{}', ''),
        '<[^>]*>', '', 'g'
      )),
      120
    )
  FROM user_posts p
  WHERE p.id = ANY(p_ids)
    AND p.status = 'published'
    AND p.is_public = true;
$$;

GRANT EXECUTE ON FUNCTION public.get_crazylog_posts_by_ids(UUID[]) TO anon, authenticated;

-- ROLLBACK: DROP FUNCTION public.get_crazylog_posts_by_ids(UUID[]); 후 #582의 정의(first_text 없는 7컬럼)로 재생성하고 anon·authenticated GRANT
