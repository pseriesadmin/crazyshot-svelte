-- Migration #819: 채팅카드 알림 RPC 에 상품명 표기 인자 추가 — '대표 상품명 외 N개 상품' (2026-11-12, Stephen 지시)
--   반납 예정 안내(return_remind, 매일 09시 크론)가 한 주문의 상품을 대표 1건으로 보낼 때 카드 본문·payload 상품명도 같은 표기를 쓰게 한다.
--   send_rental_chat_notification(bigint, text, text) 에 마지막 인자 p_product_label text DEFAULT NULL 을 더한다 —
--   비어 있으면 기존과 완전히 같다(예약의 상품명). 기존 호출(인자 3개)은 그대로 동작한다.
--   방식: 현재 정의(Stage·Production 동일 해시 482f8ced70f5ae916b169cfb7c9780e3)를 그대로 읽어 인자 한 개와 상품명 치환 한 줄만 바꿔 다시 만든다 —
--   손으로 옮겨 적다 생길 수 있는 본문 오차를 막고, 해시가 다르면(다른 변경이 먼저 들어간 경우) 중단한다.
-- ROLLBACK: 새 4-인자 함수를 DROP 하고, 직전 본문(Migration #694·#695·#771·#775 계열의 현재 정의)으로 3-인자 함수를 다시 만든다(적용 전 pg_get_functiondef 원문을 저장해 둘 것).
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). 코드(return-remind 크론이 p_product_label 을 넘김)보다 먼저 적용한다.

DO $mig$
DECLARE
  d  text;
  nd text;
BEGIN
  d := pg_get_functiondef('public.send_rental_chat_notification(bigint,text,text)'::regprocedure);
  IF md5(d) <> '482f8ced70f5ae916b169cfb7c9780e3' THEN
    RAISE EXCEPTION 'send_rental_chat_notification 현재 정의가 예상(482f8ced…)과 다릅니다 — 다른 변경이 먼저 들어갔는지 확인하세요.';
  END IF;

  nd := replace(d,
    'p_action_url text DEFAULT NULL::text)',
    'p_action_url text DEFAULT NULL::text, p_product_label text DEFAULT NULL::text)');
  IF nd = d THEN RAISE EXCEPTION '인자 치환에 실패했습니다.'; END IF;

  d := nd;
  nd := replace(d,
    E'  IF v_user_id IS NULL THEN\n    RETURN jsonb_build_object(''ok'', false, ''error'', ''예약을 찾을 수 없습니다.'');\n  END IF;\n',
    E'  IF v_user_id IS NULL THEN\n    RETURN jsonb_build_object(''ok'', false, ''error'', ''예약을 찾을 수 없습니다.'');\n  END IF;\n\n  -- 묶음 안내 표기(#819): 호출부가 ''대표 상품명 외 N개 상품'' 을 넘기면 카드 본문·payload 상품명에 그대로 쓴다\n  v_product := COALESCE(NULLIF(btrim(COALESCE(p_product_label, '''')), ''''), v_product);\n');
  IF nd = d THEN RAISE EXCEPTION '상품명 치환에 실패했습니다.'; END IF;

  EXECUTE nd;
END
$mig$;

-- 새 인자 함수가 만들어졌으니 옛 3-인자 정의를 지운다(둘이 공존하면 이름 호출이 모호해진다)
DROP FUNCTION public.send_rental_chat_notification(bigint, text, text);

REVOKE ALL ON FUNCTION public.send_rental_chat_notification(bigint, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_rental_chat_notification(bigint, text, text, text) TO service_role;
