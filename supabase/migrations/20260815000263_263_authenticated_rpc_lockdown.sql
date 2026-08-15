-- Migration #263: authenticated 레벨 관리자 전용 RPC 실행권한 회수 (262 후속)
--
-- 배경: Migration 262는 anon(완전 비로그인)만 차단했다. 그 마이그레이션 주석에 남긴 대로
-- authenticated(회원가입 후 로그인만 한 일반 고객 누구나)까지 회수하려면 각 함수를 실제로
-- "누가/어떤 클라이언트로" 호출하는지 하나하나 확인해야 안전하다고 판단해 별도 후속으로
-- 미뤄뒀다 — 이번 마이그레이션이 그 후속이다.
--
-- 조사 방법: 262에서 anon 차단된 함수 중 관리자 전용 성격이면서 함수 내부에 자체 권한 체크
-- (is_cms_user/is_admin 등)가 없는 80개를 코드베이스 전체(src/**/*.ts, src/**/*.svelte)에서
-- `.rpc('함수명'` 호출부를 전수 검색해 어떤 클라이언트로 호출되는지 대조했다.
--
-- 결과: 80개 전부 admin(service_role) 클라이언트 또는 pg_cron 스케줄에서만 호출되고,
-- locals.supabase(CMS 로그인 세션) 또는 브라우저 anon/authenticated 클라이언트로 직접
-- 호출하는 지점은 코드베이스 전체에서 0건이었다 — 즉 이 함수들은 애초에 authenticated
-- 권한이 전혀 필요하지 않다(설계상 service_role 전용). 함수 내부 로직을 전혀 건드리지 않고
-- authenticated 실행권한만 회수하는 것이 가장 안전한 조치다:
--   - service_role: 이 스키마의 ALTER DEFAULT PRIVILEGES가 함수 생성 시 anon·authenticated·
--     service_role 각각에 개별 ACL 항목을 자동 부여하므로, service_role 권한은 이번 REVOKE와
--     무관하게 그대로 유지된다(262에서 동일 메커니즘 확인됨).
--   - pg_cron: cron.schedule로 등록된 SQL은 postgres superuser로 실행되어 GRANT/REVOKE 대상이
--     아니다 — release_reservation_hold, auto_pending_inactive_sessions, execute_marketing_rules,
--     batch_update_search_impressions, auto_send_return_remind, run_search_reformulation_scan
--     6개가 cron 전용이며 이 REVOKE로 영향받지 않는다.
--   - /cms/set/rental 등 locals.supabase로 직접 호출하는 화면은 별도로 이미 함수 내부에
--     is_cms_user() 체크가 있음을 확인했고(262 조사 시점), 이번 80개 목록에는 포함되지 않는다.
--
-- 이번 회수 대상에 cms_update_admin_role(로그인만 한 일반 고객이 CMS 관리자 권한으로 자신을
-- 승격시킬 수 있던 권한상승 결함), soft_delete_customer/toggle_blacklist/adjust_credit_score
-- (임의 고객 계정 삭제·블랙리스트·신용점수 조작), admin_update_subscription_status(임의 구독
-- 취소), cms_create_invite_token(관리자 초대링크 임의 발급) 등이 포함된다.
--
-- stage(ezyvffjvuwmtuhpxdjrw) 적용 후 전체 vitest 스위트로 회귀 확인 → 문제 없으면
-- production(vnbpmvxruyciuuaermyh) 적용.

DO $$
DECLARE
  target_fns TEXT[] := ARRAY[
    'add_cs_reply','adjust_credit_score','admin_update_subscription_status',
    'append_subscription_image_url','auto_create_inventory_for_product',
    'auto_pending_inactive_sessions','auto_send_return_remind','batch_update_search_impressions',
    'calculate_cart_total','cancel_payment_and_release_hold','claim_subscriptions_due_for_billing',
    'cms_add_taxonomy_code','cms_create_invite_token','cms_delete_taxonomy_code',
    'cms_edit_taxonomy_code','cms_setup_admin_profile','cms_toggle_concurrent_login',
    'cms_toggle_session_limit','cms_toggle_taxonomy_active','cms_update_admin_phone',
    'cms_update_admin_role','compute_reservation_line_amount','compute_rfm_scores',
    'confirm_payment_and_update_reservation','create_asset_for_product','create_checkout_order',
    'create_user_subscription','deactivate_push_tokens','delete_product_history_record',
    'execute_marketing_rules','find_or_create_synonym_group','find_search_reformulation_pairs',
    'generate_child_product_code','generate_inventory_product_code','generate_member_code',
    'generate_product_code','generate_subscription_inventory_product_code',
    'generate_subscription_product_code','get_admin_push_recipients','get_all_cs_posts',
    'get_and_mark_unanswered_sessions','get_chat_customer_detail','get_product_history',
    'get_product_history_multi','get_promotion_analytics','get_rental_list','get_segment_stats',
    'get_segment_users','get_session_bookmarks','increment_canned_response_usage',
    'log_push_notification','log_rental_action','record_subscription_charge_result',
    'refresh_user_segments','release_reservation_hold','run_search_reformulation_scan',
    'send_rental_chat_notification','set_chat_session_manual_mode','set_chat_session_status',
    'soft_delete_customer','toggle_blacklist','toggle_message_bookmark',
    'update_admin_notify_setting','update_asset_device_code','update_credit_score',
    'update_cs_post_status','update_customer_info','update_product_shipping_options',
    'update_reservation_status','upsert_product_history_record','upsert_product_option_links',
    'upsert_synonym_member'
  ];
  fn RECORD;
  revoked_count INT := 0;
  missing TEXT[] := '{}';
  found_names TEXT[] := '{}';
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname = ANY(target_fns)
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, authenticated', fn.oid::regprocedure);
    revoked_count := revoked_count + 1;
    found_names := array_append(found_names, fn.proname);
  END LOOP;

  -- 목록에는 있으나 이번 조회에서 못 찾은 함수명(오버로드·오탈자 등) 감지용 — 조용히 넘어가지 않는다.
  SELECT array_agg(t) INTO missing
  FROM unnest(target_fns) t
  WHERE t <> ALL(found_names);

  RAISE NOTICE '% / % functions revoked from authenticated', revoked_count, array_length(target_fns, 1);
  IF missing IS NOT NULL THEN
    RAISE WARNING 'target_fns 중 실제 조회 안 된 함수(오버로드/오탈자 확인 필요): %', missing;
  END IF;
END $$;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- 이 마이그레이션은 authenticated EXECUTE만 회수했으므로 되돌리려면 개별 함수에 다시 GRANT:
-- GRANT EXECUTE ON FUNCTION public.<함수명>(<인자타입>) TO authenticated;
-- (대상 함수 목록은 위 target_fns 배열 그대로 사용)
-- ============================================================
