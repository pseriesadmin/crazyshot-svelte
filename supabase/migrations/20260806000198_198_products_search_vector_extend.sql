-- Migration 198: products search_vector 확장
-- 목적: 기존 트리거 함수에 keywords(TEXT[])·product_caption·content_blocks(JSONB 텍스트)를 추가,
--       永久 미사용(항상 NULL) description 컬럼 가중치 제거
-- 영향: search_products RPC가 @@ tsvector 방식이므로 트리거 재정의 + 백필 UPDATE만으로 자동 반영
-- 주의: 기존 GIN 인덱스(idx_products_search_vector)는 컬럼 추가 없이 계산식만 변경 → 재색인 자동
-- 참조: products.md §2-10⑤ (description 永久 미사용), productSearchIndex.ts 필드 구성

-- ── 1. 트리거 함수 재정의 ────────────────────────────────────────────────────
--
-- 가중치 설계:
--   A: name            (상품명 — 가장 중요)
--   B: brand, slug, product_caption   (브랜드·슬러그·캡션)
--   C: keywords(TEXT[] → text), content_blocks 텍스트 노드
--   D: category
--   ❌ description: 제거 (products.md §2-10⑤ — 항상 NULL, 의미 없는 가중치)
--
-- content_blocks JSONB 텍스트 추출 전략 (type별):
--   text      : html 필드 → HTML 태그 제거
--   html      : content 필드 → HTML 태그 제거
--   link-entry: text 필드 → 그대로 사용
--   그 외 블록 (image, divider 등): 무시

CREATE OR REPLACE FUNCTION products_search_vector_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_keywords_text  TEXT;
  v_content_text   TEXT;
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

  NEW.search_vector :=
    setweight(to_tsvector('simple', COALESCE(NEW.name, '')),              'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.brand, '')),             'B') ||
    setweight(to_tsvector('simple', COALESCE(NEW.slug, '')),              'B') ||
    setweight(to_tsvector('simple', COALESCE(NEW.product_caption, '')),   'B') ||
    setweight(to_tsvector('simple', v_keywords_text),                     'C') ||
    setweight(to_tsvector('simple', v_content_text),                      'C') ||
    setweight(to_tsvector('simple', COALESCE(NEW.category, '')),          'D');

  RETURN NEW;
END;
$$;

-- ── 2. 트리거 재생성 (UPDATE OF 컬럼 목록 확장) ──────────────────────────────
--
-- 추가: product_caption, keywords, content_blocks
-- 제거: description (永久 미사용)

DROP TRIGGER IF EXISTS trig_products_search_vector ON products;
CREATE TRIGGER trig_products_search_vector
  BEFORE INSERT OR UPDATE OF name, brand, slug, product_caption, keywords, content_blocks, category
  ON products
  FOR EACH ROW EXECUTE FUNCTION products_search_vector_update();

-- ── 3. 기존 rows 백필 UPDATE ──────────────────────────────────────────────────
--
-- 트리거를 통해 모든 부모·자식 상품의 search_vector를 새 계산식으로 일괄 갱신.
-- 부모 상품만 실제 검색 대상(is_active·deleted_at IS NULL)이지만,
-- 트리거 함수는 INSERT/UPDATE 시 모든 행에 적용되므로 전체 UPDATE로 일괄 처리.
-- (자식 상품의 search_vector는 현재 search_products RPC에서 사용하지 않음 —
--  WHERE parent_product_id IS NULL 조건이 있어 성능 영향 없음)
UPDATE products
SET name = name  -- 동일 값 쓰기로 트리거를 발동시켜 search_vector 재계산
WHERE deleted_at IS NULL;

-- ── 롤백 참고 ────────────────────────────────────────────────────────────────
-- 이전 함수로 되돌리려면 migration 113의 트리거 함수를 재실행하고
-- UPDATE products SET name = name 로 백필 재실행할 것.
-- (GIN 인덱스는 재색인 불필요 — tsvector 값만 변경됨)
