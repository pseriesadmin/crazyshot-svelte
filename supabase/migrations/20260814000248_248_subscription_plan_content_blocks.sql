-- Migration 248: subscription_plans에 content_blocks 컬럼 추가
-- 상품설명 탭에서 CmsContentEditor가 저장하는 블록 배열

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS content_blocks JSONB NOT NULL DEFAULT '[]'::JSONB;

COMMENT ON COLUMN public.subscription_plans.content_blocks IS
  'CmsContentEditor 블록 배열 — ContentBlock[] JSON (NOW-3 상품설명 탭)';
