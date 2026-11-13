-- Migration #824: 무인보관함 안내 '수령 전날 사전 발송' 타이머 (2026-11-13, Stephen 지시)
--
-- 동작: CMS 푸시알림 설정 '무인보관함 수령정보 안내' 행의 '수령 전날' 시각(KST, 01:00~24:00 · 10분 단위, 24:00 은 23:50)이 되면,
--       수령일이 '내일'인 무인보관함 수령 예약(번호·비밀번호 저장·수령 대상)의 고객에게 같은 안내문장을 미리 한 번 보낸다.
--       기본 '수령 1시간 전' 발송과 '수령일 당일 지정 시각'(#821) 발송은 그대로 두고, 이 사전 발송은 별도 표식으로 예약당 1회다.
-- 변경:
--   1) rental_reservations.locker_guide_prev_pickup_at — 사전 발송 선점 표식. NULL = 아직 안 보냄.
--   2) claim_locker_guide_prev_day(p_pickup_minutes, p_limit) — 수령일 전날의 지정 시각이 지났고(1시간 이내) 아직 수령 시각 전이며,
--      기본 안내를 아직 안 보낸 건만 원자 선점. 대상 조건(방식·상태·비밀번호·발송 대상)은 #787·#821과 같다. p_pickup_minutes 가 NULL 이면 아무것도 하지 않는다.
--   3) release_locker_guide_prev_claim(p_reservation_id) — 문자 전달 실패 시 표식을 되돌려 다음 크론에서 재시도(1시간 안에서만).
-- 권한: 서버 전용 — REVOKE ALL FROM PUBLIC, anon, authenticated · GRANT service_role.
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). 코드(크론)보다 먼저 적용한다. 기존 마이그레이션 파일은 수정하지 않는다.
-- ROLLBACK(코드를 먼저 되돌린 뒤): DROP FUNCTION IF EXISTS public.claim_locker_guide_prev_day(integer, integer); DROP FUNCTION IF EXISTS public.release_locker_guide_prev_claim(bigint); ALTER TABLE public.rental_reservations DROP COLUMN IF EXISTS locker_guide_prev_pickup_at;

ALTER TABLE public.rental_reservations
  ADD COLUMN IF NOT EXISTS locker_guide_prev_pickup_at timestamptz;

COMMENT ON COLUMN public.rental_reservations.locker_guide_prev_pickup_at IS '무인보관함 안내 수령 전날 사전 발송(#824) 선점 시각. NULL = 미발송';

CREATE OR REPLACE FUNCTION public.claim_locker_guide_prev_day(
  p_pickup_minutes integer,
  p_limit integer DEFAULT 50
)
 RETURNS TABLE(reservation_id bigint, leg text, phone text, password text, locker_number text, product_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_pickup_minutes IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE rental_reservations rr
  SET locker_guide_prev_pickup_at = now()
  WHERE rr.id IN (
    SELECT r.id FROM rental_reservations r
    WHERE r.pickup_method IN ('visit', 'quick')
      AND r.status IN ('confirmed', 'shipped')
      AND r.locker_password IS NOT NULL
      AND (r.locker_guide_legs IS NULL OR r.locker_guide_legs IN ('pickup', 'both'))
      AND r.locker_guide_sent_pickup_at IS NULL
      AND r.locker_guide_prev_pickup_at IS NULL
      AND r.pickup_time IS NOT NULL
      AND now() >= ((r.start_date - 1)::timestamp + make_interval(mins => p_pickup_minutes)) AT TIME ZONE 'Asia/Seoul'
      AND now() <  ((r.start_date - 1)::timestamp + make_interval(mins => p_pickup_minutes)) AT TIME ZONE 'Asia/Seoul' + INTERVAL '1 hour'
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
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_locker_guide_prev_day(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_locker_guide_prev_day(integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.release_locker_guide_prev_claim(p_reservation_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE rental_reservations SET locker_guide_prev_pickup_at = NULL WHERE id = p_reservation_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_locker_guide_prev_claim(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_locker_guide_prev_claim(bigint) TO service_role;
