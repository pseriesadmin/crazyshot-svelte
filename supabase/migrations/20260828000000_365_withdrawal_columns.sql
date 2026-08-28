-- Migration #365: user_profiles 탈퇴(탈회) 컬럼 신설
--
-- .claude/harness/TASK.md "마이페이지 회원 탈퇴('탈회') 기능 신설" T1(Stage 0)
-- 상세설계: /Users/stevenmac/.claude/plans/dazzling-sauteeing-aurora.md §1
--
-- 목적: 회원 자율 탈퇴 기능의 상태·이력을 저장하기 위한 6개 신규 컬럼 + 부분인덱스 추가.
--   - soft_delete_customer(Migration 131)·deleted_at과 완전 분리 — 기존 컬럼 절대 건드리지 않음.
--   - 별도 "접근차단" boolean 미생성 — withdrawal_status='requested' 단일 조건으로만 판정
--     (상태 두 곳 저장 → 드리프트 버그 클래스 재발 방지).
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot production(vnbpmvxruyciuuaermyh)
-- 2026-08-28

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS withdrawal_status       TEXT NOT NULL DEFAULT 'none'
    CHECK (withdrawal_status IN ('none', 'requested', 'purged')),
  ADD COLUMN IF NOT EXISTS withdrawal_requested_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS withdrawal_purge_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS withdrawal_purged_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS withdrawal_reasons       TEXT[],
  ADD COLUMN IF NOT EXISTS withdrawal_reason_etc    TEXT;

-- 부분인덱스: purge_at 기반 일정 조회 (pg_cron 자동삭제 타깃 찾기용)
-- withdrawal_status='requested'인 행만 인덱싱 — 정상 회원(none)·완전삭제 완료(purged)는 제외
CREATE INDEX IF NOT EXISTS idx_user_profiles_withdrawal_purge_at
  ON public.user_profiles (withdrawal_purge_at)
  WHERE withdrawal_status = 'requested';

-- withdrawal_status 값 의미:
--   'none'      : 정상 회원 (기본값)
--   'requested' : 탈퇴 신청 완료, 30일 유예기간 진행 중 (서비스 접근 차단)
--   'purged'    : 30일 경과 후 pg_cron이 PII 완전삭제 완료 (auth.users는 보존)
