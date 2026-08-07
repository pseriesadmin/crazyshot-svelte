-- Migration 203: search_products RPC 버그 수정 (G-1 + G-2)
-- 목적:
--   G-1: result_count를 실제 검색어 매칭 기준으로 재계산 (기존 버그: 카테고리 내 전체 수 반환)
--   G-2: RETURNS TABLE에 search_log_id 추가 (기존 버그: search_log_id 미반환 → recordSearchClick 죽은 코드)
-- 원칙: 함수명·파라미터 시그니처 불변 (호출부 TS 코드 무수정)
-- 기존 마이그레이션 115는 직접 수정하지 않고 DROP + CREATE로 덮어씀
-- 주의: RETURNS TABLE에 컬럼(search_log_id)을 추가하는 반환타입 변경은
--       CREATE OR REPLACE로 불가(Postgres 42P13) → DROP FUNCTION 선행 필수
--       (2026-08-07 stage 적용 시 실제로 이 에러 발생 확인 후 DROP 추가)

DROP FUNCTION IF EXISTS search_products(text,text,integer,integer,text,uuid);

CREATE FUNCTION search_products(
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
  search_log_id UUID    -- G-2: 신규 컬럼 — 클릭 시 record_search_click RPC에 전달
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
    r.price_min, r.image_url, r.rank_score, r.total_count,
    v_log_id AS search_log_id  -- G-2: 매 결과 행마다 동일한 로그 ID 첨부
  FROM ranked r;

  -- G-1 버그 수정: 기존은 p_query 매칭 여부 무관하게 카테고리 내 전체 상품 수를 기록했음.
  -- 수정: 실제 검색 결과를 생성하는 것과 동일한 WHERE 조건으로 매칭된 상품 수만 기록.
  IF v_log_id IS NOT NULL THEN
    UPDATE search_logs sl
    SET result_count = (
      SELECT count(*) FROM products pr
      WHERE pr.deleted_at IS NULL
        AND pr.parent_product_id IS NULL
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
-- 이전 버전(migration 115)의 CREATE OR REPLACE 재실행으로 복구
-- DROP 불필요 (CREATE OR REPLACE가 덮어씀)
-- ============================================================
