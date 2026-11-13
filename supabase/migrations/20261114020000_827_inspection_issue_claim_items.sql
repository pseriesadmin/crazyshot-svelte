-- Migration #827: CS 청구 — 사유마다 금액을 따로 저장 (2026-11-14, Stephen 지시)
--
-- 배경: #826 은 청구 사유(복수) 1세트 + 금액 1개였다. 사유마다 금액이 다르므로(파손 15만원 + 연체 3만원 등) 사유별 금액을 따로 받는다.
--       PG 결제 요청에서는 합계(claim_amount)를 청구하고, 항목별 내역(claim_items)을 근거로 남긴다. 이번에도 결제 호출은 만들지 않고 기록만 한다.
-- 변경:
--   1) reservation_inspection_issues.claim_items(jsonb) — [{ "kind": "damage", "amount": 150000 }, ...]. claim_kinds·claim_amount 는 항목에서 계산해 함께 저장(목록·합계 조회용).
--   2) register_return_inspection_issue: 인자를 p_claim_kinds·p_claim_amount 대신 p_claim_items(jsonb, 기본 NULL)로 교체.
--      issue_types 에 'billing' 이 있으면 항목이 1개 이상, 각 항목의 kind 가 허용값(damage·lost·overdue·return_shipping, 중복 불가)이고 amount 가 1~100,000,000 정수여야 하며 합계도 100,000,000 이하여야 한다.
--      'billing' 이 없으면 청구 인자는 무시(NULL 저장). 기존 5개 인자 호출은 그대로 동작한다.
-- 권한: 서버 전용 유지 — REVOKE ALL FROM PUBLIC, anon, authenticated · GRANT service_role.
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). #826 다음에 적용한다(#826 이 먼저 없으면 이 파일이 실패한다). 코드보다 먼저 적용한다.
-- ROLLBACK(코드를 먼저 되돌린 뒤): DROP FUNCTION public.register_return_inspection_issue(bigint, uuid, text[], text, jsonb, jsonb); #826 의 7인자 정의를 다시 CREATE 하고 권한 복원 →
--   ALTER TABLE public.reservation_inspection_issues DROP CONSTRAINT IF EXISTS chk_inspection_issues_claim_items, DROP COLUMN IF EXISTS claim_items;

ALTER TABLE public.reservation_inspection_issues
  ADD COLUMN IF NOT EXISTS claim_items jsonb;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_inspection_issues_claim_items') THEN
    ALTER TABLE public.reservation_inspection_issues
      ADD CONSTRAINT chk_inspection_issues_claim_items
      CHECK (claim_items IS NULL OR (jsonb_typeof(claim_items) = 'array' AND jsonb_array_length(claim_items) > 0));
  END IF;
END $c$;

COMMENT ON COLUMN public.reservation_inspection_issues.claim_items IS '청구 항목별 금액 [{kind, amount}] — 항목 billing 일 때만. claim_kinds·claim_amount(합계)는 여기서 계산해 함께 저장';

DROP FUNCTION IF EXISTS public.register_return_inspection_issue(bigint, uuid, text[], text, jsonb, text[], integer);

CREATE OR REPLACE FUNCTION public.register_return_inspection_issue(
  p_reservation_id bigint, p_admin_id uuid, p_types text[], p_detail text, p_media jsonb,
  p_claim_items jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status  text;
  v_insp    text;
  v_issue   bigint;
  v_billing boolean;
  v_items   jsonb := '[]'::jsonb;
  v_item    jsonb;
  v_kind    text;
  v_amount  numeric;
  v_kinds   text[] := '{}';
  v_total   numeric := 0;
BEGIN
  IF p_types IS NULL OR cardinality(p_types) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '이슈 항목을 1개 이상 선택해 주세요.');
  END IF;

  v_billing := 'billing' = ANY(p_types);
  IF v_billing THEN
    IF p_claim_items IS NULL OR jsonb_typeof(p_claim_items) <> 'array' OR jsonb_array_length(p_claim_items) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', '청구 사유를 1개 이상 선택해 주세요.');
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_claim_items) LOOP
      v_kind := v_item->>'kind';
      IF v_kind IS NULL OR v_kind NOT IN ('damage', 'lost', 'overdue', 'return_shipping') OR v_kind = ANY(v_kinds) THEN
        RETURN jsonb_build_object('ok', false, 'error', '청구 사유를 1개 이상 선택해 주세요.');
      END IF;
      IF jsonb_typeof(v_item->'amount') <> 'number' THEN
        RETURN jsonb_build_object('ok', false, 'error', '청구 금액을 1원 이상 1억 원 이하로 입력해 주세요.');
      END IF;
      v_amount := (v_item->>'amount')::numeric;
      IF v_amount <> trunc(v_amount) OR v_amount < 1 OR v_amount > 100000000 THEN
        RETURN jsonb_build_object('ok', false, 'error', '청구 금액을 1원 이상 1억 원 이하로 입력해 주세요.');
      END IF;
      v_kinds := v_kinds || v_kind;
      v_total := v_total + v_amount;
      v_items := v_items || jsonb_build_array(jsonb_build_object('kind', v_kind, 'amount', v_amount::bigint));
    END LOOP;
    IF v_total > 100000000 THEN
      RETURN jsonb_build_object('ok', false, 'error', '청구 금액 합계는 1억 원 이하로 입력해 주세요.');
    END IF;
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

  INSERT INTO reservation_inspection_issues (reservation_id, issue_types, detail, media, assigned_admin, created_by, claim_kinds, claim_amount, claim_status, claim_items)
  VALUES (p_reservation_id, p_types, NULLIF(btrim(COALESCE(p_detail, '')), ''), COALESCE(p_media, '[]'::jsonb), p_admin_id, p_admin_id,
          CASE WHEN v_billing THEN v_kinds END, CASE WHEN v_billing THEN v_total::integer END, CASE WHEN v_billing THEN 'pending' END,
          CASE WHEN v_billing THEN v_items END)
  RETURNING id INTO v_issue;

  RETURN jsonb_build_object('ok', true, 'issue_id', v_issue, 'first', COALESCE(v_insp, 'pending') <> 'issue');
END;
$function$;

REVOKE ALL ON FUNCTION public.register_return_inspection_issue(bigint, uuid, text[], text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_return_inspection_issue(bigint, uuid, text[], text, jsonb, jsonb) TO service_role;
