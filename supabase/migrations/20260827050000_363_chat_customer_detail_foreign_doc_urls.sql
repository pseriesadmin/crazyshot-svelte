-- Migration #363: get_chat_customer_detail — foreign_doc_urls(다중 파일) 응답에 추가
--
-- 배경: /cms/chat CustomerDetailPanel(우측 플로팅 고객정보 카드)에 "본인증명"/"외국인증명"
-- 등록 파일 개수를 표시하는 신규 항목을 추가한다(Stephen 2026-08-27 요청). identity_doc_url은
-- 이미 배열(TEXT[])로 반환되고 있어 정확한 등록 파일 개수를 셀 수 있지만, foreign_doc_url은
-- 하위호환용 단일 파일(첫 번째 파일)만 반환해 실제로 최대 4개까지 등록 가능한
-- foreign_doc_urls(Migration #360)와 개수가 불일치할 수 있다. foreign_doc_urls를 함께
-- 반환해 두 항목의 표시 방식을 대칭으로 맞춘다.
--
-- 변경 범위: SELECT 목록에 필드 1개 추가만 — 함수 시그니처(파라미터)·기존 반환 필드는
-- 100% 동일 유지. Migration 236(현재 배포본) 본문 그대로 + foreign_doc_urls 1줄 추가라
-- CREATE OR REPLACE로 충분(파라미터 개수 변경 없음).

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
    'foreign_doc_url',      up.foreign_doc_url,
    'foreign_doc_urls',     up.foreign_doc_urls
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

-- ============================================================
-- ROLLBACK: Migration 236(20260813000236) 본문 그대로 재적용(foreign_doc_urls 키 제거)
-- ============================================================
