-- Migration #229: 구독 플랜 카테고리 연동 + 영구고정 품번 채번
--
-- 배경: Stephen 지시 — "구독등록 기본정보에 상품등록과 동일한 카테고리+품번 설정 기능 추가,
--       실물 상품과 동일한 물리 카테고리 연동 + products.md 품번 체계와 동일한 영구고정
--       자동채번 규칙(재발행 불가) 적용".
--
-- 중요: 기존 `generate_product_code` RPC는 `p_product_id UUID`를 받아 `products` 테이블만
--       대상으로 하며(subscription_plans.id는 BIGINT라 타입부터 불일치), frozen 대상인 기존
--       마이그레이션/RPC를 변경하지 않는다는 원칙(GP-10)에 따라 재사용하지 않고 완전히 별도의
--       신규 RPC + 신규 시퀀스 테이블을 둔다 — 물리 상품 품번 채번 공간과 절대 공유하지 않음
--       (products.md §2-2 영구고정 정책과 동일한 원리를 구독 플랜 전용으로 독립 구현).
--
-- 카테고리 값 도메인은 `/cms/products/new`의 CATEGORIES 상수와 동일한 9종
-- (camera/lens/camcorder/action_cam/drone/lighting/audio/accessory/package)를 그대로 따름 —
-- 다만 products.category처럼 실제로는 자유 TEXT라 CHECK 제약은 걸지 않음(상품 쪽과 동일 컨벤션).
--
-- stage(ezyvffjvuwmtuhpxdjrw) 먼저 적용·검증 → production(vnbpmvxruyciuuaermyh)은 Stephen 승인 후.

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS product_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plans_product_code
  ON subscription_plans(product_code) WHERE product_code IS NOT NULL;

-- 구독 플랜 전용 채번 시퀀스 — product_code_sequences(물리 상품용)와 완전히 독립
CREATE TABLE subscription_code_sequences (
  category TEXT PRIMARY KEY,
  next_seq INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE subscription_code_sequences ENABLE ROW LEVEL SECURITY;
-- 정책 미등록 = service_role(SECURITY DEFINER RPC)만 접근, 클라이언트 직접 접근 전면 차단

CREATE OR REPLACE FUNCTION public.generate_subscription_product_code(
  p_plan_id BIGINT,
  p_category TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing_code TEXT;
  v_seq INTEGER;
  v_prefix TEXT;
  v_code TEXT;
BEGIN
  SELECT product_code INTO v_existing_code FROM subscription_plans WHERE id = p_plan_id;
  IF v_existing_code IS NOT NULL THEN
    -- 영구고정 정책: 이미 발급된 품번은 재발급하지 않음(products.md §2-2와 동일 원리)
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_ISSUED', 'product_code', v_existing_code);
  END IF;

  v_prefix := CASE p_category
    WHEN 'camera'     THEN 'CAM'
    WHEN 'lens'        THEN 'LNS'
    WHEN 'camcorder'   THEN 'CMC'
    WHEN 'action_cam'  THEN 'ACT'
    WHEN 'drone'       THEN 'DRN'
    WHEN 'lighting'    THEN 'LGT'
    WHEN 'audio'       THEN 'AUD'
    WHEN 'accessory'   THEN 'ACC'
    WHEN 'package'     THEN 'PKG'
    ELSE 'SUB'
  END;

  -- 원자적 채번(INSERT..ON CONFLICT) — product_code_sequences와 동일한 패턴
  INSERT INTO subscription_code_sequences (category, next_seq) VALUES (p_category, 2)
  ON CONFLICT (category) DO UPDATE SET next_seq = subscription_code_sequences.next_seq + 1
  RETURNING next_seq - 1 INTO v_seq;

  v_code := 'SUB-' || v_prefix || '-' || LPAD(v_seq::TEXT, 4, '0');

  UPDATE subscription_plans SET category = p_category, product_code = v_code WHERE id = p_plan_id;

  RETURN jsonb_build_object('success', true, 'product_code', v_code);
END;
$$;
