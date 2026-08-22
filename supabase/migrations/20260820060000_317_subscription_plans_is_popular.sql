-- Migration 317: subscription_plans.is_popular 컬럼 추가
-- 목적: CMS에서 특정 구독 플랜에 "인기" 배지를 직접 지정할 수 있도록 boolean 플래그 추가
--       FeaturesTable.svelte의 위치 기반 하드코딩(index === 1) 대체
-- 정책: DEFAULT false — 기존 데이터(production id 4/5/6) 는 모두 false로 안전하게 적용
--       배타성 제약 없음 — 여러 플랜에 동시에 true가 가능(Stephen 확정)
-- 대상: stage(ezyvffjvuwmtuhpxdjrw) 먼저 적용·검증 후 production 적용(별도 승인)

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS is_popular BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.subscription_plans.is_popular IS
  '인기 배지 표시 여부 — CMS에서 직접 지정, 배타성 없음(여러 플랜 동시 true 허용)';
