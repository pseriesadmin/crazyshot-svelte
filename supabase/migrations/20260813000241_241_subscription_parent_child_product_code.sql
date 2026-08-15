-- Migration #241: 구독 상품에 부모/자식 품번 구조 도입 (products.md §2-1~§2-3 원칙 응용)
--
-- 배경 (Stephen 확정, 2026-08-13):
--   기존 구독등록(/cms/subscriptions/new)은 등록 즉시 subscription_plans.product_code를
--   발급했다. Stephen 요청으로 이를 상품(products) 모듈의 부모/자식 구조와 동일하게 바꾼다:
--     부모(구독 플랜, 구독등록 화면) = 품번 구조(code_series)만 저장, 실제 품번 미발급
--     자식(개별 구독자, user_subscriptions 행) = 실제 구독 완료 시점에 고유 품번 발급
--   구독등록 화면에는 products/new와 동일한 "코드 조합"(code_mapping_groups/items) 선택 UI가
--   추가되며, 선택한 콤보의 합산 분류코드가 code_series.prefix로 저장된다.
--
-- 절대 제약:
--   ① ADD-ONLY — 기존 마이그레이션 파일(#229/#240) 수정 없음, 컬럼 삭제 없음
--   ② 영구고정 정책 유지 — 이미 발급된 code_series/product_code는 재설정 안 함
--   ③ 현재 subscription_plans/user_subscriptions 둘 다 0 rows(stage/production 확인 완료,
--      2026-08-13) — 데이터 마이그레이션·백필 불필요
--   ④ create_user_subscription(4-param) 시그니처 무변경 — CREATE OR REPLACE만 사용

-- ── 1. 스키마 확장 ──────────────────────────────────────────────────────────

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS code_series JSONB;

ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS product_code TEXT;

-- 영구고정: 발급된 구독자 품번은 재사용 불가 (products_code_key와 동일 원칙)
CREATE UNIQUE INDEX IF NOT EXISTS user_subscriptions_product_code_key
  ON user_subscriptions (product_code)
  WHERE product_code IS NOT NULL;

-- ── 2. generate_subscription_product_code 재설계 (부모 전용 — code_series만 저장) ──
--    시그니처 변경(2-param → 3-param: p_category_code_override 추가)이라 DROP 후 재생성
--    (PostgREST 2/3-param 오버로드 모호성 방지 — products.md §2-3 PGRST203 교훈과 동일)

DROP FUNCTION IF EXISTS public.generate_subscription_product_code(BIGINT, TEXT);

CREATE OR REPLACE FUNCTION public.generate_subscription_product_code(
  p_plan_id BIGINT,
  p_category TEXT,
  p_category_code_override TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing_series JSONB;
  v_prefix TEXT;
BEGIN
  -- 영구고정 guard: code_series는 한 번 설정되면 재설정하지 않음(products.md §2-2와 동일)
  SELECT code_series INTO v_existing_series FROM subscription_plans WHERE id = p_plan_id;
  IF v_existing_series IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_SET', 'code_series', v_existing_series);
  END IF;

  -- 콤보(코드 조합) 선택 시 그 합산 분류코드를 그대로 prefix로 사용, 미선택 시
  -- generate_product_code 최종 폴백과 동일한 UPPER(LEFT(category,3)) 규칙 적용(#240 계승)
  v_prefix := COALESCE(NULLIF(p_category_code_override, ''), UPPER(LEFT(COALESCE(p_category, ''), 3)));
  IF v_prefix = '' THEN v_prefix := 'SUB'; END IF;

  UPDATE subscription_plans
  SET category = p_category,
      code_series = jsonb_build_object('prefix', v_prefix)
  WHERE id = p_plan_id;

  RETURN jsonb_build_object('success', true, 'code_series', jsonb_build_object('prefix', v_prefix));
END;
$$;

REVOKE ALL ON FUNCTION public.generate_subscription_product_code(BIGINT, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.generate_subscription_product_code(BIGINT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.generate_subscription_product_code(BIGINT, TEXT, TEXT) IS
  '구독 플랜(부모) 전용 — 실제 품번을 발급하지 않고 code_series(prefix 구조)만 저장한다.
   p_category_code_override: 코드조합(콤보) 선택 시 합산 분류코드, 미선택 시 NULL.
   실제 품번은 generate_subscription_inventory_product_code(자식)에서 발급된다.';

-- ── 3. generate_subscription_inventory_product_code 신설 (자식 — 실제 품번 발급) ──
--    products.md §2-3 generate_inventory_product_code(child_id, parent_id)와 동일 원리:
--    부모의 code_series를 읽어 subscription_code_sequences 순번을 실제로 소모한다.

CREATE OR REPLACE FUNCTION public.generate_subscription_inventory_product_code(
  p_user_subscription_id BIGINT,
  p_plan_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing_code TEXT;
  v_code_series   JSONB;
  v_prefix        TEXT;
  v_seq           INTEGER;
  v_code          TEXT;
BEGIN
  -- 영구고정 guard: 이미 발급된 구독자 품번은 재발급하지 않음
  SELECT product_code INTO v_existing_code
  FROM user_subscriptions WHERE id = p_user_subscription_id;
  IF v_existing_code IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_ISSUED', 'product_code', v_existing_code);
  END IF;

  SELECT code_series INTO v_code_series
  FROM subscription_plans WHERE id = p_plan_id;
  IF v_code_series IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_CODE_SERIES');
  END IF;

  v_prefix := COALESCE(v_code_series->>'prefix', 'SUB');

  -- 원자적 채번(INSERT..ON CONFLICT) — subscription_code_sequences.category 컬럼을
  -- "코드 버킷 키"로 재사용(순번은 이제 등록 시점이 아니라 구독 완료 시점에 소모됨)
  INSERT INTO subscription_code_sequences (category, next_seq) VALUES (v_prefix, 2)
  ON CONFLICT (category) DO UPDATE SET next_seq = subscription_code_sequences.next_seq + 1
  RETURNING next_seq - 1 INTO v_seq;

  v_code := 'SUB-' || v_prefix || '-' || LPAD(v_seq::TEXT, 4, '0');

  UPDATE user_subscriptions SET product_code = v_code WHERE id = p_user_subscription_id;

  RETURN jsonb_build_object('success', true, 'product_code', v_code);
END;
$$;

REVOKE ALL ON FUNCTION public.generate_subscription_inventory_product_code(BIGINT, BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.generate_subscription_inventory_product_code(BIGINT, BIGINT) TO service_role;

COMMENT ON FUNCTION public.generate_subscription_inventory_product_code(BIGINT, BIGINT) IS
  '구독자(자식) 전용 — 부모 플랜의 code_series.prefix를 읽어 실제 품번(SUB-{prefix}-{seq})을
   발급한다. create_user_subscription이 구독 생성 직후 내부에서 호출한다(비차단 — 실패해도
   구독 생성 자체는 유지).';

-- ── 4. create_user_subscription — 구독 생성 직후 자식 품번 자동 발급 (원자적, 4-param 시그니처 무변경) ──

CREATE OR REPLACE FUNCTION public.create_user_subscription(
  p_user_id UUID,
  p_plan_id BIGINT,
  p_billing_key TEXT,
  p_billing_cycle_day SMALLINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_id BIGINT;
  v_existing_id BIGINT;
  v_new_id BIGINT;
  v_code_result JSONB;
BEGIN
  SELECT id INTO v_plan_id
  FROM subscription_plans
  WHERE id = p_plan_id AND status = 'active' AND deleted_at IS NULL;

  IF v_plan_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PLAN_NOT_FOUND');
  END IF;

  SELECT id INTO v_existing_id
  FROM user_subscriptions
  WHERE user_id = p_user_id AND status = 'active'
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_SUBSCRIBED');
  END IF;

  INSERT INTO user_subscriptions (
    user_id, plan_id, status, started_at, billing_key, billing_cycle_day, next_billing_date, fail_count
  ) VALUES (
    p_user_id, p_plan_id, 'active', now(), p_billing_key, p_billing_cycle_day,
    (CURRENT_DATE + INTERVAL '1 month')::date, 0
  )
  RETURNING id INTO v_new_id;

  -- 자식 품번 발급 — 비차단(실패해도 구독 생성 자체는 성공 유지, code_warning으로만 전달)
  v_code_result := generate_subscription_inventory_product_code(v_new_id, p_plan_id);

  IF (v_code_result->>'success')::boolean THEN
    RETURN jsonb_build_object(
      'success', true,
      'subscription_id', v_new_id,
      'product_code', v_code_result->>'product_code'
    );
  ELSE
    RETURN jsonb_build_object(
      'success', true,
      'subscription_id', v_new_id,
      'product_code', NULL,
      'code_warning', v_code_result->>'error'
    );
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_user_subscription(UUID, BIGINT, TEXT, SMALLINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_user_subscription(UUID, BIGINT, TEXT, SMALLINT) TO service_role;
