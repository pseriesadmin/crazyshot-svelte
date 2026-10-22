-- Migration 739 — 반납등록 미션: 고객 이용 평가 컬럼 + 포인트 규칙(return_register_mission) + 지급 RPC (2026-10-22)
--
-- 배경(Stephen 지시): 고객 반납정보 등록 화면을 카드 슬롯 5장(소개→사진→체크/확인→이용 평가→완료)으로 재구성하고,
-- "반납등록 미션을 클리어하면 포인트 지급" 보상을 붙인다. 확정 정책:
--   ① 포인트 = CMS 포인트 규칙(point_earn_rules)의 신규 이벤트 return_register_mission — 금액·켜기는 CMS에서 조정(초기값 0·꺼짐 → 켜기 전엔 지급·문구 없음)
--   ② 예약당 1회(ref_type/ref_id 멱등) — 재제출해도 중복 지급 없음
--   ③ 이용 평가(100자 이내, 선택)는 반납 제출 기록(reservation_return_submissions.customer_feedback)에 저장
--
-- award_on_time_return_points(#597)와 같은 권한·멱등·fail-soft 패턴: SECURITY DEFINER + service_role 전용.
-- ref_type 은 point_transactions.ref_type varchar(30) 이내('return_register_mission' = 23자).

-- 1) 이용 평가 컬럼
ALTER TABLE public.reservation_return_submissions
  ADD COLUMN IF NOT EXISTS customer_feedback text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reservation_return_submissions_feedback_len'
       AND conrelid = 'public.reservation_return_submissions'::regclass
  ) THEN
    ALTER TABLE public.reservation_return_submissions
      ADD CONSTRAINT reservation_return_submissions_feedback_len
      CHECK (customer_feedback IS NULL OR char_length(customer_feedback) <= 100);
  END IF;
END $$;

COMMENT ON COLUMN public.reservation_return_submissions.customer_feedback IS
  '고객 이용 평가(반납등록 미션 3단계, 100자 이내·선택) — CMS 검수 탭에서 읽기 전용으로 표시';

-- 2) 포인트 규칙 행(초기 0원·꺼짐 — 관리자가 금액을 정해 켠다)
INSERT INTO public.point_earn_rules (event_type, amount, rate, is_active, grade_multipliers, description)
VALUES (
  'return_register_mission', 0, 0, false, NULL,
  '반납등록 미션 — 고객이 반납정보(사진·확인·이용 평가) 등록을 마치면 예약당 1회 고정 지급'
)
ON CONFLICT (event_type) DO NOTHING;

-- 3) 지급 RPC
CREATE OR REPLACE FUNCTION public.award_return_register_mission_points(
  p_reservation_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID;
  v_amount      INT;
  v_is_active   BOOLEAN;
  v_new_balance INT;
BEGIN
  -- 멱등성: 이 예약으로 이미 지급됐으면 재지급하지 않음
  IF EXISTS (
    SELECT 1 FROM public.point_transactions
     WHERE ref_type = 'return_register_mission' AND ref_id = p_reservation_id::text
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

  SELECT amount, is_active
    INTO v_amount, v_is_active
    FROM public.point_earn_rules
   WHERE event_type = 'return_register_mission';

  IF v_amount IS NULL OR v_is_active IS NOT TRUE OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rule_inactive');
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
    '반납등록 미션 적립', 'return_register_mission', p_reservation_id::text
  );

  RETURN jsonb_build_object('success', true, 'amount', v_amount, 'new_balance', v_new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.award_return_register_mission_points(BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.award_return_register_mission_points(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.award_return_register_mission_points(BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.award_return_register_mission_points(BIGINT) TO service_role;

-- ── ROLLBACK(참고용) ──
-- DROP FUNCTION IF EXISTS public.award_return_register_mission_points(BIGINT);
-- DELETE FROM public.point_earn_rules WHERE event_type = 'return_register_mission';
-- ALTER TABLE public.reservation_return_submissions DROP CONSTRAINT IF EXISTS reservation_return_submissions_feedback_len;
-- ALTER TABLE public.reservation_return_submissions DROP COLUMN IF EXISTS customer_feedback;
