-- Migration #182: user_profiles 관리자 푸시알림 수신 설정 컬럼 3종
-- 배경: CMS 전역 FCM 푸시알림 연동 (S1) — 요청 1-c "관리 계정의 예약신청·전자서명·결제 수신 설정"
--       중앙관리 방식 확정(2026-08-05): manager 이상 권한자가 CMS 설정 탭에서 전체 관리자 계정의
--       이벤트별 수신 여부를 일괄 토글 (개인 셀프서비스 화면 아님)
-- 대상: cms_role IS NOT NULL인 행에서만 의미 있음 — 일반 고객 행은 기본값 그대로 방치(무해)

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS admin_notify_new_reservation   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS admin_notify_contract_signed   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS admin_notify_payment_completed BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN user_profiles.admin_notify_new_reservation   IS '관리자 푸시: 고객 예약신청 접수 시 수신 여부 (기본: 수신)';
COMMENT ON COLUMN user_profiles.admin_notify_contract_signed   IS '관리자 푸시: 고객 전자계약 서명완료 시 수신 여부 (기본: 수신)';
COMMENT ON COLUMN user_profiles.admin_notify_payment_completed IS '관리자 푸시: 고객 결제완료 시 수신 여부 (기본: 수신)';

-- rollback:
-- ALTER TABLE user_profiles DROP COLUMN IF EXISTS admin_notify_new_reservation;
-- ALTER TABLE user_profiles DROP COLUMN IF EXISTS admin_notify_contract_signed;
-- ALTER TABLE user_profiles DROP COLUMN IF EXISTS admin_notify_payment_completed;
