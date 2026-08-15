-- Migration 249: subscription_plans image_urls 컬럼 + append RPC
-- 신규 Storage 버킷은 생성하지 않는다 — 기존 product-images 버킷을 subscriptions/ prefix로
-- 재사용한다(계획 승인 시 확정된 방식, 신규 버킷 프로비저닝 회피). 해당 버킷은 이미
-- 공개 읽기 정책이 적용돼 있어 별도 RLS 정책도 불필요.

-- 1. image_urls 컬럼 추가
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::JSONB;

COMMENT ON COLUMN public.subscription_plans.image_urls IS
  '구독 상품 이미지 URL 배열 (NOW-4 갤러리 탭)';

-- 2. append_subscription_image_url RPC
-- p_plan_id는 subscription_plans.id(BIGINT)와 동일 타입으로 통일 — 기존
-- generate_subscription_product_code 등 다른 구독 RPC와 동일 관례(migration 229/241 참고).
CREATE OR REPLACE FUNCTION public.append_subscription_image_url(
  p_plan_id BIGINT,
  p_url     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  UPDATE public.subscription_plans
  SET image_urls = image_urls || jsonb_build_array(p_url)
  WHERE id = p_plan_id
  RETURNING image_urls INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'subscription_plans row not found: %', p_plan_id;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_subscription_image_url(BIGINT, TEXT) TO service_role;
