-- Migration 192: price_rules 부모→자식 동기화 트리거 — INSERT 케이스 대응 (CRIT-PRICESYNC-1)
--
-- 문제: Migration 190(BND-12)의 sync_price_rules_to_children()는 자식 price_rules 행을 UPDATE만 함.
--       부모가 특정 duration_type 가격을 처음 INSERT할 때, 자식에 해당 행이 없어 UPDATE 대상 0건 →
--       자식에 가격 동기화 안 됨.
--
-- 해결: UPDATE 대신 INSERT ON CONFLICT DO UPDATE (UPSERT) 방식으로 재작성.
--       - 자식에 active 행 있으면 → DO UPDATE (기존 동작 유지)
--       - 자식에 active 행 없으면 → INSERT (신규 동기화 대상 자식에도 가격 생성)
--       트리거를 AFTER INSERT OR UPDATE로 확장 → 부모 첫 등록 시에도 자식 동기화.
--
-- ON CONFLICT 대상: price_rules_active_unique 인덱스 (product_id, duration_type WHERE deleted_at IS NULL)
-- 근거: Migration 77에서 생성됨. stage 적용 후 검증 → production 별도 Stephen 승인 후 적용.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. 함수 재작성: UPSERT 방식으로 변경
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

  -- 부모 상품의 price_rule 변경/추가 → 활성 자식들에 UPSERT로 동기화
  -- ON CONFLICT 대상: price_rules_active_unique (product_id, duration_type WHERE deleted_at IS NULL)
  INSERT INTO public.price_rules (
    product_id,
    duration_type,
    price,
    deposit_amount,
    late_fee_per_hour,
    damage_fee_percentage,
    is_active,
    deleted_at,
    updated_at
  )
  SELECT
    p.id,                       -- 자식 상품 ID
    NEW.duration_type,
    NEW.price,
    NEW.deposit_amount,
    NEW.late_fee_per_hour,
    NEW.damage_fee_percentage,
    NEW.is_active,
    NEW.deleted_at,             -- 부모 soft-delete 상태도 함께 동기화
    NOW()
  FROM public.products p
  WHERE
    p.parent_product_id = NEW.product_id   -- 해당 부모의 자식만
    AND p.deleted_at IS NULL               -- 삭제되지 않은 자식만
  ON CONFLICT (product_id, duration_type) WHERE deleted_at IS NULL
  DO UPDATE SET
    price                  = EXCLUDED.price,
    deposit_amount         = EXCLUDED.deposit_amount,
    late_fee_per_hour      = EXCLUDED.late_fee_per_hour,
    damage_fee_percentage  = EXCLUDED.damage_fee_percentage,
    is_active              = EXCLUDED.is_active,
    deleted_at             = NEW.deleted_at,
    updated_at             = NOW();

  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. 트리거 재등록: INSERT OR UPDATE 모두 반응하도록 확장
-- ────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sync_price_rules_to_children ON public.price_rules;

CREATE TRIGGER trg_sync_price_rules_to_children
AFTER INSERT OR UPDATE ON public.price_rules
FOR EACH ROW
EXECUTE FUNCTION public.sync_price_rules_to_children();

COMMENT ON FUNCTION public.sync_price_rules_to_children() IS
  'CRIT-PRICESYNC-1: 부모 price_rules INSERT/UPDATE 시 활성 자식 상품들의 동일 duration_type price_rules에 UPSERT로 자동 동기화 (처음 추가·기존 수정 양쪽 대응, 무한루프 방지)';
