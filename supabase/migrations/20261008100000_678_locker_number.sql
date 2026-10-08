-- Migration #678: 무인함 번호(locker_number) 추가 — "무인함 번호 + 비밀번호"로 재구성, 안내 문자에 함께 표기
-- 2026-10-08 | Stephen 지시("입력폼 좌측에 무인함 번호 입력폼 추가, 둘 다 필수") |
-- TDD: src/__tests__/services/lockerPasswordDiscard.test.ts · lockerGuideClaimWindow.test.ts · src/__tests__/server/lockerGuideCron.test.ts
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
--
-- ① rental_reservations.locker_number TEXT 컬럼 추가.
-- ② update_reservation_locker_password: 인자 p_locker_number 추가(기존 2인자 함수는 삭제 — 오버로드 모호성 방지). 무인함 번호와 비밀번호는 "둘 다 있거나 둘 다 NULL(삭제)"만 허용(둘 다 필수).
-- ③ 폐기 트리거 함수 2종: 무인함 번호도 함께 비움(Migration 673 함수를 같은 이름으로 다시 정의 — 673 자체 소유 함수).
-- ④ claim_reservations_due_for_locker_guide: 반환 컬럼에 locker_number 추가. 반환형이 바뀌어 DROP 후 재생성이 필요하므로 "라이브 정의 줄 치환"으로 만들어
--    #658(상품명 부모 우선)·#674(시간대 제한 제거)의 결과를 그대로 보존한다. 권한은 service_role 전용으로 재부여.
-- ROLLBACK: 반환 컬럼·RETURNING에서 locker_number 제거 후 재생성, update 함수를 2인자 정의(673)로 복원, ALTER TABLE ... DROP COLUMN locker_number.

ALTER TABLE public.rental_reservations ADD COLUMN IF NOT EXISTS locker_number TEXT;

-- ② 저장 RPC (2인자 → 3인자)
DROP FUNCTION IF EXISTS public.update_reservation_locker_password(BIGINT, TEXT);

CREATE OR REPLACE FUNCTION public.update_reservation_locker_password(
  p_reservation_id BIGINT,
  p_password        TEXT,
  p_locker_number   TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NOT is_cms_user() THEN
    RAISE EXCEPTION 'permission denied: cms role required';
  END IF;

  IF (p_password IS NULL) <> (p_locker_number IS NULL) THEN
    RAISE EXCEPTION 'locker number and password are required together';
  END IF;

  SELECT status INTO v_status FROM rental_reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation not found: %', p_reservation_id;
  END IF;
  IF p_password IS NOT NULL AND v_status IN ('cancelled', 'expired') THEN
    RAISE EXCEPTION 'locker password not allowed for status: %', v_status;
  END IF;

  UPDATE rental_reservations
  SET
    locker_password = p_password,
    locker_number   = p_locker_number,
    updated_at      = NOW()
  WHERE id = p_reservation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_reservation_locker_password(BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_reservation_locker_password(BIGINT, TEXT, TEXT) TO authenticated;

-- ③ 폐기 트리거 함수 2종 — 무인함 번호도 함께 폐기
CREATE OR REPLACE FUNCTION private.discard_locker_pw_on_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.locker_password := NULL;
  NEW.locker_number := NULL;
  NEW.locker_guide_sent_pickup_at := NULL;
  NEW.locker_guide_sent_return_at := NULL;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.discard_locker_pw_on_contract_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE rental_reservations rr
     SET locker_password = NULL,
         locker_number = NULL,
         locker_guide_sent_pickup_at = NULL,
         locker_guide_sent_return_at = NULL
   WHERE rr.id IN (
           SELECT c.reservation_id FROM contracts c WHERE c.id = NEW.contract_id
           UNION
           SELECT oi2.reservation_id
             FROM contracts c
             JOIN order_items oi1 ON oi1.reservation_id = c.reservation_id
             JOIN order_items oi2 ON oi2.order_id = oi1.order_id
            WHERE c.id = NEW.contract_id AND oi2.reservation_id IS NOT NULL
         )
     AND (rr.locker_password IS NOT NULL
          OR rr.locker_number IS NOT NULL
          OR rr.locker_guide_sent_pickup_at IS NOT NULL
          OR rr.locker_guide_sent_return_at IS NOT NULL);
  RETURN NEW;
END;
$$;

-- ④ claim 함수: 반환 컬럼에 locker_number 추가(라이브 정의 줄 치환 → DROP → 재생성 → 권한 재부여)
DO $m$
DECLARE
  d   text;
  sig regprocedure := 'public.claim_reservations_due_for_locker_guide(integer)'::regprocedure;
  o_ret text := 'password text, product_name text)';
  n_ret text := 'password text, locker_number text, product_name text)';
  o_row text := E'    rr.locker_password,\n';
  n_row text := E'    rr.locker_password,\n    rr.locker_number,\n';
  n int;
BEGIN
  d := pg_get_functiondef(sig);
  IF position('locker_number' in d) > 0 THEN RETURN; END IF; -- 멱등: 이미 반영됨

  IF (length(d) - length(replace(d, o_ret, ''))) / length(o_ret) <> 1 THEN
    RAISE EXCEPTION '678: 반환 컬럼 정의가 예상과 다름';
  END IF;
  n := (length(d) - length(replace(d, o_row, ''))) / length(o_row);
  IF n <> 2 THEN RAISE EXCEPTION '678: RETURNING 줄이 %회 일치(2회여야 함)', n; END IF;

  d := replace(replace(d, o_ret, n_ret), o_row, n_row);

  DROP FUNCTION public.claim_reservations_due_for_locker_guide(integer);
  EXECUTE d;

  REVOKE ALL ON FUNCTION public.claim_reservations_due_for_locker_guide(integer) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.claim_reservations_due_for_locker_guide(integer) TO service_role;
END $m$;
