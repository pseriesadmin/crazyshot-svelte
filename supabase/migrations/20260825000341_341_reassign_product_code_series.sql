-- Migration #341: reassign_product_code_series RPC 신규 추가
-- 배경: "새 상품으로 복제 + 품번(분류코드) 자동 생성"이 1단 계층(순번1 없음) 카테고리를
--   복제하면, 두 부모상품이 동일한 code_series(구조)를 공유하는 것 자체는 기존에 확정된
--   정책(products.md §2-3 예시: 부모순번 없음 → 복제 대상/복제 등록 모두 동일 코드 표시)이라
--   버그가 아니다. 다만 관리자가 이 "복제로 생긴 동일 코드"를 명시적으로 구분하고 싶을 때,
--   기존 generate_product_code RPC는 code_series가 이미 존재하면 무조건 NULL을 반환하고
--   아무것도 하지 않는 가드가 있어(§2-2 영구고정 정책) 재할당이 구조적으로 불가능했다.
--
-- 설계 원칙:
--   ① products.md §2-2(품번 영구고정)는 "이미 실제로 발급된 자식(재고) product_code"를
--      보호하는 정책이다 — 아직 자식이 0개(재고 미등록)인 부모의 code_series는 실물에
--      아직 아무것도 연결되지 않은 "구조 템플릿"일 뿐이므로, 재할당이 그 정책을 위반하지
--      않는다. 따라서 이 RPC는 대상 부모상품에 활성 자식(재고)이 1개라도 있으면 예외를
--      던지고 중단한다(Stephen 2026-08-25 확정 — 재고 0개 부모상품에만 재할당 허용).
--   ② 기존 generate_product_code(7-param, Migration #222)는 절대 수정하지 않는다 — 그
--      함수의 "이미 있으면 NULL 반환" 가드는 다른 모든 정상 등록 경로가 의존하는 안전장치이므로
--      건드리면 안 된다(products.md §2-3 ADD-only 원칙과 별개로, 이번 요구는 새 함수로 분리).
--   ③ 부모/자식 분리(§2-1) — parent_product_id가 있는 자식(재고) 상품에는 이 RPC를 호출할 수
--      없다(자식은 code_series 개념 자체가 없음).
--
-- 파라미터·본문 로직은 현재 라이브 generate_product_code(7-param)와 동일 구조 —
-- TypeScript 호출부(buildComboCategoryCode/getRootCode)를 그대로 재사용하기 위함.
-- ⚠️ QA 발견(2026-08-25): 최초 작성 시 Migration #222 시점 본문을 그대로 복사해
--    이후 버그수정 2건(seq_digits 자릿수 보정 #239, cms_settings 키 분리 #248)이
--    누락됐었다 — 아래 본문은 현재 라이브 7-param(#248 적용본)과 대조해 두 수정을
--    반영한 최종본이다. 향후 generate_product_code 본문이 또 바뀌면 이 함수도
--    수동으로 대조·동기화해야 한다(자동 상속 아님 — 완전히 별개 함수).
CREATE OR REPLACE FUNCTION public.reassign_product_code_series(
  p_product_id              UUID,
  p_category                TEXT,
  p_code_id                 UUID,
  p_date_option             TEXT,     -- 콤보 행의 date_option: 'none' | 'ym' | 'ymd'
  p_max_sequence            INT,      -- 순번2(자식) 상한 (NULL 허용)
  p_parent_max_sequence     INT,      -- 순번1(부모) 상한 (NULL = 1단 계층)
  p_category_code_override  TEXT      -- 합산 분류코드 (TIER_ORDER 순 대문자)
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_id_check     UUID;
  v_child_count         INT;
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
  -- Guard ①: 대상 상품 존재·미삭제·부모(자식 아님) 확인
  SELECT parent_product_id INTO v_parent_id_check
  FROM products WHERE id = p_product_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found: 상품을 찾을 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF v_parent_id_check IS NOT NULL THEN
    RAISE EXCEPTION 'child_product_not_allowed: 자식(재고) 상품에는 품번 체계를 재할당할 수 없습니다. 대표 상품에서 진행하세요.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Guard ②: 활성 자식(재고) 존재 시 재할당 차단 (Stephen 2026-08-25 확정)
  SELECT COUNT(*) INTO v_child_count
  FROM products WHERE parent_product_id = p_product_id AND deleted_at IS NULL;
  IF v_child_count > 0 THEN
    RAISE EXCEPTION 'has_existing_inventory: 이미 재고(자식상품)가 등록된 부모상품은 품번 체계를 재할당할 수 없습니다.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ① 카테고리코드 결정 (generate_product_code 7-param과 동일 로직)
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

  -- ② 포맷 결정 — product_code_format 키(Migration #248 설정 키 분리 — 예약코드 전용
  --    reservation_code_format과 혼동 금지, products.md §2-3 Migration #248 참고)
  SELECT cs.value INTO v_format
  FROM cms_settings cs WHERE cs.key = 'product_code_format';
  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;
  IF v_code_rule IS NOT NULL THEN v_format := v_format || v_code_rule; END IF;

  v_prefix     := COALESCE(NULLIF(v_format->>'prefix', ''), 'CS');
  v_seq_digits := COALESCE((v_format->>'seq_digits')::INT, 3);
  v_suffix     := COALESCE(v_format->>'suffix', '');

  -- 버그 수정(#239): 순번2(자식) 상한이 명시적으로 설정됐으면 그 자릿수를 그대로 반영한다.
  IF p_max_sequence IS NOT NULL THEN
    v_seq_digits := LENGTH(p_max_sequence::TEXT);
  END IF;

  -- ③ date_option → year_month 결정
  CASE p_date_option
    WHEN 'none' THEN v_year_month := 'nodate';
    WHEN 'ymd'  THEN v_year_month := TO_CHAR(NOW(), 'YYMMDD');
    ELSE             v_year_month := TO_CHAR(NOW(), 'YYMM');
  END CASE;

  -- ④ 순번1(부모) 모드 분기 — 선택한 코드품번에 부모순번 개념이 있으면 즉시 원자적 채번
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
    -- 1단 모드 — product_parent_sequences 미사용
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

REVOKE ALL ON FUNCTION public.reassign_product_code_series(UUID, TEXT, UUID, TEXT, INT, INT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reassign_product_code_series(UUID, TEXT, UUID, TEXT, INT, INT, TEXT) TO service_role;

COMMENT ON FUNCTION public.reassign_product_code_series(UUID, TEXT, UUID, TEXT, INT, INT, TEXT) IS
  '재고(자식) 0개인 부모상품에 한해 code_series를 새로 선택한 조합코드로 재할당한다.
   generate_product_code(7-param)와 달리 기존 code_series 존재 여부를 가드하지 않고 항상
   덮어쓴다 — §2-2 영구고정 정책은 실제 발급된 자식 product_code만 보호하므로 무자식
   부모의 구조 템플릿 재할당은 정책 위반이 아니다(products.md 2026-08-25 §2-11).
   활성 자식이 1개라도 있으면 has_existing_inventory 예외로 차단.';
