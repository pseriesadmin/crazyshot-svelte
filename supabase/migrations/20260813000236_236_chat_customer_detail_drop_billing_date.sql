-- Migration 236: get_chat_customer_detail — "멤버십 갱신일" 부분만 축소, 나머지는 유지
--
-- 배경: Stephen 요청("2번으로 축소해서 적용해") — production의 user_subscriptions에는
--   next_billing_date 컬럼이 없어(migration 235 코멘트 참고, 이 프로젝트의 다른 진행 중인
--   구독 기능 작업이 아직 production에 반영되지 않은 상태) 229를 그대로 적용할 수 없었다.
--   user_subscriptions.plan_id / status / user_id / created_at 및 subscription_plans.name은
--   stage·production 양쪽에 모두 존재하므로, "갱신일(next_billing_date)" 키 하나만 응답에서
--   제거하고 "구독중 여부 + 플랜명"은 그대로 유지한다.
--
-- stage(ezyvffjvuwmtuhpxdjrw)·production(vnbpmvxruyciuuaermyh) 양쪽에 동일하게 적용 —
--   stage는 229로 이미 정의돼 있던 함수를 이 버전으로 교체(CREATE OR REPLACE),
--   production은 이 버전으로 최초 생성.

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

  -- 2. user_subscriptions — 구독중 여부 + 플랜명만 (next_billing_date는 production 미보유로 제외)
  SELECT jsonb_build_object(
    'plan_name', sp.name
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

REVOKE EXECUTE ON FUNCTION public.get_chat_customer_detail(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_customer_detail(uuid) TO service_role;
