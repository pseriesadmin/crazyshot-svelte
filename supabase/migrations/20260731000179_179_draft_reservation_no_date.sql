-- Migration 179: 날짜 미정 임시예약(draft) 상태 신설
-- 상품상세 화면 캘린더 UI를 가리면서, 예약신청 버튼이 날짜 없이도(수량+옵션상품만으로)
-- 동작하도록 하기 위한 예약 상태 확장. 체크아웃에서 실제 날짜 입력 후 결제 확정 시
-- promote_draft_reservation으로 정식 hold 예약으로 승격된다.
-- 기존 hold 흐름(create_hold_reservation 등)은 전혀 변경하지 않는다 — 하위호환 유지.

-- STEP 1: start_date/end_date nullable 전환 (draft 상태는 날짜 미확정)
ALTER TABLE rental_reservations ALTER COLUMN start_date DROP NOT NULL;
ALTER TABLE rental_reservations ALTER COLUMN end_date   DROP NOT NULL;

-- STEP 2: status CHECK 제약에 'draft' 추가
ALTER TABLE rental_reservations DROP CONSTRAINT IF EXISTS rental_reservations_status_check;
ALTER TABLE rental_reservations ADD CONSTRAINT rental_reservations_status_check
  CHECK (status = ANY (ARRAY[
    'draft','pending','hold','confirmed','active','shipped','in_use',
    'return_requested','returned','completed','cancelled','damage_claimed'
  ]::text[]));

-- STEP 3: EXCLUDE 제약에서 draft 제외
-- (draft 행은 start_date/end_date가 NULL이라 daterange(NULL, NULL+1)이 무한대 범위로
--  해석되어 같은 상품의 모든 예약과 항상 "겹침" 오판이 발생함 — 반드시 제외해야 함)
ALTER TABLE rental_reservations DROP CONSTRAINT IF EXISTS rental_reservations_product_dates_excl;
ALTER TABLE rental_reservations
  ADD CONSTRAINT rental_reservations_product_dates_excl
  EXCLUDE USING gist (
    product_id WITH =,
    daterange(start_date, end_date + 1, '[)') WITH &&
  )
  WHERE (status <> ALL (ARRAY['cancelled', 'returned', 'completed', 'expired', 'draft']));

-- STEP 4: create_draft_reservation — 날짜 없이 draft 예약 생성 (재고 잠금 없음)
CREATE OR REPLACE FUNCTION public.create_draft_reservation(p_product_id UUID)
RETURNS TABLE(success BOOLEAN, reservation_id BIGINT, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id        UUID;
  v_reservation_id BIGINT;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '로그인이 필요합니다.';
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
$function$;

REVOKE ALL ON FUNCTION public.create_draft_reservation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_draft_reservation(UUID) TO anon, authenticated;

-- STEP 5: promote_draft_reservation — 체크아웃에서 날짜 확정 시 draft → hold 승격
-- (재고 탐색 로직은 create_hold_reservation과 동일 — 부모 product_id 아래 활성 자식 중
--  해당 기간에 겹치는 예약이 없는 것을 선점)
CREATE OR REPLACE FUNCTION public.promote_draft_reservation(
  p_reservation_id BIGINT,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(success BOOLEAN, reservation_id BIGINT, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id   UUID := auth.uid();
  v_parent_id UUID;
  v_unit_id   UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '로그인이 필요합니다.';
    RETURN;
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '대여 기간을 올바르게 입력해주세요.';
    RETURN;
  END IF;

  SELECT product_id INTO v_parent_id
  FROM rental_reservations
  WHERE id = p_reservation_id AND user_id = v_user_id AND status = 'draft'
  FOR UPDATE;

  IF v_parent_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '예약 정보를 찾을 수 없습니다.';
    RETURN;
  END IF;

  SELECT p.id INTO v_unit_id
  FROM products p
  WHERE p.parent_product_id = v_parent_id
    AND p.deleted_at IS NULL
    AND p.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM rental_reservations rr
      WHERE rr.product_id = p.id
        AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
        AND daterange(rr.start_date, rr.end_date, '[]') &&
            daterange(p_start_date, p_end_date, '[]')
    )
  ORDER BY p.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_unit_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '해당 기간에 예약 가능한 재고가 없습니다.';
    RETURN;
  END IF;

  UPDATE rental_reservations
  SET product_id = v_unit_id,
      start_date = p_start_date,
      end_date   = p_end_date,
      status     = 'hold'
  WHERE id = p_reservation_id AND user_id = v_user_id AND status = 'draft';

  RETURN QUERY SELECT true, p_reservation_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, NULL::BIGINT, SQLERRM;
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_draft_reservation(BIGINT, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_draft_reservation(BIGINT, DATE, DATE) TO anon, authenticated;

-- STEP 6: set_reservation_options — draft 상태에서도 옵션+수량 저장 허용
-- (시그니처 불변 — CREATE OR REPLACE만으로 갱신, DROP 불필요)
CREATE OR REPLACE FUNCTION public.set_reservation_options(p_reservation_id bigint, p_options jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM rental_reservations
    WHERE id = p_reservation_id AND user_id = auth.uid() AND status IN ('draft', 'hold')
  ) THEN
    RETURN;
  END IF;

  DELETE FROM reservation_options WHERE reservation_id = p_reservation_id;

  INSERT INTO reservation_options (reservation_id, option_product_id, option_name, qty, unit_price)
  SELECT
    p_reservation_id,
    NULLIF(elem->>'option_product_id', '')::UUID,
    elem->>'option_name',
    (elem->>'qty')::INTEGER,
    COALESCE((elem->>'unit_price')::NUMERIC, 0)
  FROM jsonb_array_elements(p_options) AS elem
  WHERE COALESCE((elem->>'qty')::INTEGER, 0) > 0;
END;
$function$;

-- STEP 7: calculate_cart_total — draft(날짜 NULL) 행 방어적 제외 (2차 안전장치)
-- 1차 방어는 checkout 서버가 hold 상태 id만 골라 전달하는 것 — 이 방어는 그 보험.
-- (시그니처 불변 — CREATE OR REPLACE만으로 갱신, DROP 불필요)
CREATE OR REPLACE FUNCTION public.calculate_cart_total(p_reservation_ids bigint[])
RETURNS TABLE(subtotal numeric, discount_amount numeric, final_total numeric, deposit_required numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id      UUID := auth.uid();
  v_grade        TEXT;
  v_rate         NUMERIC := 0;
  v_subtotal     NUMERIC := 0;
  v_deposit      NUMERIC := 0;
  r              RECORD;
  v_daily        NUMERIC;
  v_half         NUMERIC;
  v_dep          NUMERIC;
  v_p_hour       INT;
  v_p_min        INT;
  v_r_hour       INT;
  v_r_min        INT;
  v_total_days   INT;
  v_remain_hours INT;
  v_mins         INT;
  v_fee          NUMERIC;
  v_options_fee  NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  SELECT membership_grade INTO v_grade FROM user_profiles WHERE id = v_user_id;
  v_rate := CASE COALESCE(v_grade, 'NONE')
    WHEN 'POP'   THEN 10
    WHEN 'CRAZY' THEN 20
    ELSE 0
  END;

  FOR r IN
    SELECT rr.id, rr.product_id, rr.start_date, rr.end_date, rr.pickup_time, rr.return_time
    FROM rental_reservations rr
    WHERE rr.id = ANY(p_reservation_ids) AND rr.user_id = v_user_id
      AND rr.start_date IS NOT NULL AND rr.end_date IS NOT NULL
  LOOP
    SELECT MAX(price) FILTER (WHERE duration_type = '24h'),
           MAX(price) FILTER (WHERE duration_type = '12h'),
           MAX(deposit_amount) FILTER (WHERE duration_type = '24h')
    INTO v_daily, v_half, v_dep
    FROM price_rules
    WHERE product_id = r.product_id;

    v_daily := COALESCE(v_daily, 0);
    v_half  := COALESCE(v_half, 0);
    v_dep   := COALESCE(v_dep, 0);

    v_p_hour := COALESCE(NULLIF(split_part(r.pickup_time, ':', 1), '')::INT, 0);
    v_p_min  := COALESCE(NULLIF(split_part(r.pickup_time, ':', 2), '')::INT, 0);
    v_r_hour := COALESCE(NULLIF(split_part(r.return_time, ':', 1), '')::INT, 0);
    v_r_min  := COALESCE(NULLIF(split_part(r.return_time, ':', 2), '')::INT, 0);

    IF r.start_date = r.end_date THEN
      v_mins := (v_r_hour * 60 + v_r_min) - (v_p_hour * 60 + v_p_min);
      IF v_mins <= 0 THEN
        v_fee := 0;
      ELSIF v_mins <= 720 THEN
        v_fee := v_half;
      ELSE
        v_fee := v_daily;
      END IF;
    ELSE
      v_total_days := (r.end_date - r.start_date);
      v_fee := v_total_days * v_daily;
      v_remain_hours := ((v_r_hour - v_p_hour) % 24 + 24) % 24;
      IF v_remain_hours >= 12 THEN
        v_fee := v_fee + v_half;
      END IF;
    END IF;

    SELECT COALESCE(SUM(ro.unit_price * ro.qty), 0)
    INTO v_options_fee
    FROM reservation_options ro
    WHERE ro.reservation_id = r.id;

    v_subtotal := v_subtotal + v_fee + v_options_fee;
    v_deposit  := v_deposit + v_dep;
  END LOOP;

  RETURN QUERY SELECT
    v_subtotal,
    ROUND(v_subtotal * v_rate / 100.0),
    v_subtotal - ROUND(v_subtotal * v_rate / 100.0),
    v_deposit;
END;
$function$;
