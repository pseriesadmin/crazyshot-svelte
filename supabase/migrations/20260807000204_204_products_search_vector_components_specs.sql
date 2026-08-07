-- Migration 204: search_vector 트리거에 components·specifications 필드 추가 (§H-2)
-- 목적: productSearchIndex.ts(§H-1)에 추가된 components_text/specs_text 색인 필드를
--       DB 레벨 full-text search vector에도 동일하게 반영
-- 가중치: C 등급 (migration 198과 동일 구조 — keywords/content_blocks와 동급)
-- 원칙: 기존 마이그레이션 198 직접 수정 금지 — CREATE OR REPLACE로 덮어씀
-- 참조: productSearchIndex.ts §H-1, migration 198 (트리거 원본)

-- ── 1. 트리거 함수 재정의 ────────────────────────────────────────────────────
--
-- 가중치 설계 (migration 198 기준 유지, components/specs 추가):
--   A: name            (상품명 — 가장 중요)
--   B: brand, slug, product_caption   (브랜드·슬러그·캡션)
--   C: keywords, content_blocks, components, specifications  (← 이번 추가)
--   D: category
--
-- components/specifications JSONB → "키 값" 형태 텍스트 추출:
--   {"배터리": "1개", "케이블": "1개"} → '배터리 1개 케이블 1개'
--   jsonb_each_text()으로 key + value 모두 추출

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
  END IF;
  v_components_text := COALESCE(v_components_text, '');

  -- specifications JSONB(key-value) → "키 값" 형태 텍스트 (H-2 신규)
  IF NEW.specifications IS NOT NULL AND jsonb_typeof(NEW.specifications) = 'object' THEN
    SELECT string_agg(key || ' ' || COALESCE(value, ''), ' ')
    INTO v_specs_text
    FROM jsonb_each_text(NEW.specifications);
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

-- ── 2. 트리거 재생성 (UPDATE OF 컬럼 목록 확장) ──────────────────────────────
--
-- 추가: components, specifications
-- migration 198의 트리거를 재정의

DROP TRIGGER IF EXISTS trig_products_search_vector ON products;
CREATE TRIGGER trig_products_search_vector
  BEFORE INSERT OR UPDATE OF name, brand, slug, product_caption, keywords, content_blocks, category, components, specifications
  ON products
  FOR EACH ROW EXECUTE FUNCTION products_search_vector_update();

-- ── 3. 기존 rows 백필 UPDATE ──────────────────────────────────────────────────
--
-- 트리거를 통해 모든 상품의 search_vector를 components/specifications 포함 계산식으로 재구축.
-- migration 198과 동일 패턴 (SET name = name으로 트리거 강제 발동)
UPDATE products
SET name = name
WHERE deleted_at IS NULL;

-- ── 롤백 참고 ────────────────────────────────────────────────────────────────
-- migration 198의 CREATE OR REPLACE FUNCTION + 트리거 재실행 후 백필 UPDATE로 복구.
-- ────────────────────────────────────────────────────────────────────────────
