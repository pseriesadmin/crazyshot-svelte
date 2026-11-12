-- Migration 817: 예약 수정 저장 함수에 '수령 신청 마감(방식별 리드타임)'과 '최대 대여일'을 서버가 직접 집행
-- 배경: 811 의 edit_submitted_reservation_order 는 새 줄(교체·추가)의 수령일 마감·최대 대여일을 직접 검사하지 않았다.
--   (신규 hold 를 만드는 create_hold_reservation 안의 Migration 588 검사에 우연히 걸려 거절은 됐지만, 사유가 HOLD_FAILED(재고 없음)로 뭉개져 고객에게 틀린 안내가 갔다.)
-- 변경: 새 줄 검증 단계에서 588 의 assert_reservation_lead_and_period 를 직접 호출하고, 위반 사유를 PICKUP_LEAD_TIME / RENTAL_PERIOD_EXCEEDED 로 돌려준다.
--   · 규칙의 정본은 588 판정 함수 하나(방식별 deadline_time 정형 문구 → 아니면 기본값 배송형 2일/그 외 1일·19시, 최대 대여일 = rental_shipping_settings.max_rental_days, 배송형은 포함 일수). 이 마이그레이션은 규칙을 새로 쓰지 않는다.
--   · 유지(keep) 줄은 검사하지 않는다(변경 없음).
--   · 811 본문 대비 차이는 ① 새 줄 검증에 PERFORM 1줄 ② 허용 reason 목록 2개 ③ 메시지 CASE 2줄 뿐이다.
--   · 권한은 814 상태 유지 — 5인자 함수는 PUBLIC·anon·authenticated·service_role 모두 직접 호출 불가(for_user 래퍼만 service_role). 재정의 후 REVOKE 를 다시 명시한다.
-- 롤백: .claude/harness/rollback/817_rollback.sql

CREATE OR REPLACE FUNCTION public.edit_submitted_reservation_order(
  p_reservation_id           bigint,
  p_expected_reservation_ids bigint[],
  p_lines                    jsonb,
  p_selected_coupon_ids      uuid[]  DEFAULT NULL,
  p_selected_points          integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_anon         boolean;
  v_order_id     bigint;
  v_order_owner  uuid;
  v_prev_final   numeric;
  v_old_points   integer;
  v_target_owner uuid;
  v_target_status text;
  v_sib          bigint[];
  v_live         bigint[];
  v_anchor_old   bigint;
  v_code         text;
  v_submitted    timestamptz;
  v_approved     timestamptz;
  v_approve_req  timestamptz;
  v_reason       text;
  v_keep         bigint[] := ARRAY[]::bigint[];
  v_drop         bigint[];
  v_new          bigint[] := ARRAY[]::bigint[];
  v_final_ids    bigint[];
  v_new_anchor   bigint;
  v_line         jsonb;
  v_spec         jsonb;
  v_specs        jsonb := '[]'::jsonb;
  v_rid          bigint;
  v_res          jsonb;
  v_hold         record;
  v_pools        uuid[] := ARRAY[]::uuid[];
  v_pid          uuid;
  v_opts         jsonb;
  v_opts_clean   jsonb;
  v_opt_wanted   integer;
  v_main_pid     uuid;
  v_calc         record;
  v_cur_coupons  uuid[];
  v_single_coupon uuid;
  v_points       integer;
  v_fee          integer;
  v_order_row    record;
  v_dropped      jsonb := '[]'::jsonb;
  v_valid        jsonb;
  v_bad          uuid[];
  v_contract     record;
  v_msg          text;
  v_code_out     text;
  v_pm           text;
  v_rm           text;
  v_pt           text;
  v_rt           text;
  v_pd           boolean;
  v_chk          record;
  v_min          integer;
  v_price_missing boolean;
  v_ord          record;
BEGIN
  -- ── 0. 호출자·입력 기본 검증(변경 없음) ───────────────────────────────
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'UNAUTHENTICATED');
  END IF;
  SELECT u.is_anonymous INTO v_anon FROM auth.users u WHERE u.id = v_uid;
  IF v_anon IS NOT FALSE THEN
    RETURN jsonb_build_object('success', false, 'reason', 'UNAUTHENTICATED');
  END IF;
  IF p_reservation_id IS NULL OR p_expected_reservation_ids IS NULL OR cardinality(p_expected_reservation_ids) = 0
     OR p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'BAD_REQUEST');
  END IF;
  IF jsonb_array_length(p_lines) = 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'MIN_ONE_LINE');
  END IF;
  IF jsonb_array_length(p_lines) > 50 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'BAD_REQUEST');
  END IF;

  -- ── 1. 소유권(잠금 없는 조회): 남의 주문은 존재 여부도 알려주지 않고, 남의 행은 잠그지도 않는다 ──
  SELECT oi.order_id INTO v_order_id FROM order_items oi WHERE oi.reservation_id = p_reservation_id LIMIT 1;
  IF v_order_id IS NULL THEN
    -- 주문 항목이 없다: 내 예약이 이미 취소됐다면 다른 저장이 먼저 끝난 것(STALE), 취소가 아니면 '제출된 예약'이 아니다(장바구니 경로 소관)
    SELECT rr.user_id, rr.status INTO v_target_owner, v_target_status
      FROM rental_reservations rr WHERE rr.id = p_reservation_id;
    IF NOT FOUND OR v_target_owner IS DISTINCT FROM v_uid THEN
      RETURN jsonb_build_object('success', false, 'reason', 'NOT_OWNER');
    END IF;
    IF v_target_status = 'cancelled' THEN
      RETURN jsonb_build_object('success', false, 'reason', 'STALE');
    END IF;
    RETURN jsonb_build_object('success', false, 'reason', 'ERROR');
  END IF;

  SELECT o.user_id INTO v_order_owner FROM orders o WHERE o.id = v_order_id;
  IF v_order_owner IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'reason', 'NOT_OWNER');
  END IF;

  -- ── 2. 잠금: 주문 → 형제 예약(id 순) → 계약 서명 행. 잠금 뒤 소유자·형제 목록을 다시 확인한다 ──
  SELECT o.user_id, o.final_amount, o.selected_points
    INTO v_order_owner, v_prev_final, v_old_points
    FROM orders o WHERE o.id = v_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'STALE', 'order_id', v_order_id);
  END IF;
  IF v_order_owner IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'reason', 'NOT_OWNER');
  END IF;

  SELECT array_agg(x.id ORDER BY x.id) INTO v_sib FROM (
    SELECT rr.id FROM rental_reservations rr
     WHERE rr.id IN (SELECT oi.reservation_id FROM order_items oi WHERE oi.order_id = v_order_id AND oi.reservation_id IS NOT NULL)
     ORDER BY rr.id FOR UPDATE
  ) x;
  -- 잠금을 기다리는 사이 다른 저장이 이 대상 예약을 교체·삭제했다면(형제 목록에 없음) 낡은 요청이다
  IF v_sib IS NULL OR NOT (p_reservation_id = ANY (v_sib)) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'STALE', 'order_id', v_order_id);
  END IF;
  IF EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.id = ANY (v_sib) AND rr.user_id IS DISTINCT FROM v_uid) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'NOT_OWNER');
  END IF;
  IF EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.id = p_reservation_id AND rr.status = 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'STALE', 'order_id', v_order_id);
  END IF;

  PERFORM 1 FROM contract_signings cs JOIN contracts c ON c.id = cs.contract_id
   WHERE c.reservation_id = ANY (v_sib) FOR UPDATE OF cs;

  -- ── 3. 가드 재검사(잠금 후) ───────────────────────────────────────────
  v_reason := private.is_reservation_order_editable(p_reservation_id);
  IF v_reason <> 'ok' THEN
    RETURN jsonb_build_object('success', false, 'reason', v_reason, 'order_id', v_order_id);
  END IF;

  -- (쿠폰·포인트 소진 흔적 → PAID 판정도 위 판정 함수 안에 있다 — 화면 노출과 같은 정본)

  -- ── 4. 낙관적 검사 ────────────────────────────────────────────────────
  SELECT array_agg(rr.id ORDER BY rr.id) INTO v_live
    FROM rental_reservations rr WHERE rr.id = ANY (v_sib) AND rr.status <> 'cancelled';
  IF v_live IS NULL
     OR v_live IS DISTINCT FROM (SELECT array_agg(DISTINCT t.e ORDER BY t.e) FROM unnest(p_expected_reservation_ids) AS t(e)) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'STALE', 'order_id', v_order_id);
  END IF;

  -- 이후 변경 구간: 하나라도 실패하면 아래 EXCEPTION 블록이 이 구간의 모든 변경을 원복한다
  BEGIN
    -- 원래 주문의 정본 값(대표 예약 = 주문 내 MIN id)
    SELECT oi.reservation_id INTO v_anchor_old
      FROM order_items oi WHERE oi.order_id = v_order_id AND oi.reservation_id IS NOT NULL
     ORDER BY oi.reservation_id LIMIT 1;
    SELECT rr.reservation_code, rr.submitted_at, rr.approved_at, rr.approve_requested_at
      INTO v_code, v_submitted, v_approved, v_approve_req
      FROM rental_reservations rr WHERE rr.id = v_anchor_old;
    IF v_code IS NULL THEN
      RAISE EXCEPTION 'ERROR: 원래 예약코드를 찾을 수 없습니다.';
    END IF;

    -- ── 5. 줄 검증·유지/교체/삭제 분류 ──────────────────────────────────
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
      IF jsonb_typeof(v_line) <> 'object' THEN RAISE EXCEPTION 'BAD_REQUEST: 잘못된 줄 형식'; END IF;
      IF COALESCE((v_line ->> 'keep')::boolean, false) THEN
        v_rid := (v_line ->> 'reservation_id')::bigint;
        IF v_rid IS NULL OR NOT (v_rid = ANY (v_live)) OR v_rid = ANY (v_keep) THEN
          RAISE EXCEPTION 'BAD_REQUEST: 유지할 예약이 올바르지 않습니다.';
        END IF;
        v_keep := v_keep || v_rid;
        IF EXISTS (
          SELECT 1 FROM rental_reservations rr
            JOIN products p ON p.id = rr.product_id
            LEFT JOIN products par ON par.id = p.parent_product_id
           WHERE rr.id = v_rid
             AND (COALESCE(par.sale_only, p.sale_only, false) OR COALESCE(rr.duration_type, '') = 'purchase')
        ) THEN
          RAISE EXCEPTION 'SALE_ONLY_NOT_EDITABLE: 구매 상품이 포함된 예약은 수정할 수 없습니다.';
        END IF;
        -- 유지 줄의 저장된 수령·반납 방식도 지금 사용 가능한 방식이어야 한다(SEC-811-08)
        IF EXISTS (
          SELECT 1 FROM rental_reservations rr
           WHERE rr.id = v_rid
             AND (NOT EXISTS (SELECT 1 FROM rental_method_options o WHERE o.method_key = rr.pickup_method AND o.is_active = true AND o.deleted_at IS NULL)
                  OR (COALESCE(rr.return_method, '') <> ''
                      AND NOT EXISTS (SELECT 1 FROM rental_method_options o WHERE o.method_key = rr.return_method AND o.is_active = true AND o.deleted_at IS NULL)))
        ) THEN
          RAISE EXCEPTION 'INVALID_METHOD: 사용할 수 없는 수령·반납 방식이 포함되어 있습니다.';
        END IF;
      ELSE
        IF (v_line ->> 'product_id') IS NULL OR (v_line ->> 'start_date') IS NULL OR (v_line ->> 'end_date') IS NULL
           OR COALESCE(v_line ->> 'pickup_method', '') = '' THEN
          RAISE EXCEPTION 'BAD_REQUEST: 상품·기간·수령 방식이 필요합니다.';
        END IF;
        -- 수령·반납 방식 검증(SEC-811-08): 활성·미삭제로 등록된 방식만. set_reservation_shipment_method 는 방식 키를 검증하지 않고 저장한다.
        v_pm := v_line ->> 'pickup_method';
        v_rm := NULLIF(v_line ->> 'return_method', '');
        IF NOT EXISTS (SELECT 1 FROM rental_method_options o WHERE o.method_key = v_pm AND o.is_active = true AND o.deleted_at IS NULL)
           OR (v_rm IS NOT NULL AND NOT EXISTS (SELECT 1 FROM rental_method_options o WHERE o.method_key = v_rm AND o.is_active = true AND o.deleted_at IS NULL)) THEN
          RAISE EXCEPTION 'INVALID_METHOD: 사용할 수 없는 수령·반납 방식입니다.';
        END IF;
        -- 시간 검증: 형식은 장바구니와 같은 HH:MM(반납만 24:00 허용 — 수령이 배송이면 반납 24:00 고정, rental-policy.md §1-1).
        -- 수령 방식이 배송형이면 요금이 시각을 보지 않으므로(1day 강제청구) 시간은 비어도 된다. 그 외 방식은 두 시간 모두 필요하고, 반납이 수령보다 늦어야 한다.
        -- 방식별 시각 범위(퀵 12~22시·당일 +2/+3시간 등)는 '지금' 기준 화면 규칙(pickupTimeRules.ts)이라 서버에서 재현하지 않는다(보고 참조).
        v_pt := NULLIF(v_line ->> 'pickup_time', '');
        v_rt := NULLIF(v_line ->> 'return_time', '');
        IF (v_pt IS NOT NULL AND v_pt !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
           OR (v_rt IS NOT NULL AND v_rt !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$') THEN
          RAISE EXCEPTION 'INVALID_TIME: 수령·반납 시간 형식이 올바르지 않습니다.';
        END IF;
        SELECT EXISTS (SELECT 1 FROM rental_method_options o WHERE o.method_key = v_pm AND o.is_active = true AND o.deleted_at IS NULL AND o.is_delivery_type = true) INTO v_pd;
        IF NOT v_pd THEN
          IF v_pt IS NULL OR v_rt IS NULL THEN
            RAISE EXCEPTION 'INVALID_TIME: 수령·반납 시간이 필요합니다.';
          END IF;
          IF ((v_line ->> 'end_date')::date - (v_line ->> 'start_date')::date) * 1440
             + (split_part(v_rt, ':', 1)::integer * 60 + split_part(v_rt, ':', 2)::integer)
             - (split_part(v_pt, ':', 1)::integer * 60 + split_part(v_pt, ':', 2)::integer) <= 0 THEN
            RAISE EXCEPTION 'INVALID_TIME: 반납 시각이 수령 시각보다 늦어야 합니다.';
          END IF;
        END IF;
        v_pid := (v_line ->> 'product_id')::uuid;
        IF EXISTS (
          SELECT 1 FROM products p LEFT JOIN products par ON par.id = p.parent_product_id
           WHERE p.id = v_pid AND COALESCE(par.sale_only, p.sale_only, false)
        ) OR COALESCE(v_line ->> 'duration_type', '') = 'purchase' THEN
          RAISE EXCEPTION 'SALE_ONLY_NOT_EDITABLE: 구매 상품은 이 화면에서 수정할 수 없습니다.';
        END IF;
        -- [817] 수령 신청 마감(방식별 리드타임)·최대 대여일 서버 집행 — 장바구니 신규 예약(create_hold_reservation)과 같은 판정 함수(Migration 588)를 쓴다.
        -- 새 줄(교체·추가)에만 적용한다. 유지(keep) 줄은 변경이 없으므로 검사하지 않는다 — 이미 지난 수령일의 정상 예약이 다른 줄을 고친다는 이유로 막히지 않게.
        -- 위반 시 'PICKUP_LEAD_TIME:' / 'RENTAL_PERIOD_EXCEEDED:' 예외 → 아래 EXCEPTION 블록이 같은 이름의 reason 으로 돌려준다(이전에는 hold 단계에서 HOLD_FAILED 로 뭉개졌다).
        PERFORM public.assert_reservation_lead_and_period(v_pid, (v_line ->> 'start_date')::date, (v_line ->> 'end_date')::date, v_pm);
        v_pools := v_pools || v_pid;
        v_pools := v_pools || COALESCE((SELECT array_agg(pbl.bundle_product_id) FROM product_bundle_links pbl
                                         WHERE pbl.product_id = v_pid AND pbl.deleted_at IS NULL), ARRAY[]::uuid[]);
      END IF;
    END LOOP;

    SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::bigint[]) INTO v_drop
      FROM unnest(v_live) x WHERE NOT (x = ANY (v_keep));

    -- ── 6. 옛 예약 취소(재고 해제) — 같은 상품·기간 재고를 새 hold 가 다시 잡을 수 있도록 먼저 ──
    FOREACH v_rid IN ARRAY v_drop LOOP
      v_res := public.update_reservation_status(v_rid, 'cancelled');
      IF COALESCE((v_res ->> 'ok')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'CANCEL_FAILED: %', COALESCE(v_res ->> 'error', '기존 예약 취소 실패');
      END IF;
    END LOOP;

    -- ── 7. 재고 풀 잠금(정렬·일괄) 후 새 hold 생성 (7-1: 모든 새 hold) ─────
    IF cardinality(v_pools) > 0 THEN
      PERFORM private.lock_unit_pools(v_pools);
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
      CONTINUE WHEN COALESCE((v_line ->> 'keep')::boolean, false);

      SELECT * INTO v_hold FROM public.create_hold_reservation(
        (v_line ->> 'product_id')::uuid,
        (v_line ->> 'start_date')::date,
        (v_line ->> 'end_date')::date,
        v_line ->> 'pickup_method',
        NULLIF(v_line ->> 'return_method', '')
      );
      IF v_hold.success IS NOT TRUE OR v_hold.reservation_id IS NULL THEN
        RAISE EXCEPTION 'HOLD_FAILED: %', COALESCE(v_hold.error_message, '재고 확보에 실패했습니다.');
      END IF;
      v_rid := v_hold.reservation_id;
      v_new := v_new || v_rid;
      v_specs := v_specs || jsonb_build_array(jsonb_build_object('rid', v_rid, 'line', v_line));

      -- 품번·신청일시·예약승인 상태 승계(트리거가 새 코드를 발급하므로 덮어쓴다 — UNIQUE 는 #400 에서 제거됨)
      UPDATE rental_reservations
         SET reservation_code = v_code,
             submitted_at     = COALESCE(v_submitted, submitted_at),
             approved_at      = v_approved,
             approve_requested_at = v_approve_req
       WHERE id = v_rid;
    END LOOP;

    -- 최종 줄(유지+새 줄) 전부를 '주문 미연결' 상태로 만든다 — private.cart_group_size 는 order_items 가 없는 예약만 같은 그룹으로 세므로,
    -- 유지 줄이 빠지면 수량 연동 옵션 수량이 장바구니와 어긋난다(sp3 MAJOR). 이미 취소된 형제·방금 취소한 옛 예약의 항목도 함께 지워 합계 오염을 없앤다.
    -- 이 주문의 항목은 7-3 에서 최종 줄 전부로 다시 넣는다(같은 트랜잭션 — 실패 시 전부 원복).
    DELETE FROM order_items oi WHERE oi.order_id = v_order_id;

    -- ── 7-2. 새 줄 설정(수령·반납·기간·주소·옵션) — 모든 새 hold 가 만들어진 뒤에 처리(그룹 크기 기준 수량 연동 보정이 장바구니와 같게 동작) ──
    FOR v_spec IN SELECT * FROM jsonb_array_elements(v_specs) LOOP
      v_rid  := (v_spec ->> 'rid')::bigint;
      v_line := v_spec -> 'line';

      -- 수령·반납 방식·시간·주소·지점·요청사항(장바구니 saveShipmentMethod 와 같은 인자)
      PERFORM public.set_reservation_shipment_method(
        p_reservation_id        := v_rid,
        p_pickup_method         := v_line ->> 'pickup_method',
        p_return_method         := NULLIF(v_line ->> 'return_method', ''),
        p_pickup_time           := NULLIF(v_line ->> 'pickup_time', ''),
        p_return_time           := NULLIF(v_line ->> 'return_time', ''),
        p_pickup_address_road   := NULLIF(v_line ->> 'pickup_address_road', ''),
        p_pickup_address_detail := NULLIF(v_line ->> 'pickup_address_detail', ''),
        p_pickup_request_note   := NULLIF(v_line ->> 'pickup_request_note', ''),
        p_return_request_note   := NULLIF(v_line ->> 'return_request_note', ''),
        p_pickup_point_id       := NULLIF(v_line ->> 'pickup_point_id', '')::uuid,
        p_return_point_id       := NULLIF(v_line ->> 'return_point_id', '')::uuid,
        p_pickup_postal_code    := NULLIF(v_line ->> 'pickup_postal_code', '')
      );

      IF COALESCE(v_line ->> 'duration_type', '') <> '' THEN
        PERFORM public.set_reservation_duration(v_rid, v_line ->> 'duration_type');
      END IF;

      IF COALESCE(v_line ->> 'return_address_road', '') <> '' OR COALESCE(v_line ->> 'return_address_detail', '') <> '' THEN
        PERFORM public.set_reservation_return_address(
          v_rid, NULLIF(v_line ->> 'return_address_road', ''), NULLIF(v_line ->> 'return_address_detail', ''),
          NULLIF(v_line ->> 'return_postal_code', ''));
      END IF;
      IF COALESCE(v_line ->> 'frontdoor_password', '') <> '' THEN
        PERFORM public.set_reservation_frontdoor_password(v_rid, v_line ->> 'frontdoor_password');
      END IF;

      -- 옵션: 화면이 보낸 unit_price 는 버리고 서버가 단가를 정한다(옵션 이름·단가·연결 여부 모두 서버 기준)
      v_opts := v_line -> 'options';
      IF v_opts IS NOT NULL AND jsonb_typeof(v_opts) = 'array' AND jsonb_array_length(v_opts) > 0 THEN
        SELECT COALESCE(p.parent_product_id, rr.product_id) INTO v_main_pid
          FROM rental_reservations rr LEFT JOIN products p ON p.id = rr.product_id
         WHERE rr.id = v_rid;

        -- 같은 옵션이 여러 줄로 오면 option_product_id 별로 수량을 합산한다(SEC-811-09). 서로 다른 옵션 수 = 요청한 서로 다른 옵션 수여야 한다(연결 안 된 옵션은 거절).
        SELECT count(DISTINCT COALESCE(NULLIF(t.e ->> 'option_product_id', ''), '#' || t.n::text)) INTO v_opt_wanted
          FROM jsonb_array_elements(v_opts) WITH ORDINALITY AS t(e, n)
         WHERE COALESCE((t.e ->> 'qty')::integer, 0) > 0;

        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'option_product_id', g.oid,
                 'option_name',       g.nm,
                 'qty',               g.qty,
                 'unit_price',        COALESCE(g.price, 0)
               )), '[]'::jsonb),
               COALESCE(bool_or(g.price_missing), false)
          INTO v_opts_clean, v_price_missing
          FROM (
            SELECT q.oid,
                   MIN(op.name)  AS nm,
                   SUM(q.qty)::integer AS qty,
                   MAX(pr.price) AS price,
                   -- 활성 24h 요금이 없는 옵션은 거절(무료·판매전용 옵션은 요금 규칙 없이도 정상 — 금액은 set_reservation_options 가 이어서 정한다)
                   bool_or(pr.price IS NULL AND NOT COALESCE(pol.is_free, false) AND NOT COALESCE(opar.sale_only, op.sale_only, false)) AS price_missing
              FROM (
                SELECT NULLIF(t.e ->> 'option_product_id', '')::uuid AS oid,
                       COALESCE((t.e ->> 'qty')::integer, 0)           AS qty
                  FROM jsonb_array_elements(v_opts) AS t(e)
              ) q
              JOIN products op ON op.id = q.oid AND op.deleted_at IS NULL
              LEFT JOIN products opar ON opar.id = op.parent_product_id
              JOIN product_option_links pol
                ON pol.product_id = v_main_pid AND pol.option_product_id = q.oid AND pol.deleted_at IS NULL
              LEFT JOIN LATERAL (
                SELECT MAX(x.price) AS price FROM price_rules x
                 WHERE x.product_id = q.oid AND x.duration_type = '24h' AND x.is_active = true AND x.deleted_at IS NULL
              ) pr ON true
             WHERE q.qty > 0
             GROUP BY q.oid
          ) g;

        IF jsonb_array_length(v_opts_clean) <> v_opt_wanted THEN
          RAISE EXCEPTION 'OPTION_NOT_LINKED: 이 상품에 연결되지 않은 옵션이 있습니다.';
        END IF;
        IF v_price_missing THEN
          RAISE EXCEPTION 'PRICE_UNSET: 요금이 등록되지 않은 옵션이 있어 저장할 수 없습니다.';
        END IF;
        IF v_opt_wanted > 0 THEN
          PERFORM public.set_reservation_options(v_rid, v_opts_clean);
        END IF;
      END IF;
    END LOOP;

    -- 유지 줄의 옵션: DB 에 저장된 값(서버가 정한 이름·단가 그대로, 같은 옵션은 수량 합산)으로 다시 설정해 수량 연동 그룹 크기를 반영한다(위 ⑯).
    -- 화면이 보낸 값은 쓰지 않는다 — 저장돼 있던 값뿐이라 단가·구성이 바뀌지 않고, 연동 옵션 수량만 현재 그룹 크기로 정규화된다.
    FOREACH v_rid IN ARRAY v_keep LOOP
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'option_product_id', g.oid, 'option_name', g.nm, 'qty', g.qty, 'unit_price', g.price)), '[]'::jsonb)
        INTO v_opts_clean
        FROM (
          SELECT ro.option_product_id AS oid, MIN(ro.option_name) AS nm, SUM(ro.qty)::integer AS qty, MAX(ro.unit_price) AS price
            FROM reservation_options ro
           WHERE ro.reservation_id = v_rid AND ro.qty > 0 AND ro.option_product_id IS NOT NULL
           GROUP BY ro.option_product_id
        ) g;
      IF jsonb_array_length(v_opts_clean) > 0 THEN
        PERFORM public.set_reservation_options(v_rid, v_opts_clean);
      END IF;
    END LOOP;

    v_final_ids := (SELECT array_agg(x ORDER BY x) FROM unnest(v_keep || v_new) x);
    IF v_final_ids IS NULL OR cardinality(v_final_ids) < 1 THEN
      RAISE EXCEPTION 'MIN_ONE_LINE: 상품이 최소 1개 필요합니다.';
    END IF;
    v_new_anchor := v_final_ids[1];

    -- ── 7-3. 최종 줄(유지+새 줄) 전부: 시간 재검증 → 24h 요금 확인(PRICE_UNSET, 장바구니 #587 와 같은 규칙) → 주문 항목 삽입 ──
    FOREACH v_rid IN ARRAY v_final_ids LOOP
      -- 시간 재검증: 휴무일 연장 뒤 DB 에 저장된 값 기준. 수령이 배송형이 아니면 (종료일−시작일)*1440 + 반납분 − 수령분 > 0 이어야 한다
      -- (compute_reservation_line_amount 의 v_total_minutes <= 0 → 0원 경로 차단). 시간이 NULL 이면 compute 와 같이 0:00 으로 본다.
      SELECT rr.start_date, rr.end_date, rr.pickup_time, rr.return_time,
             EXISTS (SELECT 1 FROM rental_method_options o WHERE o.method_key = rr.pickup_method AND o.is_active = true AND o.deleted_at IS NULL AND o.is_delivery_type = true) AS pd
        INTO v_chk
        FROM rental_reservations rr WHERE rr.id = v_rid;
      IF NOT v_chk.pd THEN
        v_min := (v_chk.end_date - v_chk.start_date) * 1440
                 + (COALESCE(NULLIF(split_part(v_chk.return_time, ':', 1), ''), '0')::integer * 60 + COALESCE(NULLIF(split_part(v_chk.return_time, ':', 2), ''), '0')::integer)
                 - (COALESCE(NULLIF(split_part(v_chk.pickup_time, ':', 1), ''), '0')::integer * 60 + COALESCE(NULLIF(split_part(v_chk.pickup_time, ':', 2), ''), '0')::integer);
        IF v_min <= 0 THEN
          RAISE EXCEPTION 'INVALID_TIME: 반납 시각이 수령 시각보다 늦어야 합니다.';
        END IF;
      END IF;

      -- create_reservation_order 의 요금 미등록 가드는 이미 주문 항목이 있는 예약을 건너뛰므로(#587) 여기서 직접 검사한다
      IF NOT EXISTS (
        SELECT 1 FROM rental_reservations rr
          JOIN price_rules pr ON pr.product_id = rr.product_id
           AND pr.duration_type = '24h' AND pr.is_active = true AND pr.deleted_at IS NULL
         WHERE rr.id = v_rid
      ) THEN
        RAISE EXCEPTION 'PRICE_UNSET: 요금이 등록되지 않은 상품이 있어 저장할 수 없습니다.';
      END IF;

      -- 주문 항목(create_reservation_order 의 INSERT 와 같은 모양 — 요금은 compute_reservation_line_amount 결과 그대로)
      SELECT * INTO v_calc FROM public.compute_reservation_line_amount(v_rid);
      INSERT INTO order_items (order_id, reservation_id, product_id, quantity, unit_price, line_total)
      SELECT v_order_id, v_rid, rr.product_id, 1, v_calc.rental_fee, v_calc.rental_fee + v_calc.options_fee
        FROM rental_reservations rr WHERE rr.id = v_rid;
    END LOOP;

    -- 모든 최종 예약이 같은 원래 코드를 갖도록 보장(유지 줄은 이미 같지만 방어)
    UPDATE rental_reservations SET reservation_code = v_code
     WHERE id = ANY (v_final_ids) AND reservation_code IS DISTINCT FROM v_code;

    -- ── 9. 계약서(D2): 서명 전(서명이 있으면 위 가드에서 이미 거절) 계약서는 발송 여부와 무관하게 전부 무효화, anchor 를 새 대표 예약으로 이동 ──
    FOR v_contract IN
      SELECT DISTINCT c.id AS contract_id
        FROM contracts c
       WHERE c.reservation_id = ANY (v_sib) AND c.deleted_at IS NULL
    LOOP
      PERFORM public.cancel_issued_contract(v_contract.contract_id);
    END LOOP;
    UPDATE contracts SET reservation_id = v_new_anchor
     WHERE reservation_id = ANY (v_sib) AND deleted_at IS NULL AND reservation_id <> v_new_anchor;

    -- ── 10. 쿠폰·포인트·합계 재계산(기존 create_reservation_order 재사용). 배송비는 서버가 최종 예약 집합으로 다시 계산(D1) ──
    -- 모든 줄·방식 설정(7-2)이 끝난 뒤, create_reservation_order 호출 직전. 고객이 보낸 값은 쓰지 않는다(함수 인자 자체가 없음).
    -- 계산 실패·판정 불가는 fail-closed(DELIVERY_FEE_FAILED) — 잘못된 금액으로 저장하지 않는다.
    v_points := GREATEST(0, COALESCE(p_selected_points, v_old_points, 0));
    BEGIN
      v_fee := private.calc_order_delivery_fee(v_uid, v_final_ids);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'calc_order_delivery_fee(order %) 실패 [%]: %', v_order_id, SQLSTATE, SQLERRM;  -- 원문은 서버 로그에만
      RAISE EXCEPTION 'DELIVERY_FEE_FAILED: 배송비 계산 실패';
    END;
    IF v_fee IS NULL OR v_fee < 0 THEN
      RAISE EXCEPTION 'DELIVERY_FEE_FAILED: 배송비 판정 불가';
    END IF;
    IF p_selected_coupon_ids IS NOT NULL THEN
      SELECT COALESCE(array_agg(DISTINCT t.c), ARRAY[]::uuid[]) INTO v_cur_coupons
        FROM unnest(p_selected_coupon_ids) AS t(c) WHERE t.c IS NOT NULL;
    ELSE
      SELECT array_agg(oc.user_coupon_id) INTO v_cur_coupons FROM order_coupons oc WHERE oc.order_id = v_order_id;
      IF v_cur_coupons IS NULL THEN
        -- 구형 단일 쿠폰(orders.selected_coupon_id): 배열로 바꿔 다중 쿠폰 흐름(validate_order_coupons 재검증)에 태운다(SEC-811-10). 탈락하면 dropped_coupons 에 담긴다.
        SELECT o.selected_coupon_id INTO v_single_coupon FROM orders o WHERE o.id = v_order_id;
        IF v_single_coupon IS NOT NULL THEN
          v_cur_coupons := ARRAY[v_single_coupon];
          UPDATE orders SET selected_coupon_id = NULL WHERE id = v_order_id;  -- 이후 배열 경로만 쓴다(단일 값이 남아 탈락 쿠폰을 되살리지 않도록)
        END IF;
      END IF;
    END IF;
    v_single_coupon := NULL;

    -- 쿠폰을 전부 해제한 저장: create_reservation_order 는 빈 선택(NULL)이면 order_coupons 를 지우지 않으므로 여기서 명시 삭제
    IF v_cur_coupons IS NOT NULL AND cardinality(v_cur_coupons) = 0 THEN
      DELETE FROM order_coupons oc WHERE oc.order_id = v_order_id;
      v_single_coupon := NULL;
    END IF;

    SELECT * INTO v_order_row FROM public.create_reservation_order(
      v_uid, v_final_ids, v_single_coupon, v_points, v_fee,
      CASE WHEN v_cur_coupons IS NULL OR cardinality(v_cur_coupons) = 0 THEN NULL ELSE v_cur_coupons END
    );
    IF v_order_row.order_id IS DISTINCT FROM v_order_id THEN
      RAISE EXCEPTION 'ERROR: 주문이 달라졌습니다(원래 주문 유지 실패).';
    END IF;

    -- 부적격 쿠폰 제외 후 재계산(create-order API 와 같은 순서·같은 규칙)
    IF v_cur_coupons IS NOT NULL AND cardinality(v_cur_coupons) > 0 THEN
      v_valid := public.validate_order_coupons(v_uid, v_order_id, v_cur_coupons);
      SELECT array_agg((r ->> 'user_coupon_id')::uuid) INTO v_bad
        FROM jsonb_array_elements(COALESCE(v_valid -> 'results', '[]'::jsonb)) r
       WHERE (r ->> 'ok') = 'false';
      IF v_bad IS NOT NULL AND cardinality(v_bad) > 0 THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('userCouponId', r ->> 'user_coupon_id', 'reason', COALESCE(r ->> 'error', 'UNKNOWN'))), '[]'::jsonb)
          INTO v_dropped
          FROM jsonb_array_elements(v_valid -> 'results') r WHERE (r ->> 'ok') = 'false';
        v_cur_coupons := ARRAY(SELECT c FROM unnest(v_cur_coupons) c WHERE NOT (c = ANY (v_bad)));
        -- 전부 탈락하면 첫 계산이 넣어 둔 order_coupons 를 지운다(남기면 할인 없는 쿠폰 행이 잔존)
        IF cardinality(v_cur_coupons) = 0 THEN
          DELETE FROM order_coupons oc WHERE oc.order_id = v_order_id;
        END IF;
        SELECT * INTO v_order_row FROM public.create_reservation_order(
          v_uid, v_final_ids, NULL, v_points, v_fee,
          CASE WHEN cardinality(v_cur_coupons) = 0 THEN NULL ELSE v_cur_coupons END
        );
      END IF;
    END IF;

    -- 응답용 최종 값(정규화된 포인트·서버 계산 배송비·합계는 DB 에 저장된 값 그대로)
    SELECT o.selected_points, o.delivery_fee, o.total_amount, o.final_amount
      INTO v_ord FROM orders o WHERE o.id = v_order_id;

    RETURN jsonb_build_object(
      'success', true, 'reason', 'ok',
      'order_id', v_order_id,
      'reservation_ids', to_jsonb(v_final_ids),
      'reservation_code', v_code,
      'previous_final_amount', v_prev_final,
      'final_amount', v_ord.final_amount,
      'selected_points', v_ord.selected_points,
      'delivery_fee', v_ord.delivery_fee,
      'total_amount', v_ord.total_amount,
      'cancelled_reservation_ids', to_jsonb(v_drop),
      'dropped_coupons', v_dropped
    );
  EXCEPTION WHEN OTHERS THEN
    -- 이 블록의 모든 변경(취소·새 hold·주문 항목·계약 폐기·재계산)이 원복된다
    v_msg := SQLERRM;
    RAISE WARNING 'edit_submitted_reservation_order(%) 실패 [%]: %', p_reservation_id, SQLSTATE, v_msg;  -- 원문은 서버 로그에만
    -- 'CODE:' 접두를 허용 목록과 대조한다. 소문자 코드(return_delivery_restricted 등)는 대문자로 바꿔 같은 목록에서 찾는다.
    v_code_out := upper(substring(v_msg from '^([A-Za-z][A-Za-z_]+):'));
    IF v_code_out IS NULL OR NOT (v_code_out = ANY (ARRAY[
         'BAD_REQUEST', 'MIN_ONE_LINE', 'SALE_ONLY_NOT_EDITABLE', 'DELIVERY_FEE_FAILED', 'PRICE_UNSET',
         'HOLD_FAILED', 'CANCEL_FAILED', 'OPTION_STOCK_EXCEEDED', 'OPTION_DELIVERY_DISABLED', 'OPTION_NOT_LINKED',
         'COUPON_STACKING_NOT_ALLOWED', 'INVALID_METHOD', 'INVALID_TIME',
         'RETURN_DELIVERY_RESTRICTED', 'OUT_OF_DELIVERY_AREA', 'HOLIDAY_EXTENSION_CONFLICT', 'BUNDLE_HOLIDAY_EXTENSION_CONFLICT',
         'FRONTDOOR_PASSWORD_TOO_LONG', 'RETURN_ADDRESS_TOO_LONG', 'RETURN_POSTAL_CODE_TOO_LONG',
         'PICKUP_LEAD_TIME', 'RENTAL_PERIOD_EXCEEDED'
       ])) THEN
      v_code_out := 'ERROR';
    END IF;
    RETURN jsonb_build_object(
      'success', false,
      'reason', v_code_out,
      'message', CASE v_code_out
        WHEN 'BAD_REQUEST'                  THEN '요청 내용이 올바르지 않아요'
        WHEN 'MIN_ONE_LINE'                 THEN '상품이 최소 1개 필요해요'
        WHEN 'SALE_ONLY_NOT_EDITABLE'       THEN '구매 상품이 포함된 예약은 이 화면에서 수정할 수 없어요'
        WHEN 'DELIVERY_FEE_FAILED'          THEN '배송비를 계산하지 못했어요'
        WHEN 'PRICE_UNSET'                  THEN '요금이 등록되지 않은 상품이 있어요'
        WHEN 'HOLD_FAILED'                  THEN '선택한 기간에 예약할 수 있는 재고가 없어요'
        WHEN 'CANCEL_FAILED'                THEN '기존 예약을 정리하지 못했어요'
        WHEN 'OPTION_STOCK_EXCEEDED'        THEN '옵션 재고가 부족해요'
        WHEN 'OPTION_DELIVERY_DISABLED'     THEN '배송이 불가능한 옵션이 포함되어 있어요'
        WHEN 'OPTION_NOT_LINKED'            THEN '이 상품에 연결되지 않은 옵션이 있어요'
        WHEN 'COUPON_STACKING_NOT_ALLOWED'  THEN '함께 사용할 수 없는 쿠폰이 포함되어 있어요'
        WHEN 'INVALID_METHOD'               THEN '사용할 수 없는 수령·반납 방식이 포함되어 있어요'
        WHEN 'INVALID_TIME'                 THEN '수령·반납 시간이 올바르지 않아요'
        WHEN 'RETURN_DELIVERY_RESTRICTED'   THEN '반납 방식으로 배송을 선택할 수 없어요'
        WHEN 'OUT_OF_DELIVERY_AREA'         THEN '배송 가능 지역이 아니에요'
        WHEN 'HOLIDAY_EXTENSION_CONFLICT'   THEN '휴무일로 늘어나는 대여 기간에 재고가 이미 다른 예약에 배정되어 있어요'
        WHEN 'BUNDLE_HOLIDAY_EXTENSION_CONFLICT' THEN '휴무일로 늘어나는 대여 기간에 구성품 재고가 이미 다른 예약에 배정되어 있어요'
        WHEN 'FRONTDOOR_PASSWORD_TOO_LONG'  THEN '공동현관 출입번호가 너무 길어요'
        WHEN 'RETURN_ADDRESS_TOO_LONG'      THEN '반납 주소가 너무 길어요'
        WHEN 'RETURN_POSTAL_CODE_TOO_LONG'  THEN '우편번호가 올바르지 않아요'
        WHEN 'PICKUP_LEAD_TIME'             THEN '선택한 수령 시각이 수령 신청 마감을 지났어요'
        WHEN 'RENTAL_PERIOD_EXCEEDED'       THEN '최대 대여 기간을 넘었어요'
        ELSE '저장에 실패했어요'
      END,
      'order_id', v_order_id
    );
  END;
END;
$$;

-- 814 권한 상태 재명시(CREATE OR REPLACE 는 기존 권한을 보존하지만, 드리프트 방지를 위해 다시 적는다)
REVOKE ALL ON FUNCTION public.edit_submitted_reservation_order(bigint, bigint[], jsonb, uuid[], integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.edit_submitted_reservation_order_for_user(uuid, bigint, bigint[], jsonb, uuid[], integer) TO service_role;

-- 적용 직후 확인(기대값):
--   SELECT r, has_function_privilege(r, 'public.edit_submitted_reservation_order(bigint, bigint[], jsonb, uuid[], integer)', 'EXECUTE') FROM unnest(ARRAY['anon','authenticated','service_role']) r;  -- 모두 false
--   SELECT has_function_privilege('service_role','public.edit_submitted_reservation_order_for_user(uuid, bigint, bigint[], jsonb, uuid[], integer)','EXECUTE');  -- true
--   SELECT has_function_privilege('authenticated','public.edit_submitted_reservation_order_for_user(uuid, bigint, bigint[], jsonb, uuid[], integer)','EXECUTE');  -- false
