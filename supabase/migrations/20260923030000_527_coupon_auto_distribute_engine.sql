-- Migration #527: 쿠폰 "자동배포" 엔진 신설 + distribution_enabled 재설계
--
-- 배경(Stephen 2026-09-23 재설계 지시): Migration #525에서 만든 "신규 배포 중단/재개"
-- 토글(distribution_enabled)은 관리자의 수동 "배포 실행" 액션만 막는 단순 차단 스위치였다.
-- Stephen이 이를 진짜 "자동배포" 엔진으로 교체하라고 지시 — 토글을 켜두면 "필수 회원
-- 등급"(coupons.user_grade_required) 조건을 충족하는 회원에게 pg_cron이 계속 감시하며
-- 자동으로 배포(user_coupons 행 생성)한다. 관리자가 수동으로 배포 대상(전체 회원/특정
-- 등급)을 매번 선택해 "배포 실행"을 누르던 기존 방식은 이 자동 엔진과 완전히 중복되는
-- 기능이라 제거(앱 코드 쪽에서 UI만 제거 — RPC 자체는 "특정 사용자 수동 지급" 용도로
-- 계속 사용됨, 아래 STEP 3 참고).
--
-- AskUserQuestion으로 확인된 설계 결정 2건:
--   ① 자동배포 방식: "계속 감시"(추천) — 토글이 켜져 있는 동안, 새로 가입하거나 등급이
--      바뀌어 조건을 충족하게 된 회원에게도 계속 자동 지급된다. pg_cron이 주기적으로 이
--      함수를 호출하는 방식으로 구현(1회성 스냅샷 배포가 아님).
--   ② "특정 사용자 UUID" 수동 지급 기능은 자동배포와 완전히 별개로 유지 — 채팅 쿠폰선물과
--      무관하게 관리자가 특정 고객 1명에게 예외적으로 지급하는 용도라 계속 필요.

-- ── STEP 1: 컬럼 재설계 — distribution_enabled → auto_distribute_enabled ──────────
ALTER TABLE public.coupons
  RENAME COLUMN distribution_enabled TO auto_distribute_enabled;

COMMENT ON COLUMN public.coupons.auto_distribute_enabled IS
  '자동배포 활성 여부(관리자 토글). true면 "필수 회원 등급" 조건을 충족하는 회원에게
   pg_cron(auto-distribute-eligible-coupons)이 주기적으로 자동 배포한다. is_active(쿠폰
   자체 사용 가능 여부)·"특정 사용자 수동 지급"과는 완전히 별개 축.';

-- ── STEP 2: distribute_coupon — DISTRIBUTION_PAUSED 체크 제거 ─────────────────────
-- "특정 사용자 수동 지급"은 자동배포 토글 상태와 무관하게 항상 가능해야 한다(Stephen
-- 확정) — Migration #525에서 추가했던 차단 체크를 제거하고 그 이전 상태로 되돌린다.
-- 파라미터 개수 불변(4개 그대로) — DROP 없이 CREATE OR REPLACE로 안전하게 교체 가능.
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
    SELECT ARRAY_AGG(id) INTO v_users
    FROM user_profiles
    WHERE membership_grade = (p_target_meta->>'grade');

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

-- ── STEP 3: cms_toggle_coupon_distribution 제거 → cms_toggle_coupon_auto_distribute 신설 ──
-- Migration #525에서 만든 함수는 아직 Production에 배포된 적 없고(Stage 전용, 미커밋)
-- 앱 코드에서도 더 이상 참조하지 않으므로 안전하게 DROP.
DROP FUNCTION IF EXISTS public.cms_toggle_coupon_distribution(uuid);

CREATE OR REPLACE FUNCTION public.cms_toggle_coupon_auto_distribute(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  UPDATE public.coupons
     SET auto_distribute_enabled = NOT auto_distribute_enabled
   WHERE id = p_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.cms_toggle_coupon_auto_distribute(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cms_toggle_coupon_auto_distribute(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cms_toggle_coupon_auto_distribute(uuid) TO authenticated;

-- ── STEP 4: auto_distribute_eligible_coupons — 자동배포 엔진 본체 ─────────────────
-- pg_cron이 주기적으로 호출. auto_distribute_enabled=true인 활성 쿠폰마다, "필수 회원
-- 등급" 조건을 충족하는 회원 중 아직 이 쿠폰을 못 받은 사람에게 새로 배포한다
-- (ON CONFLICT DO NOTHING이라 이미 받은 사람은 건드리지 않음 — 매 실행마다 "새로
-- 조건을 충족하게 된 사람"만 추가로 잡힘, ①"계속 감시" 요구사항 충족).
--
-- coupon_distributions에는 기록하지 않는다 — 그 테이블의 admin_id가 NOT NULL FK라
-- 사람이 아닌 시스템(cron) 기동에 채워 넣을 만한 값이 없다(가짜 UUID를 억지로 채우면
-- "누가 배포했나"라는 감사 목적 자체가 오염된다). 실제 배포 결과는 user_coupons에
-- 정확히 남으므로 기능상 문제 없음 — "배포 이력" 아코디언에는 자동배포 건이 보이지
-- 않는다는 것만 알아두면 됨(수동 배포·특정 사용자 지급만 그 이력에 남음).
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
       OR up.membership_grade = v_coupon.user_grade_required
    ON CONFLICT (user_id, coupon_id) DO NOTHING;

    GET DIAGNOSTICS v_issued_count = ROW_COUNT;
    v_total_issued := v_total_issued + v_issued_count;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'coupons_processed', v_coupons_run, 'total_issued', v_total_issued);
END;
$function$;

-- CMS 세션(authenticated)에서 수동 실행(테스트·즉시 반영 요청 등) 가능하도록 권한 부여,
-- anon은 제외. pg_cron 실행은 SECURITY DEFINER라 postgres 권한으로 동작하므로 별도 권한
-- 불필요.
REVOKE ALL ON FUNCTION public.auto_distribute_eligible_coupons() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_distribute_eligible_coupons() FROM anon;
GRANT EXECUTE ON FUNCTION public.auto_distribute_eligible_coupons() TO authenticated;

-- ── STEP 5: pg_cron 등록 — 30분마다 실행 ─────────────────────────────────────────
-- 이 프로젝트의 다른 pg_cron 잡들과 동일 컨벤션(hold_expiration_cleanup 1분,
-- locker-guide 10분, auto_pending_inactive_sessions 3시간)과 비교해, 쿠폰 자동배포는
-- 시간에 민감하지 않아 30분 간격으로 설정 — 필요 시 추후 조정 가능.
SELECT cron.schedule(
  'auto-distribute-eligible-coupons',
  '*/30 * * * *',
  $$SELECT public.auto_distribute_eligible_coupons()$$
);
