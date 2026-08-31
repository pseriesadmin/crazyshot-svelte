-- Migration #390: search_products RPC — option_only=true 상품 검색결과 제외
-- 배경: Migration #389에서 추가한 products.option_only 컬럼을 카탈로그 검색(전체목록·
--   자동완성 근간 RPC)에도 반영 — 옵션 전용 상품이 검색결과·result_count 집계 어디에도
--   나타나지 않도록 두 WHERE 절 모두에 조건 추가.
-- 원칙: 함수명·파라미터·반환타입(RETURNS TABLE) 불변 — DROP 불필요, CREATE OR REPLACE로 충분
--   (Migration #203의 DROP은 반환 컬럼 자체를 추가하던 경우라 필요했던 것 — 이번엔 WHERE
--   조건만 추가하므로 해당 없음).
-- 참고: 이 RPC는 원래부터 is_active 필터가 없다(pre-existing, 이번 작업 범위 아님) —
--   그대로 두고 option_only 조건만 추가한다.

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
      AND p.option_only = false
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
-- ROLLBACK (역순 실행)
-- ============================================================
-- Migration #203의 CREATE 문 재실행으로 복구(option_only 조건 2곳 제거)
-- ============================================================
