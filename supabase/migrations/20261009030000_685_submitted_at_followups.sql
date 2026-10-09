-- Migration #685: submitted_at 후속 보완 — sp3-qa MINOR-3·4 (get_rental_list 정렬 보조 키 + "+추가" 예약의 신청 시각 상속)
-- 2026-10-09 | Stephen 지시("MINOR 3,4번 보완 진행해") | TDD: src/__tests__/services/submittedAtFollowups.test.ts
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
--
-- MINOR-4: Migration 684 보정으로 같은 주문의 예약들이 같은 submitted_at을 갖게 돼, 정렬 동률이 늘었다. 단건 모드는 ORDER BY에 보조 키가 없어
--          OFFSET 페이지 경계에서 중복·누락이 날 수 있다(간트·모바일 목록). 단건 모드에 rr.id DESC, 묶음 모드(주문 대표 행)에 g.b_rid DESC를 보조 키로 둔다.
-- MINOR-3: cms_add_reservation_product_unit("+추가", 원본 예약을 복제해 같은 주문에 합류시키는 경로 — 현재 관리자 화면 차단 중, 재활성화 대비)은
--          새 예약의 submitted_at이 추가 시각(기본값 now())이 돼 기존 데이터(주문 제출 시각 기준)와 기준이 어긋난다. 같은 주문에 합류한 상품은 같은 신청이므로
--          원본 예약의 submitted_at을 그대로 물려받는다(UPDATE OF submitted_at만 — 상태 전용 트리거 미발동).
-- 라이브 정의에서 필요한 줄만 치환(일치 횟수 검사·멱등) — 이전 마이그레이션 변경 보존.
-- ROLLBACK: 두 함수의 ORDER BY를 보조 키 없이 되돌리고, add_unit 함수에서 submitted_at UPDATE 문을 제거.

DO $m$
DECLARE
  d   text;
  sig regprocedure := 'public.get_rental_list(text,text,date,date,integer,integer,text[],text[],boolean,bigint,boolean,boolean)'::regprocedure;
  o1  text := 'ORDER BY rr.submitted_at DESC' || E'\n';
  n1  text := 'ORDER BY rr.submitted_at DESC, rr.id DESC' || E'\n';
  o2  text := 'ORDER BY g.b_created_at DESC' || E'\n';
  n2  text := 'ORDER BY g.b_created_at DESC, g.b_rid DESC' || E'\n';
  c1  int; c2 int;
BEGIN
  d := pg_get_functiondef(sig);
  IF position('rr.id DESC' in d) > 0 THEN RETURN; END IF; -- 멱등
  c1 := (length(d) - length(replace(d, o1, ''))) / length(o1);
  c2 := (length(d) - length(replace(d, o2, ''))) / length(o2);
  IF c1 <> 1 OR c2 <> 1 THEN RAISE EXCEPTION '685: get_rental_list ORDER BY 치환 대상 불일치(단건 %, 묶음 %) — 각 1회여야 함(Migration 684 선행 필요)', c1, c2; END IF;
  EXECUTE replace(replace(d, o1, n1), o2, n2);
END $m$;

DO $m$
DECLARE
  d   text;
  sig regprocedure := 'public.cms_add_reservation_product_unit(bigint,uuid)'::regprocedure;
  o   text := E'  RETURNING id INTO v_new_res_id;\n';
  n   text := E'  RETURNING id INTO v_new_res_id;\n\n  -- 같은 주문에 합류한 상품은 같은 신청 — 원본 예약의 신청 시각을 물려받는다(Migration 685)\n  UPDATE rental_reservations\n     SET submitted_at = (SELECT src.submitted_at FROM rental_reservations src WHERE src.id = p_reservation_id)\n   WHERE id = v_new_res_id;\n';
  cnt int;
BEGIN
  d := pg_get_functiondef(sig);
  IF position('submitted_at' in d) > 0 THEN RETURN; END IF; -- 멱등
  cnt := (length(d) - length(replace(d, o, ''))) / length(o);
  IF cnt <> 1 THEN RAISE EXCEPTION '685: cms_add_reservation_product_unit 치환 대상이 %회 일치(1회여야 함)', cnt; END IF;
  EXECUTE replace(d, o, n);
END $m$;
