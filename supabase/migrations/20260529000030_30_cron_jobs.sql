-- ★ MIGRATION: 30_cron_jobs.sql
-- Schema version: v5.46
-- Description: pg_cron scheduled jobs for automation
-- Dependencies: 29_rpc_functions.sql, 01_extensions.sql (pg_cron)
-- Author: Stephen Cconzy
-- Date: 2026-05-29
--
-- Jobs:
--   1. hold_expiration_cleanup  — 매 1분: hold 만료 예약 자동 해제
--   2. credit_score_monthly     — 매월 1일: 우량 회원 credit_score +3

-- ★ hold 만료 처리: 1분마다
SELECT cron.schedule(
  'hold_expiration_cleanup',
  '* * * * *',
  $$SELECT release_reservation_hold();$$
);

-- ★ 월간 우량 회원 credit_score +3
-- (rental_count >= 5 AND late_return_count = 0 AND damage_count = 0)
SELECT cron.schedule(
  'monthly_credit_score_boost',
  '0 0 1 * *',
  $$
  SELECT update_credit_score(
    up.user_id,
    3::SMALLINT,
    '월간 우량 회원 자동 포인트',
    jsonb_build_object('source', 'monthly_cron', 'date', NOW())
  )
  FROM user_profiles up
  WHERE up.rental_count >= 5
    AND up.late_return_count = 0
    AND up.damage_count = 0
    AND up.credit_score < 100
    AND up.deleted_at IS NULL;
  $$
);

-- ★ 구독 만료 처리: 매일 자정
SELECT cron.schedule(
  'subscription_expiry_check',
  '0 0 * * *',
  $$
  UPDATE subscriptions
  SET status = 'expired', updated_at = NOW()
  WHERE status = 'active'
    AND auto_renew = false
    AND billing_cycle_end < CURRENT_DATE
    AND deleted_at IS NULL;
  $$
);
