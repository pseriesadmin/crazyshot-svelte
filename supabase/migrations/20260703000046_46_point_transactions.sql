-- Migration #46: point_transactions 테이블
-- 포인트 적립·사용·차감 이력 추적
-- Phase 1: 프로모션 모듈 — 포인트(point) 기반 DB

CREATE TYPE IF NOT EXISTS public.point_tx_type AS ENUM (
  'earn',          -- 렌탈·리뷰 등으로 자동 적립
  'use',           -- 결제 시 사용
  'expire',        -- 유효기간 만료
  'admin_grant',   -- 관리자 수동 적립
  'admin_deduct'   -- 관리자 수동 차감
);

CREATE TABLE IF NOT EXISTS public.point_transactions (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type          public.point_tx_type NOT NULL,
  amount        INT NOT NULL,        -- 양수(적립) / 음수(사용·차감)
  balance_after INT NOT NULL,        -- 트랜잭션 후 잔액 스냅샷
  description   TEXT,
  ref_type      VARCHAR(30),         -- 'reservation' | 'coupon' | 'admin' | 'event'
  ref_id        UUID,                -- 참조 ID (예약ID, 쿠폰ID 등)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pt_user ON public.point_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pt_created ON public.point_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pt_type ON public.point_transactions(type, created_at DESC);

-- RLS
ALTER TABLE public.point_transactions ENABLE ROW LEVEL SECURITY;

-- 관리자: 전체 접근
CREATE POLICY "pt_admin_all" ON public.point_transactions
  FOR ALL
  USING (public.is_cms_user())
  WITH CHECK (public.is_cms_user());

-- 일반 사용자: 본인 이력만 SELECT
CREATE POLICY "pt_user_select" ON public.point_transactions
  FOR SELECT
  USING (user_id = auth.uid());
