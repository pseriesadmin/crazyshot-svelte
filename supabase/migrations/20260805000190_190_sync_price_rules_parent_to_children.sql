-- Migration 190: price_rules 부모→자식 동기화 트리거 (BND-12)
-- 부모 상품의 price_rules UPDATE 시 활성 자식(재고 단위)의 동일 duration_type price_rules에 자동 반영
-- 정책: 항상 덮어쓰기 (자식 개별 가격 커스터마이즈 미지원 — 이 트리거 활성화로 통일)
-- stage 먼저 적용 후 prod 별도 승인 진행

-- ────────────────────────────────────────────────────────────────────────────
-- 1. 트리거 함수: price_rules 행 UPDATE 후 자식들에게 전파
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_price_rules_to_children()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_parent_product_id uuid;
BEGIN
  -- 변경된 price_rule의 product_id가 부모 상품인지 확인
  SELECT parent_product_id INTO v_parent_product_id
  FROM public.products
  WHERE id = NEW.product_id AND deleted_at IS NULL;

  -- v_parent_product_id IS NOT NULL → 이 상품은 자식 → 동기화 생략 (자식→자식 무한루프 방지)
  IF v_parent_product_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 부모 상품의 price_rule이 변경됨 → 활성 자식들의 동일 duration_type 가격 동기화
  UPDATE public.price_rules pr
  SET
    price                  = NEW.price,
    deposit_amount         = NEW.deposit_amount,
    late_fee_per_hour      = NEW.late_fee_per_hour,
    damage_fee_percentage  = NEW.damage_fee_percentage,
    is_active              = NEW.is_active,
    deleted_at             = NEW.deleted_at,
    updated_at             = NOW()
  FROM public.products p
  WHERE
    pr.product_id   = p.id
    AND p.parent_product_id = NEW.product_id   -- 해당 부모의 자식만
    AND p.deleted_at IS NULL                   -- 삭제되지 않은 자식만
    AND pr.duration_type = NEW.duration_type   -- 동일 대여기간 유형
    AND pr.deleted_at IS NULL;                 -- 활성 price_rule만

  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. 트리거 등록 (price_rules UPDATE 후 실행)
-- ────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sync_price_rules_to_children ON public.price_rules;

CREATE TRIGGER trg_sync_price_rules_to_children
AFTER UPDATE ON public.price_rules
FOR EACH ROW
EXECUTE FUNCTION public.sync_price_rules_to_children();

COMMENT ON FUNCTION public.sync_price_rules_to_children() IS
  'BND-12: 부모 price_rules UPDATE 시 활성 자식 상품들의 동일 duration_type price_rules에 자동 동기화 (항상 덮어쓰기 정책)';
