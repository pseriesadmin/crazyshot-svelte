-- Migration 500: 홈 큐레이션(추천상품·카테고리상품·취향직격 테마그룹)에 남아있던
-- "이미 삭제된 상품" 죽은 참조 1회성 청소
--
-- 배경(2026-09-15): 상품을 삭제해도 그 상품이 등록돼 있던 추천상품(product_page_md_picks)·
-- 카테고리 상품 큐레이션(home_category_products)·취향직격 테마그룹(home_theme_groups)
-- 설정에서는 그 참조가 자동으로 빠지지 않아, 홈 화면에서 해당 섹션이 고객에게 조용히
-- 비어보이는 문제가 production 실사용 중 발견됐다(get_products_by_ids/
-- get_home_theme_groups_with_products가 삭제상품을 걸러내기 때문에 화면이 깨지지는
-- 않지만, 관리자가 원인을 모른 채 방치되는 구조였음). 이번 세션에서 앞으로의 삭제 건은
-- src/routes/cms/products/+page.server.ts의 deleteProduct 액션에 자동정리 로직
-- (src/lib/server/removeProductFromHomeCuration.ts, 기존 upsert_product_page_setting/
-- cms_update_theme_group RPC 재사용)을 추가해 재발하지 않도록 별도 코드 수정을 완료했고,
-- 이 파일은 "그 코드 수정 이전에 이미 죽어있던 참조"만 1회성으로 청소한다.
--
-- 대상 조건: 각 설정이 가리키는 product id 중 products 테이블에서 deleted_at IS NOT NULL
-- 이거나 아예 존재하지 않는(고아) 것만 제거 — 살아있는 상품 참조·정상 노출 항목은
-- 절대 건드리지 않음(EXISTS 서브쿼리로 대상 없는 키/그룹은 UPDATE 자체가 스킵됨).
--
-- 적용 전 실측(2026-09-15):
--   Stage(ezyvffjvuwmtuhpxdjrw)      — home_category_products(camera) 1건
--   Production(vnbpmvxruyciuuaermyh) — product_page_md_picks 3건 + home_category_products(camera) 1건
--   home_theme_groups는 양쪽 다 죽은 참조 0건(참고용, 이 파일의 3번째 UPDATE는 향후
--   재발 방지 겸 안전망으로 포함 — 현재는 대상 없어 no-op).

CREATE TABLE IF NOT EXISTS _migration_500_backup_settings AS
SELECT key, value AS old_value, NOW() AS backed_up_at
FROM cms_settings
WHERE key IN ('product_page_md_picks', 'home_category_products');

CREATE TABLE IF NOT EXISTS _migration_500_backup_theme_groups AS
SELECT id, product_ids AS old_product_ids, NOW() AS backed_up_at
FROM home_theme_groups
WHERE deleted_at IS NULL;

-- 추천상품(MD 추천)
UPDATE cms_settings
SET value = jsonb_set(
      value,
      '{products}',
      COALESCE((
        SELECT jsonb_agg(elem)
        FROM jsonb_array_elements(COALESCE(value->'products', '[]'::jsonb)) elem
        WHERE EXISTS (
          SELECT 1 FROM products p
          WHERE p.id = (elem->>'id')::uuid AND p.deleted_at IS NULL
        )
      ), '[]'::jsonb)
    ),
    updated_at = NOW()
WHERE key = 'product_page_md_picks'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(value->'products', '[]'::jsonb)) elem
    WHERE NOT EXISTS (
      SELECT 1 FROM products p WHERE p.id = (elem->>'id')::uuid AND p.deleted_at IS NULL
    )
  );

-- 카테고리 상품 큐레이션
UPDATE cms_settings
SET value = jsonb_set(
      value,
      '{items}',
      COALESCE((
        SELECT jsonb_agg(
          jsonb_set(
            item,
            '{products}',
            COALESCE((
              SELECT jsonb_agg(elem)
              FROM jsonb_array_elements(COALESCE(item->'products', '[]'::jsonb)) elem
              WHERE EXISTS (
                SELECT 1 FROM products p
                WHERE p.id = (elem->>'id')::uuid AND p.deleted_at IS NULL
              )
            ), '[]'::jsonb)
          )
        )
        FROM jsonb_array_elements(COALESCE(value->'items', '[]'::jsonb)) item
      ), '[]'::jsonb)
    ),
    updated_at = NOW()
WHERE key = 'home_category_products'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(value->'items', '[]'::jsonb)) item,
         jsonb_array_elements(COALESCE(item->'products', '[]'::jsonb)) elem
    WHERE NOT EXISTS (
      SELECT 1 FROM products p WHERE p.id = (elem->>'id')::uuid AND p.deleted_at IS NULL
    )
  );

-- 취향직격 테마그룹 (현재 대상 0건 — 안전망 겸 포함)
UPDATE home_theme_groups g
SET product_ids = COALESCE((
      SELECT jsonb_agg(elem)
      FROM jsonb_array_elements(COALESCE(g.product_ids, '[]'::jsonb)) elem
      WHERE EXISTS (
        SELECT 1 FROM products p
        WHERE p.id = (elem->>'id')::uuid AND p.deleted_at IS NULL
      )
    ), '[]'::jsonb),
    updated_at = NOW()
WHERE g.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(g.product_ids, '[]'::jsonb)) elem
    WHERE NOT EXISTS (
      SELECT 1 FROM products p WHERE p.id = (elem->>'id')::uuid AND p.deleted_at IS NULL
    )
  );

-- ============================================================
-- ROLLBACK
-- ============================================================
-- _migration_500_backup_settings / _migration_500_backup_theme_groups 사용해 복원:
--   UPDATE cms_settings c SET value = b.old_value
--   FROM _migration_500_backup_settings b WHERE c.key = b.key;
--
--   UPDATE home_theme_groups g SET product_ids = b.old_product_ids
--   FROM _migration_500_backup_theme_groups b WHERE g.id = b.id;
-- 복원이 완전히 끝났다고 확정되면 두 백업 테이블을 DROP TABLE로 정리할 것.
-- ============================================================
