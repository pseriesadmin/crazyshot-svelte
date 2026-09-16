-- Migration #504: 관리자 계정 비밀번호 재설정("복구 링크") 전용 테이블
--
-- 배경: 기존 admin_invite_tokens + cms_create_invite_token RPC는 "신규 계정 최초
-- 설정"용으로 설계되어 본인확인 없이 링크만 있으면 누구나 비밀번호를 설정할 수 있다.
-- 이 링크를 "비밀번호를 잊어버린 기존(특히 superadmin) 계정" 복구에 그대로 재사용하면
-- 링크 유출 시 계정 탈취로 이어지는 보안 취약점이 된다(2026-09-15 발견).
--
-- 이 테이블은 그 대체 경로 전용으로, 반드시 아래 단계를 순서대로 통과해야
-- 비밀번호를 설정할 수 있다:
--   1) 발급: /cms/accounts/list에서 manager 이상(대상이 superadmin이면 진짜
--      superadmin만) 관리자가 발급 — requireAccountMutationAccess 재사용
--   2) email_verified_at — 대상 계정에 등록된 이메일을 정확히 입력해야 통과
--   3) phone_verified_at — 등록된 휴대폰 번호 입력 + SMS OTP 인증까지 통과해야 함
--   4) 위 둘 다 통과한 뒤에만 새 비밀번호 설정 가능
-- match_attempts(이메일·휴대폰 불일치)·otp_attempts(OTP 오입력) 각각 5회 초과 시
-- locked_at을 찍어 링크 자체를 차단한다(무차별 대입 방지).
-- expires_at은 발급 시점 기준 30분 고정 — admin_invite_tokens(7일)와 의도적으로 다름.

CREATE TABLE IF NOT EXISTS public.admin_password_recovery_tokens (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token              text        UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  target_user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  issued_by          uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at         timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  email_verified_at  timestamptz,
  phone_verified_at  timestamptz,
  otp_code           text,
  otp_expires_at     timestamptz,
  otp_attempts       integer     NOT NULL DEFAULT 0,
  match_attempts     integer     NOT NULL DEFAULT 0,
  locked_at          timestamptz,
  used_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_password_recovery_tokens_target_idx
  ON public.admin_password_recovery_tokens(target_user_id);

ALTER TABLE public.admin_password_recovery_tokens ENABLE ROW LEVEL SECURITY;

-- admin_invite_tokens와 동일 원칙(Migration #469 이후) — RLS 정책을 아예 두지 않아
-- anon/authenticated는 어떤 방식으로도 접근 불가, service_role(서버 API)만 접근 가능.
-- ("CMS 브라우저 auth 패턴")

COMMENT ON TABLE public.admin_password_recovery_tokens IS
  '관리자 계정 비밀번호 분실 복구 링크 — 이메일+휴대폰 OTP 2단계 본인확인 통과 후에만
   비밀번호 설정 가능, 발급 후 30분 고정 만료. service_role 전용.';

-- ──────────────────────────────────────────────
-- cms_admin_audit_log action_type CHECK 제약에 신규 이벤트 2종 추가
-- (Migration #353 정본 목록 확장 — name_change 추가 때와 동일 패턴)
-- ──────────────────────────────────────────────
ALTER TABLE public.cms_admin_audit_log
  DROP CONSTRAINT IF EXISTS cms_admin_audit_log_action_type_check;

ALTER TABLE public.cms_admin_audit_log
  ADD CONSTRAINT cms_admin_audit_log_action_type_check CHECK (action_type IN (
    'role_change',
    'create',
    'delete',
    'suspend',
    'menu_permission_change',
    'concurrent_login_change',
    'session_limit_change',
    'name_change',
    'password_recovery_issued',
    'password_recovery_completed'
  ));

-- rollback:
-- ALTER TABLE public.cms_admin_audit_log DROP CONSTRAINT IF EXISTS cms_admin_audit_log_action_type_check;
-- ALTER TABLE public.cms_admin_audit_log ADD CONSTRAINT cms_admin_audit_log_action_type_check
--   CHECK (action_type IN ('role_change','create','delete','suspend','menu_permission_change',
--   'concurrent_login_change','session_limit_change','name_change'));
-- DROP TABLE IF EXISTS public.admin_password_recovery_tokens;
