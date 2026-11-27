-- Migration #859: 활동 횟수 재계산 전에 회원 행을 잠가 동시 완료 경합 방지
--
-- 배경(2026-11-27, sp6 검수 지적): #858 의 재계산은 먼저 세고 나서 UPDATE 한다. 같은 회원의 예약 2건이 서로 다른 트랜잭션에서 동시에 completed 가 되면
--   서로의 미커밋 건을 못 본 채 각자 계산하고, 뒤 트랜잭션은 "값이 같다"며 UPDATE 를 건너뛰어 저장 칸이 실제보다 1 낮게 남을 수 있다.
-- 수정: 함수 맨 앞에서 해당 회원의 user_profiles 행을 FOR UPDATE 로 잠근 뒤 센다 — 뒤 트랜잭션은 앞 트랜잭션이 끝나길 기다렸다가
--   (READ COMMITTED 에서 새 스냅샷으로) 다시 세므로 최종 값이 항상 실제 이력과 같다. 잠그는 행은 한 회원뿐이라 교착 위험은 사실상 없다.
-- 그 밖(기준·트리거·권한)은 #858 과 동일. 함수 시그니처가 같아 CREATE OR REPLACE 로 권한(REVOKE)이 유지된다 — 적용 뒤 ACL 확인.
-- 롤백: #858 의 함수 정의로 되돌린다(FOR UPDATE 줄 제거).

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

  -- 같은 회원의 동시 재계산을 순서대로 처리(행이 없으면 아무 것도 하지 않음)
  PERFORM 1 FROM public.user_profiles up WHERE up.id = p_user_id FOR UPDATE;

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

REVOKE ALL ON FUNCTION private.refresh_user_activity_counts(uuid) FROM PUBLIC, anon, authenticated;
