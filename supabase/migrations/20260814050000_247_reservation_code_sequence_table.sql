-- Migration #247: 예약코드 채번을 COUNT(*) 방식에서 전용 시퀀스 테이블로 교체
--
-- 문제: generate_reservation_code()가 "SELECT COUNT(*)+1 FROM rental_reservations
--       WHERE reservation_code LIKE ..." 방식으로 다음 순번을 계산했음.
--       예약이 삭제되면 COUNT가 낮아져 이미 사용된 순번이 재사용될 수 있고,
--       reservation_code UNIQUE 제약 위반으로 예약 생성 자체가 실패할 위험이 있었음.
--       (실측 확인: stage에서 2026-07-28 예약과 2026-08-13 예약이 동일 시퀀스 052를
--        발급받음 — 그 사이 테스트 예약 삭제로 COUNT가 낮아졌기 때문. 같은 달 안에서
--        발생했다면 실제 충돌이었을 것)
-- 해결: product_code_sequences(migration #68)와 동일한 검증된 패턴 적용
--       (atomic INSERT ... ON CONFLICT DO UPDATE — 삭제 여부와 무관하게 항상 단조증가)

-- ─────────────────────────────────────────────
-- 1. reservation_code_sequences 시퀀스 테이블
--    count_base : prefix + cat_code (+ reset_monthly=true인 경우 date까지 포함)
--    next_seq   : 다음 채번할 순번 (현재 최댓값+1을 저장)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reservation_code_sequences (
  id          BIGSERIAL   PRIMARY KEY,
  count_base  VARCHAR(50) NOT NULL,
  next_seq    INT         NOT NULL DEFAULT 1,
  CONSTRAINT reservation_code_sequences_unique UNIQUE (count_base)
);

ALTER TABLE reservation_code_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_reservation_sequences" ON reservation_code_sequences;
CREATE POLICY "service_role_all_reservation_sequences"
  ON reservation_code_sequences
  FOR ALL
  USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────
-- 2. 기존 데이터 기준 시퀀스 백필
--    현재 cms_settings 설정으로 계산한 count_base 그룹에서 이미 발급된 예약코드 중
--    가장 큰 순번을 찾아 next_seq = 최댓값+1로 시딩 → 기존 예약코드와 절대 충돌하지
--    않는 지점부터 새 시스템이 이어받음. 재실행해도 안전(ON CONFLICT로 최댓값만 갱신).
--
--    주의: reservation_code 문자열은 항상 prefix+cat_code+date+seq+suffix 구조
--    (reset_monthly와 무관하게 date는 항상 포함됨). reset_monthly=false일 때는
--    count_base가 date를 포함하지 않으므로, 순번만 정확히 추출하려면 정규식에서
--    date 자릿수만큼 별도로 건너뛰어야 한다 (건너뛰지 않으면 date+seq가 통째로
--    하나의 숫자로 잘못 캡처되어 next_seq가 비정상적으로 커지는 버그가 생김).
-- ─────────────────────────────────────────────
DO $$
DECLARE
  v_fmt        JSONB;
  v_prefix     TEXT;
  v_cat        TEXT;
  v_date_fmt   TEXT;
  v_reset      BOOLEAN;
  v_date       TEXT;
  v_date_len   INT;
  v_base       TEXT;
  v_count_base TEXT;
  v_regex      TEXT;
  v_max_seq    INT;
BEGIN
  SELECT value INTO v_fmt FROM public.cms_settings WHERE key = 'reservation_code_format';

  v_prefix   := COALESCE(NULLIF(UPPER(TRIM(v_fmt->>'prefix')), ''), 'CS');
  v_cat      := COALESCE(UPPER(TRIM(v_fmt->>'cat_code')), '');
  v_date_fmt := COALESCE(NULLIF(v_fmt->>'date_format', ''), 'YYMM');
  v_reset    := COALESCE((v_fmt->>'reset_monthly')::BOOLEAN, TRUE);

  v_date := CASE v_date_fmt
    WHEN 'YYYYMM' THEN TO_CHAR(NOW(), 'YYYYMM')
    WHEN 'NONE'   THEN ''
    ELSE               TO_CHAR(NOW(), 'YYMM')
  END;
  v_date_len := CASE v_date_fmt WHEN 'YYYYMM' THEN 6 WHEN 'NONE' THEN 0 ELSE 4 END;

  v_base       := v_prefix || v_cat || v_date;
  v_count_base := CASE WHEN v_reset THEN v_base ELSE v_prefix || v_cat END;

  -- reset_monthly=true  → count_base에 이미 date가 포함돼 있어 그대로 순번만 캡처
  -- reset_monthly=false → count_base 뒤에 date 자릿수만큼 건너뛴 후 순번 캡처
  IF v_reset THEN
    v_regex := '^' || v_count_base || '(\d+)';
  ELSE
    v_regex := '^' || v_count_base || REPEAT('\d', v_date_len) || '(\d+)';
  END IF;

  SELECT MAX((regexp_match(reservation_code, v_regex))[1]::INT)
  INTO v_max_seq
  FROM public.rental_reservations
  WHERE reservation_code LIKE v_count_base || '%';

  INSERT INTO reservation_code_sequences (count_base, next_seq)
  VALUES (v_count_base, COALESCE(v_max_seq, 0) + 1)
  ON CONFLICT (count_base) DO UPDATE
    SET next_seq = GREATEST(reservation_code_sequences.next_seq, EXCLUDED.next_seq);
END $$;

-- ─────────────────────────────────────────────
-- 3. generate_reservation_code() 재작성 — atomic 시퀀스 테이블 사용
--    포맷 파싱 로직은 기존과 동일(cms_settings.reservation_code_format), 순번 채번
--    방식만 COUNT(*)에서 INSERT...ON CONFLICT DO UPDATE 원자적 증가로 교체.
-- ─────────────────────────────────────────────
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

  -- 시퀀스 그룹 기준
  --   reset_monthly = TRUE  → base(월 포함) 단위로 그룹 분리 (매월 001부터 재시작)
  --   reset_monthly = FALSE → prefix+cat 단위로 그룹 고정 (월 무관 누적)
  v_count_base := CASE WHEN v_reset THEN v_base ELSE v_prefix || v_cat END;

  -- atomic 채번 (product_code_sequences와 동일 검증된 패턴)
  -- 신규 그룹(seq=1): INSERT next_seq=2, RETURNING 2-1=1
  -- 기존 그룹(seq=N): UPDATE next_seq=N+1, RETURNING (N+1)-1=N
  -- → 예약이 삭제돼도 이미 발급된 순번은 절대 재사용되지 않음(단조증가)
  INSERT INTO public.reservation_code_sequences (count_base, next_seq)
  VALUES (v_count_base, 2)
  ON CONFLICT (count_base)
  DO UPDATE SET next_seq = reservation_code_sequences.next_seq + 1
  RETURNING reservation_code_sequences.next_seq - 1 INTO v_seq;

  IF v_seq IS NULL THEN v_seq := 1; END IF;

  RETURN v_base
      || LPAD(v_seq::TEXT, GREATEST(v_seq_digits, 2), '0')
      || v_suffix;
END;
$$;
