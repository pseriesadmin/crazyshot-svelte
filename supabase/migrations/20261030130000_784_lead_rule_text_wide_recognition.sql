-- #784 수령일 신청 마감 안내문구 인식 범위 확장 (2026-10-30 Stephen 지시: "숫자·한글 텍스트 인지율을 높일 것")
-- 변경: parse_lead_rule_text 만 CREATE OR REPLACE (시그니처·권한 불변). get_pickup_lead_rule · assert_reservation_lead_and_period 는 건드리지 않는다.
-- 새로 읽는 표기(TS src/lib/utils/pickupLeadTime.ts parseLeadRuleText 와 항상 같은 규칙 — 한쪽만 고치지 말 것):
--   · 날짜: "N일 전/N일전/N일 이전", 하루 전·전날·전일(=1일), 이틀 전(2)·사흘 전(3)·나흘 전(4), D-N, 전각 숫자(１９：００)
--   · 시각: 오전·오후 H시 / 오전·오후 H:MM(예전엔 "오후 7:00"을 오전 7시로 잘못 읽음) / 7pm·6:30pm / HH:MM(24시간) / 13~23시("19시") /
--           저녁·낮(=오후) · 아침·새벽(=오전) · 정오(=오후 12시) · 밤(=오후, 단 "밤 12시"는 해석 안 함) / "오후 일곱 시" 같은 한글 시각(오전·오후 등 바로 뒤 열두~한)
--   · 분은 버린다(오후 6시 30분 → 18시 = 더 이른 쪽, 안전). 오전·오후 없는 1~12시("7시")는 모호해서 해석하지 않는다.
--   · 당일: "당일|오늘|같은 날" + 시각(시·분 허용) + 까지|마감|이전. 끝맺음이 없으면(퀵 "12시부터") 읽지 않는다.
-- 롤백: 20261030120000_783_same_day_lead_rule_text.sql 의 parse_lead_rule_text 정의로 CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.parse_lead_rule_text(p_text text)
RETURNS TABLE(lead_days integer, cutoff_hour integer)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  t      text;
  v_m    text[];
  v_days integer;
  v_h    integer;
  v_mer  text;
  v_hour integer := NULL;
  v_i    integer;
  v_words text[]   := ARRAY['열두','열한','열','아홉','여덟','일곱','여섯','다섯','네','세','두','한'];
  v_nums  integer[] := ARRAY[12,11,10,9,8,7,6,5,4,3,2,1];
  v_pfx  text := '(?:당일|오늘|같은\s*날)[^0-9]{0,12}';
  v_tail text := '(?:\s*[0-9]{1,2}\s*분)?\s*(?:까지|마감|이전)';
BEGIN
  IF p_text IS NULL THEN RETURN; END IF;

  -- 정규화(TS normalizeLeadText 와 같은 순서)
  t := translate(p_text, '０１２３４５６７８９：', '0123456789:');
  t := replace(t, '정오', '오후 12시');
  t := regexp_replace(t, '(?:하루\s*전|전날|전일)', '1일 전', 'g');
  t := regexp_replace(t, '이틀\s*전', '2일 전', 'g');
  t := regexp_replace(t, '사흘\s*전', '3일 전', 'g');
  t := regexp_replace(t, '나흘\s*전', '4일 전', 'g');
  t := regexp_replace(t, '(^|[^A-Za-z])[dD]\s*-\s*([0-9]+)', '\1\2일 전', 'g');
  FOR v_i IN 1..array_length(v_words, 1) LOOP
    t := regexp_replace(t, '(오전|오후|저녁|밤|낮|아침|새벽)\s*' || v_words[v_i] || '\s*시(?!간)', '\1 ' || v_nums[v_i]::text || '시', 'g');
  END LOOP;
  t := regexp_replace(t, '(저녁|낮)(?=\s*[0-9])', '오후', 'g');
  t := regexp_replace(t, '(아침|새벽)(?=\s*[0-9])', '오전', 'g');
  t := regexp_replace(t, '밤(\s*12\s*시)', '자정\1', 'g');
  t := regexp_replace(t, '밤(?=\s*[0-9])', '오후', 'g');

  v_m := regexp_match(t, '([0-9]+)\s*일\s*(?:전|이전)');
  IF v_m IS NULL THEN
    -- "당일" 정형 — 0일 전. 시각 바로 뒤(시·분 허용)에 까지|마감|이전 이 붙은 경우만
    v_m := regexp_match(t, v_pfx || '(오전|오후)\s*([0-9]{1,2})\s*시' || v_tail);
    IF v_m IS NOT NULL THEN
      v_mer := v_m[1]; v_h := v_m[2]::integer;
      IF v_h BETWEEN 0 AND 12 THEN
        v_hour := CASE WHEN v_mer = '오후' THEN (CASE WHEN v_h = 12 THEN 12 ELSE v_h + 12 END) ELSE (CASE WHEN v_h = 12 THEN 0 ELSE v_h END) END;
      END IF;
    ELSE
      v_m := regexp_match(t, v_pfx || '(오전|오후)\s*([0-9]{1,2})\s*:\s*[0-9]{2}' || v_tail);
      IF v_m IS NOT NULL THEN
        v_mer := v_m[1]; v_h := v_m[2]::integer;
        IF v_h BETWEEN 0 AND 12 THEN
          v_hour := CASE WHEN v_mer = '오후' THEN (CASE WHEN v_h = 12 THEN 12 ELSE v_h + 12 END) ELSE (CASE WHEN v_h = 12 THEN 0 ELSE v_h END) END;
        END IF;
      ELSE
        v_m := regexp_match(t, v_pfx || '([0-9]{1,2})(?:\s*:\s*[0-9]{2})?\s*([apAP])[mM](?![a-zA-Z])' || v_tail);
        IF v_m IS NOT NULL THEN
          v_mer := CASE WHEN lower(v_m[2]) = 'p' THEN '오후' ELSE '오전' END; v_h := v_m[1]::integer;
          IF v_h BETWEEN 0 AND 12 THEN
            v_hour := CASE WHEN v_mer = '오후' THEN (CASE WHEN v_h = 12 THEN 12 ELSE v_h + 12 END) ELSE (CASE WHEN v_h = 12 THEN 0 ELSE v_h END) END;
          END IF;
        ELSE
          v_m := regexp_match(t, v_pfx || '([0-9]{1,2})\s*:\s*[0-9]{2}' || v_tail);
          IF v_m IS NOT NULL THEN
            v_h := v_m[1]::integer;
            IF v_h BETWEEN 0 AND 23 THEN v_hour := v_h; END IF;
          ELSE
            v_m := regexp_match(t, v_pfx || '([0-9]{1,2})\s*시(?!간)' || v_tail);
            IF v_m IS NOT NULL THEN
              v_h := v_m[1]::integer;
              IF v_h BETWEEN 13 AND 23 THEN v_hour := v_h; END IF;
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;

    IF v_hour IS NULL THEN RETURN; END IF;
    lead_days := 0;
    cutoff_hour := v_hour;
    RETURN NEXT;
    RETURN;
  END IF;

  v_days := v_m[1]::integer;

  -- 시각 1개 읽기(TS readHour 와 같은 우선순위)
  v_m := regexp_match(t, '(오전|오후)\s*([0-9]{1,2})\s*시');
  IF v_m IS NOT NULL THEN
    v_mer := v_m[1]; v_h := v_m[2]::integer;
    IF v_h BETWEEN 0 AND 12 THEN
      v_hour := CASE WHEN v_mer = '오후' THEN (CASE WHEN v_h = 12 THEN 12 ELSE v_h + 12 END) ELSE (CASE WHEN v_h = 12 THEN 0 ELSE v_h END) END;
    END IF;
  ELSE
    v_m := regexp_match(t, '(오전|오후)\s*([0-9]{1,2})\s*:\s*[0-9]{2}');
    IF v_m IS NOT NULL THEN
      v_mer := v_m[1]; v_h := v_m[2]::integer;
      IF v_h BETWEEN 0 AND 12 THEN
        v_hour := CASE WHEN v_mer = '오후' THEN (CASE WHEN v_h = 12 THEN 12 ELSE v_h + 12 END) ELSE (CASE WHEN v_h = 12 THEN 0 ELSE v_h END) END;
      END IF;
    ELSE
      v_m := regexp_match(t, '([0-9]{1,2})(?:\s*:\s*[0-9]{2})?\s*([apAP])[mM](?![a-zA-Z])');
      IF v_m IS NOT NULL THEN
        v_mer := CASE WHEN lower(v_m[2]) = 'p' THEN '오후' ELSE '오전' END; v_h := v_m[1]::integer;
        IF v_h BETWEEN 0 AND 12 THEN
          v_hour := CASE WHEN v_mer = '오후' THEN (CASE WHEN v_h = 12 THEN 12 ELSE v_h + 12 END) ELSE (CASE WHEN v_h = 12 THEN 0 ELSE v_h END) END;
        END IF;
      ELSE
        v_m := regexp_match(t, '([0-9]{1,2})\s*:\s*[0-9]{2}');
        IF v_m IS NOT NULL THEN
          v_h := v_m[1]::integer;
          IF v_h BETWEEN 0 AND 23 THEN v_hour := v_h; END IF;
        ELSE
          v_m := regexp_match(t, '([0-9]{1,2})\s*시(?!간)');
          IF v_m IS NOT NULL THEN
            v_h := v_m[1]::integer;
            IF v_h BETWEEN 13 AND 23 THEN v_hour := v_h; END IF;
          END IF;
        END IF;
      END IF;
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
