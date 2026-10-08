-- Migration #676(파일명 번호 충돌로 670→676 변경, 2026-10-08): 전자계약 발송 후 서명 대기(HOLD 만료) 제한 시간 30분 → 1시간 (2026-10-08, Stephen 지시)
--
-- 정책(service-operations.md §10): 예약신청(hold)은 관리자가 전자계약을 발송(contract_signings.sent_at)한 시점부터만 타이머가 시작되고,
--   그 시각으로부터 제한 시간 안에 서명·결제를 마치지 않으면 pg_cron(hold_expiration_cleanup, 매 1분)이 release_reservation_hold()로 expired 처리한다.
--   이번 변경은 그 제한 시간만 30분 → 1시간으로 바꾼다. 재발송 시 sent_at이 갱신되어 타이머가 다시 시작되는 동작·결제완료 예외·미발송 hold 무기한 유지는 그대로.
--
-- 적용 방식: 함수 본문을 이 파일에 다시 쓰지 않고, DB의 현행 정의에서 `INTERVAL '30 minutes'`가 정확히 1곳일 때만 '1 hour'로 치환해 재정의한다
--   (직전 정본을 기억·옛 마이그레이션으로 재작성하다 다른 분기를 잃는 사고 방지). 0곳 또는 2곳 이상이면 예외로 중단(변경 없음).
--   판매전용 직접결제 만료(Migration 613, direct_pay_expires_at 30분)는 별개 정책이라 건드리지 않는다.
-- 롤백: 같은 방식으로 '1 hour' → '30 minutes' 치환.

DO $migration$
DECLARE
  v_def  text;
  v_new  text;
  v_hits int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
   WHERE p.oid = 'public.release_reservation_hold()'::regprocedure;
  IF v_def IS NULL THEN RAISE EXCEPTION 'release_reservation_hold 정의를 찾을 수 없습니다'; END IF;

  v_hits := (length(v_def) - length(replace(v_def, 'INTERVAL ''30 minutes''', ''))) / length('INTERVAL ''30 minutes''');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'INTERVAL 30 minutes 위치가 % 곳입니다(기대 1곳) — 현행 정의를 확인하세요', v_hits;
  END IF;

  v_new := replace(v_def, 'INTERVAL ''30 minutes''', 'INTERVAL ''1 hour''');
  EXECUTE v_new;
END
$migration$;
