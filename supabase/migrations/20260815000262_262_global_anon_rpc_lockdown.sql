-- Migration #262: 전체 함수 anon 실행권한 긴급 점검 및 차단
--
-- 배경: Stephen 요청 — 이번 세션에서 두 차례(구독 결제 RPC, 고객목록 RPC) 발견한
-- "SECURITY DEFINER 함수가 anon 키로 직접 호출 가능" 패턴이 프로젝트 전역에 얼마나 더
-- 있는지 전수 점검. 원인은 이 프로젝트 public 스키마의 `ALTER DEFAULT PRIVILEGES`가
-- anon·authenticated·service_role 전부에 신규 함수 EXECUTE를 자동 부여하도록 설정돼 있어,
-- 명시적으로 REVOKE하지 않은 모든 함수가 기본적으로 익명 호출 가능한 상태였다.
--
-- 조사 결과: public 스키마 SECURITY DEFINER 함수 172개 중 142개가 anon 실행 가능.
-- 코드베이스 전체 `.rpc(` 호출부(129곳)를 실제로 대조해 아래와 같이 분류했다:
--   ① RLS 정책 predicate로 쓰이는 함수(is_admin/is_cms_user/is_cms_admin) — anon 접근 필수(RLS 자체가 깨짐)
--   ② 트리거 전용 함수 — 트리거 발동은 EXECUTE 권한과 무관, 원칙상 안전하나 보수적으로 미변경
--   ③ 실제로 비로그인 방문자·게스트 세션(anon 키 또는 이제 막 발급된 세션)이 호출하는 화면
--      (상품 목록·검색·상세, 크레이지로그, 리뷰, 예약 생성, 위시리스트, 프로필/배송지 등)
--      — 명확히 anon 접근이 의도된 대상, 미변경
--   ④ 위 어디에도 속하지 않고 코드베이스 전체에서 admin/service-role 클라이언트로만 호출되거나
--      호출부 자체가 전혀 없는 함수(내부 함수간 호출 또는 죽은 코드로 추정) — 이번 마이그레이션의
--      차단 대상. CMS 관리자 전용 기능(고객 삭제·블랙리스트·포인트지급·쿠폰·구독관리·상품코드
--      발급·대여현황·프로모션 통계 등)과 결제 관련 RPC 다수가 여기 포함됨.
--
-- ⚠️ 범위를 anon 롤로만 한정했다 — authenticated 권한은 이번 마이그레이션에서 건드리지 않는다.
-- 이유: `/cms/set/rental` 등 일부 CMS 화면이 admin(service-role) 대신 locals.supabase(로그인한
-- 사용자의 authenticated 세션)로 RPC를 직접 호출하는 걸 확인했다 — authenticated까지 회수하면
-- 그 화면들이 즉시 깨진다. 이 함수들의 내부 권한 검증 로직(is_cms_user() 등 자체 체크 여부)을
-- 하나하나 확인하지 않고서는 authenticated 회수가 안전한지 판단할 수 없어 별도 후속 검토로
-- 분리했다 — 이번 마이그레이션은 "완전 비로그인 익명 접근" 차단에만 집중한다.
--
-- stage(ezyvffjvuwmtuhpxdjrw) 적용 후 전체 vitest 스위트로 회귀 확인 → 문제 없으면
-- production(vnbpmvxruyciuuaermyh) 적용.

DO $$
DECLARE
  allowlist TEXT[] := ARRAY[
    'is_admin','is_cms_user','is_cms_admin',
    'auto_assign_member_code','handle_new_user','prevent_member_code_nullification',
    'prevent_product_code_nullification','sync_price_rules_to_children','update_chat_session_timestamp',
    'sync_checkout_to_profile','create_post_comment','get_product_history_for_customer','get_crazylog_content_stats',
    'search_products','get_products_by_ids','get_crazylog_posts_by_ids','search_crazylog_posts',
    'get_product_reviews','record_search_click','get_user_post_stats','create_product_review',
    'create_draft_reservation','set_reservation_options','create_hold_reservation','set_reservation_shipment_method',
    'set_reservation_duration','promote_draft_reservation','update_user_post','create_user_post','delete_own_post',
    'get_user_wishlists','update_user_consent','submit_cs_post','add_shipping_address','delete_shipping_address',
    'update_user_profile','verify_and_update_phone','set_default_shipping_address','update_user_avatar',
    'update_user_doc_url','toggle_product_wishlist','update_notification_settings','track_behavior_event',
    'ensure_user_profile','get_product_page_settings','get_product_option_links','get_crazylog_banner_settings',
    'process_payment_and_create_order','get_user_rental_stats','get_active_categories','get_active_rentals'
  ];
  fn RECORD;
  revoked_count INT := 0;
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname <> ALL(allowlist)
  LOOP
    -- 오래된 함수는 anon 개별 권한이 아니라 PUBLIC(=X) 기본권한으로 노출된 경우가 많아
    -- FROM anon만으로는 회수되지 않음(REVOKE가 조용히 no-op으로 실패) — PUBLIC도 함께 회수해야
    -- 실제로 막힌다(사전 조사: proacl 확인 결과 79개 후보 전부 service_role은 별도 명시적
    -- GRANT 항목을 가지고 있어 PUBLIC 회수의 영향을 받지 않음 — service_role 안전).
    -- authenticated는 79개 중 9개가 별도 항목 없이 PUBLIC에만 의존하고 있어, PUBLIC을 회수하면
    -- 그 9개는 authenticated 접근권한까지 같이 사라진다 — 이번 마이그레이션은 authenticated를
    -- 절대 건드리지 않는다는 원칙이므로, 매번 명시적으로 TO authenticated를 재부여해 원래
    -- 접근 수준을 항상 보존한다(있던 걸 그대로 유지 — 새로 권한을 넓히는 것 아님).
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn.oid::regprocedure);
    revoked_count := revoked_count + 1;
  END LOOP;
  RAISE NOTICE '% functions revoked from anon', revoked_count;
END $$;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- 이 마이그레이션은 anon EXECUTE만 회수했으므로 되돌리려면 개별 함수에 다시 GRANT:
-- GRANT EXECUTE ON FUNCTION public.<함수명>(<인자타입>) TO anon;
-- (일괄 복원 스크립트가 필요하면 이 마이그레이션 적용 직전 anon_exec=true였던 함수 목록을
--  아래 조사 결과 주석에서 그대로 사용할 것 — 별도 백업 테이블 생성하지 않음)
-- ============================================================
