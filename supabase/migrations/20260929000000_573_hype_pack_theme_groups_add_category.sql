-- Migration #573: get_hype_pack_theme_groups_with_products — 상품 카드에 category 추가
--
-- 문제: 하입팩 테마 상세(/hype-pack/theme/[id]) 카드가 /products 카드(ProductDPCard.svelte)와
-- 동일 컴포넌트를 쓰는데도 카테고리 라벨 줄이 안 보임 — 원인은 RPC가 애초에 category를
-- 반환하지 않아 category prop 자체가 전달될 수 없었기 때문(UI 결함이 아니라 데이터 누락).
--
-- 수정: jsonb_build_object에 'category', p.category 한 줄만 추가. RETURNS JSONB라 함수
-- 시그니처(파라미터·반환타입) 변경이 없으므로 DROP 없이 CREATE OR REPLACE만으로 충분.

CREATE OR REPLACE FUNCTION public.get_hype_pack_theme_groups_with_products()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',         g.id,
        'title',      g.title,
        'sub_copy',   g.sub_copy,
        'image_url',  g.image_url,
        'sort_order', g.sort_order,
        'products',   COALESCE(plist.data, '[]'::jsonb)
      )
      ORDER BY g.sort_order, g.created_at
    ),
    '[]'::jsonb
  )
  FROM public.hype_pack_theme_groups g
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',               p.id,
        'name',             p.name,
        'slug',             p.slug,
        'category',         p.category,
        'image_urls',       COALESCE(p.image_urls, '[]'::jsonb),
        'base_price_daily', COALESCE(p.base_price_daily, 0)
      )
      ORDER BY COALESCE((elem->>'order')::integer, 0)
    ) AS data
    FROM jsonb_array_elements(COALESCE(g.product_ids, '[]'::jsonb)) AS elem
    INNER JOIN public.products p ON p.id = (elem->>'id')::uuid
    WHERE p.deleted_at IS NULL
      AND p.is_active = true
      AND p.parent_product_id IS NULL
      AND p.option_only = false
  ) plist ON true
  WHERE g.is_active = true
    AND g.deleted_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_hype_pack_theme_groups_with_products() TO anon, authenticated;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration #393의 CREATE OR REPLACE 문 재실행으로 복구(category 필드 제거)
-- ============================================================
