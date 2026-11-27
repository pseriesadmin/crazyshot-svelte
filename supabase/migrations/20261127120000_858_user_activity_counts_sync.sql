-- Migration #858: 저장 카운터(user_profiles.rental_count·late_return_count·damage_count)를 실제 이력과 자동 동기화
--
-- 배경(2026-11-27): 저장 카운터를 올리는 코드가 없어 전원 0이었다(#857은 CMS 고객목록만 실제 집계로 바꿈).
--   마이페이지 '로그' 탭 개수(/account/profile)와 보관된 월간 우량회원 크론 정의는 저장 칸을 그대로 읽으므로 계속 0이라 CMS와 값이 어긋났다.
--   Stephen 결정(2026-11-27): 저장 칸을 이력에서 자동 갱신해 한꺼번에 맞춘다.
-- 기준(#857과 동일, 이중 구현이므로 함께 바꾼다):
--   대여 = 본인 예약 status='completed' / 연체 = late_fees(예약 경유) / 파손 = reservation_inspection_issues 전체(예약 경유, 유형 구분 없음)
-- 구성: ① 재계산 함수 private.refresh_user_activity_counts(uuid) ② 세 표의 AFTER 트리거 ③ 전체 1회 백필
--   · 값이 같으면 UPDATE 하지 않는다(불필요한 행 갱신 방지).
--   · 함수는 서버 내부 전용: REVOKE ALL FROM PUBLIC, anon, authenticated(트리거는 표 소유자 권한으로 실행).
--   · 월간 우량회원 크론(monthly_credit_score_boost)은 Stage·Production 모두 등록돼 있지 않다 — 이 마이그레이션이 크론을 만들지 않는다.
-- 롤백: DROP TRIGGER trg_activity_counts_* ; DROP FUNCTION private.refresh_user_activity_counts, private.trg_refresh_activity_counts_*.
--   (저장 칸 값은 남는다 — 되돌리려면 UPDATE user_profiles SET rental_count=0, late_return_count=0, damage_count=0)

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.refresh_user_activity_counts(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_rental integer;
  v_late   integer;
  v_damage integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*)::INT INTO v_rental
    FROM public.rental_reservations r
   WHERE r.user_id = p_user_id AND r.status = 'completed';

  SELECT COUNT(*)::INT INTO v_late
    FROM public.late_fees lf
    JOIN public.rental_reservations r ON r.id = lf.reservation_id
   WHERE r.user_id = p_user_id;

  SELECT COUNT(*)::INT INTO v_damage
    FROM public.reservation_inspection_issues ii
    JOIN public.rental_reservations r ON r.id = ii.reservation_id
   WHERE r.user_id = p_user_id;

  UPDATE public.user_profiles up
     SET rental_count = v_rental,
         late_return_count = v_late,
         damage_count = v_damage
   WHERE up.id = p_user_id
     AND (up.rental_count IS DISTINCT FROM v_rental
          OR up.late_return_count IS DISTINCT FROM v_late
          OR up.damage_count IS DISTINCT FROM v_damage);
END;
$fn$;

-- 예약 표: 상태가 completed 로 들어오거나 나갈 때, 예약이 지워질 때, 예약자가 바뀔 때만 재계산
CREATE OR REPLACE FUNCTION private.trg_refresh_activity_counts_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'completed' THEN
      PERFORM private.refresh_user_activity_counts(NEW.user_id);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM private.refresh_user_activity_counts(OLD.user_id);
    RETURN OLD;
  END IF;
  -- UPDATE
  IF NEW.status IS DISTINCT FROM OLD.status
     AND (NEW.status = 'completed' OR OLD.status = 'completed') THEN
    PERFORM private.refresh_user_activity_counts(NEW.user_id);
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    PERFORM private.refresh_user_activity_counts(OLD.user_id);
    PERFORM private.refresh_user_activity_counts(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$fn$;

-- 연체료·검수 이슈 표: 추가·삭제 때 해당 예약자만 재계산
CREATE OR REPLACE FUNCTION private.trg_refresh_activity_counts_child()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_res_id bigint;
  v_user   uuid;
BEGIN
  v_res_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.reservation_id ELSE NEW.reservation_id END;
  SELECT r.user_id INTO v_user FROM public.rental_reservations r WHERE r.id = v_res_id;
  PERFORM private.refresh_user_activity_counts(v_user);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$fn$;

REVOKE ALL ON FUNCTION private.refresh_user_activity_counts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trg_refresh_activity_counts_reservation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trg_refresh_activity_counts_child() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_activity_counts_reservation ON public.rental_reservations;
CREATE TRIGGER trg_activity_counts_reservation
  AFTER INSERT OR DELETE OR UPDATE OF status, user_id ON public.rental_reservations
  FOR EACH ROW EXECUTE FUNCTION private.trg_refresh_activity_counts_reservation();

DROP TRIGGER IF EXISTS trg_activity_counts_late_fees ON public.late_fees;
CREATE TRIGGER trg_activity_counts_late_fees
  AFTER INSERT OR DELETE ON public.late_fees
  FOR EACH ROW EXECUTE FUNCTION private.trg_refresh_activity_counts_child();

DROP TRIGGER IF EXISTS trg_activity_counts_inspection_issues ON public.reservation_inspection_issues;
CREATE TRIGGER trg_activity_counts_inspection_issues
  AFTER INSERT OR DELETE ON public.reservation_inspection_issues
  FOR EACH ROW EXECUTE FUNCTION private.trg_refresh_activity_counts_child();

-- 전체 1회 백필(이력이 있는 회원 + 저장 칸이 0이 아닌 회원)
DO $backfill$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT DISTINCT r.user_id FROM public.rental_reservations r WHERE r.user_id IS NOT NULL
    UNION
    SELECT up.id FROM public.user_profiles up
     WHERE up.rental_count <> 0 OR up.late_return_count <> 0 OR up.damage_count <> 0
  LOOP
    PERFORM private.refresh_user_activity_counts(v_id);
  END LOOP;
END
$backfill$;
