-- Migration 598 — 포인트 자동적립: 생일 축하(birthday) 이벤트 (2026-09-30)
--
-- 배경: point_earn_rules(Migration #50)에 birthday 규칙이 있지만 실제로 지급하는 코드가
-- 없었음. 별개 시스템인 marketing_rules/execute_marketing_rules(#58)의 'birthday' 분기는
-- auth.users.raw_user_meta_data->>'birth_date'(가입 시점 메타데이터, 갱신 안 됨)를 읽는
-- 완전히 다른 로직이라 이번 구현과 무관 — 실제 지급은 point_earn_rules 기준으로 새로 구현.
--
-- 생년월일 출처: user_profiles.birth_date(DATE 컬럼, Migration #135) 사용 — CMS 고객
-- 정보수정(update_customer_info)·본인 프로필 수정에서 실제로 갱신되는 현재 활성 필드이며,
-- marketing_rules가 쓰던 auth.users 메타데이터보다 신뢰도가 높다(라이브 조회로 확인).
--
-- 지급 기준: point_earn_rules.description 원문("생일 당월 자동 지급")에 맞춰 "생일이 속한
-- 달(月)"에 배치 크론이 처음 만나는 날 1회 지급 — 정확한 하루(일)까지 맞출 필요 없음.
--   EXTRACT(MONTH FROM birth_date) = EXTRACT(MONTH FROM CURRENT_DATE)
-- 중복 방지: 예약 id 같은 자연키가 없는 이벤트라 "user_id + 연도"를 인조키로 사용
--   (ref_type='birthday', ref_id = user_id || '-' || 연도) — 그 달 안에 크론이 매일 돌아도
--   최초 1회만 지급되고 그 이후로는 스킵된다.
--
-- 배치 처리: 크론(src/routes/api/cron/birthday-points/+server.ts)이 여러 배치로 나눠 호출
--   (locker-guide/return-remind와 동일한 BATCH_SIZE×MAX_BATCHES 루프 패턴).
-- grade_multipliers는 다른 지급 RPC와 동일하게 이번에도 미적용.

CREATE OR REPLACE FUNCTION public.award_birthday_points_batch(
  p_limit INT DEFAULT 100
)
RETURNS TABLE (
  user_id UUID,
  amount  INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule_amount INT;
  v_is_active   BOOLEAN;
  v_year        TEXT := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  r             RECORD;
  v_new_balance INT;
BEGIN
  -- 반환 테이블 컬럼명(user_id, amount)과 겹치는 bare 컬럼명 참조는 plpgsql.variable_conflict
  -- 엄격모드에서 "ambiguous" 컴파일 에러가 나므로 테이블 별칭(per.)으로 명시적으로 구분한다.
  SELECT per.amount, per.is_active INTO v_rule_amount, v_is_active
    FROM public.point_earn_rules per WHERE per.event_type = 'birthday';

  IF v_rule_amount IS NULL OR v_is_active IS NOT TRUE OR v_rule_amount <= 0 THEN
    RETURN; -- 규칙 비활성 — 빈 결과
  END IF;

  FOR r IN
    SELECT up.user_id AS uid
      FROM public.user_profiles up
     WHERE up.birth_date IS NOT NULL
       AND up.deleted_at IS NULL
       AND EXTRACT(MONTH FROM up.birth_date) = EXTRACT(MONTH FROM CURRENT_DATE)
       AND NOT EXISTS (
         SELECT 1 FROM public.point_transactions pt
          WHERE pt.ref_type = 'birthday'
            AND pt.ref_id = up.user_id::text || '-' || v_year
       )
     LIMIT p_limit
  LOOP
    UPDATE public.user_profiles
       SET points = points + v_rule_amount
     WHERE public.user_profiles.user_id = r.uid
    RETURNING points INTO v_new_balance;

    IF FOUND THEN
      INSERT INTO public.point_transactions(
        user_id, type, amount, balance_after, description, ref_type, ref_id
      )
      VALUES (
        r.uid, 'earn', v_rule_amount, v_new_balance,
        '생일 축하 적립', 'birthday', r.uid::text || '-' || v_year
      );

      user_id := r.uid;
      amount  := v_rule_amount;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.award_birthday_points_batch(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.award_birthday_points_batch(INT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.award_birthday_points_batch(INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.award_birthday_points_batch(INT) TO service_role;

-- ── ROLLBACK(참고용) ──
-- DROP FUNCTION IF EXISTS public.award_birthday_points_batch(INT);
