-- Migration #563: search_products RPC — is_active=false 상품 노출 차단
-- 2026-09-28
--
-- 문제: search_products(SECURITY DEFINER)가 RLS를 우회하면서 is_active=true 필터가 없어
-- CMS에서 "미노출"로 설정된 상품이 /products 전체목록·카테고리·최신등록·검색 1차 경로에
-- 고객에게 그대로 노출됨.
--
-- 수정: ranked CTE WHERE 절과 UPDATE search_logs 서브쿼리 WHERE 절에
-- AND p.is_active = true / AND pr.is_active = true 를 각각 추가.
-- 파라미터·반환 스키마는 변경 없음 — CREATE OR REPLACE만으로 충분.
--
-- 영향: 이 RPC를 호출하는 모든 경로가 동시에 수정됨:
--   /api/search/products (검색), /products (전체목록·카테고리·최신등록),
--   CMS 상품 큐레이션 검색(HomeThemeGroupModal 등)

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
  total_count   BIGINT,
  search_log_id UUID
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
      COALESCE(
        NULLIF(p.base_price_daily, 0),
        (SELECT pr.price FROM price_rules pr
          WHERE pr.product_id = p.id AND pr.duration_type = '24h'
          LIMIT 1)
      )                                                  AS price_min,
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
      AND p.option_only = false
      AND p.is_active = true
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
    r.price_min, r.image_url, r.rank_score, r.total_count,
    v_log_id AS search_log_id
  FROM ranked r;

  IF v_log_id IS NOT NULL THEN
    UPDATE search_logs sl
    SET result_count = (
      SELECT count(*) FROM products pr
      WHERE pr.deleted_at IS NULL
        AND pr.parent_product_id IS NULL
        AND pr.option_only = false
        AND pr.is_active = true
        AND (p_category IS NULL OR pr.category = p_category)
        AND (
          p_query IS NULL OR length(trim(p_query)) = 0
          OR (v_query_tokens IS NOT NULL AND pr.search_vector @@ v_query_tokens)
          OR similarity(pr.name, p_query) > 0.2
          OR similarity(coalesce(pr.brand, ''), p_query) > 0.3
        )
    )
    WHERE sl.id = v_log_id;
  END IF;
END;
$$;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration #411의 CREATE OR REPLACE 문 재실행으로 복구(is_active 필터 제거)
-- ============================================================
