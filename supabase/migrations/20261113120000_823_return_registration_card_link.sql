-- Migration #823: '반납정보 등록요청' 채팅카드 버튼 링크를 반납 등록 화면으로 (2026-11-13, Stephen 지시 — sp7 검수 지적)
--   [반납 정보 요청](수동 버튼)과 반납접수 전환 자동발송이 만드는 return_registration 채팅카드는 action_url 을 넘기지 않아 '/account/rental'(목록)로 갔다.
--   같은 알림의 푸시·문자·타이머 카드는 /account/rental/{id}/return-submit(반납 등록 화면)이라, p_action_url 이 없을 때의 기본 링크에
--   return_registration → '/account/rental/{id}/return-submit' 분기를 더한다. 호출부는 바꾸지 않는다(p_action_url 이 있으면 그 값이 우선).
-- 방식: 현재 정의(Stage·Production 동일 해시 0c547f2b9811dc6ca121cc187be3c7a0)를 읽어 한 줄만 바꿔 다시 만든다 — 해시가 다르면(다른 변경이 먼저 들어간 경우) 중단한다.
--   시그니처·권한은 그대로(CREATE OR REPLACE).
-- ROLLBACK: 이 분기 한 줄(WHEN p_notify_type = 'return_registration' ...)을 뺀 정의로 CREATE OR REPLACE — 적용 전 pg_get_functiondef 원문을 저장해 둘 것(해시 0c547f2b…).
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh).

DO $mig$
DECLARE
  d  text;
  nd text;
BEGIN
  d := pg_get_functiondef('public.send_rental_chat_notification(bigint,text,text,text)'::regprocedure);
  IF md5(d) <> '0c547f2b9811dc6ca121cc187be3c7a0' THEN
    RAISE EXCEPTION 'send_rental_chat_notification 현재 정의가 예상(0c547f2b…)과 다릅니다 — 다른 변경이 먼저 들어갔는지 확인하세요.';
  END IF;

  nd := replace(d,
    E'        WHEN p_notify_type = ''return_remind'' THEN ''/account/rental/'' || p_reservation_id::TEXT || ''/history''\n',
    E'        WHEN p_notify_type = ''return_remind'' THEN ''/account/rental/'' || p_reservation_id::TEXT || ''/history''\n        WHEN p_notify_type = ''return_registration'' THEN ''/account/rental/'' || p_reservation_id::TEXT || ''/return-submit''\n');
  IF nd = d THEN RAISE EXCEPTION '링크 분기 치환에 실패했습니다.'; END IF;

  EXECUTE nd;
END
$mig$;
