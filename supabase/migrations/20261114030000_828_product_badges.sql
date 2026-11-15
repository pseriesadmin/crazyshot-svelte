-- #828 상품 배지 — 템플릿(이미지 SVG / 텍스트바) · 배지 규칙(쿠폰 연결 · 기간 · 우선순위) · 대상(상품/카테고리)
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). 코드보다 먼저 적용한다.
-- 롤백(#829 먼저, 그다음 이 파일. ⚠ 배지 템플릿·노출 데이터가 모두 삭제된다. badge-icons 버킷에 파일이 남아 있으면 버킷 삭제가 실패하므로 파일을 먼저 지운다):
--   DROP FUNCTION get_product_badges / cms_reorder_product_badges / cms_delete_product_badge / cms_toggle_product_badge /
--   cms_save_product_badge / cms_reorder_badge_templates / cms_delete_badge_template / cms_save_badge_template; DROP TABLE product_badge_targets, product_badges, badge_templates;
--   DELETE FROM storage.buckets WHERE id='badge-icons' (빈 버킷일 때).
--
-- 규칙: 쿠폰은 참조(coupon_id)만 한다 — 쿠폰 발급·할인 로직은 건드리지 않는다.
--       직접 DML 금지(H-01) → CMS 쓰기는 아래 cms_* 함수만. 직원·매니저 이상 확인은 함수 안에서 한다.
--       표 3개는 서버 전용(RLS 켬·정책 0건·service_role 권한만). 고객 읽기는 get_product_badges 1개(표시용 필드만).

-- ─── 1. 이미지(SVG) 전용 공개 버킷 ───────────────────────────────────────────
-- 올리기는 서버(/api/cms/badges/icon — 정화 후 서비스 롤)로만, 읽기는 공개 주소(<img>)로만.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('badge-icons', 'badge-icons', true, 204800, ARRAY['image/svg+xml'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── 2. 표 ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.badge_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('image', 'textbar')),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  svg_url     text,
  text        text CHECK (text IS NULL OR char_length(text) BETWEEN 1 AND 8),
  bg_color    text CHECK (bg_color IS NULL OR bg_color ~ '^#[0-9A-Fa-f]{6}$'),
  text_color  text NOT NULL DEFAULT '#FFFFFF' CHECK (text_color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT badge_templates_kind_fields CHECK (
    (kind = 'image' AND svg_url IS NOT NULL) OR
    (kind = 'textbar' AND text IS NOT NULL AND bg_color IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.product_badges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  template_id  uuid NOT NULL REFERENCES public.badge_templates(id) ON DELETE RESTRICT,
  coupon_id    uuid REFERENCES public.coupons(id) ON DELETE SET NULL,
  priority     integer NOT NULL DEFAULT 0,
  valid_from   timestamptz,
  valid_until  timestamptz,
  is_active    boolean NOT NULL DEFAULT true,
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_badges_period CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from)
);

CREATE TABLE IF NOT EXISTS public.product_badge_targets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_id        uuid NOT NULL REFERENCES public.product_badges(id) ON DELETE CASCADE,
  target_type     text NOT NULL CHECK (target_type IN ('product', 'category')),
  product_id      uuid REFERENCES public.products(id) ON DELETE CASCADE,
  category_value  text,
  CONSTRAINT product_badge_targets_shape CHECK (
    (target_type = 'product' AND product_id IS NOT NULL AND category_value IS NULL) OR
    (target_type = 'category' AND category_value IS NOT NULL AND product_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS product_badge_targets_uq_product
  ON public.product_badge_targets (badge_id, product_id) WHERE target_type = 'product';
CREATE UNIQUE INDEX IF NOT EXISTS product_badge_targets_uq_category
  ON public.product_badge_targets (badge_id, category_value) WHERE target_type = 'category';
CREATE INDEX IF NOT EXISTS product_badge_targets_product_idx ON public.product_badge_targets (product_id);
CREATE INDEX IF NOT EXISTS product_badge_targets_category_idx ON public.product_badge_targets (category_value);
CREATE INDEX IF NOT EXISTS product_badges_template_idx ON public.product_badges (template_id);

ALTER TABLE public.badge_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_badge_targets ENABLE ROW LEVEL SECURITY;

-- Supabase 기본 권한이 anon·authenticated 에 남을 수 있어 명시적으로 회수(서버 전용 표 — 읽기·쓰기는 함수와 서버 경로만)
REVOKE ALL ON public.badge_templates, public.product_badges, public.product_badge_targets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.badge_templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_badges TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_badge_targets TO service_role;

-- ─── 3. CMS 쓰기 함수 ───────────────────────────────────────────────────────
-- 공통 확인: CMS 직원 + manager 이상(partner 불가)

-- public-callable: cms_save_badge_template — CMS 직원이 세션으로 호출, 함수 안에서 매니저 이상 확인
CREATE OR REPLACE FUNCTION public.cms_save_badge_template(
  p_id         uuid,
  p_kind       text,
  p_name       text,
  p_svg_url    text,
  p_text       text,
  p_bg_color   text,
  p_text_color text DEFAULT '#FFFFFF',
  p_is_active  boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_cms_user() OR NOT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND cms_role IN ('manager', 'superadmin')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCESS_DENIED');
  END IF;

  IF p_kind NOT IN ('image', 'textbar') THEN
    RETURN jsonb_build_object('ok', false, 'error', '배지 형태가 올바르지 않아요');
  END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 40 THEN
    RETURN jsonb_build_object('ok', false, 'error', '이름은 1~40자로 입력해 주세요');
  END IF;
  IF p_kind = 'image' AND (p_svg_url IS NULL OR btrim(p_svg_url) = '') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SVG 이미지를 가져와 주세요');
  END IF;
  -- 배지 전용 버킷에 업로드 API 가 저장한 파일 주소만 허용(외부 주소 삽입 차단 — TS isBadgeSvgUrl 과 같은 규칙)
  IF p_kind = 'image' AND btrim(p_svg_url) !~ '^https://(ezyvffjvuwmtuhpxdjrw|vnbpmvxruyciuuaermyh)\.supabase\.co/storage/v1/object/public/badge-icons/badges/[0-9a-f-]{36}\.svg$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SVG 이미지는 가져오기로만 등록할 수 있어요');
  END IF;
  IF p_kind = 'textbar' THEN
    IF p_text IS NULL OR char_length(btrim(p_text)) NOT BETWEEN 1 AND 8 THEN
      RETURN jsonb_build_object('ok', false, 'error', '문구는 1~8자로 입력해 주세요');
    END IF;
    IF p_bg_color IS NULL OR p_bg_color !~ '^#[0-9A-Fa-f]{6}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', '바 색상은 #RRGGBB 형식이어야 해요');
    END IF;
  END IF;
  IF p_text_color IS NULL OR p_text_color !~ '^#[0-9A-Fa-f]{6}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', '글자 색상은 #RRGGBB 형식이어야 해요');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO badge_templates (kind, name, svg_url, text, bg_color, text_color, is_active, sort_order)
    VALUES (
      p_kind, btrim(p_name),
      CASE WHEN p_kind = 'image' THEN btrim(p_svg_url) END,
      CASE WHEN p_kind = 'textbar' THEN btrim(p_text) END,
      CASE WHEN p_kind = 'textbar' THEN p_bg_color END,
      p_text_color, COALESCE(p_is_active, true),
      COALESCE((SELECT max(sort_order) + 1 FROM badge_templates WHERE deleted_at IS NULL), 0)
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE badge_templates SET
      kind = p_kind,
      name = btrim(p_name),
      svg_url = CASE WHEN p_kind = 'image' THEN btrim(p_svg_url) END,
      text = CASE WHEN p_kind = 'textbar' THEN btrim(p_text) END,
      bg_color = CASE WHEN p_kind = 'textbar' THEN p_bg_color END,
      text_color = p_text_color,
      is_active = COALESCE(p_is_active, true),
      updated_at = now()
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'TEMPLATE_NOT_FOUND');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.cms_save_badge_template(uuid, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cms_save_badge_template(uuid, text, text, text, text, text, text, boolean) TO authenticated, service_role;

-- public-callable: cms_delete_badge_template — CMS 직원이 세션으로 호출, 함수 안에서 매니저 이상 확인
CREATE OR REPLACE FUNCTION public.cms_delete_badge_template(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() OR NOT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND cms_role IN ('manager', 'superadmin')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCESS_DENIED');
  END IF;

  IF EXISTS (SELECT 1 FROM product_badges WHERE template_id = p_id AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TEMPLATE_IN_USE');
  END IF;

  UPDATE badge_templates SET deleted_at = now(), is_active = false, updated_at = now()
   WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TEMPLATE_NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.cms_delete_badge_template(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cms_delete_badge_template(uuid) TO authenticated, service_role;

-- public-callable: cms_save_product_badge — CMS 직원이 세션으로 호출, 함수 안에서 매니저 이상 확인
CREATE OR REPLACE FUNCTION public.cms_save_product_badge(
  p_id           uuid,
  p_name         text,
  p_template_id  uuid,
  p_coupon_id    uuid,
  p_valid_from   timestamptz,
  p_valid_until  timestamptz,
  p_is_active    boolean,
  p_product_ids  uuid[],
  p_categories   text[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_products uuid[] := array_remove(COALESCE(p_product_ids, ARRAY[]::uuid[]), NULL);
  v_cats text[] := COALESCE(p_categories, ARRAY[]::text[]);
BEGIN
  IF NOT public.is_cms_user() OR NOT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND cms_role IN ('manager', 'superadmin')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCESS_DENIED');
  END IF;

  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 40 THEN
    RETURN jsonb_build_object('ok', false, 'error', '명칭은 1~40자로 입력해 주세요');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM badge_templates WHERE id = p_template_id AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', '배지 템플릿을 선택해 주세요');
  END IF;
  IF p_coupon_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM coupons WHERE id = p_coupon_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', '쿠폰을 찾을 수 없어요');
  END IF;
  IF cardinality(v_products) + cardinality(v_cats) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '상품 또는 카테고리를 1개 이상 선택해 주세요');
  END IF;
  IF cardinality(v_products) > 500 OR cardinality(v_cats) > 50 THEN
    RETURN jsonb_build_object('ok', false, 'error', '대상이 너무 많아요');
  END IF;
  IF p_valid_from IS NOT NULL AND p_valid_until IS NOT NULL AND p_valid_until < p_valid_from THEN
    RETURN jsonb_build_object('ok', false, 'error', '종료일이 시작일보다 빠를 수 없어요');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO product_badges (name, template_id, coupon_id, valid_from, valid_until, is_active, priority)
    VALUES (
      btrim(p_name), p_template_id, p_coupon_id, p_valid_from, p_valid_until, COALESCE(p_is_active, true),
      COALESCE((SELECT max(priority) + 1 FROM product_badges WHERE deleted_at IS NULL), 0)
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE product_badges SET
      name = btrim(p_name), template_id = p_template_id, coupon_id = p_coupon_id,
      valid_from = p_valid_from, valid_until = p_valid_until,
      is_active = COALESCE(p_is_active, true), updated_at = now()
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'BADGE_NOT_FOUND');
    END IF;
    DELETE FROM product_badge_targets WHERE badge_id = v_id;
  END IF;

  INSERT INTO product_badge_targets (badge_id, target_type, product_id)
  SELECT v_id, 'product', pid FROM (SELECT DISTINCT unnest(v_products) AS pid) s;
  INSERT INTO product_badge_targets (badge_id, target_type, category_value)
  SELECT v_id, 'category', c FROM (SELECT DISTINCT btrim(unnest(v_cats)) AS c) s WHERE c <> '';

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', '처리에 실패했어요');
END;
$$;
REVOKE ALL ON FUNCTION public.cms_save_product_badge(uuid, text, uuid, uuid, timestamptz, timestamptz, boolean, uuid[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cms_save_product_badge(uuid, text, uuid, uuid, timestamptz, timestamptz, boolean, uuid[], text[]) TO authenticated, service_role;

-- public-callable: cms_toggle_product_badge — CMS 직원이 세션으로 호출, 함수 안에서 매니저 이상 확인
CREATE OR REPLACE FUNCTION public.cms_toggle_product_badge(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() OR NOT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND cms_role IN ('manager', 'superadmin')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCESS_DENIED');
  END IF;
  UPDATE product_badges SET is_active = NOT is_active, updated_at = now()
   WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BADGE_NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.cms_toggle_product_badge(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cms_toggle_product_badge(uuid) TO authenticated, service_role;

-- public-callable: cms_delete_product_badge — CMS 직원이 세션으로 호출, 함수 안에서 매니저 이상 확인
CREATE OR REPLACE FUNCTION public.cms_delete_product_badge(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() OR NOT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND cms_role IN ('manager', 'superadmin')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCESS_DENIED');
  END IF;
  UPDATE product_badges SET deleted_at = now(), is_active = false, updated_at = now()
   WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BADGE_NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.cms_delete_product_badge(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cms_delete_product_badge(uuid) TO authenticated, service_role;

-- public-callable: cms_reorder_product_badges — CMS 직원이 세션으로 호출, 함수 안에서 매니저 이상 확인
CREATE OR REPLACE FUNCTION public.cms_reorder_product_badges(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() OR NOT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND cms_role IN ('manager', 'superadmin')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCESS_DENIED');
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_IDS');
  END IF;
  UPDATE product_badges b SET priority = o.ord - 1, updated_at = now()
    FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)
   WHERE b.id = o.id AND b.deleted_at IS NULL;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.cms_reorder_product_badges(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cms_reorder_product_badges(uuid[]) TO authenticated, service_role;

-- public-callable: cms_reorder_badge_templates — '배지 설정' 목록 순서(sort_order). 함수 안에서 매니저 이상 확인
CREATE OR REPLACE FUNCTION public.cms_reorder_badge_templates(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() OR NOT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND cms_role IN ('manager', 'superadmin')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCESS_DENIED');
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_IDS');
  END IF;
  UPDATE badge_templates t SET sort_order = o.ord - 1, updated_at = now()
    FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)
   WHERE t.id = o.id AND t.deleted_at IS NULL;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.cms_reorder_badge_templates(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cms_reorder_badge_templates(uuid[]) TO authenticated, service_role;

-- ─── 4. 고객 읽기 함수 ──────────────────────────────────────────────────────
-- public-callable: get_product_badges — 상품 카드·상세(비로그인 포함)가 표시용 필드만 일괄 조회
-- 반환: 상품별 노출 배지(활성·기간 내·삭제 안 됨, 우선순위 → 시작일 → id 순). 쿠폰·대상 목록 등 내부 필드는 내보내지 않는다.
-- 판정 규칙은 TS(src/lib/utils/resolveBadges.ts)와 같다 — 함께 바꾼다.
CREATE OR REPLACE FUNCTION public.get_product_badges(p_product_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ids AS (
    SELECT DISTINCT unnest(p_product_ids[1:200]) AS id
  ),
  prod AS (
    SELECT p.id, p.category
      FROM products p JOIN ids ON ids.id = p.id
     WHERE p.deleted_at IS NULL AND p.is_active AND p.parent_product_id IS NULL
  ),
  hits AS (
    SELECT DISTINCT prod.id AS product_id, b.id AS badge_id, b.priority, b.valid_from,
           t.kind, t.svg_url, t.text, t.bg_color, t.text_color
      FROM prod
      JOIN product_badge_targets g
        ON (g.target_type = 'product' AND g.product_id = prod.id)
        OR (g.target_type = 'category' AND g.category_value = prod.category::text)
      JOIN product_badges b ON b.id = g.badge_id
      JOIN badge_templates t ON t.id = b.template_id
     WHERE b.is_active AND b.deleted_at IS NULL
       AND t.is_active AND t.deleted_at IS NULL
       AND (b.valid_from IS NULL OR b.valid_from <= now())
       AND (b.valid_until IS NULL OR b.valid_until >= now())
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', product_id, 'badge_id', badge_id, 'priority', priority,
           'kind', kind, 'svg_url', svg_url, 'text', text,
           'bg_color', bg_color, 'text_color', text_color
         ) ORDER BY product_id, priority, valid_from NULLS FIRST, badge_id), '[]'::jsonb)
    FROM hits;
$$;
REVOKE ALL ON FUNCTION public.get_product_badges(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_badges(uuid[]) TO anon, authenticated, service_role;
