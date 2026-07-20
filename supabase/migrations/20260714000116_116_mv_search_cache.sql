-- Migration 116: 트래픽 분산용 Materialized View + pg_cron
-- 목적: 500K/월 트래픽에서 반복 집계 쿼리를 사전 계산 → Vercel Function 응답 속도 개선
-- 전략: DB에서 주기적 집계 → API는 캐시 읽기만 → Supabase PgBouncer 커넥션 절약

-- 1. 카테고리별 활성 상품 수 (홈/카테고리 페이지 즉시 응답용)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_active_products_by_category AS
SELECT
  category,
  count(*) AS product_count,
  min(base_price_daily) AS min_price,
  max(base_price_daily) AS max_price
FROM products
WHERE deleted_at IS NULL
  AND parent_product_id IS NULL
GROUP BY category
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_active_products_category
  ON mv_active_products_by_category(category);

-- 2. 최근 30일 인기 검색어 Top 200 (자동완성·추천 검색어용)
--    search_logs가 비어 있어도 오류 없음 (빈 MV 생성)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_search_terms AS
SELECT
  lower(trim(query))   AS normalized_term,
  count(*)             AS search_count,
  avg(result_count)    AS avg_result_count,
  max(created_at)      AS last_searched_at
FROM search_logs
WHERE created_at >= now() - interval '30 days'
  AND result_count > 0
  AND length(trim(query)) >= 2
GROUP BY normalized_term
ORDER BY search_count DESC
LIMIT 200
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_top_terms_normalized
  ON mv_top_search_terms(normalized_term);
CREATE INDEX IF NOT EXISTS idx_mv_top_terms_trgm
  ON mv_top_search_terms USING GIN(normalized_term gin_trgm_ops);

-- 3. pg_cron 갱신 스케줄 (Migration 30에서 pg_cron 이미 활성화됨)
SELECT cron.schedule(
  'refresh-product-category-stats',
  '*/30 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_active_products_by_category$$
);

SELECT cron.schedule(
  'refresh-top-search-terms',
  '0 */2 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_search_terms$$
);

-- 4. impression_count 일괄 갱신 (매 시간 — search_products 호출량 기반)
CREATE OR REPLACE FUNCTION batch_update_search_impressions()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO product_search_stats(product_id, search_term, impression_count, click_count)
  SELECT
    p.id,
    sl.query,
    count(*),
    0
  FROM search_logs sl
  JOIN products p ON (
    p.search_vector @@ websearch_to_tsquery('simple', sl.query)
    AND p.deleted_at IS NULL
  )
  WHERE sl.created_at >= now() - interval '1 hour'
    AND sl.query IS NOT NULL
    AND length(trim(sl.query)) >= 2
  GROUP BY p.id, sl.query
  ON CONFLICT (product_id, search_term)
  DO UPDATE SET
    impression_count = product_search_stats.impression_count + EXCLUDED.impression_count,
    last_updated     = now();
EXCEPTION WHEN others THEN
  -- 배치 실패해도 서비스 영향 없음
  NULL;
END;
$$;

SELECT cron.schedule(
  'batch-update-search-impressions',
  '5 * * * *',
  $$SELECT batch_update_search_impressions()$$
);

-- ============================================================
-- ROLLBACK (역순 실행)
-- ============================================================
-- SELECT cron.unschedule('batch-update-search-impressions');
-- SELECT cron.unschedule('refresh-top-search-terms');
-- SELECT cron.unschedule('refresh-product-category-stats');
-- DROP FUNCTION IF EXISTS batch_update_search_impressions();
-- DROP MATERIALIZED VIEW IF EXISTS mv_top_search_terms;
-- DROP MATERIALIZED VIEW IF EXISTS mv_active_products_by_category;
-- ============================================================
