-- Migration #836: 상품 카드 노출 키워드
-- 상품설명 키워드(products.keywords) 중 고객 상품 카드의 썸네일·상품명 사이에 라운드 바로 보여줄 키워드를 저장한다.
-- 값은 keywords 의 부분집합(최대 3개)이며 검증은 CMS 서버 액션에서 한다. 기존 행은 빈 배열(= 노출 없음).
-- 롤백: ALTER TABLE products DROP COLUMN IF EXISTS card_keywords;
ALTER TABLE products ADD COLUMN IF NOT EXISTS card_keywords TEXT[] NOT NULL DEFAULT '{}';
