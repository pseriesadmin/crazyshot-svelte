-- Migration #679: CMS 예약목록·상세 "신청일(시)"을 주문 제출 시각으로 표시 (get_rental_list)
-- 2026-10-09 | Stephen 지시("신청일이 정상이 아니야 — A로 진행") | TDD: src/__tests__/services/rentalListSubmittedAt.test.ts
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
--
-- 문제: 신청일로 보여 주던 rental_reservations.created_at은 "장바구니에 담아 예약 행이 만들어진 시각"이다. 고객이 체크아웃을 제출(=예약신청)하는 시각은
--       주문(orders.created_at)이라, 담고 며칠 뒤 제출한 예약은 신청일이 며칠 앞서 표시됐다(운영 예: 예약 256 — 10/5 담음·10/9 제출, 주문 연결 108건 중 33건이 10분 이상 차이).
-- 수정: get_rental_list의 created_at을 COALESCE(o.created_at, rr.created_at)로(주문이 없으면 기존 값). 정렬(최근 신청 순)도 같은 값 기준으로 맞춘다.
--       라이브 정의에서 필요한 3곳(단건 모드 select·묶음 모드 select·단건 모드 ORDER BY)만 치환 — #618·#658 등 이후 변경을 그대로 보존. 일치 횟수 검사·멱등.
--       묶음 모드의 정렬은 이미 b_created_at(= 위 select 값)을 쓰므로 별도 치환이 필요 없다.
-- ROLLBACK: 세 곳을 rr.created_at으로 되돌린다.

DO $m$
DECLARE
  d   text;
  sig regprocedure := 'public.get_rental_list(text,text,date,date,integer,integer,text[],text[],boolean,bigint,boolean,boolean)'::regprocedure;
  n1  int; n2 int; n3 int;
BEGIN
  d := pg_get_functiondef(sig);
  IF position('COALESCE(o.created_at, rr.created_at)' in d) > 0 THEN RETURN; END IF; -- 멱등

  SELECT count(*) INTO n1 FROM regexp_matches(d, 'rr\.created_at(\s+)AS created_at,', 'g');
  SELECT count(*) INTO n2 FROM regexp_matches(d, 'rr\.created_at(\s+)AS b_created_at,', 'g');
  SELECT count(*) INTO n3 FROM regexp_matches(d, 'ORDER BY rr\.created_at DESC', 'g');
  IF n1 <> 1 OR n2 <> 1 OR n3 <> 1 THEN
    RAISE EXCEPTION '679: 치환 대상 일치 횟수가 예상과 다름(단건 select %, 묶음 select %, ORDER BY %) — 각 1회여야 함', n1, n2, n3;
  END IF;

  d := regexp_replace(d, 'rr\.created_at(\s+)AS created_at,',   'COALESCE(o.created_at, rr.created_at)\1AS created_at,');
  d := regexp_replace(d, 'rr\.created_at(\s+)AS b_created_at,', 'COALESCE(o.created_at, rr.created_at)\1AS b_created_at,');
  d := regexp_replace(d, 'ORDER BY rr\.created_at DESC',        'ORDER BY COALESCE(o.created_at, rr.created_at) DESC');

  EXECUTE d;
END $m$;
