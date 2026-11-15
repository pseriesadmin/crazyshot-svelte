-- #829 장바구니 '배지 연동 쿠폰' 표시용 — 카트 상품에 붙은(활성·기간 내) 배지가 연결한 쿠폰 id 목록
-- 적용 순서: Stage(ezyvffjvuwmtuhpxdjrw) → Production(vnbpmvxruyciuuaermyh). #828 다음에 적용한다.
-- 롤백: DROP FUNCTION public.get_badge_coupon_ids(uuid[]);
--
-- 쿠폰 발급·할인 계산은 건드리지 않는다 — 장바구니 쿠폰 목록에서 연동 쿠폰을 먼저·표식으로 보여 주는 용도뿐이다.
-- 입력 id 는 재고단위(자식)일 수 있어 부모로 환산해 판정한다. 호출한 사용자가 보유한 쿠폰만 돌려준다(보유 여부를 알 수 없는 쿠폰 id 는 내보내지 않음). 로그인(authenticated) 사용자만 호출 — anon 불가.
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
    JOIN badge_templates t ON t.id = b.template_id
   WHERE b.coupon_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM user_coupons uc WHERE uc.user_id = auth.uid() AND uc.coupon_id = b.coupon_id)
     AND b.is_active AND b.deleted_at IS NULL
     AND t.is_active AND t.deleted_at IS NULL
     AND (b.valid_from IS NULL OR b.valid_from <= now())
     AND (b.valid_until IS NULL OR b.valid_until >= now());
$$;
REVOKE ALL ON FUNCTION public.get_badge_coupon_ids(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_badge_coupon_ids(uuid[]) TO authenticated, service_role;
-- public-callable: get_badge_coupon_ids — 로그인한 고객의 장바구니가 세션으로 호출(연결 쿠폰 id 만 반환, anon 불가)
