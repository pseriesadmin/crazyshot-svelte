-- #783 수령일 신청 마감 안내문구의 "당일" 정형 인식 (방문 수령 당일 예약, 2026-10-30 Stephen 확정)
-- 배경: CMS 안내문구 "당일 예약은 오후 6시까지"가 정형 규칙("N일 전 …")이 아니라 해석되지 않아 기본값(1일 전 19시)이 적용되고,
--       그 결과 화면 달력·서버 검증(assert_reservation_lead_and_period)이 당일 수령을 막고 있었다.
-- 변경: parse_lead_rule_text 만 CREATE OR REPLACE — "N일 전"이 없고 "당일 … (오전|오후) H시 까지|마감"(또는 "당일 … HH:MM 까지|마감")이면 0일 전·그 시각으로 읽는다.
--       "N일 전" 문구는 기존과 완전히 같은 경로(앞부분 그대로)라 택배·무인보관함 규칙은 불변.
--       시각 바로 뒤에 '까지|마감'이 없는 문구(퀵 "당일 오후 12시부터 …")는 해석하지 않아 기본값 유지.
--       get_pickup_lead_rule · assert_reservation_lead_and_period 는 건드리지 않는다(654 에서 이미 수정된 정의 보존) — 이 함수를 그대로 부른다.
-- 화면 쪽 같은 규칙: src/lib/utils/pickupLeadTime.ts parseLeadRuleText (두 곳은 항상 같이 고친다).
-- 롤백: 20260930050000_588_server_pickup_lead_and_period_guard.sql 의 parse_lead_rule_text 정의로 CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.parse_lead_rule_text(p_text text)
RETURNS TABLE(lead_days integer, cutoff_hour integer)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_m    text[];
  v_days integer;
  v_h    integer;
  v_hour integer := NULL;
BEGIN
  IF p_text IS NULL THEN RETURN; END IF;

  v_m := regexp_match(p_text, '(\d+)\s*일\s*전');
  IF v_m IS NULL THEN
    -- "당일" 정형 — 0일 전. 시각 바로 뒤에 까지|마감 이 붙은 경우만(당일~시각 사이는 숫자 없는 12글자 이내)
    v_m := regexp_match(p_text, '당일[^0-9]{0,12}(오전|오후)\s*(\d{1,2})\s*시\s*(?:까지|마감)');
    IF v_m IS NOT NULL THEN
      v_h := v_m[2]::integer;
      IF v_h BETWEEN 0 AND 12 THEN
        v_hour := CASE
          WHEN v_m[1] = '오후' THEN (CASE WHEN v_h = 12 THEN 12 ELSE v_h + 12 END)
          ELSE (CASE WHEN v_h = 12 THEN 0 ELSE v_h END)
        END;
      END IF;
    ELSE
      v_m := regexp_match(p_text, '당일[^0-9]{0,12}(\d{1,2})\s*:\s*\d{2}\s*(?:까지|마감)');
      IF v_m IS NOT NULL THEN
        v_h := v_m[1]::integer;
        IF v_h BETWEEN 0 AND 23 THEN v_hour := v_h; END IF;
      END IF;
    END IF;

    IF v_hour IS NULL THEN RETURN; END IF;
    lead_days := 0;
    cutoff_hour := v_hour;
    RETURN NEXT;
    RETURN;
  END IF;

  v_days := v_m[1]::integer;

  v_m := regexp_match(p_text, '(오전|오후)\s*(\d{1,2})\s*시');
  IF v_m IS NOT NULL THEN
    v_h := v_m[2]::integer;
    IF v_h BETWEEN 0 AND 12 THEN
      v_hour := CASE
        WHEN v_m[1] = '오후' THEN (CASE WHEN v_h = 12 THEN 12 ELSE v_h + 12 END)
        ELSE (CASE WHEN v_h = 12 THEN 0 ELSE v_h END)
      END;
    END IF;
  ELSE
    v_m := regexp_match(p_text, '(\d{1,2})\s*:\s*\d{2}');
    IF v_m IS NOT NULL THEN
      v_h := v_m[1]::integer;
      IF v_h BETWEEN 0 AND 23 THEN v_hour := v_h; END IF;
    END IF;
  END IF;

  IF v_hour IS NULL THEN RETURN; END IF;
  lead_days := v_days;
  cutoff_hour := v_hour;
  RETURN NEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$$;
