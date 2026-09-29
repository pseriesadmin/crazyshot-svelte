-- Migration #574: 하입팩 테마그룹당 상품 개수 제한(10개) 폐지
--
-- 대상: cms_create_hype_pack_theme_group / cms_update_hype_pack_theme_group
-- (Migration #358이 현재 유효한 정의 — MAX_10_PRODUCTS_PER_GROUP 체크만 제거, 그 외 로직
--  전부 동일. 그룹 자체 개수 제한(MAX_10_GROUPS)은 이번 변경 대상 아님, 그대로 유지)
-- 파라미터·반환타입 무변경이라 DROP 불필요, CREATE OR REPLACE만으로 충분.

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

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration #358의 두 CREATE OR REPLACE 문 재실행으로 복구(10개 제한 재적용)
-- ============================================================
