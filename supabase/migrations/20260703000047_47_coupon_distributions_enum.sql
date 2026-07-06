-- Migration #47: coupon_type_enum 확장 + coupon_distributions 테이블
-- 쿠폰 타입 추가 및 관리자 배포 이력 추적
-- Phase 1: 프로모션 모듈 — 쿠폰(coupon) 기반 DB

-- coupon_type_enum 마케팅 타입 추가
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'event'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'coupon_type_enum')
  ) THEN
    ALTER TYPE public.coupon_type_enum ADD VALUE 'event';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'referral'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'coupon_type_enum')
  ) THEN
    ALTER TYPE public.coupon_type_enum ADD VALUE 'referral';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'reactivation'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'coupon_type_enum')
  ) THEN
    ALTER TYPE public.coupon_type_enum ADD VALUE 'reactivation';
  END IF;
END $$;

-- 쿠폰 배포 이력 테이블
CREATE TABLE IF NOT EXISTS public.coupon_distributions (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  coupon_id    UUID NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  admin_id     UUID NOT NULL REFERENCES auth.users(id),
  target_type  VARCHAR(20) NOT NULL DEFAULT 'all',
  -- 'all' | 'segment' | 'specific_user'
  target_meta  JSONB,        -- 세그먼트 정의 or 사용자 UUID 배열
  issued_count INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cd_coupon ON public.coupon_distributions(coupon_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cd_admin ON public.coupon_distributions(admin_id, created_at DESC);

-- RLS
ALTER TABLE public.coupon_distributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cd_admin_all" ON public.coupon_distributions
  FOR ALL
  USING (public.is_cms_user())
  WITH CHECK (public.is_cms_user());
