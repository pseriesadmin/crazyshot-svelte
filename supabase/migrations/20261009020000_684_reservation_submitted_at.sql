-- Migration #684: 예약 신청 시각 전용 컬럼 submitted_at (근본 해결) — "장바구니 담은 시각"이 신청 시각으로 쓰이던 문제
-- 2026-10-09 | Stephen 지시("submitted_at 방향으로 진행") | TDD: src/__tests__/services/reservationSubmittedAt.test.ts · rentalListSubmittedAt.test.ts
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
--
-- 문제: rental_reservations.created_at은 임시예약(draft)이 만들어진 장바구니 담기 시각인데, 신청일로 쓰였다. 임시예약→hold 승격(promote_draft_reservation)은
--       status만 바꾸고 created_at을 그대로 둬서, 담고 며칠 뒤 제출한 예약의 신청일이 며칠 앞서 보였다(운영 예: 예약 256 — 10/5 담음·10/9 제출).
-- 수정: ① 컬럼 submitted_at 신설(기본 now(), NOT NULL) + 기존 데이터 보정(주문이 있으면 주문 제출 시각, 없으면 created_at)
--       ② promote_draft_reservation이 승격 순간 submitted_at = now() 기록(created_at은 보존) — 바로 hold로 만드는 경로(create_hold_reservation)는 기본값 now()가 그 시각
--       ③ 신청 시각을 보여주거나 신청 순서로 쓰는 읽기 경로를 submitted_at으로 전환: get_rental_list(Migration 679의 주문조인 방식 대체, 반환 필드명 created_at은 호환 유지) ·
--          get_chat_customer_detail(예약 목록 시각·정렬, JSON 키 created_at 유지) · compute_rfm_scores(최근성) · get_coupon_redemptions(최근 예약 선택)
--       의도적 비전환: refresh_user_segments의 "장바구니 이탈" 판정(cart_add 이벤트 기준·담은 시각 의미)은 그대로.
--       라이브 정의에서 필요한 줄만 치환(일치 횟수 검사·멱등) — 이전 마이그레이션(#618·#658·#679 등) 변경을 그대로 보존.
-- 기존 UPDATE 트리거는 모두 UPDATE OF status 전용이라 이 보정 UPDATE(submitted_at만)는 트리거를 발동하지 않는다.
-- ROLLBACK: 4개 함수를 이전 정의(rr.created_at 기준 / 679의 COALESCE(o.created_at, rr.created_at))로 되돌리고 promote의 submitted_at 줄 제거, 컬럼 DROP.

-- ① 컬럼 + 보정
ALTER TABLE public.rental_reservations ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

UPDATE public.rental_reservations rr
   SET submitted_at = COALESCE(
         (SELECT min(o.created_at)
            FROM public.order_items oi
            JOIN public.orders o ON o.id = oi.order_id
           WHERE oi.reservation_id = rr.id),
         rr.created_at)
 WHERE rr.submitted_at IS NULL;

ALTER TABLE public.rental_reservations ALTER COLUMN submitted_at SET DEFAULT now();
ALTER TABLE public.rental_reservations ALTER COLUMN submitted_at SET NOT NULL;

COMMENT ON COLUMN public.rental_reservations.submitted_at IS
  '예약 신청(체크아웃 제출) 시각 — 신청일 표시·신청 순 정렬의 정본. created_at은 예약 행 생성(장바구니 담기) 시각. 임시예약→hold 승격 시 now()로 갱신(Migration 684).';

-- ② promote_draft_reservation: 승격 시 submitted_at 기록
DO $m$
DECLARE
  d   text;
  sig regprocedure := 'public.promote_draft_reservation(bigint,date,date,text,text)'::regprocedure;
  o   text := E'      status     = ''hold'',\n';
  n   text := E'      status     = ''hold'',\n      submitted_at = now(),\n';
  cnt int;
BEGIN
  d := pg_get_functiondef(sig);
  IF position('submitted_at' in d) > 0 THEN RETURN; END IF;
  cnt := (length(d) - length(replace(d, o, ''))) / length(o);
  IF cnt <> 1 THEN RAISE EXCEPTION '684: promote_draft_reservation 치환 대상이 %회 일치(1회여야 함)', cnt; END IF;
  EXECUTE replace(d, o, n);
END $m$;

-- ③-a get_rental_list: Migration 679의 COALESCE(o.created_at, rr.created_at) 3곳 → rr.submitted_at
DO $m$
DECLARE
  d   text;
  sig regprocedure := 'public.get_rental_list(text,text,date,date,integer,integer,text[],text[],boolean,bigint,boolean,boolean)'::regprocedure;
  o   text := 'COALESCE(o.created_at, rr.created_at)';
  cnt int;
BEGIN
  d := pg_get_functiondef(sig);
  IF position('rr.submitted_at' in d) > 0 THEN RETURN; END IF;
  cnt := (length(d) - length(replace(d, o, ''))) / length(o);
  IF cnt <> 3 THEN RAISE EXCEPTION '684: get_rental_list 치환 대상이 %회 일치(3회여야 함 — Migration 679 선행 필요)', cnt; END IF;
  EXECUTE replace(d, o, 'rr.submitted_at');
END $m$;

-- ③-b get_chat_customer_detail: 최근 예약 10건의 시각·정렬
DO $m$
DECLARE
  d   text;
  sig regprocedure := 'public.get_chat_customer_detail(uuid)'::regprocedure;
  o1  text := E'    SELECT id, status, start_date, end_date, product_id, created_at\n    FROM rental_reservations';
  n1  text := E'    SELECT id, status, start_date, end_date, product_id, submitted_at AS created_at\n    FROM rental_reservations';
  o2  text := E'    ORDER BY created_at DESC\n    LIMIT 10';
  n2  text := E'    ORDER BY submitted_at DESC\n    LIMIT 10';
  c1  int; c2 int;
BEGIN
  d := pg_get_functiondef(sig);
  IF position('submitted_at' in d) > 0 THEN RETURN; END IF;
  c1 := (length(d) - length(replace(d, o1, ''))) / length(o1);
  c2 := (length(d) - length(replace(d, o2, ''))) / length(o2);
  IF c1 <> 1 OR c2 <> 1 THEN RAISE EXCEPTION '684: get_chat_customer_detail 치환 대상 불일치(%, %)', c1, c2; END IF;
  EXECUTE replace(replace(d, o1, n1), o2, n2);
END $m$;

-- ③-c compute_rfm_scores: 최근성 = 마지막 "신청" 시각
DO $m$
DECLARE
  d   text;
  sig regprocedure := 'public.compute_rfm_scores()'::regprocedure;
  o   text := 'MAX(rr.created_at)';
  cnt int;
BEGIN
  d := pg_get_functiondef(sig);
  IF position('MAX(rr.submitted_at)' in d) > 0 THEN RETURN; END IF;
  cnt := (length(d) - length(replace(d, o, ''))) / length(o);
  IF cnt <> 1 THEN RAISE EXCEPTION '684: compute_rfm_scores 치환 대상이 %회 일치(1회여야 함)', cnt; END IF;
  EXECUTE replace(d, o, 'MAX(rr.submitted_at)');
END $m$;

-- ③-d get_coupon_redemptions: 최근 예약 선택 기준
DO $m$
DECLARE
  d   text;
  sig regprocedure := 'public.get_coupon_redemptions(uuid)'::regprocedure;
  o   text := 'ORDER BY rr.created_at DESC';
  cnt int;
BEGIN
  d := pg_get_functiondef(sig);
  IF position('rr.submitted_at' in d) > 0 THEN RETURN; END IF;
  cnt := (length(d) - length(replace(d, o, ''))) / length(o);
  IF cnt <> 1 THEN RAISE EXCEPTION '684: get_coupon_redemptions 치환 대상이 %회 일치(1회여야 함)', cnt; END IF;
  EXECUTE replace(d, o, 'ORDER BY rr.submitted_at DESC');
END $m$;
