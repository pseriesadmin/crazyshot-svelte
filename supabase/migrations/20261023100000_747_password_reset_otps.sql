-- Migration 747 — 비밀번호 재설정(문자 인증번호 방식) 인증번호 테이블 (2026-10-23)
--
-- 배경: 메일 발송형 재설정은 Supabase 내장 메일의 발송 제한(429)·링크 1회용 소진·브라우저 불일치 문제로 고객에게 안정적으로 전달되지 않는다.
--       휴대폰 문자 인증번호 방식으로 교체한다(이메일 + 휴대폰 번호가 같은 계정과 일치할 때만 발송 → 인증번호 확인 → 새 비밀번호 설정).
-- 보안:
--   · 인증번호는 원문이 아니라 해시(code_hash = sha256(id:code))로만 저장한다.
--   · 서버 전용 테이블 — RLS 활성화 + 정책 0건, anon/authenticated 권한 없음, service_role만 접근.
--   · 틀린 입력 5회(attempt_count)·유효시간 3분(expires_at)·인증 후 10분 안에만 비밀번호 설정 가능(서버가 verified_at 기준 확인)·1회용(used_at).
-- 새 테이블 GRANT 규칙(security-auth.md): 같은 파일에서 service_role 권한을 명시한다.

CREATE TABLE IF NOT EXISTS public.password_reset_otps (
  id            uuid        PRIMARY KEY,
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone         text        NOT NULL,
  code_hash     text        NOT NULL,
  attempt_count integer     NOT NULL DEFAULT 0,
  expires_at    timestamptz NOT NULL,
  verified_at   timestamptz,
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_otps_phone_created_idx ON public.password_reset_otps (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS password_reset_otps_user_idx ON public.password_reset_otps (user_id);

ALTER TABLE public.password_reset_otps ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.password_reset_otps FROM PUBLIC;
REVOKE ALL ON public.password_reset_otps FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.password_reset_otps TO service_role;

COMMENT ON TABLE public.password_reset_otps IS '비밀번호 재설정 문자 인증번호(해시 저장) — 서버 전용, 3분 유효·5회 시도·1회용';
