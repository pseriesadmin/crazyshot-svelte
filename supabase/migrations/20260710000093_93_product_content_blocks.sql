-- 93: products 테이블에 content_blocks(JSONB) + keywords(TEXT[]) 컬럼 추가
-- content_blocks: 블록 기반 상품 설명 (CmsContentEditor 출력 JSON)
-- keywords: AI 검색 노출용 태그 배열

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS content_blocks JSONB    DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS keywords       TEXT[]   DEFAULT '{}';

COMMENT ON COLUMN products.content_blocks IS '블록 기반 상품 설명 (ContentBlock[] JSON — CmsContentEditor)';
COMMENT ON COLUMN products.keywords       IS 'AI 검색 노출 키워드 태그 배열 (최대 10개)';
