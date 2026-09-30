-- Migration #602: 기존 추천패키지(category='hypepack') 부모 상품 전체를 결합상품(is_bundle_product)으로 분류 (Stephen 지시, 2026-09-30)
--
-- 배경: #575 백필은 "이미 결합 링크가 있는 상품"만 is_bundle_product=true로 분류했다. 링크가 아직 없는
-- 기존 추천패키지는 플래그가 false로 남아 결합상품 탭이 열리지 않아 구성 자체가 불가능했다.
-- Stephen 지시: 추천패키지(code_mapping_groups.default_category='hypepack') 코드품번 상품 전체를 결합상품으로 분류.
--
-- 범위: 부모 상품(parent_product_id IS NULL)·미삭제·category='hypepack'·아직 false인 행만. 링크는 만들지 않는다
-- (플래그만 변경 — 재고·요금·예약에 영향 없음). 자식(재고) 상품은 플래그 개념이 없어 제외.
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) → crazyshot(vnbpmvxruyciuuaermyh)
-- ROLLBACK: 적용 전 대상 id 목록을 별도 기록해 두었다가 해당 id만 is_bundle_product=false로 되돌림
--           (단, 링크가 있는 상품은 되돌리지 말 것).

UPDATE products
SET is_bundle_product = true
WHERE parent_product_id IS NULL
  AND deleted_at IS NULL
  AND category = 'hypepack'
  AND is_bundle_product = false;
