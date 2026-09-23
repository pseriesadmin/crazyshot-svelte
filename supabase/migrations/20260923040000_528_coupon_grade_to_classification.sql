-- Migration #528: 쿠폰 배포 대상 "필수 회원 등급" → 실제 "회원 분류"(일반/학생/구독) 기준 교정
--
-- 배경(Stephen 2026-09-23 지적): Migration #527에서 BASIC/PRO 하드코딩 결함을
-- subscription_plans(EASY/POP/CRAZY 구독 티어) 기준으로 고쳤으나, 이것도 정답이 아니었다.
-- CMS 고객 관리 화면(CustomerDetailPanel.svelte·cms/customers/+page.svelte)이 이미
-- 확립해 둔 "회원 분류"(일반/학생/구독, 2026-09-01 재구성)가 이 서비스의 진짜 고객 분류
-- 기준이다 — subscription_plans의 EASY/POP/CRAZY는 "고객 등급"이 아니라 "정기구독
-- 상품의 개별 티어"일 뿐이라는 게 그 재구성 당시 이미 명문화돼 있었다(본 파일 주석 인용):
--   "easy/pop/crazy(membership_grade)는 고객등급이 아니라 정기구독 상품 티어이므로,
--    실제 고객 분류는 인증 상태 기준 3종으로 별도 정의한다."
-- 분류 판정 로직(classificationsOf, CustomerDetailPanel.svelte):
--   is_student=true              → 'student'(학생)
--   membership_grade NOT NULL/NONE → 'subscriber'(구독, 티어 무관 — 셋 다 동일하게 묶임)
--   위 둘 다 아니면                → 'general'(일반)
--   (학생이면서 동시에 구독자일 수 있음 — 복수 태그 허용, Stephen 확정)
--
-- 이번 마이그레이션은 "필수 [X]" 조건의 자동배포 매칭 로직을 이 실제 분류 기준에 맞춘다.
-- 화면 드롭다운 값도 general/student/subscriber로 앱 코드에서 함께 교체됨(같은 커밋).
-- 컬럼명(user_grade_required)은 그대로 유지 — 세 번째 재정의라 추가 rename보다 주석으로
-- 정확한 의미를 문서화하는 쪽을 택함(과도한 스키마 churn 방지).

COMMENT ON COLUMN public.coupons.user_grade_required IS
  '필수 회원 분류 조건(컬럼명은 레거시, 실제로는 "등급"이 아님) — NULL=전체 회원,
   ''general''=일반(학생도 구독자도 아님), ''student''=학생 인증 계정,
   ''subscriber''=정기구독 중(티어 무관, EASY/POP/CRAZY 전부 포함).
   /cms/customers CustomerDetailPanel.svelte classificationsOf()와 동일 판정 기준
   (Migration #528, 2026-09-23 — Migration #527의 구독 티어 기준을 대체).';

-- ── auto_distribute_eligible_coupons — 회원 분류 기준으로 매칭 로직 교정 ──────────
CREATE OR REPLACE FUNCTION public.auto_distribute_eligible_coupons()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_coupon       RECORD;
  v_issued_count INT;
  v_total_issued INT := 0;
  v_coupons_run  INT := 0;
BEGIN
  FOR v_coupon IN
    SELECT id, user_grade_required
    FROM public.coupons
    WHERE auto_distribute_enabled = true
      AND is_active = true
      AND deleted_at IS NULL
  LOOP
    v_coupons_run := v_coupons_run + 1;

    INSERT INTO public.user_coupons (user_id, coupon_id)
    SELECT up.id, v_coupon.id
    FROM public.user_profiles up
    WHERE v_coupon.user_grade_required IS NULL
       OR (
            v_coupon.user_grade_required = 'general'
            AND NOT COALESCE(up.is_student, false)
            AND (up.membership_grade IS NULL OR up.membership_grade = 'NONE')
          )
       OR (
            v_coupon.user_grade_required = 'student'
            AND COALESCE(up.is_student, false)
          )
       OR (
            v_coupon.user_grade_required = 'subscriber'
            AND up.membership_grade IS NOT NULL
            AND up.membership_grade != 'NONE'
          )
    ON CONFLICT (user_id, coupon_id) DO NOTHING;

    GET DIAGNOSTICS v_issued_count = ROW_COUNT;
    v_total_issued := v_total_issued + v_issued_count;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'coupons_processed', v_coupons_run, 'total_issued', v_total_issued);
END;
$function$;

-- ── distribute_coupon — 'grade' target_type 분기도 동일 기준으로 교정(현재 UI에서는
-- 호출 경로가 없는 죽은 분기이지만, RPC 자체는 여전히 이 값을 받아들이므로 방치하면
-- 향후 재사용 시 동일한 오판정 함정이 재발한다. 파라미터 개수 불변 — REPLACE로 안전) ──
CREATE OR REPLACE FUNCTION public.distribute_coupon(p_coupon_id uuid, p_target_type text, p_target_meta jsonb DEFAULT NULL::jsonb, p_admin_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_coupon       RECORD;
  v_users        UUID[];
  v_issued_count INT := 0;
  v_dist_id      UUID;
  v_grade        TEXT;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  SELECT * INTO v_coupon FROM coupons WHERE id = p_coupon_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_NOT_FOUND');
  END IF;

  -- 대상 사용자 수집
  IF p_target_type = 'all' THEN
    SELECT ARRAY_AGG(id) INTO v_users FROM auth.users;

  ELSIF p_target_type = 'grade' THEN
    v_grade := p_target_meta->>'grade';
    SELECT ARRAY_AGG(up.id) INTO v_users
    FROM user_profiles up
    WHERE (v_grade = 'general' AND NOT COALESCE(up.is_student, false) AND (up.membership_grade IS NULL OR up.membership_grade = 'NONE'))
       OR (v_grade = 'student' AND COALESCE(up.is_student, false))
       OR (v_grade = 'subscriber' AND up.membership_grade IS NOT NULL AND up.membership_grade != 'NONE');

  ELSIF p_target_type = 'specific_user' THEN
    SELECT ARRAY_AGG(val::UUID) INTO v_users
    FROM jsonb_array_elements_text(p_target_meta->'user_ids') AS val;

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TARGET_TYPE');
  END IF;

  -- B-4 FIX: issued_at → created_at (user_coupons 실제 컬럼명)
  INSERT INTO user_coupons (user_id, coupon_id)
  SELECT uid, p_coupon_id
  FROM UNNEST(v_users) AS uid
  ON CONFLICT (user_id, coupon_id) DO NOTHING;

  GET DIAGNOSTICS v_issued_count = ROW_COUNT;

  -- 배포 이력 기록
  INSERT INTO coupon_distributions (coupon_id, admin_id, target_type, target_meta, issued_count)
  VALUES (p_coupon_id, COALESCE(p_admin_id, auth.uid()), p_target_type, p_target_meta, v_issued_count)
  RETURNING id INTO v_dist_id;

  RETURN jsonb_build_object('ok', true, 'issued_count', v_issued_count, 'distribution_id', v_dist_id);
END;
$function$;
