-- Migration 503: compute_reservation_line_amount — 권한 재하드닝 (CRITICAL, sp3-qa-agent 발견)
--
-- 배경: Migration #501에서 compute_reservation_line_amount(bigint)의 반환 타입을
-- 3컬럼→4컬럼(holiday_extra_fee 추가)으로 바꾸기 위해 DROP FUNCTION IF EXISTS 후
-- CREATE OR REPLACE를 실행했다. 이 함수는 인자 시그니처(bigint)가 그대로였으므로 DROP이
-- 실제로 기존 객체(및 그 객체에 걸려 있던 ACL)를 삭제했고, 새로 생성된 함수는 이 프로젝트
-- 스키마의 기본 권한(PUBLIC/anon/authenticated 자동 EXECUTE 부여)을 그대로 물려받았다.
--
-- 이 함수는 auth.uid() 검사가 전혀 없이 p_reservation_id만으로 그 예약의 rental_fee/
-- options_fee/deposit/holiday_extra_fee를 반환한다 — 과거 Migration #251b·#263에서
-- "anon이 이 함수를 직접 호출해 남의 예약 금액을 조회할 수 있었다"는 동일한 이유로 이미
-- 두 차례 service_role 전용으로 하드닝됐던 이력이 있다(create_checkout_order 관련
-- 감사에서 발견). 이번에 그 하드닝이 DROP으로 인해 초기화된 것 — sp3-qa-agent가 Stage에
-- 실제 anon key로 직접 호출해 재현 확인(POST .../rpc/compute_reservation_line_amount
-- {"p_reservation_id":15818} → 200 OK, 타인 예약 금액 그대로 반환됨).
--
-- 유일한 정상 호출부(src/routes/account/rental/[id]/+page.server.ts)는 이미 admin
-- (service_role) 클라이언트를 사용하므로 authenticated/anon 권한이 애초에 필요 없다.

REVOKE ALL ON FUNCTION public.compute_reservation_line_amount(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_reservation_line_amount(bigint) TO service_role;

-- ============================================================
-- 예방 조치(sp3-qa-agent MEDIUM 권고 반영) — 같은 마이그레이션에서 DROP+CREATE된
-- create_hold_reservation/promote_draft_reservation은 이번엔 인자 시그니처가 3-param→
-- 5-param으로 바뀌어 있었기 때문에(8일 전 다른 세션이 이미 5-param으로 바꿔둔 상태) DROP
-- FUNCTION ...(uuid,date,date)/( bigint,date,date) 대상이 이미 존재하지 않아 no-op이었고,
-- 뒤이은 CREATE OR REPLACE가 기존 5-param 객체를 "교체"만 해 기존 ACL이 그대로 보존됐다
-- (Stage 직접 조회로 확인 — 의도 훼손 없음). 다만 향후 동일 함수가 다시 DROP+CREATE될
-- 가능성에 대비해, 두 함수의 "의도된" 권한을 이번 기회에 명시적으로 고정해둔다(현재
-- 상태를 그대로 재확인·재부여하는 것뿐 — 접근범위 변경 없음):
--   create_hold_reservation   : anon+authenticated 허용(자기 자신 auth.uid() 기준으로만
--     동작하는 자기완결형 함수 — Migration #262 원 설계 그대로 유지)
--   promote_draft_reservation : authenticated 전용(anon 불허 — 기존 상태 그대로 유지)
-- ============================================================
REVOKE ALL ON FUNCTION public.create_hold_reservation(uuid, date, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_hold_reservation(uuid, date, date, text, text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.promote_draft_reservation(bigint, date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_draft_reservation(bigint, date, date, text, text) TO authenticated, service_role;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- GRANT EXECUTE ON FUNCTION public.compute_reservation_line_amount(bigint) TO PUBLIC, anon, authenticated, service_role;
-- (다른 두 함수는 원래도 이 상태였으므로 롤백 대상 아님)
-- ============================================================
