-- Migration #377: verify_and_update_phone — anon 실행권한 명시적 REVOKE
--
-- 배경: Migration #370(탈퇴 유예기간 휴대폰 충돌 체크 추가) 작업 중 verify_and_update_phone의
-- 실행권한(proacl)에 anon이 포함돼 있음을 발견(Stage·Production 공통). CREATE OR REPLACE는
-- 기존 ACL을 보존하는 Postgres 특성상 #370도 이 상태를 그대로 물려받았을 뿐, 새로 만든 구멍은
-- 아니었다 — 원본 Migration #132(profile_edit_phone_otp)부터 REVOKE가 없었던 것으로 추정.
--
-- 함수 내부에 auth.uid() IS NULL 가드가 있어 비로그인(anon) 호출은 즉시
-- {ok:false, error:'로그인이 필요합니다.'}만 반환하고 phone_otps·user_profiles 어느 쪽도
-- 건드리지 않으므로 즉각적인 데이터 노출 위험은 없었으나, 이 프로젝트가 다른 모든 RPC에
-- 적용해온 "명시적 REVOKE ALL FROM PUBLIC,anon,authenticated 후 필요한 role만 GRANT" 원칙과
-- 어긋나 Stephen 요청으로 정리한다.
--
-- 함수 본문(로직)은 전혀 건드리지 않는다 — 순수 권한(GRANT/REVOKE)만 변경.
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot production(vnbpmvxruyciuuaermyh)
-- 2026-08-29

REVOKE ALL ON FUNCTION verify_and_update_phone(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_and_update_phone(TEXT, TEXT) TO authenticated;
