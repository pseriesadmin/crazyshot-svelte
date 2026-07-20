-- Migration 115: search_products RPC (통합 검색 엔드포인트)
-- 목적: FTS → trgm → 카테고리 폴백의 3단계 검색 + 자동 로그 기록
-- 트래픽 분산: 모든 검색 로직을 DB 내부에서 처리 (Vercel Function 부하 최소화)
-- NOTE (stage 적용 시 수정):
--   - price_per_day → base_price_daily (실제 컬럼명)
--   - thumbnail_url → image_url (image_urls JSONB 배열 첫 번째 원소)
--   - query_tokens INSERT: tsquery → to_tsvector('simple', ...) 변환
--   - result_count UPDATE: category 컬럼 ambiguous → pr alias 사용

CREATE OR REPLACE FUNCTION search_products(
  p_query         TEXT    DEFAULT NULL,
  p_category      TEXT    DEFAULT NULL,
  p_page          INT     DEFAULT 1,
  p_limit         INT     DEFAULT 20,
  p_session_id    TEXT    DEFAULT NULL,
  p_user_id       UUID    DEFAULT NULL
)
RETURNS TABLE (
  product_id    UUID,
  name          TEXT,
  slug          TEXT,
  category      TEXT,
  brand         TEXT,
  price_min     NUMERIC,
  image_url     TEXT,
  rank_score    FLOAT,
  total_count   BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_query_tokens  tsquery;
  v_offset        INT := (p_page - 1) * p_limit;
  v_log_id        UUID;
BEGIN
  IF p_query IS NOT NULL AND length(trim(p_query)) >= 1 THEN
    v_query_tokens := websearch_to_tsquery('simple', p_query);
  END IF;

  IF p_query IS NOT NULL AND length(trim(p_query)) >= 2 THEN
    INSERT INTO search_logs(user_id, session_id, query, query_tokens, category_filter)
    VALUES (
      p_user_id,
      p_session_id,
      p_query,
      to_tsvector('simple', p_query),
      p_category
    )
    RETURNING id INTO v_log_id;
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      p.id                                              AS product_id,
      p.name,
      p.slug,
      p.category,
      p.brand,
      p.base_price_daily                                AS price_min,
      (p.image_urls->>0)                                AS image_url,
      CASE
        WHEN v_query_tokens IS NOT NULL AND p.search_vector @@ v_query_tokens
          THEN ts_rank_cd(p.search_vector, v_query_tokens, 32) * 10.0
               + coalesce((
                   SELECT avg(pss.ctr) FROM product_search_stats pss
                   WHERE pss.product_id = p.id
                     AND similarity(pss.search_term, p_query) > 0.3
                 ), 0) * 2.0
        ELSE
          coalesce(similarity(p.name, p_query), 0) * 5.0
      END                                               AS rank_score,
      count(*) OVER ()                                  AS total_count
    FROM products p
    WHERE p.deleted_at IS NULL
      AND p.parent_product_id IS NULL
      AND (p_category IS NULL OR p.category = p_category)
      AND (
        p_query IS NULL OR length(trim(p_query)) = 0
        OR (v_query_tokens IS NOT NULL AND p.search_vector @@ v_query_tokens)
        OR similarity(p.name, p_query) > 0.2
        OR similarity(coalesce(p.brand, ''), p_query) > 0.3
      )
    ORDER BY rank_score DESC, p.created_at DESC
    LIMIT p_limit OFFSET v_offset
  )
  SELECT
    r.product_id, r.name, r.slug, r.category, r.brand,
    r.price_min, r.image_url, r.rank_score, r.total_count
  FROM ranked r;

  IF v_log_id IS NOT NULL THEN
    UPDATE search_logs sl
    SET result_count = (
      SELECT count(*) FROM products pr
      WHERE pr.deleted_at IS NULL
        AND pr.parent_product_id IS NULL
        AND (p_category IS NULL OR pr.category = p_category)
    )
    WHERE sl.id = v_log_id;
  END IF;
END;
$$;

-- product_search_stats 갱신 함수 (클릭 이벤트 발생 시 호출)
CREATE OR REPLACE FUNCTION record_search_click(
  p_search_log_id UUID,
  p_product_id    UUID
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_query TEXT;
BEGIN
  SELECT query INTO v_query FROM search_logs WHERE id = p_search_log_id;
  IF v_query IS NULL THEN RETURN; END IF;

  INSERT INTO product_search_stats(product_id, search_term, impression_count, click_count)
  VALUES (p_product_id, v_query, 0, 1)
  ON CONFLICT (product_id, search_term)
  DO UPDATE SET
    click_count  = product_search_stats.click_count + 1,
    last_updated = now();

  UPDATE search_logs
  SET clicked_ids = array_append(coalesce(clicked_ids, '{}'), p_product_id)
  WHERE id = p_search_log_id;
END;
$$;

-- ============================================================
-- ROLLBACK (역순 실행)
-- ============================================================
-- DROP FUNCTION IF EXISTS record_search_click(UUID, UUID);
-- DROP FUNCTION IF EXISTS search_products(TEXT, TEXT, INT, INT, TEXT, UUID);
-- ============================================================
