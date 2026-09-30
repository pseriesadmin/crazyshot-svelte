-- Migration 604: CMS 쿠폰 수동 지급 — 사전 조회(preview_distribute_coupon) + 대상별 결과(distribute_coupon)
--
-- 배경(신고 B-8): CMS "특정 사용자 수동 지급"에서 이미 보유한 회원에게 지급을 눌러도
--   · 확인 없이 바로 실행되고
--   · INSERT ... ON CONFLICT DO NOTHING 이라 실제로는 지급되지 않는데(issued_count=0)
--     화면은 무조건 "지급되었습니다"를 표시해 운영자가 지급된 것으로 오해했다.
--   · 존재하지 않는 UUID를 넣으면 user_coupons.user_id FK 위반으로 RPC 전체가 실패할 수 있었다.
--
-- 변경:
--   1) 신규 preview_distribute_coupon(p_coupon_id, p_user_ids[]) — 지급 전 사전 조회(쓰기 없음).
--      대상별 상태: will_issue(지급 가능) / already_held(이미 보유, 미사용) / already_used(이미 사용) / not_found(없는 회원)
--   2) distribute_coupon — 기존 반환 키(ok, issued_count, distribution_id)는 그대로 두고,
--      specific_user 대상일 때만 results[](대상별 issued/already_held/already_used/not_found)를 추가 반환.
--      존재하지 않는 회원은 INSERT 대상에서 제외(FK 위반으로 전체 실패하던 경로 차단).
--      all / grade 대상은 동작·반환 모두 변경 없음.
--
-- ⛔ 1인당 사용 횟수 2 이상 "추가 지급"은 이 마이그레이션 범위 밖이다.
--    user_coupons에 UNIQUE(user_id, coupon_id)가 있어 스키마 변경이 전제다(별도 승인 단계).

CREATE OR REPLACE FUNCTION public.preview_distribute_coupon(
  p_coupon_id UUID,
  p_user_ids  UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit   INT;
  v_results JSONB;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  SELECT per_user_limit INTO v_limit
  FROM coupons
  WHERE id = p_coupon_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_NOT_FOUND');
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'user_id', u.uid,
             'status', CASE
               WHEN NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = u.uid) THEN 'not_found'
               WHEN EXISTS (SELECT 1 FROM user_coupons uc
                             WHERE uc.user_id = u.uid AND uc.coupon_id = p_coupon_id
                               AND uc.used_at IS NOT NULL) THEN 'already_used'
               WHEN EXISTS (SELECT 1 FROM user_coupons uc
                             WHERE uc.user_id = u.uid AND uc.coupon_id = p_coupon_id) THEN 'already_held'
               ELSE 'will_issue'
             END
           ) ORDER BY u.ord
         ), '[]'::jsonb)
  INTO v_results
  FROM UNNEST(COALESCE(p_user_ids, '{}'::UUID[])) WITH ORDINALITY AS u(uid, ord);

  RETURN jsonb_build_object('ok', true, 'per_user_limit', v_limit, 'results', v_results);
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_distribute_coupon(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_distribute_coupon(UUID, UUID[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.distribute_coupon(
  p_coupon_id   UUID,
  p_target_type TEXT,
  p_target_meta JSONB DEFAULT NULL,
  p_admin_id    UUID DEFAULT NULL
)
RETURNS JSONB
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
  v_issued_uids  UUID[] := '{}';
  v_results      JSONB := NULL;
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
    -- 중복 입력 제거(같은 UUID를 두 번 넣어도 결과는 1건)
    SELECT ARRAY_AGG(DISTINCT val::UUID) INTO v_users
    FROM jsonb_array_elements_text(p_target_meta->'user_ids') AS val;

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TARGET_TYPE');
  END IF;

  IF p_target_type = 'specific_user' THEN
    -- 실제로 새로 삽입된 사용자만 집계(RETURNING). 존재하지 않는 회원은 FK 위반을 피하려 대상에서 제외.
    WITH ins AS (
      INSERT INTO user_coupons (user_id, coupon_id)
      SELECT uid, p_coupon_id
      FROM UNNEST(v_users) AS uid
      WHERE EXISTS (SELECT 1 FROM auth.users au WHERE au.id = uid)
      ON CONFLICT (user_id, coupon_id) DO NOTHING
      RETURNING user_id
    )
    SELECT COALESCE(ARRAY_AGG(user_id), '{}') INTO v_issued_uids FROM ins;

    v_issued_count := COALESCE(array_length(v_issued_uids, 1), 0);

    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'user_id', u.uid,
               'status', CASE
                 WHEN u.uid = ANY(v_issued_uids) THEN 'issued'
                 WHEN NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = u.uid) THEN 'not_found'
                 WHEN EXISTS (SELECT 1 FROM user_coupons uc
                               WHERE uc.user_id = u.uid AND uc.coupon_id = p_coupon_id
                                 AND uc.used_at IS NOT NULL) THEN 'already_used'
                 ELSE 'already_held'
               END
             ) ORDER BY u.ord
           ), '[]'::jsonb)
    INTO v_results
    FROM UNNEST(COALESCE(v_users, '{}'::UUID[])) WITH ORDINALITY AS u(uid, ord);
  ELSE
    -- all / grade: 기존 동작 그대로
    INSERT INTO user_coupons (user_id, coupon_id)
    SELECT uid, p_coupon_id
    FROM UNNEST(v_users) AS uid
    ON CONFLICT (user_id, coupon_id) DO NOTHING;

    GET DIAGNOSTICS v_issued_count = ROW_COUNT;
  END IF;

  -- 배포 이력 기록
  INSERT INTO coupon_distributions (coupon_id, admin_id, target_type, target_meta, issued_count)
  VALUES (p_coupon_id, COALESCE(p_admin_id, auth.uid()), p_target_type, p_target_meta, v_issued_count)
  RETURNING id INTO v_dist_id;

  IF v_results IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'issued_count', v_issued_count, 'distribution_id', v_dist_id);
  END IF;
  RETURN jsonb_build_object('ok', true, 'issued_count', v_issued_count, 'distribution_id', v_dist_id, 'results', v_results);
END;
$function$;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS public.preview_distribute_coupon(UUID, UUID[]);
-- distribute_coupon은 이전 정의(results 없음, 존재하지 않는 회원 제외 로직 없음)로 CREATE OR REPLACE:
--   20260923040000_528_coupon_grade_to_classification.sql 의 distribute_coupon 정의 참고
