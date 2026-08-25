-- Migration #342: hype_pack_theme_groups 테이블 + CMS 관리 RPC 4종
-- home_theme_groups(Migration #322)와 완전히 독립된 하이프팩 전용 테이블/RPC 세트.
-- 홈 화면 기능에는 영향 없음(테이블·RPC 이름 전부 hype_pack_ 접두사로 분리).
--
-- 변경 내용:
--   1. hype_pack_theme_groups 테이블 신설 (RLS 포함)
--   2. updated_at 자동갱신 트리거
--   3. cms_create_hype_pack_theme_group  — 그룹 생성 (MAX 10, 상품 MAX 10)
--   4. cms_update_hype_pack_theme_group  — 그룹 수정
--   5. cms_delete_hype_pack_theme_group  — 소프트 삭제
--   6. get_hype_pack_theme_groups_with_products — LATERAL JOIN, anon/authenticated 읽기

-- ─── 1. 테이블 ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hype_pack_theme_groups (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL,
  sub_copy    TEXT,
  image_url   TEXT        NOT NULL DEFAULT '',
  product_ids JSONB       NOT NULL DEFAULT '[]'::jsonb,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 2. updated_at 트리거 ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_hype_pack_theme_groups_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hype_pack_theme_groups_updated_at ON public.hype_pack_theme_groups;
CREATE TRIGGER hype_pack_theme_groups_updated_at
  BEFORE UPDATE ON public.hype_pack_theme_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_hype_pack_theme_groups_updated_at();

-- ─── 3. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.hype_pack_theme_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hype_pack_theme_groups_admin_all ON public.hype_pack_theme_groups;
CREATE POLICY hype_pack_theme_groups_admin_all ON public.hype_pack_theme_groups
  FOR ALL
  USING (public.is_cms_user())
  WITH CHECK (public.is_cms_user());

DROP POLICY IF EXISTS hype_pack_theme_groups_public_select ON public.hype_pack_theme_groups;
CREATE POLICY hype_pack_theme_groups_public_select ON public.hype_pack_theme_groups
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true AND deleted_at IS NULL);

-- ─── 4. cms_create_hype_pack_theme_group ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_create_hype_pack_theme_group(
  p_title       TEXT,
  p_sub_copy    TEXT    DEFAULT NULL,
  p_image_url   TEXT    DEFAULT '',
  p_product_ids JSONB   DEFAULT '[]'::jsonb,
  p_sort_order  INTEGER DEFAULT 0
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

  INSERT INTO public.hype_pack_theme_groups (title, sub_copy, image_url, product_ids, sort_order)
  VALUES (p_title, p_sub_copy, COALESCE(p_image_url, ''), COALESCE(p_product_ids, '[]'::jsonb), p_sort_order)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('ok', true, 'id', v_new_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cms_create_hype_pack_theme_group(TEXT, TEXT, TEXT, JSONB, INTEGER) TO authenticated;

-- ─── 5. cms_update_hype_pack_theme_group ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_update_hype_pack_theme_group(
  p_id          UUID,
  p_title       TEXT,
  p_sub_copy    TEXT    DEFAULT NULL,
  p_image_url   TEXT    DEFAULT '',
  p_product_ids JSONB   DEFAULT '[]'::jsonb,
  p_sort_order  INTEGER DEFAULT 0
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
         sort_order  = p_sort_order
   WHERE id = p_id
     AND deleted_at IS NULL;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cms_update_hype_pack_theme_group(UUID, TEXT, TEXT, TEXT, JSONB, INTEGER) TO authenticated;

-- ─── 6. cms_delete_hype_pack_theme_group ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_delete_hype_pack_theme_group(p_id UUID)
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
     SET deleted_at = now()
   WHERE id = p_id
     AND deleted_at IS NULL;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cms_delete_hype_pack_theme_group(UUID) TO authenticated;

-- ─── 7. get_hype_pack_theme_groups_with_products ──────────────────────────────
-- SECURITY DEFINER: is_cms_user() 없이도 is_active + deleted_at IS NULL 필터로
-- 공개용 데이터를 RLS 우회하여 LATERAL JOIN 안전하게 수행
-- STABLE: 캐시 가능 (같은 트랜잭션 내 같은 결과 보장)
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
  ) plist ON true
  WHERE g.is_active = true
    AND g.deleted_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_hype_pack_theme_groups_with_products() TO anon, authenticated;
