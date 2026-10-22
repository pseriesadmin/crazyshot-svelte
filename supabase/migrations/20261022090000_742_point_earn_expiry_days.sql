-- Migration 742 — 포인트 '자동 소멸 기한'(적립일로부터 N일) 전역 설정 (2026-10-22, CRITICAL — 포인트)
--
-- 배경: 소멸 로직(point_transactions.expires_at · expire_due_points · 크론 /api/cron/point-expiry, Migration #538~540)은 이미 있으나
--   구독 혜택 적립(award_subscription_points / award_rental_complete_points 의 sub_bonus 행)에만 expires_at 이 채워지고,
--   생일·정시반납·렌탈완료·반납등록 미션·리뷰 등 일반 적립은 expires_at=NULL(영구 유효)이었다.
--
-- 설계(Stephen 확정: "적립일로부터 OOO일" 형식, CMS 포인트 → 사용 규칙에서 설정):
--   ① point_use_settings.expiry_days (0 = 소멸 없음, 기본 0 → 이 마이그레이션만으로는 동작 변화 없음)
--   ② point_transactions BEFORE INSERT 트리거: type='earn' 이고 expires_at 이 비어 있으면
--        expires_at = (적립일 KST 자정 + N일)의 23:59:59 KST  (예: 10/22 적립·30일 → 11/21 23:59:59 KST 까지 사용, 이후 소멸)
--      → 적립 함수 8곳(생일·정시반납·렌탈완료·반납등록 미션·리뷰·구독 등)의 본문은 수정하지 않는다(함수 본문 드리프트 위험 회피, 앞으로 생길 적립 경로도 자동 적용).
--   ③ 적용 범위: 신규 적립분부터. 기존 적립분은 소급하지 않는다(설정을 바꿔도 이미 쌓인 expires_at 은 그대로).
--      구독 혜택 적립은 자기 expires_at(구독상품별 points_expiry_days)이 이미 있으므로 트리거가 덮어쓰지 않는다.
--      관리자 직접 지급(admin_grant)·차감·환급(refund)은 type 이 earn 이 아니라 대상 아님(expire_due_points 도 earn 만 만료 처리).
--   ④ 실제 소멸 처리는 기존 크론이 매일 1회(UTC 01:00) FIFO 로 수행 — 이 마이그레이션은 크론·expire_due_points 를 건드리지 않는다.
--
-- 설정 함수: get_point_use_settings 에 expiry_days 키 추가(기존 권한 유지). upsert_point_use_settings 는 인자가 늘어나므로
--   PostgREST 오버로드 모호성(PGRST203)을 피하려고 기존 4인자 함수를 DROP 하고 5인자로 재생성, service_role 전용(#641 정책 유지).
--
-- ROLLBACK(참고용):
--   DROP TRIGGER IF EXISTS trg_point_earn_expiry ON public.point_transactions;
--   DROP FUNCTION IF EXISTS public.apply_point_earn_expiry();
--   DROP FUNCTION IF EXISTS public.upsert_point_use_settings(BOOLEAN, INTEGER, INTEGER, INTEGER, INTEGER);
--   upsert_point_use_settings 4인자 정의를 Migration #641 본문으로 재생성(+ REVOKE/GRANT service_role 전용), get_point_use_settings 는 #639 본문으로 복원
--   ALTER TABLE public.point_use_settings DROP COLUMN IF EXISTS expiry_days;

ALTER TABLE public.point_use_settings
  ADD COLUMN IF NOT EXISTS expiry_days INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'point_use_settings_expiry_days_range'
       AND conrelid = 'public.point_use_settings'::regclass
  ) THEN
    ALTER TABLE public.point_use_settings
      ADD CONSTRAINT point_use_settings_expiry_days_range CHECK (expiry_days BETWEEN 0 AND 3650);
  END IF;
END $$;

COMMENT ON COLUMN public.point_use_settings.expiry_days IS
  '포인트 자동 소멸 기한(적립일로부터 N일). 0 = 소멸 없음. 신규 적립(type=earn, expires_at 비어 있는 건)부터 적용 — trg_point_earn_expiry.';

CREATE OR REPLACE FUNCTION public.get_point_use_settings()
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.point_use_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.point_use_settings LIMIT 1;
  RETURN jsonb_build_object(
    'use_enabled',    COALESCE(v_row.use_enabled, TRUE),
    'min_use_points', COALESCE(v_row.min_use_points, 0),
    'use_unit',       COALESCE(v_row.use_unit, 1),
    'max_use_ratio',  COALESCE(v_row.max_use_ratio, 100),
    'expiry_days',    COALESCE(v_row.expiry_days, 0)
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.upsert_point_use_settings(BOOLEAN, INTEGER, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.upsert_point_use_settings(
  p_use_enabled    BOOLEAN DEFAULT NULL,
  p_min_use_points INTEGER DEFAULT NULL,
  p_use_unit       INTEGER DEFAULT NULL,
  p_max_use_ratio  INTEGER DEFAULT NULL,
  p_expiry_days    INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.point_use_settings LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.point_use_settings (use_enabled, min_use_points, use_unit, max_use_ratio, expiry_days)
    VALUES (COALESCE(p_use_enabled, TRUE), COALESCE(p_min_use_points, 0), COALESCE(p_use_unit, 1), COALESCE(p_max_use_ratio, 100), COALESCE(p_expiry_days, 0));
  ELSE
    UPDATE public.point_use_settings
       SET use_enabled    = COALESCE(p_use_enabled, use_enabled),
           min_use_points = COALESCE(p_min_use_points, min_use_points),
           use_unit       = COALESCE(p_use_unit, use_unit),
           max_use_ratio  = COALESCE(p_max_use_ratio, max_use_ratio),
           expiry_days    = COALESCE(p_expiry_days, expiry_days),
           updated_at     = NOW()
     WHERE id = v_id;
  END IF;

  RETURN public.get_point_use_settings();
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_point_use_settings(BOOLEAN, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_point_use_settings(BOOLEAN, INTEGER, INTEGER, INTEGER, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_point_use_settings(BOOLEAN, INTEGER, INTEGER, INTEGER, INTEGER) TO service_role;

-- 적립 시점에 만료일을 채우는 트리거 — 설정(expiry_days)이 0이거나 행이 없으면 아무것도 하지 않는다
CREATE OR REPLACE FUNCTION public.apply_point_earn_expiry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER;
  v_base TIMESTAMPTZ;
BEGIN
  IF NEW.type = 'earn' AND NEW.expires_at IS NULL THEN
    SELECT expiry_days INTO v_days FROM public.point_use_settings LIMIT 1;
    IF COALESCE(v_days, 0) > 0 THEN
      v_base := COALESCE(NEW.created_at, now());
      -- 적립일(KST) 0시 + N일 + 1일 - 1초 = N일째 23:59:59 KST
      NEW.expires_at := (
        date_trunc('day', v_base AT TIME ZONE 'Asia/Seoul') + make_interval(days => v_days + 1) - interval '1 second'
      ) AT TIME ZONE 'Asia/Seoul';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_point_earn_expiry() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_point_earn_expiry ON public.point_transactions;
CREATE TRIGGER trg_point_earn_expiry
  BEFORE INSERT ON public.point_transactions
  FOR EACH ROW EXECUTE FUNCTION public.apply_point_earn_expiry();
