-- Migration #389: products.option_only 컬럼 신규 추가
-- 목적: '옵션 상품 전용' 상품 — 고객 화면(카탈로그·홈·하이프팩·검색) 모든 진열 지점에서
--   숨기고, 오직 다른 부모상품의 '옵션상품'(option_links)으로 연결됐을 때만 노출되는
--   상품 유형. 부모 상품에만 의미 있는 "정책성" 컬럼(sale_only와 동일한 성격 —
--   Migration #66 product_sale_fields 참고, 동일 컨벤션으로 명명) — 자식(재고)에는
--   미적용.
--
-- CMS 옵션상품 선택 피커(ProductDetailPanel.svelte/new/+page.svelte의
-- searchOptionProducts)는 원래부터 is_active만 검사할 뿐 이 컬럼과 무관하게 전체 활성
-- 부모상품을 보여주므로, option_only=true 상품도 그대로 후보에 계속 노출된다(요구사항
-- "옵션상품 목록으로만 노출"이 별도 코드 변경 없이 이미 충족됨).

ALTER TABLE products ADD COLUMN IF NOT EXISTS option_only BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN products.option_only IS
  'true면 카탈로그·홈·하이프팩·검색 등 모든 고객용 상품 진열 화면에서 제외되고, 오직
   다른 부모상품의 옵션상품(option_links)으로 연결됐을 때만 노출된다. 부모 상품 전용
   설정(sale_only와 동일 성격) — CMS 옵션상품 선택 피커에는 영향 없음(그 피커는 이미
   is_active만 검사해 왔으므로 그대로 노출됨).';

-- ============================================================
-- ROLLBACK (역순 실행)
-- ============================================================
-- ALTER TABLE products DROP COLUMN IF EXISTS option_only;
-- ============================================================
