-- Migration #45: banners 테이블
-- 홈페이지 배너 슬롯별 이미지·링크 관리
-- Phase 1: 프로모션 모듈 — 홍보(ad) 기반 DB

CREATE TABLE IF NOT EXISTS public.banners (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slot_key    VARCHAR(50) NOT NULL,
  -- 'hero_pc' | 'hero_mobile' | 'mid_banner_pc' | 'mid_banner_mobile'
  title       TEXT,
  image_url   TEXT NOT NULL,        -- Cloudinary URL
  link_url    TEXT,
  device_type VARCHAR(10) NOT NULL DEFAULT 'all',
  -- 'pc' | 'mobile' | 'all'
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  valid_from  TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banners_slot ON public.banners(slot_key, sort_order);
CREATE INDEX IF NOT EXISTS idx_banners_active ON public.banners(is_active, valid_from, valid_until);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION public.set_banners_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER banners_updated_at
  BEFORE UPDATE ON public.banners
  FOR EACH ROW EXECUTE FUNCTION public.set_banners_updated_at();

-- RLS
ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;

-- 관리자: 전체 접근
CREATE POLICY "banners_admin_all" ON public.banners
  FOR ALL
  USING (public.is_cms_user())
  WITH CHECK (public.is_cms_user());

-- 일반 사용자: 활성·유효 기간 내 배너만 SELECT
CREATE POLICY "banners_public_select" ON public.banners
  FOR SELECT
  USING (
    is_active = true
    AND (valid_from IS NULL OR valid_from <= now())
    AND (valid_until IS NULL OR valid_until >= now())
  );
