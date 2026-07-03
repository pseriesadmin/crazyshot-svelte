-- Migration #50: point_earn_rules 테이블 신설 + point_transactions 확장
-- Phase 1 보강: 등급별 적립률·이벤트 on-off 관리자 설정 레이어
-- 2026-07-03

-- ─────────────────────────────────────────────────────────
-- 1. point_transactions — admin_id 컬럼 추가
-- ─────────────────────────────────────────────────────────
ALTER TABLE public.point_transactions
  ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.point_transactions.admin_id IS
  '관리자 발행·차감 시 담당 관리자 ID (admin_grant/admin_deduct 타입에서만 설정)';

-- ─────────────────────────────────────────────────────────
-- 2. point_earn_rules 테이블 신설
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.point_earn_rules (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type     VARCHAR(30) NOT NULL UNIQUE,
  -- 'rental_complete' | 'review' | 'on_time_return'
  -- 'referrer' | 'referee' | 'birthday' | 'event'
  amount         INT         NOT NULL DEFAULT 0,   -- 고정 적립량 (정률 이벤트는 0)
  rate           NUMERIC(5,4)         DEFAULT 0,   -- 적립률 (0.0100 = 1%)
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  grade_multipliers JSONB,
  -- 등급별 배수 {"BASIC": 1.0, "PRO": 2.0, "CRAZY": 3.0}
  -- rate × grade_multipliers[grade] 로 최종 적립률 계산
  description    TEXT,
  updated_at     TIMESTAMPTZ          DEFAULT now()
);

-- ─────────────────────────────────────────────────────────
-- 3. 기본 규칙 데이터 삽입 (이미 존재 시 스킵)
-- ─────────────────────────────────────────────────────────
INSERT INTO public.point_earn_rules (event_type, amount, rate, is_active, grade_multipliers, description)
VALUES
  ('rental_complete', 0,    0.0100, true,
   '{"BASIC": 1.0, "PRO": 2.0, "CRAZY": 3.0}',
   '렌탈 완료 — 렌탈비 × 적립률 (기본 1%, PRO 2%, CRAZY 3%)'),

  ('review',          500,  0,      true,
   NULL,
   '리뷰 작성 — 렌탈 완료 후 14일 이내 작성 시 고정 500P'),

  ('on_time_return',  200,  0,      true,
   NULL,
   '정시 반납 — 반납 예정일 당일 반납 시 고정 200P'),

  ('referrer',        1000, 0,      true,
   NULL,
   '친구 추천 (추천인) — 피추천인 첫 렌탈 완료 시 1,000P'),

  ('referee',         500,  0,      true,
   NULL,
   '친구 추천 (피추천인) — 첫 렌탈 완료 시 500P'),

  ('birthday',        1000, 0,      true,
   NULL,
   '생일 축하 — 생일 당월 자동 지급 1,000P'),

  ('event',           0,    0,      true,
   NULL,
   '이벤트 (관리자) — 금액 자유 지정, admin_grant_points RPC 사용')
ON CONFLICT (event_type) DO NOTHING;

-- ─────────────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────────────
ALTER TABLE public.point_earn_rules ENABLE ROW LEVEL SECURITY;

-- 관리자: 전체 조회
CREATE POLICY "cms_select_earn_rules"
  ON public.point_earn_rules FOR SELECT
  USING (public.is_cms_user());

-- 관리자: 수정
CREATE POLICY "cms_update_earn_rules"
  ON public.point_earn_rules FOR UPDATE
  USING (public.is_cms_user())
  WITH CHECK (public.is_cms_user());
