-- Migration 285: HOLD 자동만료(pg_cron) 메커니즘 복구 — 10분 → 30분으로 정책 변경
--
-- 배경: reservation-rental-execution.md §0-5 조사 결과, Migration 30(2026-05-29)에 최초
-- 등록됐던 hold_expiration_cleanup pg_cron 잡 + release_reservation_hold() 함수가 Stage·
-- Production 둘 다에 실존하지 않음을 확인했다(pg_get_functiondef 0건, cron.job 0건).
-- Production 실측: status='hold'인 예약 29건 전부 생성 30분 초과. 언제·왜 사라졌는지는
-- 불명(마이그레이션 히스토리상 명시적 DROP/unschedule 파일 없음).
--
-- Stephen 확정 정책(2026-08-18): 10분은 고객 체크아웃 시간으로 너무 짧아 30분으로 변경.
--
-- 설계: rental_reservations_product_dates_excl 배제 제약은 이미 status='expired'를 배제
-- 대상에서 빼고 있어(WHERE status <> ALL(...'expired'...)) status만 'expired'로 바꾸면
-- 재고(날짜 배제 제약)가 즉시 해제된다 — 별도의 "재고 해제" 로직이 필요 없다.
-- update_reservation_status RPC는 hold→expired 전이를 CASE문에 갖고 있지 않으므로
-- (hold→confirmed만 허용) 이 함수를 경유하지 않고, cancelled/damage_claimed와 동일하게
-- 이 cron 전용 함수가 직접 UPDATE한다(update_reservation_status의 상태전이 CASE문 자체는
-- 건드리지 않음).
--
-- ⚠️ 실행 중 추가 발견: rental_reservations_status_check CHECK 제약에는 정작 'expired'가
-- 등록돼 있지 않았다(draft/pending/hold/confirmed/active/shipped/in_use/return_requested/
-- returned/completed/cancelled/damage_claimed 12개뿐). 배제 인덱스·rental-lifecycle.md
-- 상태머신 문서·products.md §5 예약가능조건은 전부 'expired'를 이미 존재하는 값처럼 다루고
-- 있었으나 실제 CHECK 제약에는 처음부터 빠져 있었던 것으로 보인다 — release_reservation_hold
-- 복구와 별개로 이 제약도 함께 넓혀야 UPDATE ... SET status='expired'가 성공한다.

ALTER TABLE public.rental_reservations DROP CONSTRAINT rental_reservations_status_check;
ALTER TABLE public.rental_reservations ADD CONSTRAINT rental_reservations_status_check
  CHECK (status = ANY (ARRAY[
    'draft', 'pending', 'hold', 'confirmed', 'active', 'shipped', 'in_use',
    'return_requested', 'returned', 'completed', 'cancelled', 'damage_claimed',
    'expired'
  ]));

CREATE OR REPLACE FUNCTION public.release_reservation_hold()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_expired_count INT;
BEGIN
  UPDATE public.rental_reservations
  SET status = 'expired', updated_at = NOW()
  WHERE status = 'hold'
    AND created_at < NOW() - INTERVAL '30 minutes';

  GET DIAGNOSTICS v_expired_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'expired_count', v_expired_count);
END;
$function$;

REVOKE ALL ON FUNCTION public.release_reservation_hold() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_reservation_hold() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_reservation_hold() TO service_role;

-- pg_cron 잡 재등록 — Migration 30과 동일 이름·주기(1분마다), 함수 내부 임계값만 30분으로 상향.
-- 이미 동일 이름의 잡이 있으면 먼저 해제(재실행 안전성 확보 — 최초 적용 시엔 존재하지 않음).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hold_expiration_cleanup') THEN
    PERFORM cron.unschedule('hold_expiration_cleanup');
  END IF;
END $$;

SELECT cron.schedule(
  'hold_expiration_cleanup',
  '* * * * *',
  $$SELECT public.release_reservation_hold();$$
);

-- ============================================================
-- ROLLBACK
-- ============================================================
-- SELECT cron.unschedule('hold_expiration_cleanup');
-- DROP FUNCTION IF EXISTS public.release_reservation_hold();
-- ALTER TABLE public.rental_reservations DROP CONSTRAINT rental_reservations_status_check;
-- ALTER TABLE public.rental_reservations ADD CONSTRAINT rental_reservations_status_check
--   CHECK (status = ANY (ARRAY['draft','pending','hold','confirmed','active','shipped',
--     'in_use','return_requested','returned','completed','cancelled','damage_claimed']));
-- ============================================================
