-- Migration #646: get_crazylog_posts_by_ids.first_text — HTML 엔티티 디코딩·공백 정리 (메인 헤더 배너 부제목 &nbsp; 노출 수정)
-- 원인(2026-10-05): 본문 첫 text 블록의 html에서 태그만 제거(#583)해, contenteditable이 만든 '&nbsp; &nbsp; ...'가 엔티티 문자열 그대로
--  배너 카드 부제(.m-card-sub)에 노출됐다. 태그는 공백으로 치환하고 &nbsp;·&amp;·&lt;·&gt;·&quot;·&#39;와 실제 NBSP(U+00A0)를 일반 문자로
--  바꾼 뒤 연속 공백을 하나로 정리·trim·120자로 자른다. 앱의 plainTextPreview(src/lib/utils/crazylogText.ts)와 같은 규칙.
--  · 반환 컬럼·필터(published AND is_public)·SECURITY DEFINER·GRANT는 #583과 동일(본문 식만 교체)

CREATE OR REPLACE FUNCTION public.get_crazylog_posts_by_ids(p_ids UUID[])
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
        replace(replace(replace(replace(replace(replace(replace(
          regexp_replace(
            COALESCE(jsonb_path_query_first(p.content_blocks, '$[*] ? (@.type == "text").html') #>> '{}', ''),
            '<[^>]*>', ' ', 'g'
          ),
          '&nbsp;', ' '), E' ', ' '), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&amp;', '&'),
        '\s+', ' ', 'g'
      )),
      120
    )
  FROM user_posts p
  WHERE p.id = ANY(p_ids)
    AND p.status = 'published'
    AND p.is_public = true;
$$;

GRANT EXECUTE ON FUNCTION public.get_crazylog_posts_by_ids(UUID[]) TO anon, authenticated;

-- ROLLBACK: #583 정의(태그만 제거하는 first_text)로 CREATE OR REPLACE
