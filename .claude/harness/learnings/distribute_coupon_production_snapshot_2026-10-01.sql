-- Production(vnbpmvxruyciuuaermyh) distribute_coupon 적용 전 스냅샷 (2026-10-01, Migration 604 적용 직전)
-- 공백 제거 md5 = 16b02960fc7a03cbe675645d940367e0  — 롤백 시 아래 정의로 CREATE OR REPLACE,
-- 신규 함수는 DROP FUNCTION IF EXISTS public.preview_distribute_coupon(UUID, UUID[]);

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

  INSERT INTO user_coupons (user_id, coupon_id)
  SELECT uid, p_coupon_id
  FROM UNNEST(v_users) AS uid
  ON CONFLICT (user_id, coupon_id) DO NOTHING;

  GET DIAGNOSTICS v_issued_count = ROW_COUNT;

  INSERT INTO coupon_distributions (coupon_id, admin_id, target_type, target_meta, issued_count)
  VALUES (p_coupon_id, COALESCE(p_admin_id, auth.uid()), p_target_type, p_target_meta, v_issued_count)
  RETURNING id INTO v_dist_id;

  RETURN jsonb_build_object('ok', true, 'issued_count', v_issued_count, 'distribution_id', v_dist_id);
END;
$function$;
