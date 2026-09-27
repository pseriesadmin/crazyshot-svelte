-- Migration 552: products_search_vector_update — components/specifications 배열형([{key,value}]) 색인 지원
-- 배경: 사양·구성품 저장 형식을 순서 보존 배열 [{key,value}]로 변경(JSONB 객체는 키 순서 미보존).
--       #204 트리거는 jsonb_typeof='object'만 처리 → 배열형 색인 누락 방지를 위해 확장.
-- 원칙: 최신 라이브 정의(#204, 이후 재정의 없음 — grep 확인 2026-09-27) 본문에서 두 블록만 ELSIF 추가.
--       시그니처·트리거 바인딩 무변경(트리거 재생성 불필요). 기존 상품 search_vector 재계산 UPDATE 없음(다음 저장 시 갱신).
-- ⛔ 적용 순서: Stage(ezyvffjvuwmtuhpxdjrw) 검증 → Production(vnbpmvxruyciuuaermyh)
-- 롤백: migration 204의 CREATE OR REPLACE FUNCTION products_search_vector_update() 본문 재실행.

CREATE OR REPLACE FUNCTION products_search_vector_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_keywords_text     TEXT;
  v_content_text      TEXT;
  v_components_text   TEXT;
  v_specs_text        TEXT;
BEGIN
  -- keywords TEXT[] → space-joined 문자열
  v_keywords_text := COALESCE(array_to_string(NEW.keywords, ' '), '');

  -- content_blocks JSONB → 텍스트 노드만 추출
  IF NEW.content_blocks IS NOT NULL AND jsonb_typeof(NEW.content_blocks) = 'array' THEN
    SELECT string_agg(
      CASE
        WHEN elem->>'type' = 'text'
          THEN regexp_replace(COALESCE(elem->>'html', ''), '<[^>]*>', ' ', 'g')
        WHEN elem->>'type' = 'html'
          THEN regexp_replace(COALESCE(elem->>'content', ''), '<[^>]*>', ' ', 'g')
        WHEN elem->>'type' = 'link-entry'
          THEN COALESCE(elem->>'text', '')
        ELSE ''
      END,
      ' '
    )
    INTO v_content_text
    FROM jsonb_array_elements(NEW.content_blocks) AS elem
    WHERE elem->>'type' IN ('text', 'html', 'link-entry');
  END IF;
  v_content_text := COALESCE(v_content_text, '');

  -- components JSONB(key-value) → "키 값" 형태 텍스트 (H-2 신규)
  IF NEW.components IS NOT NULL AND jsonb_typeof(NEW.components) = 'object' THEN
    SELECT string_agg(key || ' ' || COALESCE(value, ''), ' ')
    INTO v_components_text
    FROM jsonb_each_text(NEW.components);
  ELSIF NEW.components IS NOT NULL AND jsonb_typeof(NEW.components) = 'array' THEN
    -- 2026-09-27(#552): 순서 보존 배열 [{key,value}]
    SELECT string_agg(COALESCE(elem->>'key', '') || ' ' || COALESCE(elem->>'value', ''), ' ')
    INTO v_components_text
    FROM jsonb_array_elements(NEW.components) AS elem
    WHERE jsonb_typeof(elem) = 'object';
  END IF;
  v_components_text := COALESCE(v_components_text, '');

  -- specifications JSONB(key-value) → "키 값" 형태 텍스트 (H-2 신규)
  IF NEW.specifications IS NOT NULL AND jsonb_typeof(NEW.specifications) = 'object' THEN
    SELECT string_agg(key || ' ' || COALESCE(value, ''), ' ')
    INTO v_specs_text
    FROM jsonb_each_text(NEW.specifications);
  ELSIF NEW.specifications IS NOT NULL AND jsonb_typeof(NEW.specifications) = 'array' THEN
    -- 2026-09-27(#552): 순서 보존 배열 [{key,value}]
    SELECT string_agg(COALESCE(elem->>'key', '') || ' ' || COALESCE(elem->>'value', ''), ' ')
    INTO v_specs_text
    FROM jsonb_array_elements(NEW.specifications) AS elem
    WHERE jsonb_typeof(elem) = 'object';
  END IF;
  v_specs_text := COALESCE(v_specs_text, '');

  NEW.search_vector :=
    setweight(to_tsvector('simple', COALESCE(NEW.name, '')),              'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.brand, '')),             'B') ||
    setweight(to_tsvector('simple', COALESCE(NEW.slug, '')),              'B') ||
    setweight(to_tsvector('simple', COALESCE(NEW.product_caption, '')),   'B') ||
    setweight(to_tsvector('simple', v_keywords_text),                     'C') ||
    setweight(to_tsvector('simple', v_content_text),                      'C') ||
    setweight(to_tsvector('simple', v_components_text),                   'C') ||  -- H-2
    setweight(to_tsvector('simple', v_specs_text),                        'C') ||  -- H-2
    setweight(to_tsvector('simple', COALESCE(NEW.category, '')),          'D');

  RETURN NEW;
END;
$$;
