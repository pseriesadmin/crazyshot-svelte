-- Migration 291: 쿠폰 기준코드 지연채번(Lazy Sequencing) 아키텍처 — 스키마 변경
-- 작업:
--   B-4: distribute_coupon의 issued_at → created_at 버그 수정 (선행조건)
--   B-1: coupons.code_series / code_mode 신규 컬럼, code NOT NULL 완화,
--         user_coupons.redeemed_code, coupon_code_sequences 테이블 신설
-- 2026-08-18

-- ─────────────────────────────────────────────────────────
-- B-4 (선행 필수): distribute_coupon issued_at → created_at 버그 수정
--   근거: user_coupons 테이블(migration 16)에 issued_at 컬럼 없음(created_at만 존재).
--         distribute_coupon RPC(migration 51:152)가 issued_at을 참조해 호출 시 항상
--         "column issued_at of relation user_coupons does not exist" Postgres 에러 발생.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.distribute_coupon(
  p_coupon_id   UUID,
  p_target_type TEXT,
  p_target_meta JSONB DEFAULT NULL,
  p_admin_id    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coupon       RECORD;
  v_users        UUID[];
  v_issued_count INT := 0;
  v_dist_id      UUID;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  SELECT * INTO v_coupon FROM coupons WHERE id = p_coupon_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_NOT_FOUND');
  END IF;

  -- 대상 사용자 수집
  IF p_target_type = 'all' THEN
    SELECT ARRAY_AGG(id) INTO v_users FROM auth.users;

  ELSIF p_target_type = 'grade' THEN
    SELECT ARRAY_AGG(id) INTO v_users
    FROM user_profiles
    WHERE membership_grade = (p_target_meta->>'grade');

  ELSIF p_target_type = 'specific_user' THEN
    SELECT ARRAY_AGG(val::UUID) INTO v_users
    FROM jsonb_array_elements_text(p_target_meta->'user_ids') AS val;

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TARGET_TYPE');
  END IF;

  -- B-4 FIX: issued_at → created_at (user_coupons 실제 컬럼명)
  INSERT INTO user_coupons (user_id, coupon_id)
  SELECT uid, p_coupon_id
  FROM UNNEST(v_users) AS uid
  ON CONFLICT (user_id, coupon_id) DO NOTHING;

  GET DIAGNOSTICS v_issued_count = ROW_COUNT;

  -- 배포 이력 기록
  INSERT INTO coupon_distributions (coupon_id, admin_id, target_type, target_meta, issued_count)
  VALUES (p_coupon_id, COALESCE(p_admin_id, auth.uid()), p_target_type, p_target_meta, v_issued_count)
  RETURNING id INTO v_dist_id;

  RETURN jsonb_build_object('ok', true, 'issued_count', v_issued_count, 'distribution_id', v_dist_id);
END;
$$;

-- ─────────────────────────────────────────────────────────
-- B-1: coupons 테이블 신규 컬럼 추가
-- ─────────────────────────────────────────────────────────

-- 1a. 쿠폰 코드 패턴 저장용 (products.code_series와 동일 역할)
-- {category_code, prefix, date_option, seq_digits, max_sequence}
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS code_series JSONB;

-- 1b. 코드 모드: 'manual'(기존 직접 입력) | 'sequenced'(지연채번)
--   DEFAULT 'manual'로 기존 모든 쿠폰이 manual로 유지됨 (완전 하위호환)
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS code_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (code_mode IN ('manual', 'sequenced'));

-- 1c. code NOT NULL → NULL 허용 (sequenced 모드는 생성 시 code가 없음)
--   기존 manual 쿠폰은 code IS NOT NULL 상태 그대로 유지
ALTER TABLE public.coupons
  ALTER COLUMN code DROP NOT NULL;

-- 1d. 기존 UNIQUE 제약 제거 후 부분 인덱스로 교체
--   기존 inline UNIQUE 제약은 PostgreSQL이 자동으로 coupons_code_key로 명명
DO $$
BEGIN
  -- 제약(CONSTRAINT) 방식으로 존재하면 CONSTRAINT 삭제
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'coupons'
      AND constraint_name = 'coupons_code_key'
      AND constraint_type = 'UNIQUE'
  ) THEN
    ALTER TABLE public.coupons DROP CONSTRAINT coupons_code_key;
  END IF;
END $$;

-- 부분 인덱스: code가 NULL이 아닌 활성 쿠폰만 유니크 보장
CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_unique_idx
  ON public.coupons(code)
  WHERE code IS NOT NULL AND deleted_at IS NULL;

-- 1e. code_mode ↔ 필드 일관성 체크 제약
--   manual이면 code 필수 / sequenced이면 code_series 필수
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'coupons' AND constraint_name = 'coupons_code_mode_chk'
  ) THEN
    ALTER TABLE public.coupons ADD CONSTRAINT coupons_code_mode_chk
      CHECK (
        (code_mode = 'manual'    AND code IS NOT NULL)
        OR
        (code_mode = 'sequenced' AND code_series IS NOT NULL)
      );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────
-- B-1: user_coupons 테이블 — 사용 시점 채번 코드 저장 컬럼
-- ─────────────────────────────────────────────────────────

-- use_coupon RPC 내부에서 채번 전까지 NULL, 채번 후 유니크
ALTER TABLE public.user_coupons
  ADD COLUMN IF NOT EXISTS redeemed_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS user_coupons_redeemed_code_idx
  ON public.user_coupons(redeemed_code)
  WHERE redeemed_code IS NOT NULL;

-- ─────────────────────────────────────────────────────────
-- B-1: coupon_code_sequences — 원자적 채번 카운터
--   product_code_sequences와 동일 원리(TASK.md B-1, products.md §2-2 참조)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coupon_code_sequences (
  id            BIGSERIAL PRIMARY KEY,
  category_code VARCHAR(30) NOT NULL,
  year_month    VARCHAR(7)  NOT NULL,    -- 'YYYYMM' 또는 'nodate'(날짜 없는 시리즈)
  next_seq      INT         NOT NULL DEFAULT 1,
  CONSTRAINT coupon_code_sequences_unique UNIQUE (category_code, year_month)
);

ALTER TABLE public.coupon_code_sequences ENABLE ROW LEVEL SECURITY;

-- service_role만 직접 접근 허용 (generate_user_coupon_redeemed_code 내부에서 사용)
CREATE POLICY "service_role_all_coupon_sequences" ON public.coupon_code_sequences
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.coupon_code_sequences IS
  '쿠폰 지연채번(Lazy Sequencing) 원자적 순번 카운터.
   product_code_sequences와 동일 INSERT...ON CONFLICT DO UPDATE 단조증가 패턴.
   쿠폰 사용(use_coupon RPC) 시점에만 순번이 소비된다 — 생성·배포 시점은 무소비.';

-- ─────────────────────────────────────────────────────────
-- ROLLBACK (필요 시)
-- ─────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION public.distribute_coupon(...) -- 원본 복원 (issued_at 포함 버전)
-- DROP INDEX IF EXISTS public.coupons_code_unique_idx;
-- ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_code_mode_chk;
-- ALTER TABLE public.coupons DROP COLUMN IF EXISTS code_mode;
-- ALTER TABLE public.coupons DROP COLUMN IF EXISTS code_series;
-- ALTER TABLE public.coupons ALTER COLUMN code SET NOT NULL;
-- ALTER TABLE public.user_coupons DROP COLUMN IF EXISTS redeemed_code;
-- DROP TABLE IF EXISTS public.coupon_code_sequences;
