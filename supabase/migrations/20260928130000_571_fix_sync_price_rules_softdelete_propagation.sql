-- Migration 571: price_rules 부모→자식 동기화 트리거 — 소프트삭제 전파 결함 수정 (CRIT-PRICESYNC-2)
--
-- 결함 원인 (Migration 192 CRIT-PRICESYNC-1의 잔여 버그):
--   sync_price_rules_to_children()가 INSERT ... ON CONFLICT (product_id, duration_type)
--   WHERE deleted_at IS NULL DO UPDATE 방식을 씀.
--
--   부모 price_rule이 소프트삭제될 때(NEW.deleted_at IS NOT NULL):
--     - INSERT하려는 행도 deleted_at = timestamp (null 아님)
--     - 부분 유니크 인덱스 price_rules_active_unique는 "WHERE deleted_at IS NULL" 조건이므로
--       deleted_at이 null이 아닌 새 삽입 행과 기존 활성 행 사이의 충돌을 감지하지 못함
--     - ON CONFLICT가 발동하지 않아 DO UPDATE가 실행되지 않음
--     - 자식의 기존 활성 price_rule(deleted_at IS NULL)이 삭제되지 않고 그대로 남음
--
--   결과: 부모 12H/24H 가격을 비웠을 때 자식에게 전파되지 않아
--         CMS 상품 목록 카드가 childFallback으로 자식의 잔여 가격을 표시함
--         (예: Panasonic AG-VBR59 카드에 "12H 5,000원" 잘못 표시)
--
-- 해결 방법:
--   소프트삭제 전파 경로(NEW.deleted_at IS NOT NULL)는 UPSERT 대신 직접 UPDATE 사용.
--   활성화/가격 변경 경로(NEW.deleted_at IS NULL)는 기존 UPSERT 로직 유지.
--
-- 데이터 정리:
--   기존 버그로 인해 이미 "부모는 소프트삭제, 자식은 여전히 활성" 상태인 고아 행을
--   이 마이그레이션에서 일괄 정리.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. 트리거 함수 재작성: 소프트삭제 vs 활성화 분기 처리
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

  IF NEW.deleted_at IS NOT NULL THEN
    -- ── 소프트삭제 전파 ──────────────────────────────────────────────────────
    -- INSERT ... ON CONFLICT 방식은 부분 유니크 인덱스(WHERE deleted_at IS NULL)가
    -- deleted_at IS NOT NULL 삽입 행과의 충돌을 감지하지 못해 DO UPDATE가 미실행됨.
    -- 직접 UPDATE로 자식의 기존 활성 행을 소프트삭제.
    UPDATE public.price_rules pr
    SET
      is_active   = false,
      deleted_at  = NEW.deleted_at,
      updated_at  = NOW()
    FROM public.products p
    WHERE
      pr.product_id     = p.id
      AND p.parent_product_id = NEW.product_id   -- 해당 부모의 자식만
      AND p.deleted_at  IS NULL                  -- 삭제되지 않은 자식만
      AND pr.duration_type = NEW.duration_type   -- 동일 대여기간 유형
      AND pr.deleted_at IS NULL;                 -- 활성 price_rule만

  ELSE
    -- ── 활성화 / 가격 변경 전파 (UPSERT) ────────────────────────────────────
    -- 자식에 해당 행이 없으면 INSERT, 있으면 DO UPDATE.
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
      p.id,
      NEW.duration_type,
      NEW.price,
      NEW.deposit_amount,
      NEW.late_fee_per_hour,
      NEW.damage_fee_percentage,
      NEW.is_active,
      NULL,   -- 활성화 경로이므로 deleted_at 항상 NULL
      NOW()
    FROM public.products p
    WHERE
      p.parent_product_id = NEW.product_id   -- 해당 부모의 자식만
      AND p.deleted_at IS NULL               -- 삭제되지 않은 자식만
    ON CONFLICT (product_id, duration_type) WHERE deleted_at IS NULL
    DO UPDATE SET
      price                 = EXCLUDED.price,
      deposit_amount        = EXCLUDED.deposit_amount,
      late_fee_per_hour     = EXCLUDED.late_fee_per_hour,
      damage_fee_percentage = EXCLUDED.damage_fee_percentage,
      is_active             = EXCLUDED.is_active,
      deleted_at            = NULL,
      updated_at            = NOW();

  END IF;

  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. 트리거 재등록 (변경 없음 — INSERT OR UPDATE 유지)
-- ────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sync_price_rules_to_children ON public.price_rules;

CREATE TRIGGER trg_sync_price_rules_to_children
AFTER INSERT OR UPDATE ON public.price_rules
FOR EACH ROW
EXECUTE FUNCTION public.sync_price_rules_to_children();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. 기존 고아 행 일괄 정리
--    기존 버그로 인해 이미 쌓인 케이스:
--    자식 price_rules는 활성(deleted_at IS NULL)인데
--    부모의 동일 duration_type price_rules는 소프트삭제(deleted_at IS NOT NULL)된 상태
--
--    ⚠️ 2026-09-28 재검증 후 조건 보강: "부모에 동일 duration_type 활성 price_rule이
--    없다"는 조건만으로는, products.md §9에 명시된 **정상 기능**(부모가 그 duration_type
--    가격을 아예 등록한 적이 없고, 관리자가 자식 상품 패널에서 직접 가격을 입력해둔 경우
--    — 카드가 그 자식 가격을 fallback으로 보여줌)까지 함께 삭제해버리는 위험이 있었다.
--    실제로 Stage DB에서 이 패턴(부모 price_rules 이력 자체가 0건, 자식만 2026-07-24부터
--    독립적으로 가격 보유 — "DJI RS4 Pro")을 확인해 이 조건을 추가로 보강했다.
--    → "부모가 이 duration_type 가격을 한 번이라도 등록했다가 소프트삭제한 이력이 있는
--       경우"만 정리 대상으로 한정(진짜 트리거 버그로 인한 고아 행만 정리).
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.price_rules child_pr
SET
  is_active  = false,
  deleted_at = NOW(),
  updated_at = NOW()
FROM public.products child
JOIN public.products parent ON child.parent_product_id = parent.id
WHERE
  child_pr.product_id   = child.id
  AND child.deleted_at  IS NULL
  AND parent.deleted_at IS NULL
  AND child_pr.deleted_at IS NULL
  -- 부모에 동일 duration_type 활성 price_rule이 존재하지 않는 경우
  AND NOT EXISTS (
    SELECT 1
    FROM public.price_rules parent_pr
    WHERE parent_pr.product_id    = parent.id
      AND parent_pr.duration_type = child_pr.duration_type
      AND parent_pr.deleted_at    IS NULL
  )
  -- ⛔ 추가 보강: 부모가 이 duration_type 가격을 "등록했다가 지운 이력"이 실제로 있어야만
  -- (트리거 버그로 인한 고아 행만 정리 — 부모가 애초에 등록한 적 없는 정상 fallback은 보존)
  AND EXISTS (
    SELECT 1
    FROM public.price_rules parent_pr
    WHERE parent_pr.product_id    = parent.id
      AND parent_pr.duration_type = child_pr.duration_type
      AND parent_pr.deleted_at    IS NOT NULL
  );

COMMENT ON FUNCTION public.sync_price_rules_to_children() IS
  'CRIT-PRICESYNC-2(571): 소프트삭제 전파 결함 수정 — 삭제 시 직접 UPDATE, 활성화 시 UPSERT 분기. Migration 192(CRIT-PRICESYNC-1) ON CONFLICT 방식이 deleted_at IS NOT NULL 삽입과 부분 유니크 인덱스 충돌 미감지로 DO UPDATE 미실행되던 버그 해소.';
