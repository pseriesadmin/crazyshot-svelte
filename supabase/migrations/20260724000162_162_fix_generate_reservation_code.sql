-- Migration 162: generate_reservation_code() 수정 — public 스키마 명시
-- 원인: Migration 153이 schema prefix 없이 작성돼 production에서 함수 교체 실패
-- 수정: public.generate_reservation_code() 명시적 스키마로 재작성
-- 효과: /cms/codes 예약코드 형식 설정이 신규 예약에 즉시 반영됨

CREATE OR REPLACE FUNCTION public.generate_reservation_code()
RETURNS TEXT LANGUAGE plpgsql AS $$
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
  -- cms_settings에서 reservation_code_format 읽기
  SELECT value INTO v_fmt
  FROM public.cms_settings
  WHERE key = 'reservation_code_format';

  -- 각 필드 추출 (기본값 폴백)
  v_prefix     := COALESCE(NULLIF(UPPER(TRIM(v_fmt->>'prefix')),   ''), 'CS');
  v_cat        := COALESCE(UPPER(TRIM(v_fmt->>'cat_code')),            '');
  v_date_fmt   := COALESCE(NULLIF(v_fmt->>'date_format', ''),       'YYMM');
  v_seq_digits := COALESCE((v_fmt->>'seq_digits')::INTEGER,              3);
  v_reset      := COALESCE((v_fmt->>'reset_monthly')::BOOLEAN,        TRUE);
  v_suffix     := COALESCE(UPPER(TRIM(v_fmt->>'suffix')),              '');

  -- 날짜 파트 생성
  v_date := CASE v_date_fmt
    WHEN 'YYYYMM' THEN TO_CHAR(NOW(), 'YYYYMM')
    WHEN 'NONE'   THEN ''
    ELSE               TO_CHAR(NOW(), 'YYMM')
  END;

  -- 코드 베이스 = prefix + cat_code + date
  v_base := v_prefix || v_cat || v_date;

  -- 시퀀스 카운트 기준
  --   reset_monthly = TRUE  → 현재 base(월 포함)로 시작하는 코드만 카운트 (매월 001 재시작)
  --   reset_monthly = FALSE → prefix+cat 기준 누적 카운트 (월 무관)
  v_count_base := CASE WHEN v_reset THEN v_base ELSE v_prefix || v_cat END;

  SELECT COUNT(*) + 1 INTO v_seq
  FROM public.rental_reservations
  WHERE reservation_code LIKE v_count_base || '%';

  RETURN v_base
      || LPAD(v_seq::TEXT, GREATEST(v_seq_digits, 2), '0')
      || v_suffix;
END;
$$;
