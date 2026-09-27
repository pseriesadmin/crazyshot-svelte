-- Migration #556: cms_create_coupon — 발행 순번(issue_seq) 채번 + p_auto_distribute_enabled 추가
--
-- 배경(Plan "쿠폰 생성 7건 결함 보완" 4번+7번+3번):
--   1) sequenced 모드 쿠폰의 code_series에 담긴 "부모 순번(2단 계층)" 설정이 실제 채번
--      로직에는 전혀 반영되지 않아, 관리자가 코드조합에 설정한 "자식 순번" 상한이
--      아무 효과가 없었다. 이번 수정으로 coupon_parent_sequences(Migration #555)를
--      이용해 쿠폰 레코드 생성 시점에 "발행 순번"(issue_seq)을 원자적으로 채번해
--      code_series에 병합 저장한다.
--   2) 이 issue_seq는 CMS 발행관리 목록에서 "몇 번째로 발행된 쿠폰인가"를 구분하기
--      위한 표시 전용 값이다 — 고객에게 실제 발급되는 redeemed_code(사용 시점 실채번,
--      generate_user_coupon_redeemed_code)는 이번 수정과 무관하게 그대로 유지된다.
--   3) 1단 계층(parent_max_sequence 없음) 조합에도 issue_seq를 부여한다 — 쿠폰
--      발행관리 목록에서 "코드" 컬럼이 관리자의 1차 식별자로 쓰이기 때문에, 상품의
--      "1단=순번 없음" 정책과 의도적으로 다르게 적용한다.
--   4) "자동 발행" 화면 토글(auto_issue_enabled)과 실제 배포를 좌우하는
--      auto_distribute_enabled(Migration #527) 컬럼이 서로 다른 개념인데, 생성 RPC가
--      auto_distribute_enabled를 지정하지 않아 DB 기본값(true)이 항상 적용되고
--      있었다 — p_auto_distribute_enabled 파라미터를 신설해 생성 시점에 명시적으로
--      지정할 수 있게 한다.
--
-- 시그니처: 기존 30-param 끝에 p_auto_distribute_enabled boolean DEFAULT true 1개만
--   추가(31-param). ⚠️ CREATE OR REPLACE는 파라미터 "개수"가 다르면 기존 함수를
--   대체하지 않고 새 오버로드로 추가된다(Stage 적용 중 실제로 30-param/31-param
--   오버로드 2개가 동시에 남는 것을 확인) — products.md의 generate_product_code
--   2-param/3-param 오버로드 혼동(PGRST203) 사례와 동일한 함정이라, 반드시 먼저
--   기존 30-param을 명시적으로 DROP한 뒤 새로 생성한다.
--
-- 롤백: 20260921090000_520_cms_create_coupon_relative_days.sql의 30-param 정의로 되돌릴 것.

DROP FUNCTION IF EXISTS public.cms_create_coupon(
  text, text, text, numeric, integer, numeric,
  timestamp with time zone, timestamp with time zone,
  text, integer, integer, numeric, jsonb, text,
  boolean, integer, integer, boolean, boolean, boolean, boolean,
  jsonb, jsonb, text, boolean, boolean, jsonb, text, text, integer
);

CREATE OR REPLACE FUNCTION public.cms_create_coupon(
  p_code text DEFAULT NULL::text,
  p_type text DEFAULT 'all'::text,
  p_discount_type text DEFAULT 'fixed'::text,
  p_discount_value numeric DEFAULT 0,
  p_usage_limit integer DEFAULT NULL::integer,
  p_min_purchase_amount numeric DEFAULT 0,
  p_valid_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_valid_until timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_description text DEFAULT NULL::text,
  p_min_rental_amount integer DEFAULT 0,
  p_min_rental_days integer DEFAULT 0,
  p_max_discount_amount numeric DEFAULT NULL::numeric,
  p_applicable_categories jsonb DEFAULT NULL::jsonb,
  p_user_grade_required text DEFAULT NULL::text,
  p_is_first_rental_only boolean DEFAULT false,
  p_per_user_limit integer DEFAULT 1,
  p_total_usage_limit integer DEFAULT NULL::integer,
  p_is_student_only boolean DEFAULT false,
  p_is_walk_in_only boolean DEFAULT false,
  p_is_subscription_only boolean DEFAULT false,
  p_auto_issue_enabled boolean DEFAULT false,
  p_auto_issue_schedule jsonb DEFAULT NULL::jsonb,
  p_distribution_target jsonb DEFAULT NULL::jsonb,
  p_validity_type text DEFAULT 'fixed_period'::text,
  p_allow_with_points boolean DEFAULT true,
  p_allow_stacking boolean DEFAULT false,
  p_code_series jsonb DEFAULT NULL::jsonb,
  p_code_mode text DEFAULT 'manual'::text,
  p_display_name text DEFAULT NULL::text,
  p_valid_days integer DEFAULT NULL::integer,
  p_auto_distribute_enabled boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
  v_code_series   JSONB;
  v_category_code TEXT;
  v_year_month    TEXT;
  v_parent_max_sequence INT;
  v_issue_seq     INT;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  IF p_code_mode = 'manual' AND (p_code IS NULL OR p_code = '') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'manual 모드에서는 쿠폰 코드가 필수입니다.');
  END IF;

  IF p_code_mode = 'sequenced' AND p_code_series IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sequenced 모드에서는 code_series가 필수입니다.');
  END IF;

  IF p_code_mode NOT IN ('manual', 'sequenced') THEN
    RETURN jsonb_build_object('ok', false, 'error', '유효하지 않은 code_mode입니다.');
  END IF;

  -- ── 발행 순번(issue_seq) 채번 — sequenced 모드에서만, 1단/2단 계층 구분 없이 항상 부여 ──
  IF p_code_mode = 'sequenced' AND p_code_series IS NOT NULL THEN
    v_category_code := p_code_series->>'category_code';
    IF v_category_code IS NULL THEN
      RAISE EXCEPTION 'INVALID_CODE_SERIES: category_code가 없습니다.';
    END IF;

    v_year_month := CASE WHEN p_code_series->>'date_option' = 'yyyymm'
      THEN TO_CHAR(NOW(), 'YYYYMM')
      ELSE 'nodate'
    END;

    INSERT INTO public.coupon_parent_sequences (category_code, year_month, next_seq)
    VALUES (v_category_code, v_year_month, 2)
    ON CONFLICT (category_code, year_month) DO UPDATE
      SET next_seq = coupon_parent_sequences.next_seq + 1
    RETURNING next_seq - 1 INTO v_issue_seq;

    v_parent_max_sequence := (p_code_series->>'parent_max_sequence')::INT;
    IF v_parent_max_sequence IS NOT NULL AND v_issue_seq > v_parent_max_sequence THEN
      -- 카운터 롤백은 별도 처리 불필요 — 이 RAISE는 함수 전체를 감싸는 아래
      -- EXCEPTION WHEN OTHERS에서 잡히고, PL/pgSQL이 이 BEGIN 블록 시작 시점의
      -- 암묵적 savepoint로 자동 롤백하므로 방금 증가시킨 카운터도 함께 되돌아간다.
      RAISE EXCEPTION 'COUPON_ISSUE_SEQ_EXCEEDED: 발행 순번 한도에 도달했습니다. (parent_max_sequence=%, 현재=%)',
        v_parent_max_sequence, v_issue_seq;
    END IF;

    v_code_series := p_code_series || jsonb_build_object('issue_seq', v_issue_seq);
  ELSE
    v_code_series := p_code_series;
  END IF;

  INSERT INTO public.coupons (
    code, type, discount_type, discount_value, usage_limit,
    min_purchase_amount, valid_from, valid_until, description,
    is_active, usage_count,
    min_rental_amount, min_rental_days, max_discount_amount,
    applicable_categories, user_grade_required, is_first_rental_only,
    per_user_limit, total_usage_limit,
    is_student_only, is_walk_in_only, is_subscription_only,
    auto_issue_enabled, auto_issue_schedule, distribution_target,
    validity_type, allow_with_points, allow_stacking,
    code_series, code_mode,
    display_name,
    valid_days,
    auto_distribute_enabled
  ) VALUES (
    NULLIF(TRIM(p_code), ''),
    p_type::public.coupon_type_enum, p_discount_type, p_discount_value, p_usage_limit,
    p_min_purchase_amount,
    CASE WHEN p_validity_type IN ('unlimited', 'relative_days') THEN NULL ELSE p_valid_from  END,
    CASE WHEN p_validity_type IN ('unlimited', 'relative_days') THEN NULL ELSE p_valid_until END,
    p_description,
    TRUE, 0,
    p_min_rental_amount, p_min_rental_days, p_max_discount_amount,
    p_applicable_categories, p_user_grade_required, p_is_first_rental_only,
    p_per_user_limit, p_total_usage_limit,
    p_is_student_only, p_is_walk_in_only, p_is_subscription_only,
    p_auto_issue_enabled, p_auto_issue_schedule, p_distribution_target,
    p_validity_type, p_allow_with_points, p_allow_stacking,
    v_code_series, p_code_mode,
    NULLIF(TRIM(p_display_name), ''),
    CASE WHEN p_validity_type = 'relative_days' THEN p_valid_days ELSE NULL END,
    p_auto_distribute_enabled
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

-- ─────────────────────────────────────────────────────────
-- ROLLBACK
-- ─────────────────────────────────────────────────────────
-- 20260921090000_520_cms_create_coupon_relative_days.sql의 30-param 정의를 그대로 재실행
