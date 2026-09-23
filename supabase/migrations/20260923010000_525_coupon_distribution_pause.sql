-- Migration #525: 쿠폰 "신규 배포 중단/재개" 토글
--
-- 배경(Stephen 2026-09-23 확정): 쿠폰 상세 패널의 "상태(활성/비활성)" 행 옆에, 관리자가
-- 이 쿠폰을 새로운 대상에게 배포하는 것만 잠시 멈췄다가 다시 재개할 수 있는 토글을
-- 추가한다. is_active(쿠폰 자체의 사용 가능 여부)와는 완전히 별개 축이다 — 이미 배포받은
-- 고객은 이 토글과 무관하게 계속 정상적으로 쿠폰을 확인·사용할 수 있어야 하며, 이 토글은
-- 오직 distribute_coupon RPC(관리자 수동 배포 + approve_pending_coupon_gift의 쿠폰선물
-- 승인이 내부적으로 호출하는 배포 경로 둘 다 포함)의 "신규 배포" 진입점 한 곳만 차단한다.
-- 장바구니·마이페이지 쿠폰 목록 조회 쿼리는 이 컬럼을 전혀 참조하지 않는다(의도적 — 이미
-- 배포된 고객의 열람·사용 경험에 영향 없음).

-- ── STEP 1: coupons.distribution_enabled 컬럼 추가 ─────────────────────────────
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS distribution_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.coupons.distribution_enabled IS
  '신규 배포 허용 여부(관리자 토글). false면 distribute_coupon RPC가 신규 배포를 거부한다.
   is_active(쿠폰 자체 사용 가능 여부)와 무관 — 이미 배포받은 고객의 열람·사용에는 영향 없음.';

-- ── STEP 2: distribute_coupon — 신규 배포 시점에 distribution_enabled 체크 추가 ──
-- 파라미터 개수가 그대로라(p_coupon_id, p_target_type, p_target_meta, p_admin_id) DROP 없이
-- CREATE OR REPLACE로 교체 가능 — 기존 GRANT(authenticated/postgres/service_role)도 그대로
-- 보존된다(core-rules.md Postgres 함수 오버로드 규칙 — 파라미터 개수 불변 시 REPLACE는 안전).
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

  IF NOT v_coupon.distribution_enabled THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DISTRIBUTION_PAUSED');
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

-- ── STEP 3: cms_toggle_coupon_distribution — 토글 전용 RPC(cms_toggle_coupon과 동일 패턴) ──
CREATE OR REPLACE FUNCTION public.cms_toggle_coupon_distribution(p_id uuid)
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
     SET distribution_enabled = NOT distribution_enabled
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

-- 신규 생성 함수는 Supabase 프로젝트 전역 ALTER DEFAULT PRIVILEGES가 anon에게 자동으로
-- EXECUTE를 부여한다(DRIFT_CHECK_PROCEDURE.md §2) — CMS 전용(cms_toggle_coupon과 동일
-- 권한 수준)이므로 명시적으로 REVOKE 후 authenticated만 재부여한다.
REVOKE ALL ON FUNCTION public.cms_toggle_coupon_distribution(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cms_toggle_coupon_distribution(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cms_toggle_coupon_distribution(uuid) TO authenticated;
