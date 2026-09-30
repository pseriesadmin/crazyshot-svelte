-- Migration 588: 수령일 신청 마감(리드타임) + 최대 대여일 서버측 재검증 (PICKUP-LEAD-GUARD)
--
-- 결함: 방식별 신청 마감("N일 전 오후 H시까지")과 최대 대여일 검증이 장바구니 화면(클라이언트)에만 있어,
--   RPC를 직접 호출하면 마감이 지난 수령일·최대 대여일 초과 예약도 만들 수 있었다.
--
-- 수정: 예약을 hold로 만드는 고객 경로 2곳에서 같은 규칙을 서버가 집행한다.
--   ① create_hold_reservation  (create_hold_reservation_with_shipment·reissue-reservation·상품상세 즉시예약이 경유)
--   ② promote_draft_reservation (장바구니 draft → hold 승격)
--   판매전용(sale_only) 상품은 구매 건이라 수령일 개념이 없어 제외(장바구니가 오늘 날짜·crazydelivery를 강제 주입).
--
-- 규칙(TS pickupLeadTime.ts와 동일 — 패리티 테스트로 고정):
--   · 방식 규칙 = 활성 rental_method_options(method_key)의 deadline_time이 정형("N일 전 (오전|오후) H시" 또는 "N일 전 HH:MM")이면 그 값,
--     아니면 기본값(is_delivery_type=true → 2일, 그 외 1일, 마감 19시). 방식 미지정은 'visit'로 본다(create_hold 기존 기본값과 동일).
--   · 최소 수령일 = (KST 오늘) + 리드일수 + (KST 현재시각 < 마감시각 ? 0 : 1)
--   · 최대 대여일: 종료일-시작일(+ 배송형이면 1) > rental_shipping_settings.max_rental_days 이면 거부
--
-- 그 외 로직·시그니처·권한은 무변경. 두 RPC 본문은 통째로 옮기지 않고 현재 정의에 한 줄(PERFORM)만
-- 끼워 넣어 재생성한다(단일 앵커 검증, 이미 적용돼 있으면 no-op).
--
-- ROLLBACK: 두 함수에서 '-- PICKUP-LEAD-GUARD' 다음 PERFORM 한 줄을 제거해 재생성하고,
--   assert_reservation_lead_and_period / get_pickup_lead_rule / parse_lead_rule_text 를 DROP 한다.

CREATE OR REPLACE FUNCTION public.parse_lead_rule_text(p_text text)
RETURNS TABLE(lead_days integer, cutoff_hour integer)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_m    text[];
  v_days integer;
  v_h    integer;
  v_hour integer := NULL;
BEGIN
  IF p_text IS NULL THEN RETURN; END IF;

  v_m := regexp_match(p_text, '(\d+)\s*일\s*전');
  IF v_m IS NULL THEN RETURN; END IF;
  v_days := v_m[1]::integer;

  v_m := regexp_match(p_text, '(오전|오후)\s*(\d{1,2})\s*시');
  IF v_m IS NOT NULL THEN
    v_h := v_m[2]::integer;
    IF v_h BETWEEN 0 AND 12 THEN
      v_hour := CASE
        WHEN v_m[1] = '오후' THEN (CASE WHEN v_h = 12 THEN 12 ELSE v_h + 12 END)
        ELSE (CASE WHEN v_h = 12 THEN 0 ELSE v_h END)
      END;
    END IF;
  ELSE
    v_m := regexp_match(p_text, '(\d{1,2})\s*:\s*\d{2}');
    IF v_m IS NOT NULL THEN
      v_h := v_m[1]::integer;
      IF v_h BETWEEN 0 AND 23 THEN v_hour := v_h; END IF;
    END IF;
  END IF;

  IF v_hour IS NULL THEN RETURN; END IF;
  lead_days := v_days;
  cutoff_hour := v_hour;
  RETURN NEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pickup_lead_rule(p_method_key text)
RETURNS TABLE(lead_days integer, cutoff_hour integer, is_delivery_type boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deliv boolean;
  v_text  text;
  v_rule  RECORD;
BEGIN
  SELECT o.is_delivery_type, o.deadline_time
    INTO v_deliv, v_text
  FROM rental_method_options o
  WHERE o.method_key = p_method_key
    AND o.is_active = true
    AND o.deleted_at IS NULL
  ORDER BY o.display_order
  LIMIT 1;

  v_deliv := COALESCE(v_deliv, false);
  SELECT * INTO v_rule FROM parse_lead_rule_text(v_text);

  lead_days := COALESCE(v_rule.lead_days, CASE WHEN v_deliv THEN 2 ELSE 1 END);
  cutoff_hour := COALESCE(v_rule.cutoff_hour, 19);
  is_delivery_type := v_deliv;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_reservation_lead_and_period(
  p_product_id    uuid,
  p_start_date    date,
  p_end_date      date,
  p_pickup_method text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sale     boolean;
  v_rule     RECORD;
  v_kst_now  timestamp;
  v_min_date date;
  v_max_days integer;
  v_days     integer;
  v_label    text;
BEGIN
  IF p_start_date IS NULL THEN RETURN; END IF;

  SELECT COALESCE(sale_only, false) INTO v_sale FROM products WHERE id = p_product_id;
  IF COALESCE(v_sale, false) THEN RETURN; END IF;

  SELECT * INTO v_rule FROM get_pickup_lead_rule(COALESCE(p_pickup_method, 'visit'));

  v_kst_now  := now() AT TIME ZONE 'Asia/Seoul';
  v_min_date := v_kst_now::date + v_rule.lead_days
                + (CASE WHEN EXTRACT(HOUR FROM v_kst_now) < v_rule.cutoff_hour THEN 0 ELSE 1 END);

  IF p_start_date < v_min_date THEN
    v_label := CASE
      WHEN v_rule.cutoff_hour = 12 THEN '오후 12시'
      WHEN v_rule.cutoff_hour = 0  THEN '오전 12시'
      WHEN v_rule.cutoff_hour > 12 THEN '오후 ' || (v_rule.cutoff_hour - 12) || '시'
      ELSE '오전 ' || v_rule.cutoff_hour || '시'
    END;
    RAISE EXCEPTION 'PICKUP_LEAD_TIME: 선택한 수령일은 신청 마감(대여일 %일 전 %)이 지났습니다.', v_rule.lead_days, v_label;
  END IF;

  SELECT s.max_rental_days INTO v_max_days FROM rental_shipping_settings s LIMIT 1;
  IF p_end_date IS NOT NULL AND COALESCE(v_max_days, 0) > 0 THEN
    v_days := (p_end_date - p_start_date) + (CASE WHEN v_rule.is_delivery_type THEN 1 ELSE 0 END);
    IF v_days > v_max_days THEN
      RAISE EXCEPTION 'RENTAL_PERIOD_EXCEEDED: 최대 대여기간(%일)을 초과했습니다.', v_max_days;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.parse_lead_rule_text(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_pickup_lead_rule(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_reservation_lead_and_period(uuid, date, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parse_lead_rule_text(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_pickup_lead_rule(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_reservation_lead_and_period(uuid, date, date, text) TO service_role;

-- ── 두 RPC에 검증 한 줄 삽입 (단일 앵커) ───────────────────────────────────
DO $mig$
DECLARE
  v_oid    oid;
  v_def    text;
  v_anchor CONSTANT text := E'  SELECT effective_start_date, effective_end_date, pickup_extra_days, return_extra_days\n  INTO v_effective_start';
  v_hold   CONSTANT text := E'  -- PICKUP-LEAD-GUARD (Migration 588): 수령일 신청 마감·최대 대여일 서버 재검증\n  PERFORM assert_reservation_lead_and_period(p_product_id, p_start_date, p_end_date, p_pickup_method);\n\n';
  v_promo  CONSTANT text := E'  -- PICKUP-LEAD-GUARD (Migration 588): 수령일 신청 마감·최대 대여일 서버 재검증\n  PERFORM assert_reservation_lead_and_period(v_parent_id, p_start_date, p_end_date, p_pickup_method);\n\n';
BEGIN
  -- create_hold_reservation
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_hold_reservation';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'create_hold_reservation not found'; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position('PICKUP-LEAD-GUARD' IN v_def) = 0 THEN
    IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
      RAISE EXCEPTION 'create_hold_reservation 앵커가 정확히 1개가 아님';
    END IF;
    EXECUTE replace(v_def, v_anchor, v_hold || v_anchor);
  END IF;

  -- promote_draft_reservation
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'promote_draft_reservation';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'promote_draft_reservation not found'; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position('PICKUP-LEAD-GUARD' IN v_def) = 0 THEN
    IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
      RAISE EXCEPTION 'promote_draft_reservation 앵커가 정확히 1개가 아님';
    END IF;
    EXECUTE replace(v_def, v_anchor, v_promo || v_anchor);
  END IF;
END
$mig$;
