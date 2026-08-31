-- Migration 407 — 포인트 자동적립: 대여완료(rental_complete) 이벤트 (2026-09-01)
--
-- 배경: CMS 전역 정밀 검증 v5(cms_global_verification_v5_synthesis_2026-08-31.md)에서
-- point_earn_rules 테이블(Migration #50)에 rental_complete 등 7종 적립규칙이 CMS에서
-- 관리 가능하지만, 이를 실제로 지급하는 트리거/cron/앱코드가 프로젝트 전체에 0곳임을 발견.
-- Stephen 확정(2026-09-01): 이번 사이클엔 7종 중 rental_complete(대여완료)만 우선 구현.
--
-- 정정(2026-09-01, Stephen 지적으로 바로잡음): 초안에서 point_earn_rules.grade_multipliers
-- 키를 membership_grade_enum 값('none'|'easy'|'pop'|'crazy'|'admin')에 맞춰 정정하려 했으나,
-- 이는 잘못된 가정이었다 — easy/pop/crazy는 "고객 등급"이 아니라 정기구독 상품 분류
-- (database.ts:387 EASY/POP/CRAZY 구독 티어)이고, 포인트 배수를 매길 만한 고객 등급 체계
-- 자체가 아직 정의돼 있지 않다(현재 고객 분류는 인증 상태 — 일반/학생/구독 — 뿐이며 이는
-- 적립 배수 목적의 "등급"과는 다른 개념). 따라서 이 마이그레이션은 grade_multipliers 시드
-- 데이터를 건드리지 않고(원래 값 그대로 보존), RPC도 등급 배수 조회 자체를 시도하지 않는다
-- — 배수 없이 rate만으로 계산한다. 실제 고객 등급 체계가 설계되면 별도 마이그레이션으로
-- 배수 로직을 추가할 것.
--
-- 부수 발견·수정 2: point_transactions.ref_id(Migration #46)가 UUID로 선언돼 있으나
-- 이 프로젝트의 예약/주문 PK는 전부 BIGINT다(rental_reservations.id, order_items.order_id 등,
-- 여러 RPC의 BIGINT 반환 타입으로 확인) — UUID 컬럼에 BIGINT 값을 넣을 방법이 없어 지금까지
-- ref_id는 사실상 한 번도 실제로 채워진 적이 없었다(use_points RPC #303도 NULL 하드코딩).
-- 이 마이그레이션에서 TEXT로 전환(기존 NULL/UUID 문자열 값과 완전 호환) — 이번 RPC의 멱등성
-- 체크(예약ID 기준 중복지급 방지)에 반드시 필요하기 때문.
--
-- 호출 위치: src/lib/server/awardRentalCompletePoints.ts (공용 헬퍼, fail-soft)
--   → src/lib/server/rentalQrTransition.ts (QR 반납 경로)
--   → src/routes/cms/reservation/+page.server.ts updateStatus 액션 (수동 반납 경로)
--   두 경로 모두 newStatus === 'returned' 전이 성공 시 호출(log_rental_action과 동일 이중 배선).
--
-- 적립 기준: order_items.line_total(해당 예약의 실 렌탈비) × point_earn_rules.rate.
--   고객 등급 체계가 아직 없어 grade_multipliers는 이번 구현에서 적용하지 않는다(배수 1.0 고정).
--
-- SECURITY DEFINER + service_role 전용(CMS/QR 서버 코드에서만 호출).

-- ── point_transactions.ref_id — UUID → TEXT (기존 값 완전 호환) ──
ALTER TABLE public.point_transactions
  ALTER COLUMN ref_id TYPE TEXT USING ref_id::text;

-- ── award_rental_complete_points RPC ──
CREATE OR REPLACE FUNCTION public.award_rental_complete_points(
  p_reservation_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            UUID;
  v_line_total         NUMERIC;
  v_rate               NUMERIC;
  v_is_active          BOOLEAN;
  v_amount             INT;
  v_new_balance        INT;
BEGIN
  -- 멱등성: 이 예약으로 이미 지급됐으면 재지급하지 않음(재시도·중복 전이 안전)
  IF EXISTS (
    SELECT 1 FROM public.point_transactions
     WHERE ref_type = 'rental_complete' AND ref_id = p_reservation_id::text
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_granted', true);
  END IF;

  SELECT rr.user_id
    INTO v_user_id
    FROM public.rental_reservations rr
   WHERE rr.id = p_reservation_id;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'reservation_not_found');
  END IF;

  SELECT rate, is_active
    INTO v_rate, v_is_active
    FROM public.point_earn_rules
   WHERE event_type = 'rental_complete';

  IF v_rate IS NULL OR v_is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'rule_inactive');
  END IF;

  SELECT COALESCE(SUM(line_total), 0)
    INTO v_line_total
    FROM public.order_items
   WHERE reservation_id = p_reservation_id;

  IF v_line_total IS NULL OR v_line_total <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_rental_fee');
  END IF;

  -- 고객 등급 체계 미정 — 배수 없이 rate만 적용(grade_multipliers 미사용)
  v_amount := ROUND(v_line_total * v_rate)::int;

  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'zero_amount');
  END IF;

  UPDATE public.user_profiles
     SET points = points + v_amount
   WHERE user_id = v_user_id
  RETURNING points INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  INSERT INTO public.point_transactions(
    user_id, type, amount, balance_after, description, ref_type, ref_id
  )
  VALUES (
    v_user_id, 'earn', v_amount, v_new_balance,
    '대여 완료 적립', 'rental_complete', p_reservation_id::text
  );

  RETURN jsonb_build_object('success', true, 'amount', v_amount, 'new_balance', v_new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.award_rental_complete_points(BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.award_rental_complete_points(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.award_rental_complete_points(BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.award_rental_complete_points(BIGINT) TO service_role;

-- ── ROLLBACK(참고용) ──
-- DROP FUNCTION IF EXISTS public.award_rental_complete_points(BIGINT);
-- ALTER TABLE public.point_transactions ALTER COLUMN ref_id TYPE UUID USING NULL; -- 기존 데이터 손실 주의
