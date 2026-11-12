-- Rollback: Migration #819 — send_rental_chat_notification 의 p_product_label 인자 제거 (2026-11-12)
-- 적용 대상: Stage(ezyvffjvuwmtuhpxdjrw) / Production(vnbpmvxruyciuuaermyh)
-- ⚠ 실행 순서: ① 코드부터 되돌린다(return-remind 크론이 p_product_label 을 넘기므로, 함수를 먼저 되돌리면 09시 반납 예정 카드 발송이 전부 실패) ② 그다음 이 파일을 실행한다.
-- 방식: 현재 4-인자 정의를 읽어 #819 가 더한 두 곳(인자 선언·상품명 치환 1줄)만 되돌려 3-인자 함수를 다시 만든다 — 직전 정의 원문과 같아야 하며(해시 482f8ced70f5ae916b169cfb7c9780e3) 다르면 중단한다.

DO $rb$
DECLARE
  d  text;
  nd text;
BEGIN
  d := pg_get_functiondef('public.send_rental_chat_notification(bigint,text,text,text)'::regprocedure);

  nd := replace(d,
    'p_action_url text DEFAULT NULL::text, p_product_label text DEFAULT NULL::text)',
    'p_action_url text DEFAULT NULL::text)');
  IF nd = d THEN RAISE EXCEPTION '인자 되돌리기에 실패했습니다.'; END IF;

  d := nd;
  nd := replace(d,
    E'\n  -- 묶음 안내 표기(#819): 호출부가 ''대표 상품명 외 N개 상품'' 을 넘기면 카드 본문·payload 상품명에 그대로 쓴다\n  v_product := COALESCE(NULLIF(btrim(COALESCE(p_product_label, '''')), ''''), v_product);\n',
    '');
  IF nd = d THEN RAISE EXCEPTION '상품명 치환 되돌리기에 실패했습니다.'; END IF;

  EXECUTE nd;
END
$rb$;

DROP FUNCTION public.send_rental_chat_notification(bigint, text, text, text);

REVOKE ALL ON FUNCTION public.send_rental_chat_notification(bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_rental_chat_notification(bigint, text, text) TO service_role;

-- 확인: 되돌린 정의가 직전 정의와 같아야 한다(다르면 결과가 false)
SELECT md5(pg_get_functiondef('public.send_rental_chat_notification(bigint,text,text)'::regprocedure)) = '482f8ced70f5ae916b169cfb7c9780e3' AS restored_exactly;
