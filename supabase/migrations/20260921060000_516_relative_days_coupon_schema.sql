-- Migration 516: 쿠폰 "첫 확인일로부터 N일" 유효기간(relative_days) 모드 — 스키마 변경
--
-- 배경: 쿠폰 유효기간 모드로 relative_days("첫 확인일로부터 N일") 신설.
--   고객이 장바구니 화면에서 쿠폰을 처음 확인하는 시점에 N일짜리 카운트다운이 시작된다.
--   사용 안내 없이 발급만 해두면 영구 유효한 기존 unlimited와 달리,
--   "보여준 순간부터 N일 이내 사용"이라는 긴장감 있는 유효기간을 제공한다.
--
-- 추가 컬럼:
--   user_coupons.first_viewed_at TIMESTAMPTZ NULL
--     — 고객이 카트 화면에서 처음으로 이 쿠폰을 확인한 시각
--       (mark_coupons_first_viewed RPC, Migration 518에서 기록)
--   coupons.valid_days INTEGER NULL
--     — relative_days 모드에서 "first_viewed_at + N일" 만료 기준
--       NULL 또는 0 이하는 허용하지 않음(CHECK 제약)
--
-- 롤백: 아래 ALTER를 역으로 실행하거나 테이블을 원래 상태로 되돌릴 것.
--   ALTER TABLE public.user_coupons DROP COLUMN IF EXISTS first_viewed_at;
--   ALTER TABLE public.coupons DROP COLUMN IF EXISTS valid_days;
--   DROP INDEX IF EXISTS idx_user_coupons_first_viewed_null;

ALTER TABLE public.user_coupons
  ADD COLUMN IF NOT EXISTS first_viewed_at TIMESTAMPTZ DEFAULT NULL;

-- 부분 인덱스: 아직 처음 확인하지 않은 미사용 쿠폰만 인덱싱
-- (mark_coupons_first_viewed RPC의 UPDATE 대상 최소화)
CREATE INDEX IF NOT EXISTS idx_user_coupons_first_viewed_null
  ON public.user_coupons (user_id)
  WHERE first_viewed_at IS NULL AND used_at IS NULL;

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS valid_days INTEGER DEFAULT NULL;

-- Postgres는 ADD CONSTRAINT에 IF NOT EXISTS를 지원하지 않음 — DO 블록으로 존재 여부 확인 후 추가
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_valid_days_positive'
  ) THEN
    ALTER TABLE public.coupons
      ADD CONSTRAINT coupons_valid_days_positive
      CHECK (valid_days IS NULL OR valid_days > 0);
  END IF;
END $$;
