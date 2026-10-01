-- Migration 615 — 쿠폰 "적용 대상"(대여상품 / 판매상품) 설정 (2026-10-01, Stephen 확정)
--
-- 정책:
--   · 쿠폰마다 적용 대상을 대여상품·판매상품 중 하나 또는 둘 다 선택한다. 기본값은 둘 다(true/true) —
--     기존 모든 쿠폰은 지금과 동작이 같다(하위호환).
--   · 둘 다 끄는 것은 불가(DB CHECK 제약 + 설정 RPC 이중 방어).
--   · 이번 범위는 CMS 설정 저장까지다. 장바구니·결제 서버의 적용 차단(할인 대상 금액 분리 등)은
--     사용자 개발 세션에서 별도로 연동한다 — 이 마이그레이션은 쿠폰 사용 판정 함수를 건드리지 않는다.
--
-- 구조: allow_coupon_stacking(Migration 605)과 같은 패턴 — cms_create_coupon/cms_update_coupon의 긴 시그니처에
--       파라미터를 추가하면 오버로드가 생기므로, CMS가 쿠폰 생성·수정 후 호출하는 전용 설정 RPC로 분리한다.

-- ── 1) 컬럼 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS applies_to_rental BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS applies_to_sale   BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.coupons.applies_to_rental IS '쿠폰 적용 대상 — 대여상품에 사용 가능. applies_to_sale과 최소 하나는 true.';
COMMENT ON COLUMN public.coupons.applies_to_sale   IS '쿠폰 적용 대상 — 판매상품(sale_only)에 사용 가능. applies_to_rental과 최소 하나는 true.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coupons_applies_to_check' AND conrelid = 'public.coupons'::regclass) THEN
    ALTER TABLE public.coupons
      ADD CONSTRAINT coupons_applies_to_check CHECK (applies_to_rental OR applies_to_sale);
  END IF;
END $$;

-- ── 2) CMS 설정 RPC ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_set_coupon_applies_to(
  p_id     UUID,
  p_rental BOOLEAN,
  p_sale   BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  IF NOT (COALESCE(p_rental, false) OR COALESCE(p_sale, false)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'APPLIES_TO_REQUIRED');
  END IF;

  UPDATE coupons
  SET applies_to_rental = COALESCE(p_rental, false),
      applies_to_sale   = COALESCE(p_sale, false),
      updated_at = now()
  WHERE id = p_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.cms_set_coupon_applies_to(UUID, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cms_set_coupon_applies_to(UUID, BOOLEAN, BOOLEAN) TO authenticated, service_role;

-- ROLLBACK(참고용): DROP FUNCTION public.cms_set_coupon_applies_to(UUID, BOOLEAN, BOOLEAN);
--   ALTER TABLE public.coupons DROP CONSTRAINT coupons_applies_to_check, DROP COLUMN applies_to_rental, DROP COLUMN applies_to_sale;
