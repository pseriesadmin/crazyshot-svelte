-- Migration #362: user_profiles.identity_type CHECK 제약조건에 'enrollment' 누락 수정
-- 배경: migration 359가 update_user_doc_url() RPC 내부의 identity_type 화이트리스트에는
-- 'enrollment'(재학증명서)를 추가했으나, 실제 테이블 CHECK 제약조건
-- (user_profiles_identity_type_check)은 갱신하지 않고 예전 값 그대로 남겨뒀다. 그 결과
-- RPC 내부 검증은 통과해도 UPDATE 문 실행 시 이 CHECK 제약에 걸려 23514 에러가 발생한다.
--
-- 실제 영향: /account?tab=profile 본인증명 탭에서 "학생증+재학증명서"는 프론트 UI
-- (validateIdentityPairing, ProfileTabContent.svelte)가 반드시 함께 선택하도록 강제하는
-- 필수 조합인데, 이 조합을 실제로 등록 제출하면 DB 에러로 실패한다 — 2026-08-27 CMS 본인증명
-- 노출 검증 작업 중 부수적으로 발견(Stage·Production 둘 다 동일하게 재현 확인).

ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_identity_type_check;

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_identity_type_check
  CHECK (
    identity_type IS NULL
    OR identity_type <@ ARRAY['general', 'student', 'enrollment', 'resident', 'resident_copy', 'driver', 'other']::text[]
  );
