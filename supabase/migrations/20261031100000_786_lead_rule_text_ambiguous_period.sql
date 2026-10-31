-- #786 밤·낮·아침 모호 시각 오독 보정 (2026-10-31, 독립 리뷰 지적 — Stephen 승인)
-- 변경: parse_lead_rule_text 만 CREATE OR REPLACE (시그니처·권한 불변). #784·#785 파일은 수정하지 않는다. TS src/lib/utils/pickupLeadTime.ts 와 항상 같은 규칙.
--   밤/낮/아침을 숫자 앞에서 무조건 오후/오전으로 바꾸던 탓에 12시간 어긋나게 읽던 조합을 해석하지 않는다(→ 기본 규칙 적용).
--   · 밤 1~5시(새벽?): 예전엔 오후 1~5시(13~17시)로 읽음  · 낮 6~11시(오전?): 예전엔 낮 11시를 23시로 읽음  · 아침 12시(낮?): 예전엔 0시로 읽음
--   그대로 읽는 것: 밤 6~11시(18~23시)·낮 12시(12)·낮 1~5시(13~17)·아침 1~11시·새벽·저녁. 시:분 표기(밤 3:30)와 한글 시각(밤 한 시)도 같다.
-- 롤백: 20261031090000_785_lead_rule_text_hardening.sql 의 parse_lead_rule_text 정의로 CREATE OR REPLACE.
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
  v_found boolean := false;
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
  -- 밤 1~5시·낮 6~11시·아침 12시는 12시간 어긋나게 읽힐 수 있어 해석 안 함(TS normalizeLeadText 와 같은 순서·같은 규칙) — 오전·오후 없는 시각으로 남겨 null 이 되게 한다
  t := regexp_replace(t, '밤(\s*[1-5]\s*시)', '모호\1', 'g');
  t := regexp_replace(t, '밤(\s*[1-5]\s*):', '모호\1시:', 'g');
  t := regexp_replace(t, '낮(\s*(?:1[01]|[6-9])\s*시)', '모호\1', 'g');
  t := regexp_replace(t, '낮(\s*(?:1[01]|[6-9])\s*):', '모호\1시:', 'g');
  t := regexp_replace(t, '아침(\s*12\s*시)', '모호\1', 'g');
  t := regexp_replace(t, '아침(\s*12\s*):', '모호\1시:', 'g');
  t := regexp_replace(t, '(저녁|낮)(?=\s*[0-9])', '오후', 'g');
  t := regexp_replace(t, '(아침|새벽)(?=\s*[0-9])', '오전', 'g');
  t := regexp_replace(t, '밤(\s*12\s*시)', '자정\1', 'g');
  t := regexp_replace(t, '밤(\s*12\s*):', '자정\1시:', 'g');
  t := regexp_replace(t, '밤(?=\s*[0-9])', '오후', 'g');

  v_m := regexp_match(t, '([0-9]+)\s*일\s*(?:전|이전)');
  IF v_m IS NULL THEN
    -- "당일" 정형 — 0일 전. 시각 바로 뒤(시·분 허용)에 까지|마감|이전 이 붙은 경우만. 먼저 맞는 형태가 시각을 못 읽으면 해석 안 함(다음 형태로 넘어가지 않음)
  v_m := regexp_match(t, v_pfx || '(오전|오후)\s*([0-9]{1,2})\s*시' || v_tail);
      IF v_m IS NOT NULL THEN
        v_found := true;
        v_h := v_m[2]::integer;
        v_mer := v_m[1];
        IF v_h BETWEEN 0 AND 12 THEN v_hour := CASE WHEN v_mer = '오후' THEN (CASE WHEN v_h = 12 THEN 12 ELSE v_h + 12 END) ELSE (CASE WHEN v_h = 12 THEN 0 ELSE v_h END) END; END IF;
      END IF;
    IF NOT v_found THEN
      v_m := regexp_match(t, v_pfx || '(오전|오후)\s*([0-9]{1,2})\s*:\s*[0-9]{2}' || v_tail);
      IF v_m IS NOT NULL THEN
        v_found := true;
        v_h := v_m[2]::integer;
        v_mer := v_m[1];
        IF v_h BETWEEN 0 AND 12 THEN v_hour := CASE WHEN v_mer = '오후' THEN (CASE WHEN v_h = 12 THEN 12 ELSE v_h + 12 END) ELSE (CASE WHEN v_h = 12 THEN 0 ELSE v_h END) END; END IF;
      END IF;
    END IF;
    IF NOT v_found THEN
      v_m := regexp_match(t, v_pfx || '([0-9]{1,2})(?:\s*:\s*[0-9]{2})?\s*([apAP])[mM](?![a-zA-Z])' || v_tail);
      IF v_m IS NOT NULL THEN
        v_found := true;
        v_h := v_m[1]::integer;
        v_mer := CASE WHEN lower(v_m[2]) = 'p' THEN '오후' ELSE '오전' END;
        IF v_h BETWEEN 0 AND 12 THEN v_hour := CASE WHEN v_mer = '오후' THEN (CASE WHEN v_h = 12 THEN 12 ELSE v_h + 12 END) ELSE (CASE WHEN v_h = 12 THEN 0 ELSE v_h END) END; END IF;
      END IF;
    END IF;
    IF NOT v_found THEN
      v_m := regexp_match(t, v_pfx || '([apAP])[mM]\s*([0-9]{1,2})(?:\s*:\s*[0-9]{2}|\s*시)?' || v_tail);
      IF v_m IS NOT NULL THEN
        v_found := true;
        v_h := v_m[2]::integer;
        v_mer := CASE WHEN lower(v_m[1]) = 'p' THEN '오후' ELSE '오전' END;
        IF v_h BETWEEN 0 AND 12 THEN v_hour := CASE WHEN v_mer = '오후' THEN (CASE WHEN v_h = 12 THEN 12 ELSE v_h + 12 END) ELSE (CASE WHEN v_h = 12 THEN 0 ELSE v_h END) END; END IF;
      END IF;
    END IF;
    IF NOT v_found THEN
      v_m := regexp_match(t, v_pfx || '([0-9]{1,2})\s*:\s*[0-9]{2}' || v_tail);
      IF v_m IS NOT NULL THEN
        v_found := true;
        v_h := v_m[1]::integer;
        IF v_h BETWEEN 0 AND 23 THEN v_hour := v_h; END IF;
      END IF;
    END IF;
    IF NOT v_found THEN
      v_m := regexp_match(t, v_pfx || '([0-9]{1,2})\s*시(?!간)' || v_tail);
      IF v_m IS NOT NULL THEN
        v_found := true;
        v_h := v_m[1]::integer;
        IF v_h BETWEEN 13 AND 23 THEN v_hour := v_h; END IF;
      END IF;
    END IF;

    IF v_hour IS NULL THEN RETURN; END IF;
    lead_days := 0;
    cutoff_hour := v_hour;
    RETURN NEXT;
    RETURN;
  END IF;

  -- 일수 상한 365(TS MAX_LEAD_DAYS) — 앞자리 0 을 뺀 자릿수가 3 초과이거나 365 초과면 해석 안 함
  IF length(ltrim(v_m[1], '0')) > 3 THEN RETURN; END IF;
  v_days := v_m[1]::integer;
  IF v_days > 365 THEN RETURN; END IF;

  -- 시각 1개 읽기(TS readHour 와 같은 우선순위)
  v_m := regexp_match(t, '(오전|오후)\s*([0-9]{1,2})\s*시');
    IF v_m IS NOT NULL THEN
      v_found := true;
      v_h := v_m[2]::integer;
      v_mer := v_m[1];
      IF v_h BETWEEN 0 AND 12 THEN v_hour := CASE WHEN v_mer = '오후' THEN (CASE WHEN v_h = 12 THEN 12 ELSE v_h + 12 END) ELSE (CASE WHEN v_h = 12 THEN 0 ELSE v_h END) END; END IF;
    END IF;
  IF NOT v_found THEN
    v_m := regexp_match(t, '(오전|오후)\s*([0-9]{1,2})\s*:\s*[0-9]{2}');
    IF v_m IS NOT NULL THEN
      v_found := true;
      v_h := v_m[2]::integer;
      v_mer := v_m[1];
      IF v_h BETWEEN 0 AND 12 THEN v_hour := CASE WHEN v_mer = '오후' THEN (CASE WHEN v_h = 12 THEN 12 ELSE v_h + 12 END) ELSE (CASE WHEN v_h = 12 THEN 0 ELSE v_h END) END; END IF;
    END IF;
  END IF;
  IF NOT v_found THEN
    v_m := regexp_match(t, '([0-9]{1,2})(?:\s*:\s*[0-9]{2})?\s*([apAP])[mM](?![a-zA-Z])');
    IF v_m IS NOT NULL THEN
      v_found := true;
      v_h := v_m[1]::integer;
      v_mer := CASE WHEN lower(v_m[2]) = 'p' THEN '오후' ELSE '오전' END;
      IF v_h BETWEEN 0 AND 12 THEN v_hour := CASE WHEN v_mer = '오후' THEN (CASE WHEN v_h = 12 THEN 12 ELSE v_h + 12 END) ELSE (CASE WHEN v_h = 12 THEN 0 ELSE v_h END) END; END IF;
    END IF;
  END IF;
  IF NOT v_found THEN
    v_m := regexp_match(t, '(^|[^A-Za-z])([apAP])[mM]\s*([0-9]{1,2})(?:\s*:\s*[0-9]{2})?(?![0-9])');
    IF v_m IS NOT NULL THEN
      v_found := true;
      v_h := v_m[3]::integer;
      v_mer := CASE WHEN lower(v_m[2]) = 'p' THEN '오후' ELSE '오전' END;
      IF v_h BETWEEN 0 AND 12 THEN v_hour := CASE WHEN v_mer = '오후' THEN (CASE WHEN v_h = 12 THEN 12 ELSE v_h + 12 END) ELSE (CASE WHEN v_h = 12 THEN 0 ELSE v_h END) END; END IF;
    END IF;
  END IF;
  IF NOT v_found THEN
    v_m := regexp_match(t, '([0-9]{1,2})\s*:\s*[0-9]{2}');
    IF v_m IS NOT NULL THEN
      v_found := true;
      v_h := v_m[1]::integer;
      IF v_h BETWEEN 0 AND 23 THEN v_hour := v_h; END IF;
    END IF;
  END IF;
  IF NOT v_found THEN
    v_m := regexp_match(t, '([0-9]{1,2})\s*시(?!간)');
    IF v_m IS NOT NULL THEN
      v_found := true;
      v_h := v_m[1]::integer;
      IF v_h BETWEEN 13 AND 23 THEN v_hour := v_h; END IF;
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
