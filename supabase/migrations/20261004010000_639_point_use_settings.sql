-- Migration #639: 포인트 사용 규칙 CMS 설정 (2026-10-04, CRITICAL — 결제 금액)
--
-- 배경: 포인트 사용 한도가 "보유 포인트와 결제금액 중 작은 값"이라는 암묵 규칙뿐이었고, 그마저 장바구니·계약서
--   화면에만 있어 서버(주문 생성/결제 확정/차감)는 검증하지 않았다. 관리자가 조정할 수 있는 규칙을 CMS 설정으로
--   만들고 서버가 이 값으로 강제한다(규칙 적용은 Migration #640).
-- 규칙(Stephen 확정): ① 사용 ON/OFF ② 최소 사용 포인트 ③ 사용 단위 ④ 주문당 최대 사용 비율(결제금액 대비 %).
--   기본값 = 현재 동작(사용 ON · 최소 0 · 단위 1 · 비율 100%) → 적용 직후 동작 변화 없음.
--
-- ROLLBACK (필요 시 수동 실행):
--   DROP FUNCTION IF EXISTS public.normalize_point_use(uuid, integer, numeric);
--   DROP FUNCTION IF EXISTS public.upsert_point_use_settings(boolean, integer, integer, integer);
--   DROP FUNCTION IF EXISTS public.get_point_use_settings();
--   DROP TABLE IF EXISTS public.point_use_settings;

-- ─── 1. point_use_settings 테이블 (싱글톤 1행) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.point_use_settings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  use_enabled      BOOLEAN NOT NULL DEFAULT TRUE,                 -- 포인트 사용 허용
  min_use_points   INTEGER NOT NULL DEFAULT 0   CHECK (min_use_points >= 0),
  use_unit         INTEGER NOT NULL DEFAULT 1   CHECK (use_unit >= 1),
  max_use_ratio    INTEGER NOT NULL DEFAULT 100 CHECK (max_use_ratio BETWEEN 0 AND 100),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.point_use_settings ENABLE ROW LEVEL SECURITY;

-- 공개 조회(장바구니·계약서 화면이 규칙을 읽어 입력 제한을 표시)
CREATE POLICY "point_use_settings: 공개 조회"
  ON public.point_use_settings FOR SELECT
  USING (true);

-- CMS 관리자 전체 액세스
CREATE POLICY "point_use_settings: cms 관리"
  ON public.point_use_settings FOR ALL
  USING (is_cms_user())
  WITH CHECK (is_cms_user());

INSERT INTO public.point_use_settings (use_enabled, min_use_points, use_unit, max_use_ratio)
SELECT TRUE, 0, 1, 100
WHERE NOT EXISTS (SELECT 1 FROM public.point_use_settings);

-- ─── 2. get_point_use_settings (공개 읽기) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_point_use_settings()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.point_use_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.point_use_settings LIMIT 1;
  RETURN jsonb_build_object(
    'use_enabled',    COALESCE(v_row.use_enabled, TRUE),
    'min_use_points', COALESCE(v_row.min_use_points, 0),
    'use_unit',       COALESCE(v_row.use_unit, 1),
    'max_use_ratio',  COALESCE(v_row.max_use_ratio, 100)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_point_use_settings() TO anon, authenticated, service_role;

-- ─── 3. upsert_point_use_settings (CMS 저장 — manager 이상은 앱 서버에서 게이트, DB는 CMS 직원만) ──
CREATE OR REPLACE FUNCTION public.upsert_point_use_settings(
  p_use_enabled    BOOLEAN DEFAULT NULL,
  p_min_use_points INTEGER DEFAULT NULL,
  p_use_unit       INTEGER DEFAULT NULL,
  p_max_use_ratio  INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT is_cms_user() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT id INTO v_id FROM public.point_use_settings LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.point_use_settings (use_enabled, min_use_points, use_unit, max_use_ratio)
    VALUES (COALESCE(p_use_enabled, TRUE), COALESCE(p_min_use_points, 0), COALESCE(p_use_unit, 1), COALESCE(p_max_use_ratio, 100));
  ELSE
    UPDATE public.point_use_settings
    SET use_enabled    = COALESCE(p_use_enabled, use_enabled),
        min_use_points = COALESCE(p_min_use_points, min_use_points),
        use_unit       = COALESCE(p_use_unit, use_unit),
        max_use_ratio  = COALESCE(p_max_use_ratio, max_use_ratio),
        updated_at     = NOW()
    WHERE id = v_id;
  END IF;

  RETURN public.get_point_use_settings();
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_point_use_settings(BOOLEAN, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_point_use_settings(BOOLEAN, INTEGER, INTEGER, INTEGER) TO authenticated, service_role;

-- ─── 4. normalize_point_use — 포인트 사용 규칙의 서버 단일 정본 ───────────────────
-- 입력: 사용자, 요청 포인트, "포인트 적용 전 결제금액"(할인·쿠폰 반영 후, 배송비 포함).
-- 순서: OFF면 0 → 보유 포인트·결제금액 상한 → 최대 비율 상한 → 사용 단위 내림 → 최소 사용 포인트 미만이면 0.
-- 화면 유틸 src/lib/utils/pointUseRules.ts 가 같은 순서를 따른다(두 곳을 항상 함께 바꿀 것).
CREATE OR REPLACE FUNCTION public.normalize_point_use(
  p_user_id UUID,
  p_requested INTEGER,
  p_payable NUMERIC
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s       public.point_use_settings%ROWTYPE;
  v_bal   INTEGER;
  v_cap   INTEGER;
  v_pay   INTEGER;
BEGIN
  SELECT * INTO s FROM public.point_use_settings LIMIT 1;

  IF NOT COALESCE(s.use_enabled, TRUE) THEN
    RETURN 0;
  END IF;

  v_cap := GREATEST(0, COALESCE(p_requested, 0));
  IF v_cap = 0 THEN RETURN 0; END IF;

  SELECT COALESCE(points, 0) INTO v_bal FROM public.user_profiles WHERE id = p_user_id;
  v_bal := COALESCE(v_bal, 0);
  v_pay := GREATEST(0, FLOOR(COALESCE(p_payable, 0)))::INTEGER;

  v_cap := LEAST(v_cap, v_bal, v_pay);

  IF COALESCE(s.max_use_ratio, 100) < 100 THEN
    v_cap := LEAST(v_cap, FLOOR(v_pay * COALESCE(s.max_use_ratio, 100) / 100.0)::INTEGER);
  END IF;

  IF COALESCE(s.use_unit, 1) > 1 THEN
    v_cap := (v_cap / s.use_unit) * s.use_unit;
  END IF;

  IF v_cap < COALESCE(s.min_use_points, 0) THEN
    RETURN 0;
  END IF;

  RETURN v_cap;
END;
$$;

-- 서버(주문 생성/동기화 함수, service_role)에서만 호출한다 — 고객이 임의 사용자 잔액을 조회하지 못하게 막는다
REVOKE ALL ON FUNCTION public.normalize_point_use(UUID, INTEGER, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_point_use(UUID, INTEGER, NUMERIC) TO service_role;
