-- Migration #364: get_customer_list() anon/authenticated EXECUTE 노출 긴급 차단 (CRITICAL)
-- 배경: Migration 261에서 이 함수는 원래 anon 키로 직접 호출 가능한 상태(고객 이메일·전화번호·
-- 본인증명 문서 URL·블랙리스트 사유 등 PII 전체 노출)로 방치돼 있던 것을 발견해
-- REVOKE ALL ... FROM PUBLIC, anon, authenticated + GRANT EXECUTE ... TO service_role로 잠갔다.
--
-- Migration 361이 identity_doc_url/identity_type 반환 타입을 배열로 바꾸기 위해 이 함수를
-- DROP FUNCTION 후 CREATE FUNCTION으로 재생성했는데(반환 타입 변경은 CREATE OR REPLACE 불가),
-- 재생성 시 GRANT EXECUTE ... TO service_role만 다시 넣고 REVOKE ALL ... FROM PUBLIC를
-- 재적용하지 않았다 — Postgres는 함수가 새로 생성되면 기본적으로 PUBLIC에 EXECUTE 권한을
-- 부여하므로, 이 누락으로 261의 REVOKE가 통째로 초기화되며 정확히 동일한 PII 노출이 재발했다
-- (2026-08-27 @sp3-qa-agent 검수로 Stage에서 curl 직접 재현·발견, proacl 조회로 확인).
--
-- 이 마이그레이션은 261과 동일한 REVOKE/GRANT를 다시 적용한다. SELECT 로직·반환 타입은
-- 무변경 — 순수 권한 원복.

REVOKE ALL ON FUNCTION get_customer_list(integer, integer, text, text, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_customer_list(integer, integer, text, text, boolean, uuid) TO service_role;

COMMENT ON FUNCTION get_customer_list(integer, integer, text, text, boolean, uuid) IS
  'CMS 고객 목록/상세 조회. service_role 전용 — anon/authenticated/PUBLIC 실행 권한 없음
   (migration 261 정책, migration 361의 DROP+CREATE로 유실됐다가 364로 원복).
   identity_doc_url·identity_type은 배열(TEXT[]) 그대로 반환(migration 361).
   foreign_doc_urls·foreign_type·foreign_stay_type 포함(migration 360).';
