-- Migration #826: CS 검수 이슈 '청구' 항목 — 청구 사유·금액 저장 (2026-11-14, Stephen 확정)
--
-- 동작: 검수 탭 CS 접수에서 항목 '청구'(issue_types 에 'billing')를 고르면 청구 사유(파손·분실·연체·반납배송요금, 복수)와 청구 금액(원)을 함께 등록한다.
--       이번에는 '기록'만 한다 — 실제 청구·결제(PG) 호출은 만들지 않는다. 나중에 PG 결제 요청을 붙일 때 사유·금액·상태를 그대로 쓰도록 구조화해 저장한다.
--       처리 흐름은 기존 CS 이슈와 같다(이슈 검수중 → 처리 완료 → 완료(추가청구)).
-- 변경:
--   1) reservation_inspection_issues.claim_kinds(text[]) · claim_amount(integer, 원) · claim_status(text) 추가.
--      claim_status: 'pending'(청구 전 — 기록만 된 상태). 'requested'·'paid'·'cancelled' 는 PG 연동 때 쓸 예약값(지금은 앱이 쓰지 않는다).
--   2) register_return_inspection_issue: 인자 p_claim_kinds·p_claim_amount 추가(기본값 NULL — 기존 5개 인자 호출은 그대로 동작).
--      issue_types 에 'billing' 이 있으면 사유 1개 이상(허용값만)·금액 1~100,000,000 을 요구하고, 없으면 청구 인자는 무시(NULL 저장).
-- 권한: 서버 전용 유지 — REVOKE ALL FROM PUBLIC, anon, authenticated · GRANT service_role (테이블 권한은 기존 그대로).
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). 코드보다 먼저 적용한다. 기존 마이그레이션 파일은 수정하지 않는다.
-- ROLLBACK(코드를 먼저 되돌린 뒤): DROP FUNCTION public.register_return_inspection_issue(bigint, uuid, text[], text, jsonb, text[], integer);
--   #724 의 5인자 register_return_inspection_issue 정의를 다시 CREATE 하고 REVOKE/GRANT(service_role) 복원 →
--   ALTER TABLE public.reservation_inspection_issues DROP COLUMN IF EXISTS claim_kinds, DROP COLUMN IF EXISTS claim_amount, DROP COLUMN IF EXISTS claim_status;

ALTER TABLE public.reservation_inspection_issues
  ADD COLUMN IF NOT EXISTS claim_kinds  text[],
  ADD COLUMN IF NOT EXISTS claim_amount integer,
  ADD COLUMN IF NOT EXISTS claim_status text;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_inspection_issues_claim') THEN
    ALTER TABLE public.reservation_inspection_issues
      ADD CONSTRAINT chk_inspection_issues_claim
      CHECK (
        (claim_kinds IS NULL AND claim_amount IS NULL AND claim_status IS NULL)
        OR (cardinality(claim_kinds) > 0 AND claim_amount BETWEEN 1 AND 100000000 AND claim_status IN ('pending', 'requested', 'paid', 'cancelled'))
      );
  END IF;
END $c$;

COMMENT ON COLUMN public.reservation_inspection_issues.claim_kinds IS '청구 사유(damage·lost·overdue·return_shipping 복수) — 항목 billing 일 때만. NULL = 청구 없음';
COMMENT ON COLUMN public.reservation_inspection_issues.claim_amount IS '청구 금액(원, 1~100,000,000) — 항목 billing 일 때만';
COMMENT ON COLUMN public.reservation_inspection_issues.claim_status IS '청구 상태: pending(청구 전, 기록만) · requested·paid·cancelled(PG 연동 예약값)';

DROP FUNCTION IF EXISTS public.register_return_inspection_issue(bigint, uuid, text[], text, jsonb);

CREATE OR REPLACE FUNCTION public.register_return_inspection_issue(
  p_reservation_id bigint, p_admin_id uuid, p_types text[], p_detail text, p_media jsonb,
  p_claim_kinds text[] DEFAULT NULL, p_claim_amount integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_insp   text;
  v_issue  bigint;
  v_billing boolean;
  v_kinds  text[];
  v_amount integer;
BEGIN
  IF p_types IS NULL OR cardinality(p_types) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '이슈 항목을 1개 이상 선택해 주세요.');
  END IF;

  v_billing := 'billing' = ANY(p_types);
  IF v_billing THEN
    SELECT COALESCE(array_agg(DISTINCT k ORDER BY k), '{}') INTO v_kinds FROM unnest(COALESCE(p_claim_kinds, '{}')) AS k;
    IF cardinality(v_kinds) = 0 OR EXISTS (SELECT 1 FROM unnest(v_kinds) AS k WHERE k NOT IN ('damage', 'lost', 'overdue', 'return_shipping')) THEN
      RETURN jsonb_build_object('ok', false, 'error', '청구 사유를 1개 이상 선택해 주세요.');
    END IF;
    IF p_claim_amount IS NULL OR p_claim_amount < 1 OR p_claim_amount > 100000000 THEN
      RETURN jsonb_build_object('ok', false, 'error', '청구 금액을 1원 이상 1억 원 이하로 입력해 주세요.');
    END IF;
    v_amount := p_claim_amount;
  END IF;

  SELECT status, inspection_status INTO v_status, v_insp
    FROM rental_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.'); END IF;
  IF v_status <> 'returned' THEN
    RETURN jsonb_build_object('ok', false, 'error', '반납완료 상태에서만 검수 이슈를 등록할 수 있습니다.');
  END IF;

  UPDATE rental_reservations
     SET inspection_status = 'issue', inspected_at = now(), inspected_by = p_admin_id
   WHERE id = ANY(public.inspection_target_ids(p_reservation_id));

  INSERT INTO reservation_inspection_issues (reservation_id, issue_types, detail, media, assigned_admin, created_by, claim_kinds, claim_amount, claim_status)
  VALUES (p_reservation_id, p_types, NULLIF(btrim(COALESCE(p_detail, '')), ''), COALESCE(p_media, '[]'::jsonb), p_admin_id, p_admin_id,
          CASE WHEN v_billing THEN v_kinds END, CASE WHEN v_billing THEN v_amount END, CASE WHEN v_billing THEN 'pending' END)
  RETURNING id INTO v_issue;

  RETURN jsonb_build_object('ok', true, 'issue_id', v_issue, 'first', COALESCE(v_insp, 'pending') <> 'issue');
END;
$function$;

REVOKE ALL ON FUNCTION public.register_return_inspection_issue(bigint, uuid, text[], text, jsonb, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_return_inspection_issue(bigint, uuid, text[], text, jsonb, text[], integer) TO service_role;
