-- Migration #857: 고객목록·고객상세의 대여/연체/파손 횟수를 실제 이력에서 집계
--
-- 배경(2026-11-27): CMS 고객 패널의 "대여 횟수·연체 횟수·파손 횟수"가 모든 회원에서 0으로만 보였다.
--   get_customer_list 가 user_profiles 의 저장 카운터(rental_count·late_return_count·damage_count)를 그대로 읽는데,
--   이 카운터를 올리는 코드·트리거가 없어 전원 기본값 0에 머물렀다(Stage: 회원 1,819명 중 0보다 큰 값 0명, 대여 이력 있는 회원 365명).
--
-- 수정: 라이브 정의에서 세 줄(c_rental_count / c_late_return_count / c_damage_count)만 실제 이력 집계로 교체(그 밖은 무변경).
--   · 대여 횟수 = 본인 예약 중 status = 'completed' 건수 (Stephen 확인 2026-11-27)
--   · 연체 횟수 = 본인 예약에 연결된 late_fees(연체료) 기록 수
--   · 파손 횟수 = 본인 예약에 연결된 reservation_inspection_issues(반납 검수 이슈) 전체 건수 (유형 구분 없음, Stephen 확인)
--   · 비회원 관리대상 행(0,0,0 고정)과 저장 카운터 컬럼 자체는 건드리지 않는다.
--   권한은 CREATE OR REPLACE(EXECUTE)가 유지(service_role 전용 — #364 정책). 적용 뒤 ACL 확인.
-- 롤백: 세 줄을 up.rental_count / up.late_return_count / up.damage_count 로 되돌린다(#686 정의).

DO $migration$
DECLARE
  v_def  TEXT;
  v_old1 TEXT := $o1$up.rental_count             AS c_rental_count,$o1$;
  v_old2 TEXT := $o2$up.late_return_count        AS c_late_return_count,$o2$;
  v_old3 TEXT := $o3$up.damage_count             AS c_damage_count,$o3$;
  v_new1 TEXT := $n1$(SELECT COUNT(*)::INT FROM public.rental_reservations r
                          WHERE r.user_id = up.id AND r.status = 'completed') AS c_rental_count,$n1$;
  v_new2 TEXT := $n2$(SELECT COUNT(*)::INT FROM public.late_fees lf
                          JOIN public.rental_reservations r ON r.id = lf.reservation_id
                          WHERE r.user_id = up.id) AS c_late_return_count,$n2$;
  v_new3 TEXT := $n3$(SELECT COUNT(*)::INT FROM public.reservation_inspection_issues ii
                          JOIN public.rental_reservations r ON r.id = ii.reservation_id
                          WHERE r.user_id = up.id) AS c_damage_count,$n3$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
   WHERE p.proname = 'get_customer_list' AND p.pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_customer_list 정의를 찾지 못했습니다';
  END IF;
  -- 이미 적용된 경우(멱등)
  IF position('AS c_rental_count' IN v_def) > 0 AND position('up.rental_count' IN v_def) = 0 THEN
    RETURN;
  END IF;
  IF position(v_old1 IN v_def) = 0 OR position(v_old2 IN v_def) = 0 OR position(v_old3 IN v_def) = 0 THEN
    RAISE EXCEPTION '횟수 컬럼 세 줄을 라이브 정의에서 찾지 못했습니다(정의가 바뀐 것으로 보임) — 적용 중단';
  END IF;

  EXECUTE replace(replace(replace(v_def, v_old1, v_new1), v_old2, v_new2), v_old3, v_new3);
END
$migration$;
