-- Migration #673: 무인보관함 비밀번호 자동 폐기 + 취소·만료 예약 저장 차단
-- 2026-10-08 | Stephen 지시("계약서명 시간 경과 또는 계약 취소 시 폐기") |
-- TDD: src/__tests__/services/lockerPasswordDiscard.test.ts
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
--
-- 정책:
--  ① 예약이 cancelled·expired로 바뀌면(고객 취소·관리자 거부·계약 미서명 30분 경과 만료 모두 이 두 상태로 귀결) 비밀번호와 안내 발송 기록을 비운다.
--  ② 전자계약이 취소되면(contract_signings.sent_at이 값→NULL, cancel_issued_contract·예약변경 경로 공통) 그 계약의 예약 비밀번호를 비운다.
--  ③ 취소·만료된 예약에는 비밀번호를 새로 저장할 수 없다(RPC 거부).
--  입력 자체는 예약 단계와 무관하게 가능하다(RPC는 단계를 보지 않음 — 위 ③ 제외).
-- 자동 안내 발송 조건(claim_reservations_due_for_locker_guide)은 변경하지 않는다.
-- ROLLBACK: DROP TRIGGER trg_locker_pw_discard_on_status ON rental_reservations; DROP TRIGGER trg_locker_pw_discard_on_contract_cancel ON contract_signings;
--           DROP FUNCTION private.discard_locker_pw_on_status(), private.discard_locker_pw_on_contract_cancel(); update_reservation_locker_password를 Migration 320 정의로 복원.

CREATE OR REPLACE FUNCTION private.discard_locker_pw_on_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.locker_password := NULL;
  NEW.locker_guide_sent_pickup_at := NULL;
  NEW.locker_guide_sent_return_at := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.discard_locker_pw_on_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_locker_pw_discard_on_status ON public.rental_reservations;
CREATE TRIGGER trg_locker_pw_discard_on_status
  BEFORE UPDATE OF status ON public.rental_reservations
  FOR EACH ROW
  WHEN (NEW.status IN ('cancelled', 'expired') AND OLD.status IS DISTINCT FROM NEW.status
        AND (OLD.locker_password IS NOT NULL
             OR OLD.locker_guide_sent_pickup_at IS NOT NULL
             OR OLD.locker_guide_sent_return_at IS NOT NULL))
  EXECUTE FUNCTION private.discard_locker_pw_on_status();

CREATE OR REPLACE FUNCTION private.discard_locker_pw_on_contract_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE rental_reservations rr
     SET locker_password = NULL,
         locker_guide_sent_pickup_at = NULL,
         locker_guide_sent_return_at = NULL
   WHERE rr.id IN (
           -- 계약서는 주문 단위로 공유된다(같은 주문의 형제 예약 포함) — 계약 취소는 주문 전체에 적용
           SELECT c.reservation_id FROM contracts c WHERE c.id = NEW.contract_id
           UNION
           SELECT oi2.reservation_id
             FROM contracts c
             JOIN order_items oi1 ON oi1.reservation_id = c.reservation_id
             JOIN order_items oi2 ON oi2.order_id = oi1.order_id
            WHERE c.id = NEW.contract_id AND oi2.reservation_id IS NOT NULL
         )
     AND (rr.locker_password IS NOT NULL
          OR rr.locker_guide_sent_pickup_at IS NOT NULL
          OR rr.locker_guide_sent_return_at IS NOT NULL);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.discard_locker_pw_on_contract_cancel() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_locker_pw_discard_on_contract_cancel ON public.contract_signings;
CREATE TRIGGER trg_locker_pw_discard_on_contract_cancel
  AFTER UPDATE OF sent_at ON public.contract_signings
  FOR EACH ROW
  WHEN (OLD.sent_at IS NOT NULL AND NEW.sent_at IS NULL)
  EXECUTE FUNCTION private.discard_locker_pw_on_contract_cancel();

-- ③ 저장 RPC: 취소·만료 예약 거부(그 외 단계는 모두 허용)
CREATE OR REPLACE FUNCTION public.update_reservation_locker_password(
  p_reservation_id BIGINT,
  p_password        TEXT
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
    updated_at      = NOW()
  WHERE id = p_reservation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_reservation_locker_password(BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_reservation_locker_password(BIGINT, TEXT)
  TO authenticated;

-- 기존 취소·만료 예약에 남은 비밀번호 정리(1회)
UPDATE rental_reservations
   SET locker_password = NULL,
       locker_guide_sent_pickup_at = NULL,
       locker_guide_sent_return_at = NULL
 WHERE status IN ('cancelled', 'expired')
   AND (locker_password IS NOT NULL
        OR locker_guide_sent_pickup_at IS NOT NULL
        OR locker_guide_sent_return_at IS NOT NULL);
