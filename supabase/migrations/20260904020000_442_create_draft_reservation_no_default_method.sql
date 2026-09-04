-- Migration #442: create_draft_reservation — pickup_method/return_method 기본값 'visit' 제거
--
-- 배경: 장바구니 "담기"(날짜·방식 선택 없는 draft 예약)로 생성된 예약행에 pickup_method/
-- return_method가 처음부터 문자열 'visit'로 하드코딩되어 있어, 카트 최초 진입 시 수령/반납
-- 방식 콤보바에 '방문'이 이미 선택된 것처럼 보이는 결함의 실제 원인이었다(컬럼 자체는 NULL
-- 허용, 체크 제약 없음 — 앱 코드 cart/+page.svelte는 이미 null을 빈 선택으로 정확히 표시하도록
-- 2026-09-04 수정 완료, 이 마이그레이션은 그 앞단인 DB 값 자체를 NULL로 바로잡는다).
--
-- 변경 내용: INSERT 값의 'visit', 'visit' → NULL, NULL. 그 외 로직(권한 검증, 상품 존재
-- 확인, 반환 타입)은 전부 동일 — CREATE OR REPLACE로 기존 함수를 그대로 대체한다.

CREATE OR REPLACE FUNCTION public.create_draft_reservation(p_product_id uuid)
 RETURNS TABLE(success boolean, reservation_id bigint, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    NULL, NULL
  )
  RETURNING id INTO v_reservation_id;

  RETURN QUERY SELECT true, v_reservation_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, NULL::BIGINT, SQLERRM;
END;
$function$;
