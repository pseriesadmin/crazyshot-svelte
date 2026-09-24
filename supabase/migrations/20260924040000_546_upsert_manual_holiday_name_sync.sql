-- Migration #546: upsert_manual_holiday — 임시 휴무일 수정 시 name이 갱신되지 않던 결함 수정
--
-- 배경(2026-09-24, CMS 달력 더블클릭 편집 레이어 도입 후 sp3-qa-agent 재검수 M-1 잔존 지적):
-- 임시 휴무일의 표시명은 등록 시점에 name = COALESCE(NULLIF(p_note,''),'임시휴무일')로 채워지지만,
-- 기존 UPDATE 분기(Migration #335)는 date·note만 바꾸고 name은 그대로 둬서, 사유를 수정하면
--   · CMS 달력/목록: note 기준이라 새 사유가 보임
--   · 장바구니 휴무일 사유(loadCourierClosedDates가 name을 select): 최초 등록 시점 이름이 계속 보임
-- 으로 어긋났다(요금·휴무 판정엔 영향 없고 표시 문구만 불일치).
--
-- 수정: UPDATE 분기와 INSERT ... ON CONFLICT DO UPDATE 분기 둘 다 name을 등록 때와 동일한 규칙으로 함께 갱신.
--  (ON CONFLICT 경로 = 같은 날짜에 이미 있던 임시 휴무일을 "신규 등록"으로 다시 저장하는 경우 —
--   이때도 note만 바뀌고 name이 낡던 같은 결함)
-- 시그니처(uuid, date, text) 무변경 — CREATE OR REPLACE로 같은 함수 객체 교체. 권한은 #337과 동일하게 재적용.

CREATE OR REPLACE FUNCTION public.upsert_manual_holiday(p_id uuid, p_date date, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public_holidays;
BEGIN
  IF NOT is_cms_user() THEN
    RAISE EXCEPTION 'CMS 권한이 필요합니다.';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public_holidays
    SET date       = p_date,
        note       = p_note,
        name       = COALESCE(NULLIF(p_note, ''), '임시휴무일'),
        updated_at = now()
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
      name       = EXCLUDED.name,
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
$function$;

REVOKE ALL ON FUNCTION public.upsert_manual_holiday(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_manual_holiday(uuid, date, text) TO authenticated;

-- 기존 임시 휴무일 백필(멱등) — name이 note와 어긋난 행만 등록 규칙에 맞춰 정렬.
-- 적용 시점 실측: Stage·Production 모두 어긋난 행 0건(수정 기능 도입 이후 편집된 적 없음).
UPDATE public_holidays
SET name = COALESCE(NULLIF(note, ''), '임시휴무일'),
    updated_at = now()
WHERE holiday_type = 'manual'
  AND name IS DISTINCT FROM COALESCE(NULLIF(note, ''), '임시휴무일');

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration #335의 upsert_manual_holiday 정의(UPDATE가 name 미갱신)로 CREATE OR REPLACE 복원.
-- 백필은 데이터 정렬만 했으므로 되돌릴 필요 없음.
-- ============================================================
