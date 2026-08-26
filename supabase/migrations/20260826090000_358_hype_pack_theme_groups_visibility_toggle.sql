-- Migration #343: hype_pack_theme_groups 그룹별 노출(is_active) 선택 기능
--
-- 변경 내용:
--   1. cms_create_hype_pack_theme_group / cms_update_hype_pack_theme_group에
--      p_is_active 파라미터 추가(기존 호출부 하위호환 — DEFAULT true)
--   2. get_hype_pack_theme_groups_admin — 관리자 전용, is_active 무관 전체 조회
--      (CMS "테마그룹 관리" 모달 전용. 공개용 get_hype_pack_theme_groups_with_products는
--      기존처럼 is_active=true 행만 반환 — 비노출 그룹의 제목·이미지·상품 정보가 anon에게
--      노출되지 않도록 그대로 유지)

-- ⚠️ 기존 5-param 오버로드를 먼저 DROP — CREATE OR REPLACE는 파라미터 개수가 다르면
-- "교체"가 아니라 새 오버로드를 추가하므로, 그대로 두면 PostgREST가 5-param/6-param
-- 오버로드를 구분 못해 PGRST203(모호성) 에러가 발생한다(products.md §2-3와 동일 클래스 버그).
DROP FUNCTION IF EXISTS public.cms_create_hype_pack_theme_group(text, text, text, jsonb, integer);
DROP FUNCTION IF EXISTS public.cms_update_hype_pack_theme_group(uuid, text, text, text, jsonb, integer);

-- ─── 1. cms_create_hype_pack_theme_group — p_is_active 추가 ───────────────────
CREATE OR REPLACE FUNCTION public.cms_create_hype_pack_theme_group(
  p_title       TEXT,
  p_sub_copy    TEXT    DEFAULT NULL,
  p_image_url   TEXT    DEFAULT '',
  p_product_ids JSONB   DEFAULT '[]'::jsonb,
  p_sort_order  INTEGER DEFAULT 0,
  p_is_active   BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count  INTEGER;
  v_new_id UUID;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.hype_pack_theme_groups
   WHERE deleted_at IS NULL;

  IF v_count >= 10 THEN
    RAISE EXCEPTION 'MAX_10_GROUPS';
  END IF;

  IF jsonb_array_length(COALESCE(p_product_ids, '[]'::jsonb)) > 10 THEN
    RAISE EXCEPTION 'MAX_10_PRODUCTS_PER_GROUP';
  END IF;

  INSERT INTO public.hype_pack_theme_groups (title, sub_copy, image_url, product_ids, sort_order, is_active)
  VALUES (p_title, p_sub_copy, COALESCE(p_image_url, ''), COALESCE(p_product_ids, '[]'::jsonb), p_sort_order, COALESCE(p_is_active, true))
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('ok', true, 'id', v_new_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cms_create_hype_pack_theme_group(TEXT, TEXT, TEXT, JSONB, INTEGER, BOOLEAN) TO authenticated;

-- ─── 2. cms_update_hype_pack_theme_group — p_is_active 추가 ───────────────────
CREATE OR REPLACE FUNCTION public.cms_update_hype_pack_theme_group(
  p_id          UUID,
  p_title       TEXT,
  p_sub_copy    TEXT    DEFAULT NULL,
  p_image_url   TEXT    DEFAULT '',
  p_product_ids JSONB   DEFAULT '[]'::jsonb,
  p_sort_order  INTEGER DEFAULT 0,
  p_is_active   BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  IF jsonb_array_length(COALESCE(p_product_ids, '[]'::jsonb)) > 10 THEN
    RAISE EXCEPTION 'MAX_10_PRODUCTS_PER_GROUP';
  END IF;

  UPDATE public.hype_pack_theme_groups
     SET title       = p_title,
         sub_copy    = p_sub_copy,
         image_url   = COALESCE(p_image_url, ''),
         product_ids = COALESCE(p_product_ids, '[]'::jsonb),
         sort_order  = p_sort_order,
         is_active   = COALESCE(p_is_active, true)
   WHERE id = p_id
     AND deleted_at IS NULL;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cms_update_hype_pack_theme_group(UUID, TEXT, TEXT, TEXT, JSONB, INTEGER, BOOLEAN) TO authenticated;

-- ─── 3. get_hype_pack_theme_groups_admin — 관리자 전용(비노출 그룹 포함) ──────
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
    ) plist ON true
    WHERE g.deleted_at IS NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_hype_pack_theme_groups_admin() TO authenticated;
