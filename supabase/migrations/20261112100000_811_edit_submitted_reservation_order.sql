-- Migration 811: 신청대기(hold) 예약 '예약정보 수정' 저장용 DB 편집 함수 (2026-11-12, Stephen GATE B 승인 E1~E5 기본안 + S2 재작업 D1~D4)
-- TDD: src/__tests__/services/editSubmittedReservationOrderDb.test.ts (Stage 라이브)
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). 기존 마이그레이션 파일은 수정하지 않는다.
--
-- 내용
--   1) private.is_reservation_order_editable(bigint) → text 사유 코드. 수정 가능 판정의 DB 쪽 정본(가드).
--   2) private.calc_order_delivery_fee(uuid, bigint[]) → integer. 배송비 서버 계산(TS cartShippingFee.ts 이식, 이중 구현 — 1-B 주석에 대응표). 서버 전용·외부 호출 불가.
--   3) public.edit_submitted_reservation_order(...) → jsonb. 저장 시 한 번에 원자 적용(전부 성공 또는 전부 원복).
--   4) public.get_reservation_edit_state(bigint) → jsonb. 화면·API 가 '수정 가능한가'를 묻는 읽기 전용 창구({ok, can_edit, reason}만 반환). 판정 정본은 1)을 그대로 쓴다.
--
-- ⚠️ 이중 구현 동기화 지점(sp7 대상) — TS 판정 src/lib/utils/reservationEditPolicy.ts(canEditSubmittedReservation) ↔ 이 파일의 private.is_reservation_order_editable
--   · 사유 코드 7종·우선순위가 같아야 한다: SIGNED > PAID > CANCEL_REQUESTED > EXPIRED > DIRECT_PAY > NOT_HOLD (ERROR 는 조회 오류·불명, 모든 판정에서 최우선 fail-closed).
--   · 입력 의미: TS siblings = 대상 포함 같은 주문의 전 예약 = SQL order_items 로 묶인 전 예약(주문이 없으면 대상 단독).
--   · 이 파일이 TS 보다 엄격한 부분(의도적, fail-closed 방향 — TS 호출부가 같은 값을 넘기도록 맞출 것):
--       (a) 서명: TS 는 '주문 대표 예약(MIN id) 기준 signed_at 을 각 형제에 반영'해 넘긴다. SQL 은 형제 어느 예약에 anchor 된 계약이든 서명이 있으면 SIGNED(대표 기준의 상위집합).
--       (b) 결제: payment_confirmed_at 외에 payment_transactions(취소되지 않은 거래: 예약 id 또는 주문키 일치)도 PAID 로 본다(#810 파트너 취소 가드와 같은 규칙).
--           '이 주문으로 이미 소진된 쿠폰(user_coupons.used_at+order_id) 또는 포인트 차감(point_transactions type=use)'이 있어도 PAID 로 본다(결제 경로를 우회한 소진 방어, 아래 ⑦).
--           ⛔ 이 쿠폰·포인트 소진 검사는 이 판정 함수 안에만 있다(편집 함수·get_reservation_edit_state 는 판정 결과만 사용 — 화면 노출과 저장 거절이 갈라지지 않도록 정본 1곳).
--       (c) 취소요청: TS 는 대상 예약의 cancel_requested_at, SQL 은 형제 어느 예약이든.
--       (d) 형제(취소 제외) 중 hold 가 아닌 예약이 있으면 NOT_HOLD (TS 는 대상 status 만 본다).
--
-- 편집 함수 동작 요약(p_lines 의미)
--   · 호출자(authenticated 본인)만. auth.uid() 가 주문 소유자가 아니거나 익명이면 거절. 서버 전용 함수(service_role)로는 호출 불가(auth.uid() 없음 — create_hold_reservation 이 auth.uid() 를 요구하는 S0 발견과 같은 이유).
--   · 타인 주문 행은 '잠금 없는 조회'로 소유자를 먼저 확인한 뒤에만 FOR UPDATE 로 잡는다(잠금 대기로 타인 주문을 오래 붙잡는 공격 차단). 잠금 뒤 소유자·형제 목록을 다시 확인한다.
--   · 주문 행·형제 예약 행·계약 서명 행을 FOR UPDATE 로 잠근 뒤 가드를 재검사한다(검사와 적용 사이 경합 차단).
--   · 낙관적 검사: 호출자가 화면에 불러온 시점의 형제 예약 id 집합(p_expected_reservation_ids, 취소 제외)과 현재가 다르면 STALE.
--     대상 예약이 (내 소유이면서) 이미 취소됐거나 잠금 뒤 형제 목록에서 사라졌어도 STALE(동시 저장·낡은 화면). p_expected_order_updated_at 인자는 orders 에 updated_at 갱신 트리거가 없어 동작하지 않으므로 제거했다 — 예약 id 집합 비교가 실질 방어다.
--   · p_lines = 최종 상태 전체. 각 줄은 {"keep":true,"reservation_id":N}(변경 없이 유지) 또는 새 줄(상품·기간·방식…). 유지 줄에 없는 기존 예약은 취소(삭제·교체) 후 재고 해제. 줄은 최대 50개.
--     새 줄의 options[].unit_price 는 무시한다 — 서버가 product_option_links(이 본상품에 연결된 옵션만) + 옵션 상품의 활성 24h 요금(price_rules)으로 단가를 다시 정한다(무료·판매전용 규칙은 set_reservation_options 가 이어서 적용).
--   · 판매전용(sale_only·purchase) 상품이 유지 줄 또는 새 줄에 있으면 SALE_ONLY_NOT_EDITABLE 로 거절한다(구매 주문은 이 경로로 수정하지 않는다).
--   · 새 줄은 create_hold_reservation 로 재고를 새로 잡고(결합상품 구성품 포함, 기존 로직 재사용) 원래 주문의 reservation_code 를 복사한다.
--     예약 신청일시(submitted_at)·예약승인 시각(approved_at·approve_requested_at)도 원래 주문 대표 예약 값을 이어받는다(수정이 '다시 신청'이 되지 않도록).
--   · 옛 예약을 먼저 취소해야 같은 상품·같은 기간 재고를 다시 잡을 수 있으므로 '취소 → 새 hold' 순서(전부 한 트랜잭션, 실패 시 전체 원복).
--     새 줄은 3단계로 처리한다: ① 모든 새 hold 생성 ② 모든 새 줄의 수령·반납·옵션 설정(장바구니 그룹 크기 기준 수량 연동 보정이 모든 새 줄을 같은 그룹으로 본다) ③ 줄별 24h 요금 확인(PRICE_UNSET)·주문 항목 삽입.
--   · 서명 전 계약서는 발송 여부와 무관하게 모두 무효화한다(cancel_issued_contract 로 내용·발송·토큰 초기화, D2). 계약 행은 새 대표 예약으로 anchor 를 옮긴다.
--   · 배송비(D1, S2 추가로 확정): 고객 화면이 넘기는 배송비를 신뢰하지 않으므로 인자가 없다. 모든 줄·방식 설정이 끝난 뒤(create_reservation_order 호출 직전)
--     private.calc_order_delivery_fee(아래 1-B)로 최종 예약 집합의 배송비를 서버가 다시 계산해 p_delivery_fee 로 넘긴다. 방문/방문 0원, 배송 수령·반납 3-way, 우대 티어, 구독 무료배송 포함.
--     이전의 '주문 값 승계 + DELIVERY_FEE_RECALC_REQUIRED 거절'은 제거했다. 계산 실패·판정 불가는 reason=DELIVERY_FEE_FAILED(fail-closed).
--     ⚠️ 이중 구현(sp7): TS src/lib/utils/cartShippingFee.ts(+ cart/+page.svelte 입력 조립, create-order API 구독 결합) ↔ private.calc_order_delivery_fee — 설정·규칙 변경 시 양쪽 동기화 의무(대응표는 1-B 주석).
--   · 금액·쿠폰·포인트·합계는 기존 create_reservation_order(요금 산식 compute_reservation_line_amount 포함) 재호출로 재계산, 부적격 쿠폰은 validate_order_coupons 로 제외(기존 create-order API 와 같은 순서).
--     쿠폰을 전부 해제하거나 전부 탈락하면 order_coupons 를 명시 삭제한다. 포인트는 create_reservation_order(normalize_point_use)가 보정한다.
--     새 줄의 order_items 행은 create_reservation_order 가 같은 주문을 찾을 수 있도록 이 함수가 compute_reservation_line_amount 결과로 직접 넣는다(create_reservation_order 의 INSERT 와 같은 모양 — 동기화 지점).
--   · 오류 메시지: 내부 오류 원문(SQLERRM)은 응답으로 내리지 않는다. 허용된 사유 코드(접두 'CODE:')일 때만 그 코드와 고정 문구, 그 외는 reason='ERROR'·'저장에 실패했어요'. 원문은 RAISE WARNING 서버 로그로만 남긴다.
--   ⑦ 혜택 복원 트리거(trg_restore_order_benefits, #644): 주문의 모든 예약이 취소·만료되면 소진된 쿠폰·포인트를 복원한다. 이 함수는 옛 예약을 먼저 취소하므로 '모든 줄 교체' 때 일시적으로 주문 전체가 취소 상태가 되어 트리거가 돈다.
--     결제 전(수정 가능한 주문)에는 쿠폰·포인트가 아직 소진되지 않아 복원 대상이 없으므로 무동작이다. 소진 흔적이 있는 주문은 위 (b)로 PAID 거절되어 이중 복원이 일어나지 않는다. (트리거 정의는 변경하지 않음)
--   ⑮ 해소(S2 2차): 이미 취소된 형제 예약·교체되는 옛 예약의 order_items 는 이 함수가 모두 지우고(7-1 직후) 최종 줄(유지+새 줄) 전부를 compute_reservation_line_amount 결과로 다시 넣는다 — 합계에 취소 줄이 남지 않는다.
--   ⑯ 수량 연동(qty_follows_main) 옵션(S2 2차, sp3 MAJOR): private.cart_group_size 는 '주문에 묶이지 않은' 예약만 같은 그룹으로 센다. 그래서 최종 줄 전부를 '주문 미연결' 상태로 만든 뒤(order_items 삭제) 새 줄 옵션을 설정하고,
--     유지 줄의 옵션도 DB 에 저장된 값(서버가 정한 단가·이름 그대로, 같은 옵션은 수량 합산)으로 set_reservation_options 를 다시 호출해 그룹 크기를 반영한 뒤 주문 항목을 다시 넣는다. 전부 한 트랜잭션이라 실패하면 원복된다.
--     부작용 주의: 유지 줄 옵션 재호출은 재고 확인(OPTION_STOCK_EXCEEDED)을 다시 받는다 — 그룹이 커져 연동 수량이 늘면 재고 부족으로 저장이 거절될 수 있다(장바구니와 같은 규칙).
--
-- 사유 코드(reason) 일람 — 응답 reason 은 아래 값 중 하나(내부 원문은 응답에 싣지 않고 서버 로그로만)
--   판정(가드)       : SIGNED · PAID · CANCEL_REQUESTED · EXPIRED · DIRECT_PAY · NOT_HOLD · ERROR      (get_reservation_edit_state 도 같은 값을 반환)
--   호출자·상태      : UNAUTHENTICATED · NOT_OWNER · STALE · BAD_REQUEST · MIN_ONE_LINE
--   줄 검증          : SALE_ONLY_NOT_EDITABLE · INVALID_METHOD(미등록·비활성·삭제된 수령/반납 방식) · INVALID_TIME(형식 오류·시간 없음·반납이 수령보다 늦지 않음)
--   재고·옵션·요금   : HOLD_FAILED · CANCEL_FAILED · OPTION_STOCK_EXCEEDED · OPTION_DELIVERY_DISABLED · OPTION_NOT_LINKED · PRICE_UNSET(요금 미등록 상품·옵션) · COUPON_STACKING_NOT_ALLOWED · DELIVERY_FEE_FAILED
--   방식 설정 오류   : RETURN_DELIVERY_RESTRICTED · OUT_OF_DELIVERY_AREA · HOLIDAY_EXTENSION_CONFLICT · BUNDLE_HOLIDAY_EXTENSION_CONFLICT · FRONTDOOR_PASSWORD_TOO_LONG · RETURN_ADDRESS_TOO_LONG · RETURN_POSTAL_CODE_TOO_LONG
--                      (set_reservation_shipment_method 등이 올리는 소문자 코드를 대문자로 바꿔 매핑. '수령 사전기한' 위반을 올리는 서버 코드는 저장소에서 찾지 못해 매핑하지 않았다 — 나오면 ERROR 로 내려간다.)
--   그 외 모든 오류  : ERROR
-- 반환 jsonb(성공): success·reason='ok'·order_id·reservation_ids·reservation_code·previous_final_amount·final_amount·selected_points(정규화된 값)·delivery_fee·total_amount·cancelled_reservation_ids(이번 저장으로 취소된 옛 예약 id)·dropped_coupons
--
-- 롤백: .claude/harness/rollback/811_rollback.sql
--   ⚠️ 함수 삭제(DROP FUNCTION)만으로는 이미 수정이 적용된 예약·주문·계약 데이터를 되돌릴 수 없다 — 롤백은 앞으로의 수정 기능만 끈다.
--   ⚠️ 적용 후 확인 쿼리(Stage 먼저, Production 은 Stage 통과 뒤):
--     SELECT has_function_privilege('anon',          'public.edit_submitted_reservation_order(bigint, bigint[], jsonb, uuid[], integer)', 'EXECUTE') AS anon_exec,          -- false
--            has_function_privilege('authenticated', 'public.edit_submitted_reservation_order(bigint, bigint[], jsonb, uuid[], integer)', 'EXECUTE') AS authenticated_exec, -- true
--            has_function_privilege('service_role',  'public.edit_submitted_reservation_order(bigint, bigint[], jsonb, uuid[], integer)', 'EXECUTE') AS service_role_exec;  -- false
--     SELECT has_function_privilege('anon',          'public.get_reservation_edit_state(bigint)', 'EXECUTE') AS anon_exec,          -- false
--            has_function_privilege('authenticated', 'public.get_reservation_edit_state(bigint)', 'EXECUTE') AS authenticated_exec, -- true
--            has_function_privilege('service_role',  'public.get_reservation_edit_state(bigint)', 'EXECUTE') AS service_role_exec;  -- false
--     SELECT r AS role, has_function_privilege(r, 'private.is_reservation_order_editable(bigint)', 'EXECUTE') AS can_exec,  -- 4개 역할 모두 false
--            has_function_privilege(r, 'private.calc_order_delivery_fee(uuid, bigint[])', 'EXECUTE') AS can_exec_fee  -- 4개 역할 모두 false
--       FROM unnest(ARRAY['anon','authenticated','service_role','public']) r;  -- 'public' 은 PUBLIC 의사 역할(PG 는 'public' 이름으로 조회 가능)

-- 이전 초안(7개 인자, 배송비·updated_at 인자 포함)이 어디엔가 적용됐다면 먼저 제거한다(없으면 무동작).
DROP FUNCTION IF EXISTS public.edit_submitted_reservation_order(bigint, bigint[], jsonb, uuid[], integer, integer, timestamptz);

-- ============================================================
-- 1. 판정 함수 — 사유 코드 반환(VOLATILE: 잠금 대기 뒤 새 스냅샷으로 읽어야 하므로 STABLE 로 두지 않는다)
-- ============================================================
CREATE OR REPLACE FUNCTION private.is_reservation_order_editable(p_reservation_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status   text;
  v_order_id bigint;
  v_sib      bigint[];
  v_direct   timestamptz;
BEGIN
  IF p_reservation_id IS NULL THEN RETURN 'ERROR'; END IF;

  SELECT rr.status INTO v_status FROM rental_reservations rr WHERE rr.id = p_reservation_id;
  IF NOT FOUND THEN RETURN 'ERROR'; END IF;

  SELECT oi.order_id INTO v_order_id FROM order_items oi WHERE oi.reservation_id = p_reservation_id LIMIT 1;
  IF v_order_id IS NULL THEN
    v_sib := ARRAY[p_reservation_id];
  ELSE
    SELECT array_agg(DISTINCT oi.reservation_id) INTO v_sib
      FROM order_items oi WHERE oi.order_id = v_order_id AND oi.reservation_id IS NOT NULL;
    IF v_sib IS NULL OR NOT (p_reservation_id = ANY (v_sib)) THEN RETURN 'ERROR'; END IF;
  END IF;

  -- 서명: 형제 어느 예약에 anchor 된 계약이든 contract_signings.signed_at 이 있으면 차단(contracts.signed_at 은 죽은 필드 — 판정 금지)
  IF EXISTS (
    SELECT 1 FROM contracts c
      JOIN contract_signings cs ON cs.contract_id = c.id
     WHERE c.reservation_id = ANY (v_sib) AND cs.signed_at IS NOT NULL
  ) THEN RETURN 'SIGNED'; END IF;

  -- 결제: payment_confirmed_at 또는 취소되지 않은 결제 거래(예약 id·주문키)
  -- 쿠폰·포인트 소진 흔적(결제 경로를 우회한 소진)도 PAID — 편집 함수·화면(get_reservation_edit_state)이 같은 정본을 쓰도록 여기서만 검사한다
  IF EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.id = ANY (v_sib) AND rr.payment_confirmed_at IS NOT NULL)
     OR (v_order_id IS NOT NULL AND (
           EXISTS (SELECT 1 FROM user_coupons uc WHERE uc.order_id = v_order_id AND uc.used_at IS NOT NULL)
           OR EXISTS (SELECT 1 FROM point_transactions pt WHERE pt.type = 'use' AND pt.ref_type = 'order' AND pt.ref_id = v_order_id::text)
        ))
     OR EXISTS (
       SELECT 1 FROM payment_transactions pt
        WHERE pt.status IS DISTINCT FROM 'cancelled'
          AND (
            pt.reservation_id = ANY (v_sib)
            OR (v_order_id IS NOT NULL AND pt.order_id IN (SELECT o.order_key FROM orders o WHERE o.id = v_order_id AND o.order_key IS NOT NULL))
          )
     )
  THEN RETURN 'PAID'; END IF;

  IF EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.id = ANY (v_sib) AND rr.cancel_requested_at IS NOT NULL) THEN
    RETURN 'CANCEL_REQUESTED';
  END IF;

  IF v_status = 'expired' OR EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.id = ANY (v_sib) AND rr.status = 'expired') THEN
    RETURN 'EXPIRED';
  END IF;

  IF v_order_id IS NOT NULL THEN
    SELECT o.direct_pay_expires_at INTO v_direct FROM orders o WHERE o.id = v_order_id;
    IF v_direct IS NOT NULL THEN RETURN 'DIRECT_PAY'; END IF;
  END IF;

  IF v_status <> 'hold'
     OR EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.id = ANY (v_sib) AND rr.status NOT IN ('hold', 'cancelled')) THEN
    RETURN 'NOT_HOLD';
  END IF;

  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERROR';  -- fail-closed: 조회 오류·불명은 수정 불가
END;
$$;

REVOKE ALL ON FUNCTION private.is_reservation_order_editable(bigint) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 1-B. 배송비 서버 계산 — TS(cartShippingFee.ts + create-order API)의 SQL 이식 (S2 추가, Stephen 확정 "배송비는 서버가 다시 계산")
-- ============================================================
-- ⚠️ 이중 구현 동기화 지점(sp7 대상): 이 함수 ↔ src/lib/utils/cartShippingFee.ts + src/routes/cart/+page.svelte(입력 조립) + src/routes/api/reservations/create-order/+server.ts(구독 무료배송 결합)
--   설정(rental_shipping_settings·delivery_fee_discount_tiers) 또는 위 TS 규칙을 바꾸면 이 함수도 함께 바꾼다(양쪽 동기화 의무). 시험: deliveryFeeParityDb.test.ts
--
-- 이식 대응표 (TS ↔ SQL)
--   TS calcShippingFee 입력 settings (cart +page.server.ts:71-74 rental_shipping_settings 첫 행)  ↔ [S] rental_shipping_settings LIMIT 1 (행이 없으면 TS 의 settings=null → 0)
--   TS cart checkedShippingItems.pickupIsDelivery  = isShippingFeeMethod = is_delivery_type && method_key<>'quick' (+page.svelte:130-132, 1613)
--        ↔ [I] 예약 pickup_method 가 rental_method_options(is_active, 미삭제, is_delivery_type=true)에 있고 'quick' 이 아님
--   TS returnIsDelivery (+page.svelte:1614) ↔ [I] return_method 로 같은 판정. return_method NULL 이면 false
--   TS shipping_round_trip/delivery/return ?? true (+page.svelte:1615-1617, 부모 우선 PARENT_POLICY_FIELDS) ↔ [I] COALESCE(부모값, 자식값, true)
--   TS calcShippingFee 3-way 배타(cartShippingFee.ts:57-75)  ↔ [F] 왕복(수령·반납 둘 다 배송) / 배송(수령만) / 반납(반납만) / 그 외 0. 상품 플래그 하나라도 false 면 그 요금 0
--   TS isPurchase 규칙(cartShippingFee.ts:55) ↔ 이 함수는 구매(sale_only·duration_type=purchase) 줄을 지원하지 않는다 — 편집 RPC 가 구매 줄을 이미 거절하므로 도달 불가, 도달하면 DELIVERY_FEE_FAILED(fail-closed)
--   TS otRentalOnlySubtotal (+page.svelte:1643-1651 = 판매전용 제외 Σ groupRentalAndOptions = 대여료×수량 + 옵션, 휴무일 연장요금 제외)
--        ↔ [T] Σ(compute_reservation_line_amount.rental_fee + options_fee) — 수량 N 은 예약 N행이므로 합이 같다(옵션은 대표 예약 1행에만 저장)
--   TS otSaleOnlySubtotal ↔ 구매 줄이 없어 0
--   TS calcShippingDiscountRate (cartShippingFee.ts:147-175) ↔ [D] delivery_fee_discount_tiers(is_active, 미삭제) 중 금액>=min_rental_amount 이고 condition_types 전부 충족(AND)인 최대 discount_rate
--        조건: long_term_rental = 어느 줄이든 달력 대여일수>=3(calcRentalDays: 같은 날 1, 아니면 max(1, 날짜차)) / rental_item = 대여 줄 존재 / sale_only_purchase = 구매 줄 존재(항상 false)
--        금액 기준: 'sale_only_purchase' 단독 티어는 판매전용 소계(0), 그 외는 대여 소계
--   TS applyShippingDiscount (cartShippingFee.ts:96-103) ↔ [A] rate>=1 이면 rate, 아니면 왕복일 때만 rate 아니면 0 → round(요금×(1-rate)) (JS Math.round ≡ 양수 numeric round: 반올림 half-up)
--   create-order API 구독 무료배송 (create-order/+server.ts:49-63) ↔ [P] 할인 후 요금>0 이면 apply_subscription_free_shipping(user, ids, p_consume:=false).applies=true → 0
--        ⚠️ API 는 이 호출이 실패하면 무시(fail-soft)하지만 이 함수는 fail-closed(DELIVERY_FEE_FAILED) — 잘못된 금액으로 저장하지 않기 위한 의도적 차이
--   ⚠️ 장기대여(long_term_rental, 3일 이상) 판정의 날짜 기준 차이: 이 함수는 DB 에 저장된 start_date/end_date(휴무일 연장이 이미 반영된 값) 기준이고,
--        TS 는 장바구니에서 고른 날짜(연장 전) 기준이다. 그래서 경계(예: 고른 기간 2일 + 휴무 연장 1일 → DB 3일, TS 2일)에서 장기대여 티어 적용이 서로 다를 수 있다(DB 쪽이 실제 청구 기간과 일치).
--   ⚠️ 방식 판정(SEC-811-08): 예약의 수령·반납 방식이 rental_method_options 에 없거나 비활성·삭제면 '배송 아님(0원)'으로 넘기지 않고 DELIVERY_FEE_FAILED 로 닫는다(TS 는 목록에 없으면 배송 아님으로 본다 — 의도적 차이, fail-closed).
--   ※ TS 에 '지역' 입력은 없다 — 배송비는 지역별이 아니라 전역 3요금이다(지역 판정은 set_reservation_shipment_method 의 허용지역 검사 소관).
--   ※ 고객이 보내는 값(배송비·소계)은 입력으로 받지 않는다 — 전부 DB 에 저장된 예약·상품·설정에서 읽는다.
CREATE OR REPLACE FUNCTION private.calc_order_delivery_fee(p_user_id uuid, p_reservation_ids bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids       bigint[];
  v_found     integer;
  v_any_pd    boolean;
  v_any_rd    boolean;
  v_all_rt    boolean;
  v_all_dl    boolean;
  v_all_rn    boolean;
  v_any_sale  boolean;
  v_any_long  boolean;
  v_s         record;
  v_fee       numeric := 0;
  v_round     boolean := false;
  v_subtotal  numeric := 0;
  v_rate      numeric := 0;
  v_tier      record;
  v_ok        boolean;
  v_eff       numeric;
  v_sub       jsonb;
  v_meth_ok   boolean;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::bigint[]) INTO v_ids FROM unnest(p_reservation_ids) AS t(x) WHERE x IS NOT NULL;
  IF p_user_id IS NULL OR cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'DELIVERY_FEE_FAILED: 입력이 올바르지 않습니다.';
  END IF;

  -- [I] 줄별 입력(DB 저장값) 집계
  SELECT count(*),
         COALESCE(bool_or(x.pd), false), COALESCE(bool_or(x.rd), false),
         COALESCE(bool_and(x.f_rt), true), COALESCE(bool_and(x.f_dl), true), COALESCE(bool_and(x.f_rn), true),
         COALESCE(bool_or(x.is_sale), false), COALESCE(bool_or(x.days >= 3), false),
         COALESCE(bool_and(x.pm_ok AND x.rm_ok), false)
    INTO v_found, v_any_pd, v_any_rd, v_all_rt, v_all_dl, v_all_rn, v_any_sale, v_any_long, v_meth_ok
    FROM (
      SELECT
        EXISTS (SELECT 1 FROM rental_method_options o WHERE o.method_key = rr.pickup_method AND o.is_active = true AND o.deleted_at IS NULL) AS pm_ok,
        (COALESCE(rr.return_method, '') = ''
          OR EXISTS (SELECT 1 FROM rental_method_options o WHERE o.method_key = rr.return_method AND o.is_active = true AND o.deleted_at IS NULL)) AS rm_ok,
        EXISTS (SELECT 1 FROM rental_method_options o WHERE o.method_key = rr.pickup_method AND o.is_active = true AND o.deleted_at IS NULL AND o.is_delivery_type = true)
          AND rr.pickup_method <> 'quick' AS pd,
        (rr.return_method IS NOT NULL
          AND EXISTS (SELECT 1 FROM rental_method_options o WHERE o.method_key = rr.return_method AND o.is_active = true AND o.deleted_at IS NULL AND o.is_delivery_type = true)
          AND rr.return_method <> 'quick') AS rd,
        COALESCE(par.shipping_round_trip, p.shipping_round_trip, true) AS f_rt,
        COALESCE(par.shipping_delivery,   p.shipping_delivery,   true) AS f_dl,
        COALESCE(par.shipping_return,     p.shipping_return,     true) AS f_rn,
        (COALESCE(par.sale_only, p.sale_only, false) OR COALESCE(rr.duration_type, '') = 'purchase') AS is_sale,
        CASE WHEN rr.start_date = rr.end_date THEN 1 ELSE GREATEST(1, (rr.end_date - rr.start_date)) END AS days
      FROM rental_reservations rr
      JOIN products p ON p.id = rr.product_id
      LEFT JOIN products par ON par.id = p.parent_product_id
     WHERE rr.id = ANY (v_ids)
    ) x;
  IF v_found IS DISTINCT FROM cardinality(v_ids) THEN
    RAISE EXCEPTION 'DELIVERY_FEE_FAILED: 예약을 찾을 수 없습니다.';
  END IF;
  IF NOT v_meth_ok THEN
    RAISE EXCEPTION 'DELIVERY_FEE_FAILED: 수령·반납 방식이 등록되어 있지 않거나 사용할 수 없습니다.';
  END IF;
  IF v_any_sale THEN
    RAISE EXCEPTION 'DELIVERY_FEE_FAILED: 구매 상품은 배송비를 서버 계산하지 않습니다.';
  END IF;

  -- [S] 설정(싱글톤) — 행이 없으면 TS 와 같이 0
  SELECT s.enable_round_trip, s.round_trip_fee, s.enable_delivery, s.delivery_fee, s.enable_return, s.return_fee
    INTO v_s FROM rental_shipping_settings s LIMIT 1;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- [F] 3-way 배타
  IF v_any_pd AND v_any_rd THEN
    v_round := true;
    IF v_s.enable_round_trip AND v_all_rt THEN v_fee := COALESCE(v_s.round_trip_fee, 0); END IF;
  ELSIF v_any_pd THEN
    IF v_s.enable_delivery AND v_all_dl THEN v_fee := COALESCE(v_s.delivery_fee, 0); END IF;
  ELSIF v_any_rd THEN
    IF v_s.enable_return AND v_all_rn THEN v_fee := COALESCE(v_s.return_fee, 0); END IF;
  END IF;

  IF v_fee <= 0 THEN RETURN 0; END IF;  -- 0원이면 우대·구독 판정은 결과에 영향이 없다(API 도 요금>0 일 때만 구독 판정)

  -- [T] 대여 소계 = Σ(대여료 + 옵션) — 휴무일 연장요금 제외(TS groupRentalAndOptions 와 동일)
  SELECT COALESCE(SUM(line.rental_fee + line.options_fee), 0) INTO v_subtotal
    FROM unnest(v_ids) AS t(rid)
    CROSS JOIN LATERAL public.compute_reservation_line_amount(t.rid) AS line;

  -- [D] 우대 티어
  FOR v_tier IN
    SELECT t.min_rental_amount, t.condition_types, t.discount_rate
      FROM delivery_fee_discount_tiers t WHERE t.is_active = true AND t.deleted_at IS NULL
  LOOP
    CONTINUE WHEN v_tier.condition_types IS NULL OR cardinality(v_tier.condition_types) = 0;
    -- 판매전용 단독 티어는 판매전용 소계(구매 줄이 없으므로 0), 그 외는 대여 소계
    IF (CASE WHEN cardinality(v_tier.condition_types) = 1 AND v_tier.condition_types[1] = 'sale_only_purchase' THEN 0 ELSE v_subtotal END) < v_tier.min_rental_amount THEN
      CONTINUE;
    END IF;
    SELECT NOT EXISTS (
      SELECT 1 FROM unnest(v_tier.condition_types) AS ct(c)
       WHERE NOT (CASE ct.c
                    WHEN 'long_term_rental'   THEN v_any_long
                    WHEN 'rental_item'        THEN true          -- 구매 줄이 없으므로 대여 줄은 항상 존재
                    WHEN 'sale_only_purchase' THEN false         -- 구매 줄 없음
                    ELSE false END)
    ) INTO v_ok;
    IF v_ok AND v_tier.discount_rate > v_rate THEN v_rate := v_tier.discount_rate; END IF;
  END LOOP;

  -- [A] 할인 적용
  v_eff := CASE WHEN v_rate >= 1 THEN v_rate WHEN v_round THEN v_rate ELSE 0 END;
  v_fee := round(v_fee * (1 - v_eff));

  -- [P] 구독 무료배송(판정만, 소진 없음)
  IF v_fee > 0 THEN
    v_sub := public.apply_subscription_free_shipping(p_user_id, v_ids, false);
    IF v_sub IS NULL THEN
      RAISE EXCEPTION 'DELIVERY_FEE_FAILED: 구독 혜택 판정 결과가 없습니다.';
    END IF;
    IF COALESCE((v_sub ->> 'applies')::boolean, false) THEN v_fee := 0; END IF;
  END IF;

  RETURN GREATEST(0, v_fee)::integer;
END;
$$;

REVOKE ALL ON FUNCTION private.calc_order_delivery_fee(uuid, bigint[]) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 1-C. 수정 가능 여부 조회(읽기 전용) — 화면·API 가 버튼 노출·안내에 쓴다. 판정 정본은 private.is_reservation_order_editable 하나.
-- ============================================================
-- 반환은 {ok, can_edit, reason} 뿐(내부 정보·id·금액 없음). 타인·없는 예약은 같은 응답(NOT_OWNER)이라 존재 여부를 알 수 없다. 잠금·변경 없음.
CREATE OR REPLACE FUNCTION public.get_reservation_edit_state(p_reservation_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_anon     boolean;
  v_order_id bigint;
  v_owner    uuid;
  v_reason   text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'can_edit', false, 'reason', 'UNAUTHENTICATED');
  END IF;
  SELECT u.is_anonymous INTO v_anon FROM auth.users u WHERE u.id = v_uid;
  IF v_anon IS NOT FALSE THEN
    RETURN jsonb_build_object('ok', false, 'can_edit', false, 'reason', 'UNAUTHENTICATED');
  END IF;
  IF p_reservation_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'can_edit', false, 'reason', 'NOT_OWNER');
  END IF;

  -- 소유자: 주문이 있으면 주문 소유자, 없으면 예약 소유자(편집 함수와 같은 기준)
  SELECT oi.order_id INTO v_order_id FROM order_items oi WHERE oi.reservation_id = p_reservation_id LIMIT 1;
  IF v_order_id IS NOT NULL THEN
    SELECT o.user_id INTO v_owner FROM orders o WHERE o.id = v_order_id;
  ELSE
    SELECT rr.user_id INTO v_owner FROM rental_reservations rr WHERE rr.id = p_reservation_id;
  END IF;
  IF v_owner IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'can_edit', false, 'reason', 'NOT_OWNER');
  END IF;

  v_reason := private.is_reservation_order_editable(p_reservation_id);
  RETURN jsonb_build_object('ok', v_reason <> 'ERROR', 'can_edit', v_reason = 'ok', 'reason', v_reason);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'can_edit', false, 'reason', 'ERROR');  -- fail-closed, 원문 비노출
END;
$$;

REVOKE ALL ON FUNCTION public.get_reservation_edit_state(bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_reservation_edit_state(bigint) TO authenticated;

-- public-callable: get_reservation_edit_state — 로그인한 고객 본인의 예약정보 수정 화면이 사용자 세션으로 직접 호출(읽기 전용, 함수 안에서 auth.uid() 소유권·익명 재검증)

COMMENT ON FUNCTION public.get_reservation_edit_state(bigint) IS
  '신청대기 예약 정보 수정 가능 여부 조회(읽기 전용, {ok, can_edit, reason}). authenticated 본인만. 판정은 private.is_reservation_order_editable. Migration 811.';

-- ============================================================
-- 2. 편집 함수
-- ============================================================
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
         'FRONTDOOR_PASSWORD_TOO_LONG', 'RETURN_ADDRESS_TOO_LONG', 'RETURN_POSTAL_CODE_TOO_LONG'
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
        ELSE '저장에 실패했어요'
      END,
      'order_id', v_order_id
    );
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.edit_submitted_reservation_order(bigint, bigint[], jsonb, uuid[], integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.edit_submitted_reservation_order(bigint, bigint[], jsonb, uuid[], integer) TO authenticated;

-- public-callable: edit_submitted_reservation_order — 로그인한 고객 본인의 장바구니 수정 모드가 사용자 세션으로 직접 호출(함수 안에서 auth.uid() 소유권·익명·서명/결제 가드를 모두 재검증)

COMMENT ON FUNCTION public.edit_submitted_reservation_order(bigint, bigint[], jsonb, uuid[], integer) IS
  '신청대기(hold) 예약 정보 수정을 한 트랜잭션으로 적용(품번 유지). authenticated 본인만. 배송비는 서버가 최종 예약 집합으로 재계산. Migration 811.';
