-- Migration #240: generate_subscription_product_code — 하드코딩 카테고리 접두사 CASE문 제거
--
-- 배경: migration #229가 만든 v_prefix := CASE p_category WHEN 'camera' THEN 'CAM' ... END
-- 는 초기 9종 고정 enum(camera/lens/camcorder/action_cam/drone/lighting/audio/accessory/
-- package) 기준으로 하드코딩됐다. 반면 구독등록 화면(/cms/subscriptions/new)의 분류 선택지는
-- code_mapping_groups.default_category(백오피스에서 자유롭게 추가·개명 가능)에서 조회한다.
--
-- production 실데이터로 확인한 실제 어긋남(2026-08-13):
--   code_mapping_groups(is_active·show_in_product_filter=true) 실제 값:
--     accessorie, actcam, camera, dronegim, hypepack, lens, light, phone
--   위 CASE문과 정확히 일치하는 값: camera, lens 단 2개뿐.
--   나머지 6개(accessorie/actcam/dronegim/hypepack/light/phone)는 전부 CASE문의 ELSE 'SUB'로
--   떨어져, 구독상품 품번이 의미 없는 'SUB-SUB-####' 형태로 발급되고 있었다.
--   product_category_codes 쪽에서 매핑을 끌어오는 것도 불가능(product_category 컬럼이
--   이 default_category 값들과 애초에 정렬돼 있지 않음 — 빈 결과로 확인).
--
-- 수정: 하드고딩 CASE문을 완전히 제거하고, generate_product_code의 최종 폴백과 동일한 방식
-- (UPPER(LEFT(p_category, 3)))으로 접두사를 항상 카테고리 값에서 직접 계산한다. 카테고리가
-- 향후 추가·개명되어도 다시 어긋날 일이 없다(관리 지점 소멸).
--
-- 절대 제약:
--   ① 시그니처 무변경 (BIGINT, TEXT) — GP-10
--   ② 영구고정 guard(이미 발급된 품번은 재발급 안 함) 그대로 유지
--   ③ subscription_code_sequences/subscription_plans 등 테이블·컬럼 변경 없음(로직만 교체)
--   ④ 이미 발급된 기존 품번(guard로 보호됨)은 이 수정과 무관 — 재계산 안 됨

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

  -- 🔴 버그 수정(#240): 하드코딩 CASE문 제거 — code_mapping_groups.default_category와
  -- 어긋나지 않도록 항상 카테고리 값 자체에서 접두사를 계산(generate_product_code의
  -- 최종 폴백 UPPER(LEFT(p_category,3))과 동일 원칙).
  v_prefix := UPPER(LEFT(COALESCE(p_category, ''), 3));
  IF v_prefix = '' THEN v_prefix := 'SUB'; END IF;

  -- 원자적 채번(INSERT..ON CONFLICT) — product_code_sequences와 동일한 패턴
  INSERT INTO subscription_code_sequences (category, next_seq) VALUES (p_category, 2)
  ON CONFLICT (category) DO UPDATE SET next_seq = subscription_code_sequences.next_seq + 1
  RETURNING next_seq - 1 INTO v_seq;

  v_code := 'SUB-' || v_prefix || '-' || LPAD(v_seq::TEXT, 4, '0');

  UPDATE subscription_plans SET category = p_category, product_code = v_code WHERE id = p_plan_id;

  RETURN jsonb_build_object('success', true, 'product_code', v_code);
END;
$$;

REVOKE ALL ON FUNCTION public.generate_subscription_product_code(BIGINT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.generate_subscription_product_code(BIGINT, TEXT) TO service_role;

COMMENT ON FUNCTION public.generate_subscription_product_code(BIGINT, TEXT) IS
  '구독 플랜 전용 채번(#229 → #240 버그수정): 카테고리→접두사 매핑을 하드코딩 CASE문 대신
   UPPER(LEFT(p_category,3))로 항상 동적 계산 — code_mapping_groups.default_category가
   추가/개명돼도 어긋나지 않음. 영구고정 guard·시퀀스 테이블·시그니처 전부 무변경.';
