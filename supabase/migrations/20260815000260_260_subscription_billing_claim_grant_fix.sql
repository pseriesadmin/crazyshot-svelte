-- Migration #260: 긴급 보안수정 — claim_subscriptions_due_for_billing/record_subscription_charge_result
-- anon·authenticated 실행권한 노출 차단
--
-- 배경: Migration 259 배포 직후 get_advisors(security)로 발견 — 이 프로젝트의 public 스키마에
--       `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon, authenticated,
--       service_role` 가 이미 설정돼 있어(pg_default_acl 확인), 신규 함수는 생성 즉시
--       anon/authenticated에게도 자동으로 EXECUTE 권한이 부여된다. Migration 259의
--       `REVOKE ALL ... FROM PUBLIC`은 PUBLIC 슈도롤에서만 회수할 뿐, default privilege로
--       개별 부여된 anon/authenticated 권한은 회수하지 못해 의도("service_role 전용")와
--       달리 두 함수 모두 anon 키로 `/rest/v1/rpc/...` 호출이 실제로 가능한 상태였다.
--       claim_subscriptions_due_for_billing은 billing_key(토스 빌링키)를 응답에 포함하고
--       실제로 구독을 선점(잠금)하는 쓰기 작업이며, record_subscription_charge_result는
--       임의 user_subscription_id에 대해 결제 성공/실패를 조작할 수 있어 둘 다 익명 접근이
--       가능하면 심각한 결제 위변조·정보유출 위험이다.
--
-- 조치: 두 함수 모두 anon·authenticated·PUBLIC에서 명시적으로 EXECUTE 회수, service_role만 유지.
--       (create_user_subscription / generate_subscription_product_code /
--       generate_subscription_inventory_product_code 등 동일 패턴의 기존 함수는 이번 마이그레이션
--       범위 밖 — Migration 224/241에서 이미 배포된 별도 세션 산출물이라 이번 세션에서 임의로
--       변경하지 않고 Stephen에게 별도 확인 후 진행)
--
-- stage(ezyvffjvuwmtuhpxdjrw) 우선 적용 → production(vnbpmvxruyciuuaermyh)은 동일 세션 내 Stephen
-- 승인(마이그레이션 259 적용 승인 연장선 — 259가 만든 노출을 즉시 닫는 교정) 즉시 적용.

REVOKE ALL ON FUNCTION public.claim_subscriptions_due_for_billing(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_subscriptions_due_for_billing(INTEGER, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.record_subscription_charge_result(BIGINT, TEXT, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_subscription_charge_result(BIGINT, TEXT, INTEGER, JSONB) TO service_role;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- GRANT EXECUTE ON FUNCTION public.claim_subscriptions_due_for_billing(INTEGER, INTEGER) TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.record_subscription_charge_result(BIGINT, TEXT, INTEGER, JSONB) TO anon, authenticated;
-- ============================================================
