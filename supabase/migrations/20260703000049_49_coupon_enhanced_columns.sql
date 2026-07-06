-- Migration #49: coupons 테이블 확장 — 렌탈 특화 제약 조건 + 발행 옵션
-- Phase 1 보강: 학생·방문픽업·구독 전용 / 자동발행 / 유효기간 유형 / 중복 허용 설정
-- 2026-07-03

-- ─────────────────────────────────────────────────────────
-- 1. coupon_type_enum 신규 값 추가 (이미 존재하는 값은 스킵)
-- ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'free_delivery'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'coupon_type_enum')) THEN
    ALTER TYPE public.coupon_type_enum ADD VALUE 'free_delivery';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'first_rental'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'coupon_type_enum')) THEN
    ALTER TYPE public.coupon_type_enum ADD VALUE 'first_rental';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'category'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'coupon_type_enum')) THEN
    ALTER TYPE public.coupon_type_enum ADD VALUE 'category';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'bundle'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'coupon_type_enum')) THEN
    ALTER TYPE public.coupon_type_enum ADD VALUE 'bundle';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'subscription'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'coupon_type_enum')) THEN
    ALTER TYPE public.coupon_type_enum ADD VALUE 'subscription';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'student'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'coupon_type_enum')) THEN
    ALTER TYPE public.coupon_type_enum ADD VALUE 'student';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'walk_in'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'coupon_type_enum')) THEN
    ALTER TYPE public.coupon_type_enum ADD VALUE 'walk_in';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────
-- 2. coupons 테이블 컬럼 추가 (렌탈 특화 제약 조건)
-- ─────────────────────────────────────────────────────────

-- 최소 렌탈 금액 (원, 0 = 제한 없음)
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS min_rental_amount INT NOT NULL DEFAULT 0;

-- 최소 렌탈 기간 (일, 0 = 제한 없음)
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS min_rental_days INT NOT NULL DEFAULT 0;

-- 정률 쿠폰의 최대 할인 한도 (원, NULL = 한도 없음)
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS max_discount_amount INT;

-- 적용 가능 카테고리 배열 (NULL = 전체, 예: ["CAM","LGT"])
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS applicable_categories JSONB;

-- 적용 가능 상품 UUID 배열 (NULL = 전체)
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS applicable_products JSONB;

-- 필수 회원 등급 (NULL = 전 회원, 'BASIC'|'PRO'|'CRAZY')
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS user_grade_required VARCHAR(10);

-- 첫 렌탈 전용 여부
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS is_first_rental_only BOOLEAN NOT NULL DEFAULT false;

-- 1인당 최대 사용 횟수 (기존 usage_limit 는 쿠폰 전체 발급 한도)
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS per_user_limit INT NOT NULL DEFAULT 1;

-- 전체 발급 한도 (선착순용, NULL = 무제한)
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS total_usage_limit INT;

-- 학생 인증 계정 전용 (user_profiles.is_student = true 결제 시 검증)
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS is_student_only BOOLEAN NOT NULL DEFAULT false;

-- 방문 픽업 전용 (shipment_type = 'pickup' 결제 시 검증)
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS is_walk_in_only BOOLEAN NOT NULL DEFAULT false;

-- 정기구독 사용자 전용 (구독 상태 결제 시 검증 — PRD 구독 스키마 확정 후 서버 로직 연동)
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS is_subscription_only BOOLEAN NOT NULL DEFAULT false;

-- 자동 발행 활성 여부
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS auto_issue_enabled BOOLEAN NOT NULL DEFAULT false;

-- 자동 발행 스케줄 JSONB
-- {"type": "monthly", "day": 1} — 매월 1일
-- {"type": "period", "from": "2026-08-01", "to": "2026-08-31"} — 특정 기간
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS auto_issue_schedule JSONB;

-- 자동 발행 배포 대상 JSONB
-- {"type": "all"} | {"type": "grade", "meta": "PRO"} | {"type": "specific", "meta": ["uuid1", ...]}
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS distribution_target JSONB DEFAULT '{"type": "all"}'::jsonb;

-- 유효기간 유형 ('unlimited' = 만료일 없음, 'fixed_period' = valid_from~until 적용)
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS validity_type VARCHAR(15) NOT NULL DEFAULT 'fixed_period';

-- 포인트와 결합 사용 허용 (true = 포인트 동시 사용 가능)
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS allow_with_points BOOLEAN NOT NULL DEFAULT true;

-- 쿠폰 중복 사용 허용 (false = 1회 결제에 쿠폰 1장만, true = 복수 쿠폰 동시 적용)
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS allow_stacking BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────
-- 3. coupon_distributions — target_type ENUM 확장 (grade 추가)
-- ─────────────────────────────────────────────────────────
-- target_type이 VARCHAR라 기존 데이터 영향 없음 (grade 값 자유 사용 가능)
-- 기존: 'all' | 'segment' | 'specific_user'
-- 추가: 'grade' (BASIC|PRO|CRAZY), 'csv' (CSV 업로드)
-- → 컬럼 변경 불필요, 주석으로만 기록

COMMENT ON COLUMN public.coupon_distributions.target_type IS
  'all | grade | segment | specific_user | csv';
