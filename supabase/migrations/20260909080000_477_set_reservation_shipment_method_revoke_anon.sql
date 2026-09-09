-- Migration 477: set_reservation_shipment_method(9-param) anon 실행권한 회귀 수정
--
-- 배경(2026-09-09, sp3-qa-agent 검수로 발견): Migration 476이 DROP FUNCTION 후 새
-- 9-param 시그니처로 CREATE OR REPLACE했는데, 이 프로젝트의 ALTER DEFAULT PRIVILEGES가
-- 신규 함수 생성 시 anon/PUBLIC에 EXECUTE를 자동 부여하는 설정이라(Migration 262/263
-- 코멘트 참고), Migration 262가 명시적으로 REVOKE했던 이 함수의 anon 접근이 새 함수
-- 객체 생성과 함께 조용히 되돌아갔다. Migration 434의 동일 케이스 선례(7-param 확장 시
-- GRANT 재부여)를 따라 재보호.
--
-- 실피해 위험은 낮았음(함수 본문 WHERE user_id = auth.uid()가 유일 방어선이나 anon
-- 세션은 auth.uid() NULL이라 0-row UPDATE로 끝남, 실제 데이터 유출·변조 불가) — 그래도
-- 심층방어(defense-in-depth) 원칙상 원복. curl로 재검증: 적용 전 anon 호출 204(0-row
-- 성공) → 적용 후 401 permission denied로 정상 차단 확인(Stage+Production 둘 다).

REVOKE EXECUTE ON FUNCTION public.set_reservation_shipment_method(
  bigint, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_reservation_shipment_method(
  bigint, text, text, text, text, text, text, text, text
) TO authenticated, service_role;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- GRANT EXECUTE ON FUNCTION public.set_reservation_shipment_method(
--   bigint, text, text, text, text, text, text, text, text
-- ) TO PUBLIC, anon;
-- ============================================================
