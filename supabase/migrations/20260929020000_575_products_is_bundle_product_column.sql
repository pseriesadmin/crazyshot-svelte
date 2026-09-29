-- Migration #575: 결합상품(패키지) 분류를 등록 시점에 영구 고정하는 컬럼 신설 (Stephen 정책, 2026-09-29)
--
-- 배경: 지금까지 "이 상품이 결합상품(패키지)인가"는 product_bundle_links에 이 상품을
-- product_id로 하는 활성 행이 있는지로만 가변 판정했다(CMS 대표카드 "결합상품" 배지).
-- 이 방식은 기존 단일(단품) 상품에 나중에 결합상품을 추가하면 자동으로 "결합상품"으로
-- 전환되는 경로를 열어둔다는 문제가 있었다 — Stephen 정책 확정: 결합상품 분류는 반드시
-- "상품 등록 시점"에만 결정하고 이후에는 영구 고정한다(기존 단일상품을 사후에 결합상품으로
-- 전환하는 것 자체를 금지). ProductDetailPanel의 '결합상품' 탭도 이 컬럼이 true인 상품에만
-- 노출되도록 애플리케이션 코드가 함께 변경됨(같은 세션).
--
-- 변경:
--   1) products.is_bundle_product 컬럼 신설(boolean, NOT NULL, DEFAULT false).
--   2) 백필: 이미 product_bundle_links에 활성 행을 가진(이미 부품이 등록돼 있는) 기존
--      상품들을 자동으로 is_bundle_product = true로 분류(Stephen 확인·승인, 2026-09-29) —
--      이 상품들은 정책 적용 이후에도 계속 "결합상품" 탭이 노출·수정 가능해야 하므로
--      소급 적용한다.
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_bundle_product boolean NOT NULL DEFAULT false;

UPDATE products p
SET is_bundle_product = true
WHERE EXISTS (
  SELECT 1 FROM product_bundle_links pbl
  WHERE pbl.product_id = p.id AND pbl.deleted_at IS NULL
)
AND p.is_bundle_product = false;
