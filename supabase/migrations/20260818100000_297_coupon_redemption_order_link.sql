-- Migration 297: 쿠폰 사용(채번) ↔ 주문(order) 연결 + CMS 채번내역 조회 RPC
-- 배경: Stephen 요청 — 쿠폰 관리 화면에서 "코드 채번 사용 목록"을 보고, 각 항목을 클릭하면
--   해당 예약(rental_reservations)의 CMS 예약현황/대여현황 상세로 랜딩하고 싶어함.
--   조사 결과 user_coupons에는 예약/주문을 가리키는 컬럼이 전혀 없어(원 스키마부터 부재)
--   이 랜딩 자체가 불가능했음 — Stephen 확인 후 선행 스키마 작업으로 확정.
--
-- 설계: reservation_id가 아니라 order_id로 연결한다 — 한 번의 체크아웃(주문)에 예약이 여러
--   건 묶여도 쿠폰 사용 기록은 딱 1번만 남는 N:1 구조라(confirm-mock 참고), 특정 reservation_id
--   1개를 직접 못 박을 근거가 없다. order_id로 연결해두면 그 주문에 묶인 예약들(order_items)
--   중 대표 1건(가장 먼저 연결된 것 — QR 스캔 등 기존 관례와 동일 원칙)을 조회 시점에 골라
--   랜딩 타깃으로 삼을 수 있다.
--
-- STEP 1: user_coupons.order_id 컬럼 신설(FK, nullable — 기존 행·manual 모드는 계속 NULL)
-- STEP 2: use_coupon에 p_order_id 파라미터 추가 — 기존 2-param 오버로드는 명시적으로 DROP
--   해야 한다(파라미터 추가 시 CREATE OR REPLACE가 기존 함수를 "교체"하지 않고 별도 오버로드로
--   "추가"하는 Postgres 동작 — 오늘 세션 migration 294에서 cms_create_coupon으로 이미 한 번
--   겪은 결함과 동일 원인이라 이번엔 처음부터 DROP을 포함한다)
-- STEP 3: get_coupon_redemptions RPC 신규 — 코드/사용일시/사용계정 + 대표 예약(id·status) 조회
-- 2026-08-18

-- ─────────────────────────────────────────────────────────
-- STEP 1: user_coupons.order_id
-- ─────────────────────────────────────────────────────────
ALTER TABLE public.user_coupons
  ADD COLUMN IF NOT EXISTS order_id BIGINT REFERENCES public.orders(id);

-- ─────────────────────────────────────────────────────────
-- STEP 2: use_coupon — p_order_id 파라미터 추가 (구 2-param 오버로드 명시적 제거)
-- ─────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.use_coupon(UUID, UUID);

CREATE OR REPLACE FUNCTION public.use_coupon(
  p_user_id        UUID,
  p_user_coupon_id UUID,
  p_order_id       BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uc RECORD;
  v_redeemed_code TEXT;
BEGIN
  SELECT uc.id, uc.coupon_id, uc.used_at, c.is_active, c.deleted_at, c.valid_from, c.valid_until
  INTO v_uc
  FROM user_coupons uc
  JOIN coupons c ON c.id = uc.coupon_id
  WHERE uc.id = p_user_coupon_id AND uc.user_id = p_user_id
  FOR UPDATE OF uc;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_NOT_FOUND');
  END IF;

  IF v_uc.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_USED');
  END IF;

  IF NOT v_uc.is_active OR v_uc.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_INACTIVE');
  END IF;

  IF v_uc.valid_until IS NOT NULL AND v_uc.valid_until < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_EXPIRED');
  END IF;

  UPDATE user_coupons
  SET used_at = now(), used_count = used_count + 1, order_id = p_order_id
  WHERE id = p_user_coupon_id;

  UPDATE coupons
  SET usage_count = usage_count + 1
  WHERE id = v_uc.coupon_id;

  SELECT public.generate_user_coupon_redeemed_code(p_user_coupon_id) INTO v_redeemed_code;

  RETURN jsonb_build_object('ok', true, 'redeemed_code', v_redeemed_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.use_coupon(UUID, UUID, BIGINT) TO authenticated;

-- ─────────────────────────────────────────────────────────
-- STEP 3: get_coupon_redemptions — CMS "채번내역" 탭 전용 조회
--   대표 예약: order_items 중 가장 먼저 연결된 행(id 오름차순 1건) — 여러 건이 묶여도
--   하나만 대표로 랜딩 타깃 삼는다(정확한 1:1 매핑이 원천적으로 불가능함을 감안한 설계).
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_coupon_redemptions(p_coupon_id UUID)
RETURNS TABLE(
  user_coupon_id      UUID,
  redeemed_code       TEXT,
  used_at             TIMESTAMPTZ,
  user_name           TEXT,
  user_email          TEXT,
  reservation_id      BIGINT,
  reservation_status  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  RETURN QUERY
  SELECT
    uc.id,
    uc.redeemed_code,
    uc.used_at,
    up.full_name,
    up.email,
    rr.id,
    rr.status
  FROM user_coupons uc
  LEFT JOIN user_profiles up ON up.id = uc.user_id
  LEFT JOIN LATERAL (
    SELECT oi.reservation_id
    FROM order_items oi
    WHERE oi.order_id = uc.order_id
    ORDER BY oi.id ASC
    LIMIT 1
  ) first_item ON true
  LEFT JOIN rental_reservations rr ON rr.id = first_item.reservation_id
  WHERE uc.coupon_id = p_coupon_id
    AND uc.redeemed_code IS NOT NULL
  ORDER BY uc.used_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_coupon_redemptions(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_coupon_redemptions(UUID) TO service_role;

COMMENT ON FUNCTION public.get_coupon_redemptions(UUID) IS
  'CMS 쿠폰 관리 화면 "채번내역" 탭 전용. sequenced 모드 쿠폰의 실제 채번된 코드·사용일시·
   사용계정과, 그 사용이 속한 주문(order_id)에 묶인 대표 예약 1건(가장 먼저 연결된 것)의
   id·status를 반환한다. reservation_id가 NULL이면(예: 옛 결제 흐름이거나 주문 연결이
   안 된 경우) 프론트에서 랜딩 링크를 비활성 처리해야 한다.';

-- ─────────────────────────────────────────────────────────
-- ROLLBACK (필요 시 수동 실행)
-- ─────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.get_coupon_redemptions(UUID);
-- DROP FUNCTION IF EXISTS public.use_coupon(UUID, UUID, BIGINT);
-- CREATE OR REPLACE FUNCTION public.use_coupon(p_user_id UUID, p_user_coupon_id UUID)
--   -- migration 296 본문 그대로 복원
-- ALTER TABLE public.user_coupons DROP COLUMN IF EXISTS order_id;
