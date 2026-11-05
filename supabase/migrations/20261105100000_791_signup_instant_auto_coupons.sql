-- Migration #791: 가입 즉시 자동배포 쿠폰 발급 (2026-11-05, Stephen 지시)
--
-- 배경: 자동배포 쿠폰(첫거래 30%·방문 10% 등)은 pg_cron(auto-distribute-eligible-coupons, 30분 간격)만 지급해
--       가입 후 최대 30분간 쿠폰이 없었다. 그 사이 대여 신청을 하면 쿠폰 없이 신청된다(2026-11-05 실사례).
-- 변경: user_profiles 행이 생기는 즉시(가입 트리거가 만드는 시점) 그 회원 1명에게 자동배포 쿠폰을 지급한다.
--       대상 판정은 auto_distribute_eligible_coupons(#528)와 동일 — 두 곳이 어긋나지 않게 같은 조건을 쓴다.
--       cron은 그대로 둔다(학생 인증·등급 변경 등 가입 이후 조건이 바뀐 회원 보충 + 이번 함수 실패 시 안전망).
-- 안전: 이 함수가 실패해도 가입을 막지 않는다(WARNING 후 통과 — 다음 cron이 보충).
--       ON CONFLICT DO NOTHING + user_coupons 발행 한도 트리거(#623)는 그대로 적용된다.

CREATE OR REPLACE FUNCTION private.issue_auto_coupons_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  BEGIN
    INSERT INTO public.user_coupons (user_id, coupon_id)
    SELECT NEW.id, c.id
    FROM public.coupons c
    WHERE c.auto_distribute_enabled = true
      AND c.is_active = true
      AND c.deleted_at IS NULL
      AND (
            c.user_grade_required IS NULL
         OR (
              c.user_grade_required = 'general'
              AND NOT COALESCE(NEW.is_student, false)
              AND (NEW.membership_grade IS NULL OR NEW.membership_grade = 'NONE')
            )
         OR (
              c.user_grade_required = 'student'
              AND COALESCE(NEW.is_student, false)
            )
         OR (
              c.user_grade_required = 'subscriber'
              AND NEW.membership_grade IS NOT NULL
              AND NEW.membership_grade != 'NONE'
            )
      )
    ON CONFLICT (user_id, coupon_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'issue_auto_coupons_on_signup 실패(user=%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION private.issue_auto_coupons_on_signup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_issue_auto_coupons_on_signup ON public.user_profiles;
CREATE TRIGGER trg_issue_auto_coupons_on_signup
  AFTER INSERT ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION private.issue_auto_coupons_on_signup();

-- ROLLBACK(참고용): DROP TRIGGER trg_issue_auto_coupons_on_signup ON public.user_profiles; DROP FUNCTION private.issue_auto_coupons_on_signup();
