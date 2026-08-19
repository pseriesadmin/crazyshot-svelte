-- Migration 292: generate_user_coupon_redeemed_code — 쿠폰 지연채번 RPC
-- 목적: use_coupon 내부에서 호출되어 sequenced 모드 쿠폰의 redeemed_code를 채번·저장.
--       generate_inventory_product_code(migration 99)와 동일한 원자성·멱등성 패턴.
-- TDD 도메인: 순번 원자성·멱등성·max_sequence 상한체크 3종 테스트 GREEN 필수
-- 2026-08-18

CREATE OR REPLACE FUNCTION public.generate_user_coupon_redeemed_code(
  p_user_coupon_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_redeemed_code TEXT;
  v_uc            RECORD;
  v_code_series   JSONB;
  v_category_code TEXT;
  v_prefix        TEXT;
  v_date_option   TEXT;
  v_seq_digits    INT;
  v_max_sequence  INT;
  v_year_month    TEXT;
  v_date_part     TEXT;
  v_seq           INT;
BEGIN
  -- ── 1. 멱등성: 이미 채번된 경우 그대로 반환 ──────────────────────────
  SELECT redeemed_code INTO v_redeemed_code
  FROM public.user_coupons
  WHERE id = p_user_coupon_id
  FOR UPDATE;  -- 동시 호출 충돌 방지 (비관적 잠금)

  IF v_redeemed_code IS NOT NULL THEN
    RETURN v_redeemed_code;
  END IF;

  -- ── 2. user_coupons → coupons 조인: code_series 읽기 ──────────────────
  SELECT
    uc.id            AS uc_id,
    c.code_mode,
    c.code_series
  INTO v_uc
  FROM public.user_coupons uc
  JOIN public.coupons c ON c.id = uc.coupon_id
  WHERE uc.id = p_user_coupon_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_COUPON_NOT_FOUND: %', p_user_coupon_id;
  END IF;

  -- ── 3. manual 모드 쿠폰은 채번 대상이 아님 — 조용히 종료 ──────────────
  --    기존 manual 쿠폰 플로우에 영향 없음(하위호환 보장)
  IF v_uc.code_mode IS DISTINCT FROM 'sequenced' THEN
    RETURN NULL;
  END IF;

  -- ── 4. code_series 파싱 ───────────────────────────────────────────────
  v_code_series   := v_uc.code_series;
  v_category_code := v_code_series->>'category_code';
  v_prefix        := COALESCE(v_code_series->>'prefix', 'CS');
  v_date_option   := COALESCE(v_code_series->>'date_option', 'none');
  v_seq_digits    := COALESCE((v_code_series->>'seq_digits')::INT, 3);
  v_max_sequence  := NULLIF((v_code_series->>'max_sequence')::TEXT, 'null')::INT;

  IF v_category_code IS NULL THEN
    RAISE EXCEPTION 'INVALID_CODE_SERIES: category_code가 없습니다. user_coupon_id=%', p_user_coupon_id;
  END IF;

  -- ── 5. year_month 결정 ───────────────────────────────────────────────
  --   date_option: 'yyyymm'(현재 연월) | 'none'/'nodate'(날짜 없음)
  IF v_date_option = 'yyyymm' THEN
    v_year_month := TO_CHAR(NOW(), 'YYYYMM');
    v_date_part  := v_year_month;
  ELSE
    v_year_month := 'nodate';
    v_date_part  := '';
  END IF;

  -- ── 6. 원자적 순번 채번 (INSERT...ON CONFLICT UPSERT) ─────────────────
  --   product_code_sequences와 동일 단조증가 패턴 (§2-2 영구고정 원칙 동일 적용)
  INSERT INTO public.coupon_code_sequences (category_code, year_month, next_seq)
  VALUES (v_category_code, v_year_month, 2)
  ON CONFLICT (category_code, year_month) DO UPDATE
    SET next_seq = coupon_code_sequences.next_seq + 1
  RETURNING next_seq - 1 INTO v_seq;

  -- ── 7. max_sequence 상한 체크 ─────────────────────────────────────────
  IF v_max_sequence IS NOT NULL AND v_seq > v_max_sequence THEN
    -- 상한 초과 시 카운터를 원래대로 되돌리고 예외 발생
    UPDATE public.coupon_code_sequences
    SET next_seq = next_seq - 1
    WHERE category_code = v_category_code AND year_month = v_year_month;

    RAISE EXCEPTION 'COUPON_SEQ_EXCEEDED: 쿠폰 발급 한도에 도달했습니다. (max_sequence=%, 현재=%, category=%, year_month=%)',
      v_max_sequence, v_seq, v_category_code, v_year_month;
  END IF;

  -- ── 8. redeemed_code 조합 ─────────────────────────────────────────────
  --   형식: prefix || category_code || date_part || LPAD(seq, seq_digits, '0')
  --   예: 'CS' || 'CPNALL' || '' || '001' = 'CSCPNALL001'
  v_redeemed_code := v_prefix
    || v_category_code
    || v_date_part
    || LPAD(v_seq::TEXT, v_seq_digits, '0');

  -- ── 9. user_coupons.redeemed_code 기록 ──────────────────────────────
  UPDATE public.user_coupons
  SET redeemed_code = v_redeemed_code
  WHERE id = p_user_coupon_id;

  RETURN v_redeemed_code;
END;
$$;

-- service_role 전용 — authenticated에는 직접 노출 안 함
--   (products의 generate_inventory_product_code와 동일 정책)
REVOKE ALL ON FUNCTION public.generate_user_coupon_redeemed_code(UUID)
  FROM PUBLIC, anon, authenticated;
-- service_role은 SECURITY DEFINER 함수 실행에 자동으로 권한 있음

COMMENT ON FUNCTION public.generate_user_coupon_redeemed_code(UUID) IS
  'Lazy Sequencing: sequenced 모드 쿠폰의 user_coupon에 redeemed_code를 원자적으로 채번·저장.
   generate_inventory_product_code(migration 99)와 동일한 멱등성·원자성·상한체크 패턴.
   use_coupon RPC 내부에서 PERFORM으로만 호출됨 — TS 직접 .rpc() 호출 없음.
   manual 모드 쿠폰(code_mode != sequenced)은 호출해도 NULL 반환(무동작, 하위호환 보장).';

-- ─────────────────────────────────────────────────────────
-- ROLLBACK
-- ─────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.generate_user_coupon_redeemed_code(UUID);
