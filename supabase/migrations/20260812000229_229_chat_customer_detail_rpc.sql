-- Migration 229: get_chat_customer_detail RPC
-- GSD-4: P2-1 고객 상세정보 통합 조회 — N+1 금지, 단일 RPC로 3개 데이터소스 반환
-- 데이터소스: user_profiles / user_subscriptions / rental_reservations
--
-- 2026-08-13 수정: 최초 초안이 실제 스키마와 불일치해 stage 적용 전 발견·수정.
--   - user_profiles.name → 실제 컬럼명 full_name
--   - user_profiles.student_verified_at / student_doc_url → 존재하지 않음(학생 인증은 별도
--     verified_at/doc_url이 없고 is_student 플래그만 존재)
--   - foreign_users 테이블 → 존재하지 않음. 외국인 인증은 user_profiles.foreign_verified_at /
--     foreign_doc_url 컬럼으로 이미 평면화되어 있음(별도 테이블 조인 불필요)
--   - 본인인증(신분증) 정보는 user_profiles.identity_type / identity_verified_at /
--     identity_doc_url 컬럼 사용
--   - user_profiles.id = auth.users.id 기준으로 조인(기존 /api/cms/customers/[id]/summary와
--     동일 패턴, user_profiles.user_id 컬럼은 사용하지 않음)

CREATE OR REPLACE FUNCTION public.get_chat_customer_detail(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile   jsonb;
  v_sub       jsonb;
  v_reserves  jsonb;
BEGIN
  -- 1. user_profiles — 이름·전화번호·본인인증·학생/외국인 인증 정보
  SELECT jsonb_build_object(
    'name',                 up.full_name,
    'phone',                up.phone,
    'is_student',           up.is_student,
    'is_foreign',           up.is_foreign,
    'identity_type',        up.identity_type,
    'identity_verified_at', up.identity_verified_at,
    'identity_doc_url',     up.identity_doc_url,
    'foreign_verified_at',  up.foreign_verified_at,
    'foreign_doc_url',      up.foreign_doc_url
  )
  INTO v_profile
  FROM user_profiles up
  WHERE up.id = p_user_id;

  -- 2. user_subscriptions — 멤버십 갱신일 (활성 구독 중 최신)
  SELECT jsonb_build_object(
    'next_billing_date', us.next_billing_date,
    'plan_name',         sp.name
  )
  INTO v_sub
  FROM user_subscriptions us
  LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
  WHERE us.user_id = p_user_id
    AND us.status = 'active'
  ORDER BY us.created_at DESC
  LIMIT 1;

  -- 3. rental_reservations — 최근 10건 (상태·기간·상품명)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',          rr.id,
      'status',      rr.status,
      'start_date',  rr.start_date,
      'end_date',    rr.end_date,
      'product_name', p.name,
      'created_at',  rr.created_at
    ) ORDER BY rr.created_at DESC
  ), '[]'::jsonb)
  INTO v_reserves
  FROM (
    SELECT id, status, start_date, end_date, product_id, created_at
    FROM rental_reservations
    WHERE user_id = p_user_id
    ORDER BY created_at DESC
    LIMIT 10
  ) rr
  LEFT JOIN products p ON p.id = rr.product_id;

  RETURN jsonb_build_object(
    'profile',       COALESCE(v_profile, '{}'::jsonb),
    'subscription',  v_sub,
    'reservations',  COALESCE(v_reserves, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_chat_customer_detail(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_chat_customer_detail(uuid) FROM anon, authenticated;
