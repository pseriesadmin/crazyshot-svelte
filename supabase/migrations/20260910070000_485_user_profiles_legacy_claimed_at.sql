-- Migration 485: user_profiles.legacy_claimed_at 신설 — 클레임 완료 마커
--
-- 배경: Migration 484의 find_legacy_member()가 "이미 클레임된 계정인지"를
-- auth.users.encrypted_password IS NULL/'' 로 판정하도록 설계됐으나, 실측 결과
-- admin.auth.admin.createUser({ email, email_confirm:true })는 비밀번호를 지정하지
-- 않아도 GoTrue가 임의의 bcrypt 해시를 즉시 채워넣는다(NULL/빈 문자열이 되지 않음) —
-- 즉 이 판정 기준으로는 방금 선등록된 미인증 계정도 "이미 클레임됨"으로 오판되어
-- 클레임 흐름이 원천적으로 동작하지 않는 치명적 결함이었다(TDD 라이브 통합테스트로
-- Stage에서 직접 재현·확인).
--
-- 해결: encrypted_password에 의존하지 않는 전용 마커 컬럼을 추가한다.
--   legacy_imported_at IS NOT NULL AND legacy_claimed_at IS NULL → 미인증(클레임 가능)
--   legacy_imported_at IS NOT NULL AND legacy_claimed_at IS NOT NULL → 인증 완료

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS legacy_claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN user_profiles.legacy_claimed_at IS
  '레거시 계정이 실제로 인증 클레임을 완료한 시각. NULL이면 아직 미인증(클레임 가능).
   auth.users.encrypted_password는 비밀번호 미지정 생성 시에도 GoTrue가 임의 해시를
   채우므로 클레임 여부 판정에 절대 쓰지 않는다(Migration 484의 결함, 이 컬럼으로 대체).';
