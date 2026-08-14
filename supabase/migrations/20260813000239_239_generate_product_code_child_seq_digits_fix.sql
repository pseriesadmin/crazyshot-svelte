-- Migration #239: generate_product_code(7-param) 자식(순번2) 자릿수 버그 수정
-- 설계: 순번1(부모) 자릿수는 p_parent_max_sequence 길이로 정확히 계산되는데,
--       순번2(자식) 자릿수(v_seq_digits)는 p_max_sequence와 무관하게 항상 전역
--       cms_settings.reservation_code_format.seq_digits(또는 code_rule override)만
--       사용하고 있었다 — 콤보 편집화면에서 "순번2(자식) 상한"을 9999로 설정해도
--       실제 저장되는 code_series.seq_digits는 그대로 3으로 고정되는 비대칭 버그.
--       (클라이언트 미리보기(_AutoMappingTab.svelte buildComboPreview,
--        products/new/+page.svelte comboPreviewFmt)는 이미 max_sequence 길이 기준으로
--        올바르게 계산하고 있어 "미리보기"와 "실제 저장 구조"가 서로 달랐음)
--
-- 실사용 데이터로 확인(2026-08-13, production): 부모~999·자식~9999로 설정한 콤보(PH+SAM)로
-- 등록한 상품의 code_series가 parent_seq_digits:3(정상) / seq_digits:3(9999→4여야 함, 오류)
-- 로 저장된 것을 직접 조회로 확인.
--
-- 수정: p_max_sequence가 NOT NULL이면 v_seq_digits를 LENGTH(p_max_sequence::TEXT)로 덮어써
--       parent_seq_digits와 동일한 방식으로 맞춘다. p_max_sequence가 NULL(무제한)이면
--       기존과 동일하게 전역/code_rule 포맷값을 그대로 사용(회귀 없음).
--
-- 절대 제약:
--   ① 시그니처 무변경 (UUID, TEXT, UUID, TEXT, INT, INT, TEXT) — products.md §2-3, GP-10
--   ② 이미 code_series가 확정된 상품은 영향 없음(guard가 기존 그대로 유지 — 함수 최상단에서
--      기존 code_series 존재 시 즉시 RETURN, 재계산 안 함 — §2-2 품번 영구고정 정책)
--   ③ 2/3/5/6-param 오버로드는 이 마이그레이션에서 건드리지 않음(현재 앱 코드가 호출하지
--      않는 레거시 경로 — products/new/+page.server.ts, products/+page.server.ts 모두
--      콤보 경로는 7-param만 호출)

CREATE OR REPLACE FUNCTION public.generate_product_code(
  p_product_id              UUID,
  p_category                TEXT,
  p_code_id                 UUID,
  p_date_option             TEXT,
  p_max_sequence            INT,
  p_parent_max_sequence     INT,
  p_category_code_override  TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_series     JSONB;
  v_cat_code            TEXT;
  v_code_rule           JSONB;
  v_format              JSONB;
  v_prefix              TEXT;
  v_seq_digits          INT;
  v_suffix              TEXT;
  v_year_month          TEXT;
  v_parent_seq          INT;
  v_parent_seq_digits   INT;
BEGIN
  -- Guard: 이미 code_series가 있으면 재설정 안 함 (구조는 한번 정해지면 고정)
  SELECT code_series INTO v_existing_series
  FROM products WHERE id = p_product_id;
  IF v_existing_series IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- ① 카테고리코드 결정
  IF p_category_code_override IS NOT NULL THEN
    v_cat_code := p_category_code_override;
    IF p_code_id IS NOT NULL THEN
      SELECT pcc.code_rule INTO v_code_rule
      FROM   product_category_codes pcc
      WHERE  pcc.id = p_code_id
        AND  pcc.is_active = TRUE AND pcc.deleted_at IS NULL;
    END IF;
  ELSE
    IF p_code_id IS NOT NULL THEN
      SELECT pcc.code, pcc.code_rule INTO v_cat_code, v_code_rule
      FROM   product_category_codes pcc
      WHERE  pcc.id = p_code_id
        AND  pcc.is_active = TRUE AND pcc.deleted_at IS NULL;
    END IF;
    IF v_cat_code IS NULL THEN
      SELECT pcc.code, pcc.code_rule INTO v_cat_code, v_code_rule
      FROM   product_category_codes pcc
      WHERE  pcc.product_category = p_category AND pcc.depth = 0
        AND  pcc.is_active = TRUE AND pcc.deleted_at IS NULL
      LIMIT  1;
    END IF;
    IF v_cat_code IS NULL THEN
      v_cat_code := UPPER(LEFT(p_category, 3));
    END IF;
  END IF;

  -- ② 포맷 결정 (prefix, seq_digits, suffix 추출용)
  SELECT cs.value INTO v_format
  FROM cms_settings cs WHERE cs.key = 'reservation_code_format';
  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;
  IF v_code_rule IS NOT NULL THEN v_format := v_format || v_code_rule; END IF;

  v_prefix     := COALESCE(NULLIF(v_format->>'prefix', ''), 'CS');
  v_seq_digits := COALESCE((v_format->>'seq_digits')::INT, 3);
  v_suffix     := COALESCE(v_format->>'suffix', '');

  -- 🔴 버그 수정(#239): 순번2(자식) 상한이 명시적으로 설정됐으면 그 자릿수를 그대로 반영한다.
  --   (부모의 parent_seq_digits := LENGTH(p_parent_max_sequence::TEXT)와 동일한 원칙)
  IF p_max_sequence IS NOT NULL THEN
    v_seq_digits := LENGTH(p_max_sequence::TEXT);
  END IF;

  -- ③ date_option → year_month 결정
  CASE p_date_option
    WHEN 'none' THEN v_year_month := 'nodate';
    WHEN 'ymd'  THEN v_year_month := TO_CHAR(NOW(), 'YYMMDD');
    ELSE             v_year_month := TO_CHAR(NOW(), 'YYMM');
  END CASE;

  -- ④ 순번1(부모) 모드 분기 — p_parent_max_sequence IS NOT NULL 일 때만 2단 계층 활성화
  IF p_parent_max_sequence IS NOT NULL THEN
    v_parent_seq_digits := LENGTH(p_parent_max_sequence::TEXT);

    INSERT INTO product_parent_sequences (category_code, year_month, next_seq)
    VALUES (v_cat_code, COALESCE(v_year_month, 'nodate'), 2)
    ON CONFLICT (category_code, year_month)
    DO UPDATE SET next_seq = product_parent_sequences.next_seq + 1
    RETURNING product_parent_sequences.next_seq - 1 INTO v_parent_seq;
    IF v_parent_seq IS NULL THEN v_parent_seq := 1; END IF;

    IF v_parent_seq > p_parent_max_sequence THEN
      RAISE EXCEPTION 'parent_max_sequence_exceeded: 이 조합코드(%)의 부모 순번 상한(%)에 도달했습니다. 코드설정에서 순번1 상한을 늘려주세요.',
        v_cat_code, p_parent_max_sequence
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE products
    SET code_series = jsonb_build_object(
      'category_code',       v_cat_code,
      'year_month',          v_year_month,
      'prefix',              v_prefix,
      'suffix',              v_suffix,
      'seq_digits',          v_seq_digits,
      'max_sequence',        p_max_sequence,
      'parent_seq',          v_parent_seq,
      'parent_seq_digits',   v_parent_seq_digits,
      'parent_max_sequence', p_parent_max_sequence
    )
    WHERE id = p_product_id;
  ELSE
    -- 1단 모드(순번1 미사용) — parent_* 키 없음. p_max_sequence가 있으면 위에서 보정된
    -- v_seq_digits(자식 상한 자릿수)가 그대로 반영됨.
    UPDATE products
    SET code_series = jsonb_build_object(
      'category_code', v_cat_code,
      'year_month',    v_year_month,
      'prefix',        v_prefix,
      'suffix',        v_suffix,
      'seq_digits',    v_seq_digits,
      'max_sequence',  p_max_sequence
    )
    WHERE id = p_product_id;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_product_code(UUID, TEXT, UUID, TEXT, INT, INT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.generate_product_code(UUID, TEXT, UUID, TEXT, INT, INT, TEXT) TO service_role;

COMMENT ON FUNCTION public.generate_product_code(UUID, TEXT, UUID, TEXT, INT, INT, TEXT) IS
  '7-param 오버로드(#222 → #239 버그수정): 순번2(자식) 상한(p_max_sequence)이 지정되면
   그 자릿수를 code_series.seq_digits에 그대로 반영한다(부모 순번1과 동일한 원칙).
   기존에는 p_max_sequence와 무관하게 항상 전역 cms_settings 포맷값만 사용해
   콤보 편집화면에서 설정한 자식 자릿수가 실제 채번 구조에 반영되지 않는 비대칭 버그가 있었음.
   기존 2/3/5/6-param 오버로드 무변경.';
