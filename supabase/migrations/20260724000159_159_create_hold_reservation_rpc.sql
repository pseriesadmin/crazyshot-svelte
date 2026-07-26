-- Migration 159: create_hold_reservation RPC
-- 상품 상세 → 예약하기 시 hold 예약 생성
-- assets.id / rental_reservations.id 가 BIGINT 기반임을 반영

DROP FUNCTION IF EXISTS public.create_hold_reservation(UUID, DATE, DATE);

CREATE FUNCTION public.create_hold_reservation(
  p_product_id UUID,
  p_start_date DATE,
  p_end_date   DATE
)
RETURNS TABLE (
  success         BOOLEAN,
  reservation_id  BIGINT,
  asset_id        BIGINT,
  error_message   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID;
  v_asset_id       BIGINT;
  v_reservation_id BIGINT;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '로그인이 필요합니다.';
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

  SELECT a.id INTO v_asset_id
  FROM assets a
  WHERE a.product_id = p_product_id
    AND a.status = 'available'
    AND a.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM rental_reservations rr
      WHERE rr.asset_id = a.id
        AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired')
        AND daterange(rr.start_date, rr.end_date, '[]') &&
            daterange(p_start_date, p_end_date, '[]')
    )
  ORDER BY a.id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_asset_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '해당 기간에 예약 가능한 장비가 없습니다.';
    RETURN;
  END IF;

  INSERT INTO rental_reservations (
    user_id, product_id, asset_id, status,
    start_date, end_date,
    pickup_method, return_method
  )
  VALUES (
    v_user_id, p_product_id, v_asset_id, 'hold',
    p_start_date, p_end_date,
    'visit', 'visit'
  )
  RETURNING id INTO v_reservation_id;

  UPDATE assets SET status = 'hold', updated_at = NOW() WHERE id = v_asset_id;

  RETURN QUERY SELECT true, v_reservation_id, v_asset_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_hold_reservation(UUID, DATE, DATE) TO authenticated;
