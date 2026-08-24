-- Migration #335: 택배 휴무일 캘린더 제어 — RPC 4종
--
-- H-01(직접 DML 금지, RPC 경유) 준수. sync_national_holidays만 is_cms_user() 게이트가 없다 —
-- 호출부(Vercel Cron 라우트의 CRON_SECRET 검증, 또는 CMS 수동동기화 액션의
-- getCmsRoleForAction manager+ 게이트)가 이미 앱 레이어에서 인증을 마친 뒤 service_role
-- 클라이언트로만 호출하는 신뢰 경계 구조이기 때문(claim_reservations_due_for_locker_guide와
-- 동일 패턴) — 그래서 EXECUTE 권한도 service_role 전용으로 제한한다(authenticated 미부여).

CREATE OR REPLACE FUNCTION public.sync_national_holidays(p_holidays JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_date DATE;
  v_max_date DATE;
  v_upserted INTEGER := 0;
BEGIN
  IF p_holidays IS NULL OR jsonb_array_length(p_holidays) = 0 THEN
    RETURN jsonb_build_object('upserted', 0);
  END IF;

  SELECT MIN((h->>'date')::DATE), MAX((h->>'date')::DATE)
  INTO v_min_date, v_max_date
  FROM jsonb_array_elements(p_holidays) AS h;

  -- national 행만 upsert — 같은 날짜에 manual 행이 이미 있으면 WHERE 절로 갱신을 건너뜀
  -- (관리자가 직접 등록한 임시휴무일을 API 동기화가 덮어쓰지 않도록 보호)
  INSERT INTO public_holidays (date, name, country, holiday_type, is_active)
  SELECT (h->>'date')::DATE, h->>'name', 'KR', 'national', true
  FROM jsonb_array_elements(p_holidays) AS h
  ON CONFLICT (date, country) DO UPDATE SET
    name       = EXCLUDED.name,
    is_active  = true,
    updated_at = now()
  WHERE public_holidays.holiday_type = 'national';

  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  -- 대체공휴일 정정 등으로 더 이상 API 응답에 없는 national 행 비활성화(입력 범위 내에서만,
  -- manual 행은 이 UPDATE의 WHERE holiday_type='national' 조건으로 절대 미접촉)
  UPDATE public_holidays
  SET is_active = false, updated_at = now()
  WHERE holiday_type = 'national'
    AND is_active = true
    AND date BETWEEN v_min_date AND v_max_date
    AND date NOT IN (SELECT (h->>'date')::DATE FROM jsonb_array_elements(p_holidays) AS h);

  RETURN jsonb_build_object('upserted', v_upserted, 'range_start', v_min_date, 'range_end', v_max_date);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_national_holidays TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_delivery_cutoff_settings(
  p_enable_prev_day_check  BOOLEAN,
  p_enable_fixed_holidays  BOOLEAN,
  p_enable_manual_holidays BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row delivery_cutoff_settings;
BEGIN
  IF NOT is_cms_user() THEN
    RAISE EXCEPTION 'CMS 권한이 필요합니다.';
  END IF;

  UPDATE delivery_cutoff_settings SET
    enable_prev_day_check  = p_enable_prev_day_check,
    enable_fixed_holidays  = p_enable_fixed_holidays,
    enable_manual_holidays = p_enable_manual_holidays,
    updated_at = now()
  WHERE true
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_delivery_cutoff_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_manual_holiday(
  p_id   UUID,
  p_date DATE,
  p_note TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public_holidays;
BEGIN
  IF NOT is_cms_user() THEN
    RAISE EXCEPTION 'CMS 권한이 필요합니다.';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public_holidays
    SET date = p_date, note = p_note, updated_at = now()
    WHERE id = p_id AND holiday_type = 'manual'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION '수정할 임시휴무일을 찾을 수 없습니다.';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public_holidays
      WHERE date = p_date AND country = 'KR' AND holiday_type = 'national'
    ) THEN
      RAISE EXCEPTION '이미 법정공휴일로 등록된 날짜입니다.';
    END IF;

    INSERT INTO public_holidays (date, name, country, holiday_type, note, is_active)
    VALUES (p_date, COALESCE(NULLIF(p_note, ''), '임시휴무일'), 'KR', 'manual', p_note, true)
    ON CONFLICT (date, country) DO UPDATE SET
      note       = EXCLUDED.note,
      is_active  = true,
      updated_at = now()
    WHERE public_holidays.holiday_type = 'manual'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION '이미 법정공휴일로 등록된 날짜입니다.';
    END IF;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_manual_holiday TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_manual_holiday(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF NOT is_cms_user() THEN
    RAISE EXCEPTION 'CMS 권한이 필요합니다.';
  END IF;

  DELETE FROM public_holidays WHERE id = p_id AND holiday_type = 'manual';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RAISE EXCEPTION '삭제할 임시휴무일을 찾을 수 없습니다(법정공휴일은 이 기능으로 삭제할 수 없습니다).';
  END IF;

  RETURN jsonb_build_object('deleted', v_deleted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_manual_holiday TO authenticated;
