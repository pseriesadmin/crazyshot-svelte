-- migration #307: get_trending_keywords RPC
-- 관심집중 키워드 동적 랭킹 — 검색 조회수 + 상품 상세 접근수 합산 상위 N개 반환
--
-- 데이터 소스:
--   search_logs.query         — 모든 검색 이벤트 원본 (migration 114)
--   user_behavior_events      — event_type='click', event_data->>'action'='product_view',
--                               event_data->>'product_name' (migration 52, behaviorTracker.ts)
--
-- 가중치: 검색 1회 = 1점, 상품 상세 접근 1회 = 1점 (동등)
-- 동일 키워드가 양쪽에 있으면 합산됨 (대소문자·공백 정규화 후 FULL OUTER JOIN)

CREATE OR REPLACE FUNCTION get_trending_keywords(
  p_limit INT DEFAULT 6,
  p_days  INT DEFAULT 7
)
RETURNS TEXT[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH search_freq AS (
    -- 검색어 빈도: 정규화(소문자+trim) 후 집계
    SELECT
      lower(trim(query)) AS kw,
      count(*)           AS cnt
    FROM search_logs
    WHERE created_at >= now() - make_interval(days => p_days)
      AND length(trim(query)) BETWEEN 2 AND 60
    GROUP BY lower(trim(query))
  ),
  view_freq AS (
    -- 상품 상세 접근 빈도: product_name을 키워드로 취급
    SELECT
      lower(trim(event_data->>'product_name')) AS kw,
      count(*)                                 AS cnt
    FROM user_behavior_events
    WHERE event_type          = 'click'
      AND event_data->>'action' = 'product_view'
      AND event_data->>'product_name' IS NOT NULL
      AND created_at >= now() - make_interval(days => p_days)
      AND length(trim(event_data->>'product_name')) BETWEEN 2 AND 60
    GROUP BY lower(trim(event_data->>'product_name'))
  ),
  combined AS (
    -- 두 신호 합산 + 점수 내림차순
    SELECT
      kw,
      sum(cnt) AS total_score
    FROM (
      SELECT kw, cnt FROM search_freq
      UNION ALL
      SELECT kw, cnt FROM view_freq
    ) t
    WHERE kw IS NOT NULL AND kw <> ''
    GROUP BY kw
    ORDER BY total_score DESC
    LIMIT p_limit
  )
  SELECT array_agg(kw ORDER BY total_score DESC)
  FROM combined;
$$;

-- anon/authenticated 클라이언트에서 호출 가능 (products 페이지 SSR)
GRANT EXECUTE ON FUNCTION get_trending_keywords(INT, INT) TO anon, authenticated;

-- ROLLBACK:
-- REVOKE EXECUTE ON FUNCTION get_trending_keywords(INT, INT) FROM anon, authenticated;
-- DROP FUNCTION IF EXISTS get_trending_keywords(INT, INT);
