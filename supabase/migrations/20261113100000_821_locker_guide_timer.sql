-- Migration #821: 무인보관함 안내 '추가 자동 발송 시간' 타이머 (2026-11-13, Stephen 지시)
--
-- 동작: 기본 '수령(반납) 시각 1시간 전 자동 발송'(claim_reservations_due_for_locker_guide) 외에,
--       CMS 푸시알림 설정에서 지정한 시각(수령·반납 예정일 당일, KST 01:00~24:00 1시간 단위 — 24:00 은 23:50)에 같은 안내를 한 번 더 보낸다.
-- 변경:
--   1) rental_reservations.locker_guide_timer_pickup_at / locker_guide_timer_return_at — 추가 발송 선점 표식(예약·구간당 1회). NULL = 아직 안 보냄.
--   2) claim_locker_guide_timer(p_pickup_minutes, p_return_minutes, p_limit) — 지정 시각이 지났고(1시간 이내) 아직 수령(반납) 시각 전이며,
--      기본 안내를 아직 안 보낸 건만 원자 선점. 대상 조건(방식·상태·비밀번호·발송 대상)은 기본 안내와 같다. p_*_minutes 가 NULL 이면 그 구간은 건너뛴다.
--   3) release_locker_guide_timer_claim(p_reservation_id, p_leg) — 문자 전달 실패 시 표식을 되돌려 다음 크론에서 재시도(1시간 안에서만).
-- 권한: 서버 전용 — REVOKE ALL FROM PUBLIC, anon, authenticated · GRANT service_role.
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). 기존 마이그레이션 파일은 수정하지 않는다.
-- ROLLBACK(코드를 먼저 되돌린 뒤): DROP FUNCTION IF EXISTS public.claim_locker_guide_timer(integer, integer, integer); DROP FUNCTION IF EXISTS public.release_locker_guide_timer_claim(bigint, text); ALTER TABLE public.rental_reservations DROP COLUMN IF EXISTS locker_guide_timer_pickup_at, DROP COLUMN IF EXISTS locker_guide_timer_return_at;

ALTER TABLE public.rental_reservations
  ADD COLUMN IF NOT EXISTS locker_guide_timer_pickup_at timestamptz,
  ADD COLUMN IF NOT EXISTS locker_guide_timer_return_at timestamptz;

COMMENT ON COLUMN public.rental_reservations.locker_guide_timer_pickup_at IS '무인보관함 안내 추가 타이머(수령 당일 지정 시각, #821) 발송 선점 시각. NULL = 미발송';
COMMENT ON COLUMN public.rental_reservations.locker_guide_timer_return_at IS '무인보관함 안내 추가 타이머(반납 당일 지정 시각, #821) 발송 선점 시각. NULL = 미발송';

CREATE OR REPLACE FUNCTION public.claim_locker_guide_timer(
  p_pickup_minutes integer,
  p_return_minutes integer,
  p_limit integer DEFAULT 50
)
 RETURNS TABLE(reservation_id bigint, leg text, phone text, password text, locker_number text, product_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_pickup_minutes IS NOT NULL THEN
    RETURN QUERY
    UPDATE rental_reservations rr
    SET locker_guide_timer_pickup_at = now()
    WHERE rr.id IN (
      SELECT r.id FROM rental_reservations r
      WHERE r.pickup_method IN ('visit', 'quick')
        AND r.status IN ('confirmed', 'shipped')
        AND r.locker_password IS NOT NULL
        AND (r.locker_guide_legs IS NULL OR r.locker_guide_legs IN ('pickup', 'both'))
        AND r.locker_guide_sent_pickup_at IS NULL
        AND r.locker_guide_timer_pickup_at IS NULL
        AND r.pickup_time IS NOT NULL
        AND now() >= (r.start_date::timestamp + make_interval(mins => p_pickup_minutes)) AT TIME ZONE 'Asia/Seoul'
        AND now() <  (r.start_date::timestamp + make_interval(mins => p_pickup_minutes)) AT TIME ZONE 'Asia/Seoul' + INTERVAL '1 hour'
        AND now() <  (r.start_date + r.pickup_time::time) AT TIME ZONE 'Asia/Seoul'
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
  END IF;

  IF p_return_minutes IS NOT NULL THEN
    RETURN QUERY
    UPDATE rental_reservations rr
    SET locker_guide_timer_return_at = now()
    WHERE rr.id IN (
      SELECT r.id FROM rental_reservations r
      WHERE r.return_method IN ('visit', 'quick')
        AND r.status IN ('in_use', 'return_requested')
        AND r.locker_password IS NOT NULL
        AND (r.locker_guide_legs IS NULL OR r.locker_guide_legs IN ('return', 'both'))
        AND r.locker_guide_sent_return_at IS NULL
        AND r.locker_guide_timer_return_at IS NULL
        AND r.return_time IS NOT NULL
        AND now() >= (r.end_date::timestamp + make_interval(mins => p_return_minutes)) AT TIME ZONE 'Asia/Seoul'
        AND now() <  (r.end_date::timestamp + make_interval(mins => p_return_minutes)) AT TIME ZONE 'Asia/Seoul' + INTERVAL '1 hour'
        AND now() <  (r.end_date + r.return_time::time) AT TIME ZONE 'Asia/Seoul'
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
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_locker_guide_timer(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_locker_guide_timer(integer, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.release_locker_guide_timer_claim(p_reservation_id bigint, p_leg text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_leg = 'pickup' THEN
    UPDATE rental_reservations SET locker_guide_timer_pickup_at = NULL WHERE id = p_reservation_id;
  ELSIF p_leg = 'return' THEN
    UPDATE rental_reservations SET locker_guide_timer_return_at = NULL WHERE id = p_reservation_id;
  ELSE
    RAISE EXCEPTION 'invalid leg: %', p_leg;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_locker_guide_timer_claim(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_locker_guide_timer_claim(bigint, text) TO service_role;
