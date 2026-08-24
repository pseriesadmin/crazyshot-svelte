-- Migration #337: sync_national_holidays 재설계 — 명시적 동기화 범위 파라미터 +
-- PUBLIC EXECUTE 권한 회수(보안 결함 수정)
--
-- TDD(deliveryCutoffHolidays.test.ts) RED로 발견된 결함 2건:
--
-- ① 대체공휴일 정정 감지 범위를 p_holidays 배치 자체의 MIN/MAX 날짜로 추론했는데, 이는
--    입력 배치가 우연히 좁아지면(예: 특정 달만 재동기화) 그 범위 밖의 기존 national 행은
--    실제로 목록에서 빠졌어도 비활성화되지 않는 결함으로 이어진다. holidaySync.ts는 항상
--    "올해 1/1 ~ 내년 12/31" 전체를 동기화 대상으로 삼으므로, 그 의도한 범위를 호출부가
--    명시적으로 전달하도록 변경 — 배치 크기와 무관하게 항상 올바른 범위에서 정정 감지.
--
-- ② Postgres는 CREATE FUNCTION 시 기본적으로 PUBLIC(모든 role)에 EXECUTE 권한을 부여한다.
--    #335는 `GRANT ... TO service_role`만 추가했을 뿐 PUBLIC 기본권한을 회수(REVOKE)하지
--    않아, anon·authenticated 세션도 이 함수를 실제로 호출할 수 있는 상태였다(라이브
--    테스트로 직접 재현·확인됨). REVOKE ALL FROM PUBLIC을 명시해야만 GRANT TO service_role
--    이 의도한 대로 "service_role 전용"이 된다.

DROP FUNCTION IF EXISTS public.sync_national_holidays(JSONB);

CREATE OR REPLACE FUNCTION public.sync_national_holidays(
  p_holidays JSONB,
  p_range_start DATE,
  p_range_end DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_upserted INTEGER := 0;
BEGIN
  IF p_holidays IS NULL OR jsonb_array_length(p_holidays) = 0 THEN
    RETURN jsonb_build_object('upserted', 0);
  END IF;

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

  -- 대체공휴일 정정 등으로 더 이상 API 응답에 없는 national 행 비활성화 — 호출부가 명시한
  -- 동기화 의도 범위(p_range_start~p_range_end) 기준, manual 행은 holiday_type='national'
  -- 조건으로 절대 미접촉
  UPDATE public_holidays
  SET is_active = false, updated_at = now()
  WHERE holiday_type = 'national'
    AND is_active = true
    AND date BETWEEN p_range_start AND p_range_end
    AND date NOT IN (SELECT (h->>'date')::DATE FROM jsonb_array_elements(p_holidays) AS h);

  RETURN jsonb_build_object('upserted', v_upserted, 'range_start', p_range_start, 'range_end', p_range_end);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_national_holidays(JSONB, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_national_holidays(JSONB, DATE, DATE) TO service_role;

-- 같은 PUBLIC 기본권한 문제가 #335의 나머지 3개 RPC에도 동일하게 있었다(is_cms_user()
-- 내부 체크가 실질적 방어선이라 기능적 구멍은 아니지만, DB 권한 자체도 명시적으로 좁혀
-- 이중 방어를 갖춘다 — defense-in-depth).
REVOKE ALL ON FUNCTION public.upsert_delivery_cutoff_settings(BOOLEAN, BOOLEAN, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_delivery_cutoff_settings(BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_manual_holiday(UUID, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_manual_holiday(UUID, DATE, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_manual_holiday(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_manual_holiday(UUID) TO authenticated;
