-- Migration #68: 상품코드(품번) 자동 생성 시스템
-- products.product_code 컬럼 + product_code_sequences 시퀀스 테이블
-- generate_product_code() RPC + 기존 상품 backfill
--
-- 생성 예시: CS-CAM-2607-001
--   prefix   = cms_settings.reservation_code_format.prefix  (기본: 'CS')
--   cat_code  = category_taxonomy_map → product_category_codes.code  (예: 'CAM')
--   date      = TO_CHAR(NOW(), 'YYMM')  (date_format 설정 따름)
--   seq       = product_code_sequences에서 채번 (seq_digits 자리 zero-padded)

-- ─────────────────────────────────────────────
-- 1. products.product_code 컬럼 추가
-- ─────────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS product_code VARCHAR(30);

-- UNIQUE 제약 (NULL은 중복 허용 — PostgreSQL 기본 동작)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'products_product_code_unique'
      AND table_name = 'products'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_product_code_unique UNIQUE (product_code);
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- 2. product_code_sequences 시퀀스 테이블
--    category_code : 분류 코드 (예: 'CAM', 'OPT')
--    year_month    : 'YYMM' 문자열 (예: '2607') 또는 'all' (월별 리셋 비활성)
--    next_seq      : 다음 채번할 순번 (현재 최댓값+1을 저장)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_code_sequences (
  id            BIGSERIAL    PRIMARY KEY,
  category_code VARCHAR(30)  NOT NULL,
  year_month    VARCHAR(7)   NOT NULL,
  next_seq      INT          NOT NULL DEFAULT 1,
  CONSTRAINT product_code_sequences_unique UNIQUE (category_code, year_month)
);

-- RLS 활성화 (서버사이드 service_role만 접근)
ALTER TABLE product_code_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_sequences"
  ON product_code_sequences
  FOR ALL
  USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────
-- 3. generate_product_code() RPC
--    p_product_id : 코드를 발행할 상품 UUID
--    p_category   : ProductCategoryEnum 값 (예: 'camera', 'lens')
--    RETURNS TEXT : 생성된 품번 (예: 'CS-CAM-2607-001')
--    SECURITY DEFINER: RLS 우회, 서버 함수 내부에서만 호출
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_product_code(
  p_product_id UUID,
  p_category   TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_taxonomy_code_id UUID;
  v_cat_code         TEXT;
  v_code_rule        JSONB;
  v_format           JSONB;
  v_prefix           TEXT;
  v_date_format      TEXT;
  v_seq_digits       INT;
  v_reset_monthly    BOOLEAN;
  v_suffix           TEXT;
  v_year_month       TEXT;
  v_seq              INT;
  v_seq_padded       TEXT;
  v_product_code     TEXT;
BEGIN
  -- ── Step 1: category_taxonomy_map 경유 분류 코드 조회 ──────────────────
  SELECT ctm.taxonomy_code_id
  INTO   v_taxonomy_code_id
  FROM   category_taxonomy_map ctm
  WHERE  ctm.product_category = p_category
  ORDER  BY ctm.priority DESC
  LIMIT  1;

  IF v_taxonomy_code_id IS NOT NULL THEN
    SELECT pcc.code, pcc.code_rule
    INTO   v_cat_code, v_code_rule
    FROM   product_category_codes pcc
    WHERE  pcc.id          = v_taxonomy_code_id
      AND  pcc.is_active   = TRUE
      AND  pcc.deleted_at  IS NULL;
  END IF;

  -- Fallback 1: product_category_codes.product_category 컬럼으로 직접 조회
  IF v_cat_code IS NULL THEN
    SELECT pcc.code, pcc.code_rule
    INTO   v_cat_code, v_code_rule
    FROM   product_category_codes pcc
    WHERE  pcc.product_category = p_category
      AND  pcc.depth            = 0
      AND  pcc.is_active        = TRUE
      AND  pcc.deleted_at       IS NULL
    LIMIT  1;
  END IF;

  -- Fallback 2: 카테고리명 앞 3자리 대문자
  IF v_cat_code IS NULL THEN
    v_cat_code := UPPER(LEFT(p_category, 3));
  END IF;

  -- ── Step 2: cms_settings에서 코드 포맷 읽기 ───────────────────────────
  SELECT cs.value
  INTO   v_format
  FROM   cms_settings cs
  WHERE  cs.key = 'reservation_code_format';

  -- 포맷 미설정 시 DEFAULT 적용
  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;

  -- code_rule JSONB로 브랜치별 포맷 오버라이드 (있을 경우만)
  IF v_code_rule IS NOT NULL THEN
    v_format := v_format || v_code_rule;
  END IF;

  -- 포맷 값 파싱
  v_prefix        := COALESCE(NULLIF(v_format->>'prefix',      ''), 'CS');
  v_date_format   := COALESCE(v_format->>'date_format',  'YYMM');
  v_seq_digits    := COALESCE((v_format->>'seq_digits')::INT,   3);
  v_reset_monthly := COALESCE((v_format->>'reset_monthly')::BOOLEAN, TRUE);
  v_suffix        := COALESCE(v_format->>'suffix', '');

  -- ── Step 3: 날짜 키 생성 ────────────────────────────────────────────────
  IF v_date_format = 'YYYYMM' THEN
    v_year_month := TO_CHAR(NOW(), 'YYYYMM');
  ELSE
    v_year_month := TO_CHAR(NOW(), 'YYMM');
  END IF;

  -- 월별 리셋 미사용 시 'all' 고정
  IF NOT v_reset_monthly THEN
    v_year_month := 'all';
  END IF;

  -- ── Step 4: 시퀀스 채번 (atomic INSERT ... ON CONFLICT) ────────────────
  -- 신규 행(seq=1): INSERT next_seq=2, RETURNING 2-1=1
  -- 기존 행(seq=N): UPDATE next_seq=N+1, RETURNING (N+1)-1=N
  INSERT INTO product_code_sequences (category_code, year_month, next_seq)
  VALUES (v_cat_code, v_year_month, 2)
  ON CONFLICT (category_code, year_month)
  DO UPDATE SET next_seq = product_code_sequences.next_seq + 1
  RETURNING product_code_sequences.next_seq - 1 INTO v_seq;

  IF v_seq IS NULL THEN v_seq := 1; END IF;

  -- ── Step 5: seq 자릿수 패딩 ──────────────────────────────────────────
  v_seq_padded := LPAD(v_seq::TEXT, v_seq_digits, '0');

  -- ── Step 6: 품번 조합 ────────────────────────────────────────────────
  -- 기본형: CS-CAM-2607-001
  -- suffix 있는 경우: CS-CAM-2607-001-SF
  IF v_suffix <> '' THEN
    v_product_code := v_prefix
      || '-' || v_cat_code
      || '-' || v_year_month
      || '-' || v_seq_padded
      || '-' || v_suffix;
  ELSE
    v_product_code := v_prefix
      || '-' || v_cat_code
      || '-' || v_year_month
      || '-' || v_seq_padded;
  END IF;

  -- ── Step 7: products.product_code 업데이트 ───────────────────────────
  UPDATE products
  SET    product_code = v_product_code
  WHERE  id = p_product_id;

  RETURN v_product_code;
END;
$$;

-- RPC 호출 권한: service_role만 허용 (클라이언트 직접 호출 차단)
REVOKE ALL ON FUNCTION generate_product_code(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION generate_product_code(UUID, TEXT) TO service_role;

-- ─────────────────────────────────────────────
-- 4. 기존 상품 backfill (product_code = NULL 인 상품에 일괄 발행)
--    created_at ASC 순서 → 오래된 상품이 낮은 번호
-- ─────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, category
    FROM   products
    WHERE  product_code IS NULL
      AND  deleted_at   IS NULL
    ORDER  BY created_at ASC
  LOOP
    PERFORM generate_product_code(r.id, r.category);
  END LOOP;
END $$;
