-- Migration #393: 하이프팩 테마그룹 RPC 2종 — option_only=true 상품 제외
-- 대상: get_hype_pack_theme_groups_with_products(고객용) /
--   get_hype_pack_theme_groups_admin(관리자 편집용) — Migration #392(홈 테마그룹)와 동일 패턴

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

CREATE OR REPLACE FUNCTION public.get_hype_pack_theme_groups_admin()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  RETURN (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id',         g.id,
          'title',      g.title,
          'sub_copy',   g.sub_copy,
          'image_url',  g.image_url,
          'sort_order', g.sort_order,
          'is_active',  g.is_active,
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
    WHERE g.deleted_at IS NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_hype_pack_theme_groups_admin() TO authenticated;

-- ============================================================
-- ROLLBACK (역순 실행)
-- ============================================================
-- Migration #358(admin)·#342(with_products)의 CREATE 문 재실행으로 복구
-- ============================================================
