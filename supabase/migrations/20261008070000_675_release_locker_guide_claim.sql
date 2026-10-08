-- Migration #675: 무인보관함 안내 발송 실패 시 "발송됨" 표시 해제(다음 크론에서 재시도)
-- 2026-10-08 | Stephen 지시("A와 B 같이 진행") | TDD: src/__tests__/services/lockerGuideClaimWindow.test.ts(W6 — 표시 복구 후 재선정, 잘못된 leg 거부) · src/__tests__/server/lockerGuideCron.test.ts(크론 재시도 정책)
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
--
-- 배경: claim_reservations_due_for_locker_guide가 발송 전에 "발송됨"을 먼저 표시하기 때문에, 문자·채팅 발송이 실패해도
--       다시 시도되지 않아 고객이 비밀번호를 못 받는 상태로 남았다. 크론이 "아무것도 전달되지 못한" 건만 이 RPC로 표시를 되돌린다.
--       재시도는 claim의 "시각 1시간 이내·미경과" 조건 안에서만 일어나므로 수령(반납) 시각이 지나면 자동 종료된다.
-- ROLLBACK: DROP FUNCTION public.release_locker_guide_claim(BIGINT, TEXT);

CREATE OR REPLACE FUNCTION public.release_locker_guide_claim(
  p_reservation_id BIGINT,
  p_leg            TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_leg = 'pickup' THEN
    UPDATE rental_reservations SET locker_guide_sent_pickup_at = NULL WHERE id = p_reservation_id;
  ELSIF p_leg = 'return' THEN
    UPDATE rental_reservations SET locker_guide_sent_return_at = NULL WHERE id = p_reservation_id;
  ELSE
    RAISE EXCEPTION 'invalid leg: %', p_leg;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.release_locker_guide_claim(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_locker_guide_claim(BIGINT, TEXT) TO service_role;
