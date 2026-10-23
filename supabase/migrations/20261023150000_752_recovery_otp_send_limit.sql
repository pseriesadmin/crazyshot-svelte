-- Migration #752: 관리자 비밀번호 복구 링크 — 인증번호 재발송 제한 + 인증번호 해시 저장 전환
--
-- 배경(2026-10-23 정밀검증): 복구 링크의 휴대폰 인증번호가 ① DB에 원문 그대로 저장되고 ② 재발송에 간격·횟수 제한이 없어
-- 링크를 가진 사람이 문자를 반복 발송시킬 수 있었다(문자 비용·스팸).
--
-- 변경:
--   · otp_sent_at     : 마지막 인증번호 발송 시각(재발송 최소 간격 판정)
--   · otp_send_count  : 이 링크로 인증번호를 발송한 누적 횟수(링크당 상한 판정)
--   · otp_code        : 이제 인증번호 원문이 아니라 서버 비밀키로 만든 해시를 저장한다(앱 코드 변경, 컬럼 타입 무변경).
--                       이 마이그레이션 시점에 남아 있는 원문 값은 모두 비운다(링크 유효시간 30분이라 영향 없음 — 재요청하면 됨).
-- 테이블은 기존 그대로 service_role 전용(RLS 정책 없음) — 권한 변경 없음.

ALTER TABLE public.admin_password_recovery_tokens
  ADD COLUMN IF NOT EXISTS otp_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS otp_send_count integer NOT NULL DEFAULT 0;

UPDATE public.admin_password_recovery_tokens
   SET otp_code = NULL, otp_expires_at = NULL
 WHERE otp_code IS NOT NULL;

COMMENT ON COLUMN public.admin_password_recovery_tokens.otp_code IS
  '휴대폰 인증번호의 HMAC-SHA256 해시(원문 저장 금지) — 서버 코드(recoveryOtp.ts)만 생성·비교';

-- rollback:
-- ALTER TABLE public.admin_password_recovery_tokens DROP COLUMN IF EXISTS otp_sent_at, DROP COLUMN IF EXISTS otp_send_count;
