-- Migration #306: 비회원(익명) 예약 생성 RPC 레벨 차단 (Stephen 승인 2026-08-19)
-- (원래 #301로 생성됐으나 동시 진행 중이던 다른 세션의 coupon_redemptions_land_on_rental
--  마이그레이션과 번호 충돌 확인되어 #306으로 재번호 — 내용 변경 없음, Migration #185/#286과
--  동일한 재번호 관례. stage·production 두 DB에는 이미 원래 이름(301_block_anonymous_
--  reservation_creation)으로 schema_migrations에 기록·적용 완료된 상태 — 이 파일 재번호는
--  로컬 파일 이력 정리 목적이며 이미 적용된 DB 상태에는 영향 없음)
-- 배경: "비회원 예약 → 회원 예약" 정책이 2026-08-18 확정됐으나, 실제로는 화면 진입점 2곳
--       (products/[id] handleReserve, /cart 서버 로드)에서만 isRealMemberSession()으로
--       막혀 있었고, 예약을 실제로 생성하는 RPC(create_hold_reservation/create_draft_
--       reservation)는 auth.uid() IS NULL(완전 비로그인)만 검사할 뿐 signInAnonymously()로
--       발급된 익명 세션(auth.uid()는 존재, auth.users.is_anonymous = true)은 걸러내지
--       못했다 — 즉 화면을 우회해 RPC를 직접 호출하면 지금도 비회원 예약이 생성 가능한
--       상태였다. 이 마이그레이션은 그 RPC 레벨 공백만 막는다.
--
-- ⚠️ 추후 비회원 예약대여 재오픈 시: 아래 두 함수에서 "비회원 차단(재오픈 시 제거)" 표시된
--    IF 블록만 삭제하면 원상복구된다. 그 외 로직(재고배정·블랙리스트·신용점수 체크 등)은
--    전혀 손대지 않았다.

CREATE OR REPLACE FUNCTION public.create_hold_reservation(
  p_product_id UUID,
  p_start_date DATE,
  p_end_date   DATE
)
RETURNS TABLE(success BOOLEAN, reservation_id BIGINT, asset_id BIGINT, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id        UUID;
  v_is_anonymous   BOOLEAN;
  v_unit_id        UUID;
  v_reservation_id BIGINT;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '로그인이 필요합니다.';
    RETURN;
  END IF;

  -- 비회원(익명) 차단 (재오픈 시 이 블록만 제거)
  SELECT is_anonymous INTO v_is_anonymous FROM auth.users WHERE id = v_user_id;
  IF v_is_anonymous IS TRUE THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '회원 가입 후 예약이 가능합니다.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = v_user_id AND blacklisted = true
  ) THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '서비스 이용이 제한된 계정입니다.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = v_user_id AND credit_score < 30
  ) THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '신용점수가 낮아 예약이 제한됩니다.';
    RETURN;
  END IF;

  SELECT p.id INTO v_unit_id
  FROM products p
  WHERE p.parent_product_id = p_product_id
    AND p.deleted_at IS NULL
    AND p.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM rental_reservations rr
      WHERE rr.product_id = p.id
        AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired')
        AND daterange(rr.start_date, rr.end_date, '[]') &&
            daterange(p_start_date, p_end_date, '[]')
    )
  ORDER BY p.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_unit_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '해당 기간에 예약 가능한 재고가 없습니다.';
    RETURN;
  END IF;

  INSERT INTO rental_reservations (
    user_id, product_id, status,
    start_date, end_date,
    pickup_method, return_method
  )
  VALUES (
    v_user_id, v_unit_id, 'hold',
    p_start_date, p_end_date,
    'visit', 'visit'
  )
  RETURNING id INTO v_reservation_id;

  RETURN QUERY SELECT true, v_reservation_id, NULL::BIGINT, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_draft_reservation(
  p_product_id UUID
)
RETURNS TABLE(success BOOLEAN, reservation_id BIGINT, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id        UUID;
  v_is_anonymous   BOOLEAN;
  v_reservation_id BIGINT;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '로그인이 필요합니다.';
    RETURN;
  END IF;

  -- 비회원(익명) 차단 (재오픈 시 이 블록만 제거)
  SELECT is_anonymous INTO v_is_anonymous FROM auth.users WHERE id = v_user_id;
  IF v_is_anonymous IS TRUE THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '회원 가입 후 예약이 가능합니다.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = v_user_id AND blacklisted = true
  ) THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '서비스 이용이 제한된 계정입니다.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = v_user_id AND credit_score < 30
  ) THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '신용점수가 낮아 예약이 제한됩니다.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM products WHERE id = p_product_id AND deleted_at IS NULL
  ) THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '상품을 찾을 수 없습니다.';
    RETURN;
  END IF;

  INSERT INTO rental_reservations (
    user_id, product_id, status,
    start_date, end_date,
    pickup_method, return_method
  )
  VALUES (
    v_user_id, p_product_id, 'draft',
    NULL, NULL,
    'visit', 'visit'
  )
  RETURNING id INTO v_reservation_id;

  RETURN QUERY SELECT true, v_reservation_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, NULL::BIGINT, SQLERRM;
END;
$$;

-- rollback (비회원 예약 재오픈 시):
-- 위 두 함수에서 "비회원(익명) 차단" 주석이 붙은 IF 블록만 제거하고 CREATE OR REPLACE 재적용
