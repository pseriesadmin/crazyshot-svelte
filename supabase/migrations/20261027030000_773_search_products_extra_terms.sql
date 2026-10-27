-- 773: 고객 상품 검색(search_products)에 "추가 검색어"(p_extra_terms)와 공백·하이픈 무시 매칭 추가
--
-- 배경(2026-10-27): 고객 검색은 FTS(search_vector)로 찾기 때문에
--   ① 동의어 확장(소니→Sony)이 "결과 3건 이하일 때만" 앱에서 돌아 영문 표기 상품이 통째로 빠지고,
--   ② 'r6markii'↔'R6 Mark II', 'AGCX10'↔'AG-CX10'처럼 공백·하이픈만 다른 표기는 서로 찾지 못했다.
-- 변경: 7번째 선택 인자 p_extra_terms text[](기본 빈 배열)을 받아 FTS OR 조건에 합치고,
--   검색어에서 공백·하이픈을 뺀 값(3자 이상)이 상품명·브랜드·캡션·키워드를 같은 방식으로 정규화한 문자열에 포함되면 매칭한다.
-- 유지: search_logs 에는 원래 검색어(p_query)만 기록, 페이지·정렬·분류 우선·초성·CTR 가산 그대로.
--   기존 6개 인자 호출은 그대로 동작한다(7번째 인자 생략 가능).
-- 주의: 인자 개수가 다른 같은 이름 함수를 두면 PostgREST 호출이 모호해지므로(PGRST203) 기존 6인자 함수를 삭제하고 교체한다.
--   실행 권한은 기존과 동일(PUBLIC·anon·authenticated·service_role).

DROP FUNCTION IF EXISTS public.search_products(text, text, integer, integer, text, uuid);

CREATE OR REPLACE FUNCTION public.search_products(
  p_query       text    DEFAULT NULL::text,
  p_category    text    DEFAULT NULL::text,
  p_page        integer DEFAULT 1,
  p_limit       integer DEFAULT 20,
  p_session_id  text    DEFAULT NULL::text,
  p_user_id     uuid    DEFAULT NULL::uuid,
  p_extra_terms text[]  DEFAULT '{}'::text[]
)
 RETURNS TABLE(product_id uuid, name text, slug text, category text, brand text, price_min numeric, image_url text, rank_score double precision, total_count bigint, search_log_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_query_tokens  tsquery;
  v_extra_tokens  tsquery;
  v_extra_q       tsquery;
  v_extra_term    text;
  v_compact_like  text;
  v_offset        INT := (p_page - 1) * p_limit;
  v_log_id        UUID;
  v_intent        text[];
  v_query_chosung TEXT;
BEGIN
  IF p_query IS NOT NULL AND length(trim(p_query)) >= 1 THEN
    v_query_tokens := websearch_to_tsquery('simple', p_query);
    -- 질의 끝쪽 연속 단어가 분류 이름이면 그 분류 코드들(없으면 NULL)
    v_intent := public.search_category_intent(p_query);
    -- 자음(ㄱ-ㅎ)과 공백만으로 된 질의만 초성 검색(영문·혼합 질의에 부분일치를 걸지 않는다)
    IF btrim(p_query) ~ '^[ㄱ-ㅎ ]+$' THEN
      v_query_chosung := btrim(p_query);
    END IF;

    -- 공백·하이픈 무시 매칭용 패턴: 정규화한 검색어가 3자 이상일 때만(너무 넓은 매칭 방지), LIKE 특수문자는 이스케이프
    IF length(regexp_replace(lower(p_query), '[\s-]', '', 'g')) >= 3 THEN
      v_compact_like := '%' || replace(replace(replace(
        regexp_replace(lower(p_query), '[\s-]', '', 'g'),
        '\', '\\'), '%', '\%'), '_', '\_') || '%';
    END IF;
  END IF;

  -- 추가 검색어(동의어 변환어 등): 최대 10개까지 FTS OR 로 합친다
  IF p_extra_terms IS NOT NULL THEN
    FOREACH v_extra_term IN ARRAY p_extra_terms[1:10] LOOP
      IF v_extra_term IS NOT NULL AND length(trim(v_extra_term)) >= 1 THEN
        v_extra_q := websearch_to_tsquery('simple', v_extra_term);
        IF v_extra_q IS NOT NULL AND v_extra_q::text <> '' THEN
          v_extra_tokens := CASE WHEN v_extra_tokens IS NULL THEN v_extra_q ELSE v_extra_tokens || v_extra_q END;
        END IF;
      END IF;
    END LOOP;
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
        WHEN v_extra_tokens IS NOT NULL AND p.search_vector @@ v_extra_tokens
          THEN ts_rank_cd(p.search_vector, v_extra_tokens, 32) * 9.0
        WHEN v_query_chosung IS NOT NULL
          AND (p.name_chosung LIKE '%' || v_query_chosung || '%'
               OR p.brand_chosung LIKE '%' || v_query_chosung || '%')
          THEN 4.0
        WHEN v_compact_like IS NOT NULL AND c.ctext LIKE v_compact_like
          THEN 3.0
        ELSE
          coalesce(similarity(p.name, p_query), 0) * 5.0
      END                                               AS rank_score,
      count(*) OVER ()                                  AS total_count
    FROM products p
    CROSS JOIN LATERAL (
      SELECT regexp_replace(lower(
        coalesce(p.name, '') || '|' || coalesce(p.brand, '') || '|' || coalesce(p.product_caption, '') || '|'
        || coalesce(array_to_string(p.keywords, '|'), '')
      ), '[\s-]', '', 'g') AS ctext
    ) c
    WHERE p.deleted_at IS NULL
      AND p.parent_product_id IS NULL
      AND p.option_only = false
      AND p.is_active = true
      AND (p_category IS NULL OR p.category = p_category)
      AND (
        p_query IS NULL OR length(trim(p_query)) = 0
        OR (v_query_tokens IS NOT NULL AND p.search_vector @@ v_query_tokens)
        OR (v_extra_tokens IS NOT NULL AND p.search_vector @@ v_extra_tokens)
        OR (v_compact_like IS NOT NULL AND c.ctext LIKE v_compact_like)
        OR similarity(p.name, p_query) > 0.2
        OR similarity(coalesce(p.brand, ''), p_query) > 0.3
        OR (v_query_chosung IS NOT NULL
            AND (p.name_chosung LIKE '%' || v_query_chosung || '%'
                 OR p.brand_chosung LIKE '%' || v_query_chosung || '%'))
        OR (v_intent IS NOT NULL AND p.category = ANY (v_intent))
      )
    ORDER BY (v_intent IS NOT NULL AND p.category = ANY (v_intent)) DESC, rank_score DESC, p.created_at DESC
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
      CROSS JOIN LATERAL (
        SELECT regexp_replace(lower(
          coalesce(pr.name, '') || '|' || coalesce(pr.brand, '') || '|' || coalesce(pr.product_caption, '') || '|'
          || coalesce(array_to_string(pr.keywords, '|'), '')
        ), '[\s-]', '', 'g') AS ctext
      ) cc
      WHERE pr.deleted_at IS NULL
        AND pr.parent_product_id IS NULL
        AND pr.option_only = false
        AND pr.is_active = true
        AND (p_category IS NULL OR pr.category = p_category)
        AND (
          p_query IS NULL OR length(trim(p_query)) = 0
          OR (v_query_tokens IS NOT NULL AND pr.search_vector @@ v_query_tokens)
          OR (v_extra_tokens IS NOT NULL AND pr.search_vector @@ v_extra_tokens)
          OR (v_compact_like IS NOT NULL AND cc.ctext LIKE v_compact_like)
          OR similarity(pr.name, p_query) > 0.2
          OR similarity(coalesce(pr.brand, ''), p_query) > 0.3
          OR (v_query_chosung IS NOT NULL
              AND (pr.name_chosung LIKE '%' || v_query_chosung || '%'
                   OR pr.brand_chosung LIKE '%' || v_query_chosung || '%'))
          OR (v_intent IS NOT NULL AND pr.category = ANY (v_intent))
        )
    )
    WHERE sl.id = v_log_id;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.search_products(text, text, integer, integer, text, uuid, text[]) TO PUBLIC, anon, authenticated, service_role;
