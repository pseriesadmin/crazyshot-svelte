-- ★ MIGRATION: 26_public_holidays.sql
-- Schema version: v5.46
-- Description: Support — public holiday calendar for delivery deadline automation
-- Dependencies: (none)
-- Author: Stephen Cconzy
-- Date: 2026-05-29
--
-- 두발히어로/체인로지스 배달 마감일 계산 시 공휴일 자동 회피
-- pg_cron으로 연간 자동 업데이트 가능

CREATE TABLE IF NOT EXISTS public_holidays (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date       DATE NOT NULL,
  name       VARCHAR(100) NOT NULL,
  country    VARCHAR(5) NOT NULL DEFAULT 'KR',
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(date, country)
);

CREATE INDEX idx_public_holidays_date    ON public_holidays(date) WHERE is_active = true;
CREATE INDEX idx_public_holidays_country ON public_holidays(country, date);

ALTER TABLE public_holidays ENABLE ROW LEVEL SECURITY;

-- 모든 인증 사용자 조회 허용 (배송 날짜 선택 UI용)
CREATE POLICY "public_holidays: 전체 조회" ON public_holidays
  FOR SELECT USING (is_active = true AND auth.uid() IS NOT NULL);

CREATE POLICY "public_holidays: 관리자 전체" ON public_holidays
  FOR ALL USING (is_admin());

CREATE TRIGGER set_public_holidays_updated_at
  BEFORE UPDATE ON public_holidays
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ★ 한국 공휴일 초기 데이터 (2026년)
INSERT INTO public_holidays (date, name, country) VALUES
  ('2026-01-01', '신정', 'KR'),
  ('2026-01-28', '설날 연휴', 'KR'),
  ('2026-01-29', '설날', 'KR'),
  ('2026-01-30', '설날 연휴', 'KR'),
  ('2026-03-01', '삼일절', 'KR'),
  ('2026-05-05', '어린이날', 'KR'),
  ('2026-05-25', '부처님오신날', 'KR'),
  ('2026-06-06', '현충일', 'KR'),
  ('2026-08-15', '광복절', 'KR'),
  ('2026-09-24', '추석 연휴', 'KR'),
  ('2026-09-25', '추석', 'KR'),
  ('2026-09-26', '추석 연휴', 'KR'),
  ('2026-10-03', '개천절', 'KR'),
  ('2026-10-09', '한글날', 'KR'),
  ('2026-12-25', '성탄절', 'KR')
ON CONFLICT (date, country) DO NOTHING;
