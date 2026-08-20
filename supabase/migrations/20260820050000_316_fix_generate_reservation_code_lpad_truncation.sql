-- Migration 316: generate_reservation_code() LPAD 자릿수 잘림 결함 수정
--
-- 배경(2026-08-20): 상품상세에서 "예약신청" 클릭 시
--   duplicate key value violates unique constraint "rental_reservations_reservation_code_key"
-- 에러로 예약 생성이 실패하는 결함이 실사용 중 발견됨.
--
-- 근본 원인: Migration 247이 도입한 원자적 시퀀스 채번(reservation_code_sequences) 자체는
-- 정상이나, 마지막에 문자열을 만드는 LPAD(v_seq::TEXT, GREATEST(v_seq_digits, 2), '0') 호출이
-- 문제였다. Postgres의 lpad()는 입력 문자열이 목표 길이보다 길면 "잘라낸다"(패딩이 아니라
-- 절단) — 즉 v_seq_digits(기본 3)를 넘는 순번(1000 이상)이 생기면 v_seq=1005/1006/1007이
-- 전부 "100"으로 잘려 서로 다른 예약들이 동일한 reservation_code를 받아 UNIQUE 위반이
-- 발생했다. 직접 재현: `SELECT generate_reservation_code(), generate_reservation_code(),
-- generate_reservation_code()`를 한 문장에서 3회 호출 → 셋 다 'CS2608100'으로 동일하게 반환됨
-- (스테이지 reservation_code_sequences.next_seq가 이미 1005였던 상태에서 확인).
--
-- Stephen 확인: "예약코드 설정(seq_digits)을 늘리기만 해도 되지 않냐"는 질문에 검증 결과
-- 보고 — 설정을 늘리면(최대 6자리) 그 범위 안에서는 회피되지만 구조적 결함 자체는 남는다는
-- 점을 공유했고, "함수 자체를 고침(권장)"으로 확정.
--
-- 수정: LPAD 목표 길이를 "설정된 자릿수"와 "실제 순번의 자릿수" 중 큰 쪽으로 계산 —
-- 짧은 순번은 기존과 동일하게 0-패딩되고, 설정 자릿수를 넘는 순번은 잘리지 않고 그대로
-- 늘어난다. 테이블/데이터/기존 발급된 reservation_code는 전혀 변경하지 않음(함수 로직만 교체).

CREATE OR REPLACE FUNCTION public.generate_reservation_code()
RETURNS TEXT LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_fmt        JSONB;
  v_prefix     TEXT;
  v_cat        TEXT;
  v_date_fmt   TEXT;
  v_seq_digits INTEGER;
  v_reset      BOOLEAN;
  v_suffix     TEXT;
  v_date       TEXT;
  v_base       TEXT;
  v_count_base TEXT;
  v_seq        INTEGER;
BEGIN
  SELECT value INTO v_fmt
  FROM public.cms_settings
  WHERE key = 'reservation_code_format';

  v_prefix     := COALESCE(NULLIF(UPPER(TRIM(v_fmt->>'prefix')),   ''), 'CS');
  v_cat        := COALESCE(UPPER(TRIM(v_fmt->>'cat_code')),            '');
  v_date_fmt   := COALESCE(NULLIF(v_fmt->>'date_format', ''),       'YYMM');
  v_seq_digits := COALESCE((v_fmt->>'seq_digits')::INTEGER,              3);
  v_reset      := COALESCE((v_fmt->>'reset_monthly')::BOOLEAN,        TRUE);
  v_suffix     := COALESCE(UPPER(TRIM(v_fmt->>'suffix')),              '');

  v_date := CASE v_date_fmt
    WHEN 'YYYYMM' THEN TO_CHAR(NOW(), 'YYYYMM')
    WHEN 'NONE'   THEN ''
    ELSE               TO_CHAR(NOW(), 'YYMM')
  END;

  v_base := v_prefix || v_cat || v_date;
  v_count_base := CASE WHEN v_reset THEN v_base ELSE v_prefix || v_cat END;

  INSERT INTO public.reservation_code_sequences (count_base, next_seq)
  VALUES (v_count_base, 2)
  ON CONFLICT (count_base)
  DO UPDATE SET next_seq = reservation_code_sequences.next_seq + 1
  RETURNING reservation_code_sequences.next_seq - 1 INTO v_seq;

  IF v_seq IS NULL THEN v_seq := 1; END IF;

  -- LPAD 목표 길이 = GREATEST(설정 자릿수, 실제 순번 자릿수) — 절대 잘리지 않음
  RETURN v_base
      || LPAD(v_seq::TEXT, GREATEST(v_seq_digits, LENGTH(v_seq::TEXT)), '0')
      || v_suffix;
END;
$$;
