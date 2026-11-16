-- #830 배지 목록 다중 배지 — 한 배지목록(product_badges)에 배지타입(badge_templates)을 여러 개(개수 제한 없음) 연결
-- 적용 순서: Stage(ezyvffjvuwmtuhpxdjrw) → Production(vnbpmvxruyciuuaermyh). #828·#829 다음, 코드 배포보다 먼저 적용한다.
-- 롤백: #828·#829 의 함수 정의(cms_save_product_badge·cms_delete_badge_template·get_product_badges·get_badge_coupon_ids)를 다시 적용한 뒤
--       DROP FUNCTION public.cms_save_product_badge(uuid, text, uuid[], uuid, timestamptz, timestamptz, boolean, uuid[], text[]); ALTER TABLE public.product_badges DROP COLUMN template_ids;
--       (template_id 열은 계속 "첫 번째 배지타입"으로 유지하므로 되돌려도 기존 배지목록은 첫 배지로 그대로 동작한다.)
--
-- 규칙: template_ids 는 선택한 순서(= 고객 화면 표시 순서)를 보존하는 배열이다. template_id 는 첫 번째 값으로 항상 함께 갱신한다(호환·롤백용).
--       template_ids 가 비어 있는 옛 행·직접 입력 행은 template_id 한 개로 판정한다(COALESCE 폴백) — 기존 시험·데이터가 그대로 동작.
--       쿠폰 연결·대상·노출기간 규칙은 그대로다(쿠폰은 참조만).

ALTER TABLE public.product_badges ADD COLUMN IF NOT EXISTS template_ids uuid[] NOT NULL DEFAULT '{}';
UPDATE public.product_badges SET template_ids = ARRAY[template_id] WHERE template_ids = '{}'::uuid[];

-- ─── 1. 저장 — 배지타입 여러 개 ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.cms_save_product_badge(uuid, text, uuid, uuid, timestamptz, timestamptz, boolean, uuid[], text[]);
-- public-callable: cms_save_product_badge — CMS 직원이 세션으로 호출, 함수 안에서 매니저 이상 확인
CREATE OR REPLACE FUNCTION public.cms_save_product_badge(
  p_id           uuid,
  p_name         text,
  p_template_ids uuid[],
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
  v_tpls uuid[];
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

  -- 선택한 순서를 유지하면서 중복만 제거한다
  SELECT COALESCE(array_agg(d.x ORDER BY d.ord), ARRAY[]::uuid[]) INTO v_tpls
    FROM (
      SELECT DISTINCT ON (u.x) u.x, u.ord
        FROM unnest(COALESCE(p_template_ids, ARRAY[]::uuid[])) WITH ORDINALITY AS u(x, ord)
       WHERE u.x IS NOT NULL
       ORDER BY u.x, u.ord
    ) d;
  IF cardinality(v_tpls) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '배지 템플릿을 선택해 주세요');
  END IF;
  IF (SELECT count(*) FROM badge_templates WHERE id = ANY(v_tpls) AND deleted_at IS NULL) <> cardinality(v_tpls) THEN
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
    INSERT INTO product_badges (name, template_id, template_ids, coupon_id, valid_from, valid_until, is_active, priority)
    VALUES (
      btrim(p_name), v_tpls[1], v_tpls, p_coupon_id, p_valid_from, p_valid_until, COALESCE(p_is_active, true),
      COALESCE((SELECT max(priority) + 1 FROM product_badges WHERE deleted_at IS NULL), 0)
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE product_badges SET
      name = btrim(p_name), template_id = v_tpls[1], template_ids = v_tpls, coupon_id = p_coupon_id,
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
REVOKE ALL ON FUNCTION public.cms_save_product_badge(uuid, text, uuid[], uuid, timestamptz, timestamptz, boolean, uuid[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cms_save_product_badge(uuid, text, uuid[], uuid, timestamptz, timestamptz, boolean, uuid[], text[]) TO authenticated, service_role;

-- ─── 2. 배지타입 삭제 — 여러 개 중 하나로 쓰이는 경우도 "사용 중" ───────────────────
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

  IF EXISTS (SELECT 1 FROM product_badges WHERE deleted_at IS NULL AND (template_id = p_id OR p_id = ANY(template_ids))) THEN
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

-- ─── 3. 고객 읽기 — 배지목록 1개가 여러 배지로 펼쳐진다(선택한 순서 유지) ────────────────
-- public-callable: get_product_badges — 상품 카드·상세(비로그인 포함)가 표시용 필드만 일괄 조회
-- 반환: 상품별 노출 배지(활성·기간 내·삭제 안 됨, 우선순위 → 시작일 → 배지목록 id → 선택 순서). 개수 상한은 두지 않는다. 쿠폰·대상 목록 등 내부 필드는 내보내지 않는다.
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
    SELECT DISTINCT prod.id AS product_id, b.id AS badge_id, b.priority, b.valid_from, tp.ord, t.id AS template_id,
           t.kind, t.svg_url, t.text, t.bg_color, t.text_color
      FROM prod
      JOIN product_badge_targets g
        ON (g.target_type = 'product' AND g.product_id = prod.id)
        OR (g.target_type = 'category' AND g.category_value = prod.category::text)
      JOIN product_badges b ON b.id = g.badge_id
      CROSS JOIN LATERAL unnest(COALESCE(NULLIF(b.template_ids, '{}'::uuid[]), ARRAY[b.template_id])) WITH ORDINALITY AS tp(tid, ord)
      JOIN badge_templates t ON t.id = tp.tid
     WHERE b.is_active AND b.deleted_at IS NULL
       AND t.is_active AND t.deleted_at IS NULL
       AND (b.valid_from IS NULL OR b.valid_from <= now())
       AND (b.valid_until IS NULL OR b.valid_until >= now())
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', product_id, 'badge_id', badge_id, 'template_id', template_id, 'priority', priority,
           'kind', kind, 'svg_url', svg_url, 'text', text,
           'bg_color', bg_color, 'text_color', text_color
         ) ORDER BY product_id, priority, valid_from NULLS FIRST, badge_id, ord), '[]'::jsonb)
    FROM hits;
$$;
REVOKE ALL ON FUNCTION public.get_product_badges(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_badges(uuid[]) TO anon, authenticated, service_role;

-- ─── 4. 장바구니 표식용 — 배지타입이 하나라도 활성이면 연동 쿠폰으로 본다 ───────────────────
-- public-callable: get_badge_coupon_ids — 로그인한 고객의 장바구니가 세션으로 호출(연결 쿠폰 id 만 반환, anon 불가)
CREATE OR REPLACE FUNCTION public.get_badge_coupon_ids(p_product_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ids AS (
    SELECT DISTINCT unnest(p_product_ids[1:200]) AS id
  ),
  parents AS (
    SELECT DISTINCT COALESCE(p.parent_product_id, p.id) AS id
      FROM products p JOIN ids ON ids.id = p.id
     WHERE p.deleted_at IS NULL
  ),
  prod AS (
    SELECT pp.id, pp.category
      FROM products pp JOIN parents ON parents.id = pp.id
     WHERE pp.deleted_at IS NULL
  )
  SELECT COALESCE(jsonb_agg(DISTINCT b.coupon_id), '[]'::jsonb)
    FROM prod
    JOIN product_badge_targets g
      ON (g.target_type = 'product' AND g.product_id = prod.id)
      OR (g.target_type = 'category' AND g.category_value = prod.category::text)
    JOIN product_badges b ON b.id = g.badge_id
   WHERE b.coupon_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM user_coupons uc WHERE uc.user_id = auth.uid() AND uc.coupon_id = b.coupon_id)
     AND b.is_active AND b.deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM badge_templates t
        WHERE t.id = ANY(COALESCE(NULLIF(b.template_ids, '{}'::uuid[]), ARRAY[b.template_id]))
          AND t.is_active AND t.deleted_at IS NULL
     )
     AND (b.valid_from IS NULL OR b.valid_from <= now())
     AND (b.valid_until IS NULL OR b.valid_until >= now());
$$;
REVOKE ALL ON FUNCTION public.get_badge_coupon_ids(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_badge_coupon_ids(uuid[]) TO authenticated, service_role;
