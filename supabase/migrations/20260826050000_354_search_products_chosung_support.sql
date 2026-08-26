-- Migration 354: search_products 한글 초성(chosung) 검색 지원
-- 목적: 한글 상품명/브랜드에 한해 초성(예: "ㅅㄴ ㅂㅌㄹ")만 입력해도 매칭되도록 지원.
--       영문 상품명(예: "Manfrotto")과 한글 사이의 상호 매핑은 하지 않는다(Stephen 확정,
--       2026-08-26 — "영문을 한글로 or 한글을 영문으로 매핑할 필요 없어") — 각 언어 트랙은
--       독립적으로 동작: 영문 검색어는 기존 FTS/trigram 그대로, 한글 초성 검색어만 신규
--       chosung 매칭 조건을 추가로 탄다.
-- 영향 범위: search_products RPC를 쓰는 모든 화면(전역 상품검색) — 함수 시그니처(파라미터·
--           반환타입) 불변이라 호출부 TS 코드 수정 불필요.
-- 함수명·파라미터 시그니처 불변 원칙 준수 — DROP 없이 CREATE OR REPLACE로 본문만 교체.

-- ── 1. 초성 추출 함수 ──────────────────────────────────────────────────────
-- 완성형 한글 음절(U+AC00~U+D7A3)만 초성으로 치환, 그 외 문자(영문·숫자·공백·자모 등)는
-- 그대로 통과시킨다 — 언어 간 매핑 없음, 순수 초성 추출만 수행.
CREATE OR REPLACE FUNCTION public.hangul_chosung(p_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  v_result   TEXT := '';
  v_chars    TEXT[] := ARRAY['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  v_code     INT;
  v_i        INT;
  v_len      INT := length(p_text);
  v_cho_idx  INT;
BEGIN
  FOR v_i IN 1..v_len LOOP
    -- Postgres ascii()는 이름과 달리 첫 글자의 유니코드 코드포인트를 반환(멀티바이트 안전)
    v_code := ascii(substr(p_text, v_i, 1));
    IF v_code BETWEEN 44032 AND 55203 THEN -- 0xAC00~0xD7A3 완성형 한글 음절
      v_cho_idx := (v_code - 44032) / 588;
      v_result  := v_result || v_chars[v_cho_idx + 1];
    ELSE
      v_result := v_result || substr(p_text, v_i, 1);
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;

-- ── 2. products 초성 생성열 추가 (GENERATED ALWAYS AS ... STORED) ───────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS name_chosung  TEXT GENERATED ALWAYS AS (public.hangul_chosung(name)) STORED,
  ADD COLUMN IF NOT EXISTS brand_chosung TEXT GENERATED ALWAYS AS (public.hangul_chosung(coalesce(brand, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_products_name_chosung_trgm
  ON public.products USING gin (name_chosung gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_brand_chosung_trgm
  ON public.products USING gin (brand_chosung gin_trgm_ops);

-- ── 3. search_products 본문 교체 — 초성 매칭 조건 추가 ──────────────────────
-- 반환타입(RETURNS TABLE) 불변 → migration 203의 search_log_id 컬럼 그대로 유지, DROP 불필요.
CREATE OR REPLACE FUNCTION public.search_products(
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
  v_query_chosung TEXT;
BEGIN
  IF p_query IS NOT NULL AND length(trim(p_query)) >= 1 THEN
    v_query_tokens  := websearch_to_tsquery('simple', p_query);
    v_query_chosung := public.hangul_chosung(p_query);
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
        WHEN v_query_chosung IS NOT NULL AND v_query_chosung <> ''
          AND (p.name_chosung LIKE '%' || v_query_chosung || '%'
               OR p.brand_chosung LIKE '%' || v_query_chosung || '%')
          THEN 4.0
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
        OR (v_query_chosung IS NOT NULL AND v_query_chosung <> ''
            AND (p.name_chosung LIKE '%' || v_query_chosung || '%'
                 OR p.brand_chosung LIKE '%' || v_query_chosung || '%'))
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
        AND (p_category IS NULL OR pr.category = p_category)
        AND (
          p_query IS NULL OR length(trim(p_query)) = 0
          OR (v_query_tokens IS NOT NULL AND pr.search_vector @@ v_query_tokens)
          OR similarity(pr.name, p_query) > 0.2
          OR similarity(coalesce(pr.brand, ''), p_query) > 0.3
          OR (v_query_chosung IS NOT NULL AND v_query_chosung <> ''
              AND (pr.name_chosung LIKE '%' || v_query_chosung || '%'
                   OR pr.brand_chosung LIKE '%' || v_query_chosung || '%'))
        )
    )
    WHERE sl.id = v_log_id;
  END IF;
END;
$$;

-- ============================================================
-- ROLLBACK (역순 실행)
-- ============================================================
-- DROP INDEX IF EXISTS idx_products_name_chosung_trgm;
-- DROP INDEX IF EXISTS idx_products_brand_chosung_trgm;
-- ALTER TABLE public.products DROP COLUMN IF EXISTS name_chosung;
-- ALTER TABLE public.products DROP COLUMN IF EXISTS brand_chosung;
-- DROP FUNCTION IF EXISTS public.hangul_chosung(TEXT);
-- -- search_products는 migration 203의 CREATE OR REPLACE 재실행으로 복구
-- ============================================================
