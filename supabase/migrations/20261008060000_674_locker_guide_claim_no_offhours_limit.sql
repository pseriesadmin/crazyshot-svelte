-- Migration #674: 무인보관함 안내 발송 대상 — 영업외시간(23:00~08:59) 제한 제거, 퀵서비스 포함
-- 2026-10-08 | Stephen 지시("방문 + 영업외시간만 발송 제한을 없앨 것. 낮에도 무인함을 이용할 수 있음") |
-- TDD: src/__tests__/services/lockerGuideClaimWindow.test.ts
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
--
-- ⛔ 방식: 함수 전체를 CREATE OR REPLACE로 다시 쓰지 않고 "라이브 정의에서 필요한 줄만 치환"한다.
--    이유: Migration #658이 같은 함수의 상품명 2곳을 부모 우선(COALESCE(ppar.name, p.name))으로 바꿔 둔 상태이며(Production 적용됨),
--    Migration 320 원문으로 통째로 덮으면 그 변경이 조용히 되돌아간다(Stage에서 실제로 되돌려졌음을 발견해 이 파일을 치환 방식으로 재작성).
--
-- 변경: ① (Stage에서 되돌려진 경우만) #658 상품명 부모 우선 치환 복원 — 이미 적용돼 있으면 건너뜀
--       ② 시간대 조건(HOUR = 23 OR < 9) 두 곳 삭제  ③ 방식 조건을 방문(visit)·퀵서비스(quick)로 확장(수령·반납 각 1곳)
--       유지: 상태, 비밀번호 존재, 미발송, 시각 1시간 이내·미경과, KST 변환, SECURITY DEFINER, 권한(service_role 전용).
--       각 치환은 정확히 일치 횟수를 검사하고(불일치 시 롤백), 이미 적용된 상태면 건너뛴다(멱등).
-- ROLLBACK: 시간대 줄·방식 조건을 반대로 치환(Migration 320 원문 조건 복원).

DO $m$
DECLARE
  d   text;
  n   int;
  sig regprocedure := 'public.claim_reservations_due_for_locker_guide(integer)'::regprocedure;
  o1  text := E'      AND (EXTRACT(HOUR FROM r.pickup_time::time) = 23 OR EXTRACT(HOUR FROM r.pickup_time::time) < 9)\n';
  o2  text := E'      AND (EXTRACT(HOUR FROM r.return_time::time) = 23 OR EXTRACT(HOUR FROM r.return_time::time) < 9)\n';
  nm_old text := '(SELECT p.name FROM products p WHERE p.id = rr.product_id)';
  nm_new text := '(SELECT COALESCE(ppar.name, p.name) FROM products p LEFT JOIN products ppar ON ppar.id = p.parent_product_id WHERE p.id = rr.product_id)';
BEGIN
  d := pg_get_functiondef(sig);

  -- ① #658 상품명 부모 우선(없을 때만 복원)
  IF position('ppar' in d) = 0 THEN
    n := (length(d) - length(replace(d, nm_old, ''))) / length(nm_old);
    IF n <> 2 THEN RAISE EXCEPTION '674: 상품명 치환 대상이 %회 일치(2회여야 함)', n; END IF;
    d := replace(d, nm_old, nm_new);
  END IF;

  -- ② 시간대 조건 삭제(이미 없으면 건너뜀)
  IF position('EXTRACT(HOUR' in d) > 0 THEN
    IF (length(d) - length(replace(d, o1, ''))) / length(o1) <> 1 OR (length(d) - length(replace(d, o2, ''))) / length(o2) <> 1 THEN
      RAISE EXCEPTION '674: 시간대 조건이 예상과 다름(각 1회여야 함)';
    END IF;
    d := replace(replace(d, o1, ''), o2, '');
  END IF;

  -- ③ 방식 조건 확장(이미 확장돼 있으면 건너뜀)
  IF position('pickup_method IN' in d) = 0 THEN
    IF (length(d) - length(replace(d, 'r.pickup_method = ''visit''', ''))) / length('r.pickup_method = ''visit''') <> 1 THEN
      RAISE EXCEPTION '674: pickup_method 조건이 예상과 다름';
    END IF;
    d := replace(d, 'r.pickup_method = ''visit''', 'r.pickup_method IN (''visit'', ''quick'')');
  END IF;
  IF position('return_method IN' in d) = 0 THEN
    IF (length(d) - length(replace(d, 'r.return_method = ''visit''', ''))) / length('r.return_method = ''visit''') <> 1 THEN
      RAISE EXCEPTION '674: return_method 조건이 예상과 다름';
    END IF;
    d := replace(d, 'r.return_method = ''visit''', 'r.return_method IN (''visit'', ''quick'')');
  END IF;

  EXECUTE d;
END $m$;
