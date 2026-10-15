-- Migration #719: 예약에 '예약승인 시각'(approved_at) 추가 + 예약목록 '계약대기' 칩 판정 확장 (2026-10-15, Stephen 확정)
--
-- 배경: 자동발행 표준양식이 꺼져 있는 경우 '예약승인' 뒤에는 관리자가 계약서를 수동으로 발행·발송한다. 이때 예약은 아직 계약서가 발송되지 않았어도
--   '승인완료' 상태이며 예약목록에서 '계약대기' 칩으로 옮겨져야 한다(발행 전에는 계약서 발행 불가, 승인 후에만 가능).
-- 변경: ① rental_reservations.approved_at timestamptz NULL — 서류 승인 완료 고객의 예약을 관리자가 '예약승인'한 시각(이 값이 있으면 승인완료).
--       ② get_rental_list 필터: '계약대기'(p_require_contract_sent_unsigned) = 계약서 발송됨 OR 예약승인됨, '신청대기'(p_exclude_contract_sent) = 둘 다 아님.
--          시그니처·반환 컬럼·권한 불변(본문만 앵커 치환, 앵커가 없으면 중단, 이미 적용돼 있으면 건너뜀).
-- 기존 행은 NULL(= 승인 전)이라 동작 변화 없음. 롤백: 위 두 조건 줄과 b_approved_at 컬럼을 제거한 정의(Migration #714)로 CREATE OR REPLACE 후
--   DROP INDEX IF EXISTS idx_rr_approved_at; ALTER TABLE public.rental_reservations DROP COLUMN IF EXISTS approved_at;

ALTER TABLE public.rental_reservations
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

COMMENT ON COLUMN public.rental_reservations.approved_at IS
  '관리자가 예약승인을 실행한 시각(서류 승인 완료 고객). 있으면 예약목록 계약대기 칩 대상이며 계약서 수동 발행이 가능해진다.';

CREATE INDEX IF NOT EXISTS idx_rr_approved_at
  ON public.rental_reservations (id)
  WHERE approved_at IS NOT NULL;

DO $$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
  c1 text := 'p_require_contract_sent_unsigned IS NOT TRUE OR cs.sent_at IS NOT NULL';
  c2 text := 'p_exclude_contract_sent IS NOT TRUE OR cs.sent_at IS NULL';
  c3 text := 'p_require_contract_sent_unsigned IS NOT TRUE OR g.b_signing_sent_at IS NOT NULL';
  c4 text := 'p_exclude_contract_sent IS NOT TRUE OR g.b_signing_sent_at IS NULL';
  c5 text := 'AS b_payment_confirmed_at,';
  function_name text := 'get_rental_list';
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p
   WHERE p.proname = function_name AND p.pronamespace = 'public'::regnamespace;
  IF v_oid IS NULL THEN RAISE EXCEPTION 'get_rental_list 없음'; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position('b_approved_at' IN v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, c1, ''))) <> length(c1)
     OR (length(v_def) - length(replace(v_def, c2, ''))) <> length(c2)
     OR (length(v_def) - length(replace(v_def, c3, ''))) <> length(c3)
     OR (length(v_def) - length(replace(v_def, c4, ''))) <> length(c4)
     OR (length(v_def) - length(replace(v_def, c5, ''))) <> length(c5) THEN
    RAISE EXCEPTION 'get_rental_list 앵커를 찾지 못했습니다 — 라이브 정의가 예상과 다릅니다';
  END IF;
  v_new := replace(v_def, c1, 'p_require_contract_sent_unsigned IS NOT TRUE OR cs.sent_at IS NOT NULL OR rr.approved_at IS NOT NULL');
  v_new := replace(v_new, c2, 'p_exclude_contract_sent IS NOT TRUE OR (cs.sent_at IS NULL AND rr.approved_at IS NULL)');
  v_new := replace(v_new, c3, 'p_require_contract_sent_unsigned IS NOT TRUE OR g.b_signing_sent_at IS NOT NULL OR g.b_approved_at IS NOT NULL');
  v_new := replace(v_new, c4, 'p_exclude_contract_sent IS NOT TRUE OR (g.b_signing_sent_at IS NULL AND g.b_approved_at IS NULL)');
  v_new := replace(v_new, c5, 'AS b_payment_confirmed_at,' || E'\n        rr.approved_at AS b_approved_at,');
  EXECUTE v_new;
END $$;
