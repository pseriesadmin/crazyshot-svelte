-- 779_product_view_stats_and_popularity.sql
-- 상품 페이지 방문 집계 + 검색 순위 인기 보조 점수 (2026-10-27, Stephen 확정: 집계하고 순위에 약하게 반영, 켜기/끄기 설정).
--  · product_view_stats: 상품별 최근 30일 방문 수·방문자 수·"직접 진입 방문자 수"(같은 사용자가 최근 30일에 그 상품을 검색 결과에서 클릭한 적이 없는 방문자 — 앱 내 이동은 referrer가 비어 있어
--    referrer로는 검색 경유를 구분할 수 없다)와 0~1 인기 점수(popularity = 직접 진입 방문자 수의 백분위, 0명이면 0). 입력은 이미 쌓이는 user_behavior_events(pageview) — 새 수집 없음.
--  · refresh_product_view_stats(): 매일 03:20 KST(pg_cron 18:20 UTC) 재집계. 서버 전용.
--  · nlsearch_popularity_weight(): nlsearch_settings.params.popularity 의 enabled=true 일 때만 weight(0~2)를 돌려준다. 설정이 없거나 오류면 0(꺼짐 = 기존 순위와 동일).
--  · search_products: 라이브 정의에서 정확히 2곳만 치환 — (1) 변수 v_pop_w 선언 (2) 전문검색 일치 점수에 + v_pop_w × popularity. 가중이 0이면 점수 불변. 그 외 로직은 손대지 않는다.
-- 권한: product_view_stats RLS ON·정책 0건·service_role만. 함수 2종은 service_role 전용(search_products는 SECURITY DEFINER라 내부 호출 가능).
-- 롤백: search_products 를 20261027030000_773 정의로 되돌리고 DROP FUNCTION nlsearch_popularity_weight, refresh_product_view_stats; cron.unschedule('refresh-product-view-stats'); DROP TABLE product_view_stats.

CREATE TABLE IF NOT EXISTS public.product_view_stats (
  product_id           uuid        PRIMARY KEY,
  views_30d            integer     NOT NULL DEFAULT 0,
  viewers_30d          integer     NOT NULL DEFAULT 0,
  direct_viewers_30d   integer     NOT NULL DEFAULT 0,
  popularity           real        NOT NULL DEFAULT 0 CHECK (popularity >= 0 AND popularity <= 1),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_view_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_view_stats FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_view_stats TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_product_view_stats()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_now  timestamptz := clock_timestamp();
  v_rows integer;
BEGIN
  WITH ev AS (
    SELECT substring(page_path from '^/products/([^/?#]+)') AS key,
           coalesce(user_id::text, CASE WHEN session_id IS NOT NULL AND session_id <> '' THEN 's:' || session_id END) AS actor
    FROM user_behavior_events
    WHERE event_type = 'pageview'
      AND created_at >= v_now - interval '30 days'
      AND page_path LIKE '/products/%'
  ), mapped AS (
    SELECT p.id AS product_id, ev.actor
    FROM ev
    JOIN products p ON (p.slug = ev.key OR p.id::text = ev.key)
    WHERE ev.key IS NOT NULL AND ev.key <> 'search'
      AND p.parent_product_id IS NULL AND p.deleted_at IS NULL
  ), agg AS (
    SELECT m.product_id,
           count(*)::int AS views,
           count(DISTINCT m.actor)::int AS viewers,
           count(DISTINCT m.actor) FILTER (WHERE m.actor IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM product_search_click_actors ca
             WHERE ca.product_id = m.product_id AND ca.actor_key = m.actor AND ca.last_clicked_at >= v_now - interval '30 days'
           ))::int AS direct_viewers
    FROM mapped m
    GROUP BY m.product_id
  ), ranked AS (
    SELECT a.*, CASE WHEN a.direct_viewers > 0 THEN percent_rank() OVER (ORDER BY a.direct_viewers) ELSE 0 END AS pop
    FROM agg a
  )
  INSERT INTO product_view_stats(product_id, views_30d, viewers_30d, direct_viewers_30d, popularity, updated_at)
  SELECT product_id, views, viewers, direct_viewers, pop::real, v_now FROM ranked
  ON CONFLICT (product_id) DO UPDATE SET
    views_30d = EXCLUDED.views_30d, viewers_30d = EXCLUDED.viewers_30d,
    direct_viewers_30d = EXCLUDED.direct_viewers_30d, popularity = EXCLUDED.popularity, updated_at = EXCLUDED.updated_at;

  -- 이번 집계에 없는 상품(최근 30일 방문 없음)은 지운다
  DELETE FROM product_view_stats WHERE updated_at < v_now;
  SELECT count(*)::int INTO v_rows FROM product_view_stats;
  RETURN v_rows;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_product_view_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_product_view_stats() TO service_role;

CREATE OR REPLACE FUNCTION public.nlsearch_popularity_weight()
RETURNS double precision
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_params jsonb;
  v_w      double precision;
BEGIN
  SELECT params -> 'popularity' INTO v_params FROM nlsearch_settings WHERE id = 1;
  IF v_params IS NULL OR coalesce(v_params ->> 'enabled', 'false') <> 'true' THEN RETURN 0; END IF;
  v_w := (v_params ->> 'weight')::double precision;
  IF v_w IS NULL OR v_w <> v_w THEN RETURN 0; END IF;
  RETURN greatest(0, least(2, v_w));
EXCEPTION WHEN others THEN
  RETURN 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.nlsearch_popularity_weight() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nlsearch_popularity_weight() TO service_role;

-- search_products: 라이브 정의에서 정확히 지정한 곳만 치환(불일치 시 롤백). 이미 적용돼 있으면(v_pop_w 포함) 건너뛴다.
DO $patch$
DECLARE
  v_def  text;
  v_new  text;
  v_n    integer;
BEGIN
  SELECT pg_get_functiondef('public.search_products(text,text,integer,integer,text,uuid,text[])'::regprocedure) INTO v_def;
  IF v_def LIKE '%v_pop_w%' THEN RETURN; END IF;

  v_n := (length(v_def) - length(replace(v_def, 'v_query_chosung TEXT;', ''))) / length('v_query_chosung TEXT;');
  IF v_n <> 1 THEN RAISE EXCEPTION 'search_products 변수 선언 위치가 1곳이 아님(%): 정의가 예상과 다름', v_n; END IF;
  v_new := replace(v_def, 'v_query_chosung TEXT;', 'v_query_chosung TEXT;' || E'\n  v_pop_w         double precision := public.nlsearch_popularity_weight();');

  v_n := (length(v_new) - length(replace(v_new, '), 0) * 2.0', ''))) / length('), 0) * 2.0');
  IF v_n <> 1 THEN RAISE EXCEPTION 'search_products 클릭률 점수 위치가 1곳이 아님(%): 정의가 예상과 다름', v_n; END IF;
  v_new := replace(v_new, '), 0) * 2.0',
    '), 0) * 2.0' || E'\n               + CASE WHEN v_pop_w > 0 THEN v_pop_w * coalesce((SELECT pvs.popularity::double precision FROM public.product_view_stats pvs WHERE pvs.product_id = p.id), 0) ELSE 0 END');

  EXECUTE v_new;
END
$patch$;

-- 매일 03:20 KST(18:20 UTC) 재집계 — pg_cron 이 있는 환경에서만
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'refresh-product-view-stats';
    PERFORM cron.schedule('refresh-product-view-stats', '20 18 * * *', 'SELECT public.refresh_product_view_stats()');
  END IF;
END
$cron$;

-- 최초 1회 집계
SELECT public.refresh_product_view_stats();
