-- #787 무인보관함 안내 발송 대상 선택(수령/반납) + 반납 안내 유형 등록 (2026-10-31, Stephen 확정)
-- 변경:
--   ① rental_reservations.locker_guide_legs — 'pickup'(수령만) | 'return'(반납만) | 'both'(둘 다). NULL = 옛 저장분(예전처럼 수령·반납 둘 다 발송).
--   ② update_reservation_locker_password: 4번째 인자 p_legs 추가(기존 3인자 함수는 삭제 — 오버로드 모호성 방지). 비밀번호를 저장할 때는 발송 대상(p_legs)도 필수, 삭제(둘 다 NULL)하면 발송 대상도 비운다.
--   ③ claim_reservations_due_for_locker_guide: 수령용은 pickup·both·NULL, 반납용은 return·both·NULL 만 선점(시그니처·반환 컬럼·권한 불변 — #678 정의에 조건만 추가).
--   ④ push_notification_config 에 'locker_return_guide'(무인보관함 반납 안내) 등록 — CMS 푸시알림 설정에서 반납용 안내문장을 따로 편집한다.
-- 폐기 트리거(#673·#678)는 건드리지 않는다: 비밀번호가 비면 발송 대상에서 빠지고, 화면은 비밀번호가 없는 예약의 발송 대상 값을 읽지 않는다.
-- ROLLBACK (아래 순서대로):
--   1) DROP FUNCTION IF EXISTS public.update_reservation_locker_password(BIGINT, TEXT, TEXT, TEXT);  -- 4인자를 먼저 삭제(3인자만 복원하면 두 함수가 공존해 호출이 모호해진다)
--   2) 3인자 update_reservation_locker_password(#678 정의)를 CREATE OR REPLACE 로 복원한 뒤 권한을 다시 부여:
--      REVOKE ALL ON FUNCTION public.update_reservation_locker_password(BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
--      GRANT EXECUTE ON FUNCTION public.update_reservation_locker_password(BIGINT, TEXT, TEXT) TO authenticated;
--   3) claim_reservations_due_for_locker_guide 를 #678 정의로 CREATE OR REPLACE 복원(권한: service_role 전용 유지)
--   4) DELETE FROM push_notification_config WHERE notify_type = 'locker_return_guide';
--   5) ALTER TABLE rental_reservations DROP CONSTRAINT IF EXISTS chk_rental_reservations_locker_guide_legs, DROP COLUMN locker_guide_legs;
--   ※ 코드(4인자 호출)를 먼저 되돌린 뒤 DB를 되돌릴 것 — 반대로 하면 저장이 실패한다.

ALTER TABLE public.rental_reservations ADD COLUMN IF NOT EXISTS locker_guide_legs TEXT;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rental_reservations_locker_guide_legs') THEN
    ALTER TABLE public.rental_reservations
      ADD CONSTRAINT chk_rental_reservations_locker_guide_legs
      CHECK (locker_guide_legs IS NULL OR locker_guide_legs IN ('pickup', 'return', 'both'));
  END IF;
END $c$;

COMMENT ON COLUMN public.rental_reservations.locker_guide_legs IS
  '무인보관함 안내 발송 대상: pickup(수령만) | return(반납만) | both(둘 다). NULL = 옛 저장분(수령·반납 둘 다 발송). 비밀번호가 없으면 의미 없는 값(화면은 읽지 않음).';

-- ② 저장 RPC (3인자 → 4인자)
DROP FUNCTION IF EXISTS public.update_reservation_locker_password(BIGINT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.update_reservation_locker_password(
  p_reservation_id BIGINT,
  p_password        TEXT,
  p_locker_number   TEXT DEFAULT NULL,
  p_legs            TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NOT is_cms_user() THEN
    RAISE EXCEPTION 'permission denied: cms role required';
  END IF;

  IF (p_password IS NULL) <> (p_locker_number IS NULL) THEN
    RAISE EXCEPTION 'locker number and password are required together';
  END IF;

  IF p_password IS NOT NULL AND (p_legs IS NULL OR p_legs NOT IN ('pickup', 'return', 'both')) THEN
    RAISE EXCEPTION 'locker guide legs required: pickup | return | both';
  END IF;

  SELECT status INTO v_status FROM rental_reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation not found: %', p_reservation_id;
  END IF;
  IF p_password IS NOT NULL AND v_status IN ('cancelled', 'expired') THEN
    RAISE EXCEPTION 'locker password not allowed for status: %', v_status;
  END IF;

  UPDATE rental_reservations
  SET
    locker_password   = p_password,
    locker_number     = p_locker_number,
    locker_guide_legs = CASE WHEN p_password IS NULL THEN NULL ELSE p_legs END,
    updated_at        = NOW()
  WHERE id = p_reservation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_reservation_locker_password(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_reservation_locker_password(BIGINT, TEXT, TEXT, TEXT) TO authenticated;

-- ③ 발송 대상 선점 — #678(라이브) 정의에 발송 대상 조건만 추가
CREATE OR REPLACE FUNCTION public.claim_reservations_due_for_locker_guide(p_limit integer DEFAULT 50)
 RETURNS TABLE(reservation_id bigint, leg text, phone text, password text, locker_number text, product_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE rental_reservations rr
  SET locker_guide_sent_pickup_at = now()
  WHERE rr.id IN (
    SELECT r.id FROM rental_reservations r
    WHERE r.pickup_method IN ('visit', 'quick')
      AND r.status IN ('confirmed', 'shipped')
      AND r.locker_password IS NOT NULL
      AND (r.locker_guide_legs IS NULL OR r.locker_guide_legs IN ('pickup', 'both'))
      AND r.locker_guide_sent_pickup_at IS NULL
      AND r.pickup_time IS NOT NULL
      AND ((r.start_date + r.pickup_time::time) AT TIME ZONE 'Asia/Seoul') - now() <= INTERVAL '1 hour'
      AND ((r.start_date + r.pickup_time::time) AT TIME ZONE 'Asia/Seoul') > now()
    ORDER BY r.start_date, r.pickup_time
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING
    rr.id,
    'pickup'::TEXT,
    (SELECT up.phone FROM user_profiles up WHERE up.id = rr.user_id),
    rr.locker_password,
    rr.locker_number,
    (SELECT COALESCE(ppar.name, p.name) FROM products p LEFT JOIN products ppar ON ppar.id = p.parent_product_id WHERE p.id = rr.product_id);

  RETURN QUERY
  UPDATE rental_reservations rr
  SET locker_guide_sent_return_at = now()
  WHERE rr.id IN (
    SELECT r.id FROM rental_reservations r
    WHERE r.return_method IN ('visit', 'quick')
      AND r.status IN ('in_use', 'return_requested')
      AND r.locker_password IS NOT NULL
      AND (r.locker_guide_legs IS NULL OR r.locker_guide_legs IN ('return', 'both'))
      AND r.locker_guide_sent_return_at IS NULL
      AND r.return_time IS NOT NULL
      AND ((r.end_date + r.return_time::time) AT TIME ZONE 'Asia/Seoul') - now() <= INTERVAL '1 hour'
      AND ((r.end_date + r.return_time::time) AT TIME ZONE 'Asia/Seoul') > now()
    ORDER BY r.end_date, r.return_time
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING
    rr.id,
    'return'::TEXT,
    (SELECT up.phone FROM user_profiles up WHERE up.id = rr.user_id),
    rr.locker_password,
    rr.locker_number,
    (SELECT COALESCE(ppar.name, p.name) FROM products p LEFT JOIN products ppar ON ppar.id = p.parent_product_id WHERE p.id = rr.product_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_reservations_due_for_locker_guide(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reservations_due_for_locker_guide(integer) TO service_role;

-- ④ CMS 푸시알림 설정에 반납 안내 유형 등록(켜짐 기본, 기존 행 미변경)
INSERT INTO push_notification_config (category, notify_type, label, push_enabled) VALUES
  ('customer_lifecycle', 'locker_return_guide', '무인보관함 반납 안내', true)
ON CONFLICT (notify_type) DO NOTHING;
