-- Migration #411: search_products RPC — price_min을 price_rules(24h)에서 계산하도록 수정
-- (2026-09-01 파일명 재번호: 원래 #410으로 작성했으나 병렬로 커밋된
-- get_customer_list_classification_case_fix.sql이 같은 번호(#410)를 먼저 선점해 충돌 —
-- #411로 재번호. ⚠️ stage/production DB에는 이미 "410_search_products_price_rules_fix"라는
-- 이름으로 apply_migration 실행됨(SQL 내용은 이 파일과 동일) — 파일명만 로컬에서 정리한
-- 것이며 재적용은 하지 않음(CREATE OR REPLACE라 재적용해도 무해하지만 중복 이력 방지 위해 생략).
--
-- 배경(2026-09-01, 실서버 전역 테스트로 발견): 검색 결과(/products/search)가 모든 상품 가격을
-- "0원"으로 표시하는 CRITICAL 버그. 원인 — search_products RPC(Migration #115~390)가
-- price_min을 products.base_price_daily 컬럼에서 그대로 가져오는데, 이 컬럼은 Migration #80에서
-- "price_rules로 대체된 레거시 컬럼, DEFAULT 0"으로 이미 명문화된 죽은 컬럼이다. 실제 대여가격은
-- price_rules(product_id, duration_type, price) 테이블에 저장된다(products.md 가격 모델 정본).
--
-- 수정: src/routes/products/+page.server.ts가 이미 쓰고 있는 정본 패턴과 동일하게 —
--   legacy base_price_daily가 0보다 크면 그 값 우선(과거 수동 입력 데이터 보존), 아니면
--   price_rules에서 duration_type='24h'(일일 대여가) 조회.
-- 함수명·파라미터·반환타입(RETURNS TABLE) 불변 — CREATE OR REPLACE로 충분(Migration #390 선례).
--
-- 영향 범위: 이 RPC를 직접 호출하는 지점 전부 수정 혜택을 받음 —
--   /api/search/products(고객 검색), HomeThemeGroupModal·HomeCategoryProductsModal·
--   ProductHeroModal(CMS 상품 큐레이션 검색) 전부 동일 버그를 겪고 있었음.

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
-- Migration #390의 CREATE 문 재실행으로 복구(price_min을 p.base_price_daily 단독 참조로 되돌림)
-- ============================================================
