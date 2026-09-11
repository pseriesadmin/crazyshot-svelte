-- Migration 491: 자동생성 "기본 재고" 자식의 image_urls 백필 — temp 경로 → 부모 현재 경로
--
-- 배경(2026-09-11): products/new/+page.server.ts의 실행 순서 버그(BND-11 이미지 이관
-- 블록이 auto_create_inventory_for_product보다 나중에 실행되던 문제 — 같은 세션에서
-- 코드는 이미 순서를 바꿔 수정 완료)로 인해, 이미지가 있는 신규 상품을 등록할 때
-- §2-3에 따라 자동 생성되는 "기본 재고" 자식 1개가 부모의 임시 업로드 경로
-- (product-images/temp/{uuid}/...)를 자기 자신의 image_urls에 영구히 물고 있는 상태로
-- 남아 있었다. get_rental_list RPC는 예약의 product_id(=이 자식)를 기준으로 이미지를
-- 조회하므로(p.image_urls ->> 0), 이 자식이 배정된 예약은 CMS 화면(RentalDetailPanel 등)
-- 에서 이미지가 깨져 보였다. 코드 수정은 이번 발견 시점 이후 신규 등록분에만 적용되므로,
-- 이미 발생한 기존 데이터는 이 마이그레이션으로 1회성 백필한다.
--
-- 사전 확인(2026-09-11, Production 실측): 영향받은 자식 42건 전부 부모 자신은
-- image_urls에 temp 경로가 전혀 없는 정상 상태임을 확인 — 부모가 오염된 케이스는 0건이라
-- 전부 안전하게 부모의 현재 image_urls로 덮어써도 된다(products.md §9 Q4 — 이미지는
-- 항상 부모 기준으로 관리되는 설계와도 일치).
--
-- 대상 조건(둘 다 만족하는 행만, 그 외 자식은 전혀 건드리지 않음):
--   ① parent_product_id IS NOT NULL (자식) + deleted_at IS NULL
--   ② image_urls 배열 안에 '/product-images/temp/'를 포함하는 문자열이 하나라도 존재
--
-- ⛔ 2026-09-11 sp3-qa-agent 검수 후 정정: 아래 백업 테이블 생성문은 Production 실제
-- 적용 시 UPDATE보다 먼저 진짜로 실행된 문장이다(주석 처리된 "권장 사항"이 아님) —
-- 최초 커밋 시 이 파일에는 실행문이 빠지고 ROLLBACK 섹션에 주석으로만 남아 있어 파일
-- 내용과 실제 실행 내용이 어긋나 있었다. Production `_migration_491_backup` 테이블에
-- 42행이 실제로 존재함을 재조회로 재확인(backed_up_at 2026-09-11 09:40:17 UTC) 후,
-- 이 파일을 실제 실행 내용과 일치하도록 정정한다.

CREATE TABLE IF NOT EXISTS _migration_491_backup AS
SELECT id, image_urls AS old_image_urls, NOW() AS backed_up_at
FROM products
WHERE parent_product_id IS NOT NULL AND deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(image_urls) u
              WHERE u LIKE '%/product-images/temp/%');

UPDATE products AS child
SET image_urls = parent.image_urls,
    updated_at = NOW()
FROM products AS parent
WHERE child.parent_product_id = parent.id
  AND child.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(child.image_urls) u
    WHERE u LIKE '%/product-images/temp/%'
  );

-- ============================================================
-- ROLLBACK
-- ============================================================
-- _migration_491_backup(위에서 생성, Production에 42행 실재 확인됨)을 사용해 복원:
--   UPDATE products p
--   SET image_urls = b.old_image_urls
--   FROM _migration_491_backup b
--   WHERE p.id = b.id;
-- 복원이 완전히 끝났다고 확정되면 DROP TABLE _migration_491_backup;으로 정리할 것.
-- ============================================================
