-- #840 두발히어로 수령 위치 안내 카드 버튼 문구 변경 (2026-11-18, Stephen 지시)
--  · 채팅카드 dhero_place_guide 의 버튼 이름 '수령 위치 등록하기' → '고객 수령요청 등록하기'. 다른 로직·권한은 그대로.
--  · 함수 전체를 다시 쓰지 않고 현재 DB 에 있는 정의에서 이 문구만 바꿔 다시 만든다(CREATE OR REPLACE 라 실행 권한 유지, 환경 간 정의 차이로 덮어쓰는 사고 방지).
--  · 이미 발송된 카드는 그대로(버튼 이름이 카드 payload 에 저장됨). 새로 나가는 카드부터 적용. 문구가 정확히 1곳이 아니면 실패해 아무것도 바꾸지 않는다.
-- 롤백: 같은 방식으로 '고객 수령요청 등록하기' → '수령 위치 등록하기' 로 되돌린다.
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.send_rental_chat_notification(bigint,text,text,text)'::regprocedure);
  v_new text;
BEGIN
  IF (length(v_def) - length(replace(v_def, '수령 위치 등록하기', ''))) <> length('수령 위치 등록하기') THEN
    RAISE EXCEPTION '#840: 버튼 문구가 정확히 1곳이 아닙니다(이미 변경됐거나 정의가 다릅니다)';
  END IF;
  v_new := replace(v_def, '수령 위치 등록하기', '고객 수령요청 등록하기');
  EXECUTE v_new;
END
$$;
