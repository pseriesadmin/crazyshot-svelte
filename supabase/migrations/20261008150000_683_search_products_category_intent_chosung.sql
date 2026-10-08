-- Migration #683: 고객 검색 DB 함수 — 한글 분류어 의도(질의 끝말이 분류 이름) + 한글 초성 검색 복원
-- 2026-10-08 (Stephen 승인: 방안 1-b + 초성 검색 누락분 포함)
--
-- 배경(프로덕션 148개 읽기 전용 재현):
--   ① "카메라" 검색 시 상위 12개 중 카메라 분류가 1개(1~3위가 드론·액션캠), "카메라 렌즈" 18건·"소니 카메라" 8건,
--      "카메라 추천해줘"류 문장형 질의는 0건 — search_vector가 'simple' 설정(단어 전체 일치)·AND 결합·영문 분류 코드뿐이고
--      한글 분류 이름("카메라")이 어디에도 없기 때문.
--   ② 한글 초성 검색(ㅅㄴ)은 Migration 354가 search_products에 넣었으나 390·411·563이 함수를 재정의하며 조건이 탈락했다.
--      hangul_chosung() 함수·생성 컬럼 name_chosung/brand_chosung·trgm 인덱스는 Stage·Production에 그대로 남아 있다.
--
-- 변경(함수 2개만, 테이블·트리거·벡터·인덱스·search_logs 스키마 무변경):
--   1) public.search_category_intent(p_query) — 질의 끝쪽의 연속된 단어가 CMS 코드설정(code_mapping_groups) 분류 이름이면
--      그 분류 코드 배열을 반환, 아니면 NULL. TS adapters/productSearchDocs.ts detectCategoryIntent와 같은 규칙
--      (끝의 ?!.~ 제거 → 끝의 부탁 표현 제거 → 끝에서부터 조사 제거 후 이름·"/"·공백 분리 부분과 대소문자 무시 비교).
--      ⚠ 판정 규칙(조사·부탁 표현 목록)을 바꾸면 TS 상수와 함께 바꿔야 한다 — Stage 테스트(searchProductsCategoryIntentDb)가 같은 표로 비교한다.
--      서버 전용: PUBLIC·anon·authenticated 실행 권한 회수, service_role만 허용(search_products는 SECURITY DEFINER라 내부 호출 가능).
--   2) public.search_products — Migration 563 정의(= 라이브 정의, 해시 Stage=Production 동일)에서 필요한 줄만 변경:
--        · v_intent := search_category_intent(p_query) (질의 NULL/빈 값이면 호출 안 함 → 전체 목록 경로 100% 동일)
--        · WHERE 매칭에 OR (v_intent IS NOT NULL AND category = ANY(v_intent)) — 분류 이름으로 끝나는 질의는 그 분류 상품 전부 포함
--        · ORDER BY (분류 의도 일치) DESC 를 맨 앞에 — rank_score 값 자체는 불변(CTR 가산 의미 보존)
--        · 초성 조건 복원: 질의가 자음(ㄱ-ㅎ)과 공백만으로 이루어졌을 때만 name_chosung/brand_chosung 부분일치.
--          (354 원문은 모든 질의에 걸어 영문 질의에도 대소문자 구분 부분일치가 붙는 잠재 결함이 있어 자음 전용으로 제한)
--        · search_logs.result_count UPDATE의 WHERE도 본문과 같은 조건(G-1 불일치 재발 방지)
--      시그니처·반환 컬럼·SECURITY DEFINER·기존 실행 권한(anon·authenticated·service_role)·로그 INSERT(호출당 1행) 불변.
--
-- 영향: search_products를 부르는 모든 경로(/api/search/products, /products 목록·카테고리·최신등록, CMS 큐레이션 검색)가 동시에 바뀐다.
--       질의가 NULL이거나 분류 이름·자음 전용이 아닌 질의("Sony A7S3", "카메라 가방", "삼각대", "미러리스")는 결과·순서가 이전과 같아야 한다.

-- ── 1. 분류 의도 판정 보조 함수 ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_category_intent(p_query text)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- TS koreanTokenizer.TRAILING_PARTICLES(긴 조사 먼저, 같은 길이는 선언 순서)와 동일
  v_particles text[] := ARRAY['으로부터','에게서','이라도','라도','까지','부터','에서','에게','으로','이나','이랑',
                              '랑','와','과','도','만','는','은','이','가','을','를','의','로','나'];
  -- TS productSearchDocs.TRAILING_REQUEST_WORDS와 동일
  v_requests  text[] := ARRAY['줘요','줘','주세요','주라','해줘','해줘요','알려줘','알려줘요','알려주세요','부탁','부탁해','부탁해요','좀',
                              '추천','추천해','추천해요','추천해줘','추천해줘요','추천해주세요'];
  v_tokens    text[];
  v_n         int;
  v_i         int;
  v_raw       text;
  v_t         text;
  v_p         text;
  v_min       int;
  v_hit       text[];
  v_codes     text[] := ARRAY[]::text[];
BEGIN
  IF p_query IS NULL OR regexp_replace(p_query, '^\s+|\s+$', '', 'g') = '' THEN
    RETURN NULL;
  END IF;

  -- 토큰: 공백·쉼표로 나누고 끝의 ?!.~ 제거, 빈 토큰 제외
  SELECT coalesce(array_agg(s.t ORDER BY s.ord), ARRAY[]::text[]) INTO v_tokens
  FROM (
    SELECT regexp_replace(u.x, '[?!.~]+$', '') AS t, u.ord
    FROM unnest(regexp_split_to_array(regexp_replace(p_query, '^\s+|\s+$', '', 'g'), '[\s,]+')) WITH ORDINALITY AS u(x, ord)
  ) s
  WHERE s.t <> '';

  v_n := coalesce(array_length(v_tokens, 1), 0);
  -- 끝의 부탁 표현 제거
  WHILE v_n > 0 AND lower(v_tokens[v_n]) = ANY (v_requests) LOOP
    v_n := v_n - 1;
  END LOOP;
  IF v_n = 0 THEN
    RETURN NULL;
  END IF;

  -- 끝에서부터 연속된 단어가 분류 이름이면 코드를 모은다
  v_i := v_n;
  WHILE v_i >= 1 LOOP
    v_raw := lower(v_tokens[v_i]);
    v_t   := v_raw;
    -- 조사 제거(TS stripTrailingParticle과 동일: 1글자 조사는 어간 2자 이상일 때만)
    FOREACH v_p IN ARRAY v_particles LOOP
      IF char_length(v_raw) >= char_length(v_p) AND right(v_raw, char_length(v_p)) = v_p THEN
        v_min := CASE WHEN char_length(v_p) = 1 THEN 2 ELSE 1 END;
        IF char_length(v_raw) - char_length(v_p) >= v_min THEN
          v_t := left(v_raw, char_length(v_raw) - char_length(v_p));
          EXIT;
        END IF;
      END IF;
    END LOOP;

    -- 조사 뗀 단어로 먼저, 없으면 원래 단어로 이름(전체)·이름의 "/"·공백 분리 부분과 비교
    v_hit := NULL;
    SELECT array_agg(DISTINCT g.default_category) INTO v_hit
    FROM public.code_mapping_groups g
    WHERE g.is_active
      AND g.default_category IS NOT NULL
      AND g.name IS NOT NULL AND btrim(g.name) <> ''
      AND (
        lower(btrim(g.name)) = v_t
        OR EXISTS (
          SELECT 1 FROM unnest(regexp_split_to_array(btrim(g.name), '[/\s]+')) AS part
          WHERE part <> '' AND lower(part) = v_t
        )
      );
    IF v_hit IS NULL AND v_raw <> v_t THEN
      SELECT array_agg(DISTINCT g.default_category) INTO v_hit
      FROM public.code_mapping_groups g
      WHERE g.is_active
        AND g.default_category IS NOT NULL
        AND g.name IS NOT NULL AND btrim(g.name) <> ''
        AND (
          lower(btrim(g.name)) = v_raw
          OR EXISTS (
            SELECT 1 FROM unnest(regexp_split_to_array(btrim(g.name), '[/\s]+')) AS part
            WHERE part <> '' AND lower(part) = v_raw
          )
        );
    END IF;

    EXIT WHEN v_hit IS NULL;
    v_codes := v_codes || v_hit;
    v_i := v_i - 1;
  END LOOP;

  IF array_length(v_codes, 1) IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT array_agg(DISTINCT c) FROM unnest(v_codes) AS c);
END;
$$;

REVOKE ALL ON FUNCTION public.search_category_intent(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_category_intent(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_category_intent(text) TO service_role;

-- ── 2. search_products — 563 정의 기준, 분류 의도 + 초성 복원 ─────────────────
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
        WHEN v_query_chosung IS NOT NULL
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
      AND p.option_only = false
      AND p.is_active = true
      AND (p_category IS NULL OR p.category = p_category)
      AND (
        p_query IS NULL OR length(trim(p_query)) = 0
        OR (v_query_tokens IS NOT NULL AND p.search_vector @@ v_query_tokens)
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
          OR (v_query_chosung IS NOT NULL
              AND (pr.name_chosung LIKE '%' || v_query_chosung || '%'
                   OR pr.brand_chosung LIKE '%' || v_query_chosung || '%'))
          OR (v_intent IS NOT NULL AND pr.category = ANY (v_intent))
        )
    )
    WHERE sl.id = v_log_id;
  END IF;
END;
$$;

-- 공개 검색 함수: 기존 실행 권한 유지(CREATE OR REPLACE는 ACL을 보존하지만 의도를 명시)
GRANT EXECUTE ON FUNCTION public.search_products(text, text, integer, integer, text, uuid) TO anon, authenticated, service_role;

-- ============================================================
-- ROLLBACK (역순 실행) — 테이블·데이터 변경이 없어 함수만 되돌리면 완전히 복구된다
-- ============================================================
-- 1) search_products를 Migration 563(supabase/migrations/20260928050000_563_search_products_is_active_filter.sql)의
--    CREATE OR REPLACE 본문으로 다시 실행한다(그 파일의 정의 = #683 직전 라이브 정의).
-- 2) DROP FUNCTION IF EXISTS public.search_category_intent(text);
-- ============================================================
