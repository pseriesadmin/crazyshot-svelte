-- Migration #368: purge_withdrawn_accounts RPC + pg_cron 스케줄
--
-- .claude/harness/TASK.md "마이페이지 회원 탈퇴('탈회') 기능 신설" T5
-- plan_source: /Users/stevenmac/.claude/plans/dazzling-sauteeing-aurora.md §2-③
-- 의존: Migration #365(withdrawal_columns) 적용 완료 필수
--
-- 목적: 탈퇴 신청 후 30일이 경과한 계정의 PII를 자동 스크럽하는 pg_cron 함수.
--   - withdrawal_status='requested' + withdrawal_purge_at <= now() 행만 대상.
--   - 스크럽 대상: 개인식별정보(full_name/phone/birth_date/address/email/avatar_url/
--     identity_*/foreign_*) 전부 NULL — 단, email은 NOT NULL 제약이 걸려 있어(2026-08-28
--     TDD 라이브 통합테스트 중 23502 위반으로 실제 발견) NULL 대신 id 기반 익명화 값으로
--     대체(UNIQUE 제약 없음 확인 완료 — 실제 이메일 주소 정보는 더 이상 남지 않음).
--   - 비대상: member_code/membership_grade/credit_score/points/rental_count 등
--     이용통계 컬럼 — 개인식별정보 아님, blast radius 회피 + soft_delete_customer 선례.
--   - 법령 보존 의무: payment_transactions 등 거래기록 테이블은 이 함수가 SELECT/UPDATE
--     대상에 포함하지 않음.
--   - auth.users 행은 절대 건드리지 않음 — 자동복구(restore_withdrawn_account) 전제.
--
-- 보안 패턴(이 프로젝트 재발사고 방지 — 신규 함수 전부 예외 없이 준수):
--   SECURITY DEFINER SET search_path='public'
--   같은 파일 내 REVOKE ALL FROM PUBLIC, anon, authenticated
--   이후 GRANT EXECUTE TO service_role ONLY (cron 내부 호출 전용, authenticated도 불필요)
--
-- pg_cron 스케줄: 매일 01:00 UTC(KST 10:00)
--   (Migration #256 auto_send_return_remind 동일 템플릿, jobname='purge-withdrawn-accounts')
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot production(vnbpmvxruyciuuaermyh)
-- 2026-08-28

CREATE OR REPLACE FUNCTION public.purge_withdrawn_accounts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE user_profiles
  SET
    -- 개인식별정보(PII) — 전부 NULL 처리
    full_name            = NULL,
    phone                = NULL,
    birth_date           = NULL,
    address              = NULL,
    -- email은 NOT NULL 제약(UNIQUE 없음) — id 기반 익명 placeholder로 대체(실제 이메일 미보존)
    email                = 'purged-' || id::text || '@purged.crazyshot.kr',
    avatar_url           = NULL,
    -- 본인인증 문서
    identity_type        = NULL,
    identity_doc_url     = NULL,
    identity_verified_at = NULL,
    -- 외국인증명 문서
    foreign_doc_url      = NULL,
    foreign_doc_urls     = NULL,
    foreign_type         = NULL,
    foreign_stay_type    = NULL,
    foreign_verified_at  = NULL,
    -- 탈퇴 상태 갱신 — 스크럽 완료 표시
    withdrawal_status       = 'purged',
    withdrawal_purged_at    = now(),
    -- 탈퇴 메타데이터 정리 (사유·일정 등 더 이상 불필요)
    withdrawal_requested_at = NULL,
    withdrawal_purge_at     = NULL,
    withdrawal_reasons      = NULL,
    withdrawal_reason_etc   = NULL,
    -- 공통
    updated_at           = now()
  WHERE withdrawal_status = 'requested'
    AND withdrawal_purge_at <= now();
  -- NOTE: member_code / membership_grade / credit_score / points /
  --       rental_count / blacklisted 등 이용통계·서비스상태 컬럼은
  --       개인식별정보가 아니므로 절대 건드리지 않음.
  --       payment_transactions 등 거래기록 테이블도 대상 외.
END;
$$;

-- ── 권한 설정 (REVOKE → GRANT 순서 고정, 재발사고 방지 필수) ──────────────────
-- Migration #364 get_customer_list_revoke_fix / #366 request_account_withdrawal 동일 패턴.
-- 이 함수는 pg_cron 내부 호출 전용 — service_role만 허용, authenticated도 불필요.
REVOKE ALL ON FUNCTION public.purge_withdrawn_accounts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_withdrawn_accounts() TO service_role;

-- ── pg_cron 스케줄 등록 (idempotent) ──────────────────────────────────────────
-- Migration #256 auto_send_return_remind_cron.sql 동일 패턴:
--   기존 job 제거 후 재등록 (unschedule → schedule 순서 고정).
SELECT cron.unschedule('purge-withdrawn-accounts')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'purge-withdrawn-accounts'
);

-- 매일 01:00 UTC (KST 10:00) — 새벽 트래픽 최소 시간대
SELECT cron.schedule(
  'purge-withdrawn-accounts',
  '0 1 * * *',
  $$SELECT public.purge_withdrawn_accounts();$$
);

-- ============================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================
-- SELECT cron.unschedule('purge-withdrawn-accounts');
-- DROP FUNCTION IF EXISTS public.purge_withdrawn_accounts();
-- ============================================================
