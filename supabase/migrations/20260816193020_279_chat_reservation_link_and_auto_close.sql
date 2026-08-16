-- Migration 279: chat_sessions 예약 연결값 타입 불일치 수정 + 대여완료 시 자동종료
-- Stephen 확정(2026-08-17): "상담 생성 시 연결값을 제대로 저장하도록 먼저 수정" 후 자동종료 연결
--
-- 배경: context_id는 uuid 컬럼인데 rental_reservations.id는 bigint라 예약 연결이 애초에
-- 불가능했다(기존 3건은 저장은 됐으나 어떤 실제 예약도 가리키지 못하는 무효 값이었음).
-- context_id(uuid, product_inquiry용 등 기존 용도 유지)와 별개로 전용 컬럼 신설.

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS context_reservation_id bigint
    REFERENCES rental_reservations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_context_reservation_id
  ON chat_sessions(context_reservation_id) WHERE context_reservation_id IS NOT NULL;

-- 대여 사이클 완료(rental_reservations.status → 'completed') 시 연결된 상담 자동 종료
CREATE OR REPLACE FUNCTION public.auto_close_chat_on_rental_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    UPDATE chat_sessions
    SET status = 'closed', updated_at = now()
    WHERE context_reservation_id = NEW.id
      AND status IN ('open', 'pending');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_close_chat_on_rental_completed ON rental_reservations;
CREATE TRIGGER trg_auto_close_chat_on_rental_completed
  AFTER UPDATE OF status ON rental_reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_close_chat_on_rental_completed();

-- rollback:
-- DROP TRIGGER IF EXISTS trg_auto_close_chat_on_rental_completed ON rental_reservations;
-- DROP FUNCTION IF EXISTS public.auto_close_chat_on_rental_completed();
-- DROP INDEX IF EXISTS idx_chat_sessions_context_reservation_id;
-- ALTER TABLE chat_sessions DROP COLUMN IF EXISTS context_reservation_id;
