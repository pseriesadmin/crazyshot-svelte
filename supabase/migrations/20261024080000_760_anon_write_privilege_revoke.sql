-- Migration #760: 비로그인(anon) 쓰기·TRUNCATE 권한 회수 + 임시 백업 표 보호 (2026-10-24 권한 감사, Stephen 지시 "2번과 백업 표 보호부터 Stage")
--
-- 배경(운영·Stage 실측): anon 역할이 public 스키마 표 약 100개에 INSERT·UPDATE·DELETE·TRUNCATE 권한을 갖고, authenticated 도 약 100개 표에 TRUNCATE 를 갖는다.
--       실제 쓰기 통제는 행 단위 보안(RLS) 정책이 하며 현재 정책은 anon 쓰기를 모두 막는다(전부 auth.uid()/is_cms_user()/false 조건). 그러나 TRUNCATE·REFERENCES·TRIGGER 는 RLS 가 적용되지 않는 권한이고,
--       정책이 한 번이라도 잘못 열리면 anon 쓰기가 바로 뚫리는 구조였다(#759 user_profiles 사고가 같은 계열). 임시 백업 표 2개(_migration_500_*)는 RLS 가 꺼져 비로그인이 읽고 쓰고 지울 수 있었다.
-- 변경:
--   ① public 모든 표에서 anon 의 INSERT·UPDATE·DELETE·TRUNCATE·REFERENCES·TRIGGER 회수(SELECT 는 유지 — 공개 조회는 RLS 정책이 통제)
--   ② public 모든 표에서 authenticated 의 TRUNCATE·REFERENCES·TRIGGER 회수(INSERT/UPDATE/DELETE 는 RLS 정책이 통제하므로 유지)
--   ③ 백업 표 2개: RLS 활성화 + anon·authenticated 모든 권한 회수(서버 service_role 은 RLS 우회)
--   ④ 비로그인이 실행할 필요가 없는 쓰기 계열 SECURITY DEFINER 함수: PUBLIC·anon 실행 권한 회수, authenticated·service_role 만 허용
-- 영향 없음 확인: 익명 로그인(signInAnonymously)은 authenticated 역할이라 영향 없음. ④ 대상은 전부 본문에서 auth.uid() 또는 관리자 확인을 하는 함수라 진짜 비로그인(세션 없음)은 원래 실패했다.
--       제외(anon 유지): 로그인 전에 쓰는 조회·분석 함수(check_email_registered·check_phone_registered·get_*·search_*·track_behavior_event·record_search_click 등)와 트리거 함수.
--       서버(service_role)·RLS 정책·기존 로그인 사용자 동작은 변경 없음.

DO $$
DECLARE
  r record;
BEGIN
  -- ① ② 표 권한
  FOR r IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon', r.relname);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', r.relname);
  END LOOP;

  -- ③ 임시 백업 표(존재할 때만)
  FOR r IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN ('_migration_500_backup_settings', '_migration_500_backup_theme_groups')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', r.relname);
  END LOOP;

  -- ④ 쓰기 계열 함수(모든 오버로드)
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.prosecdef AND p.proname = ANY (ARRAY[
      'add_shipping_address','create_draft_reservation','create_hold_reservation','create_post_comment','create_product_review','create_user_post',
      'delete_own_post','delete_shipping_address','delete_user_doc','ensure_user_profile','process_payment_and_create_order','set_default_shipping_address',
      'set_reservation_duration','set_reservation_shipment_method','submit_cs_post','sync_checkout_to_profile','toggle_product_wishlist','update_notification_settings',
      'update_user_avatar','update_user_consent','update_user_doc_url','update_user_post','update_user_profile',
      'cms_approve_chat_reply_candidate','cms_create_banner','cms_create_coupon','cms_create_hype_pack_theme_group','cms_create_marketing_rule','cms_create_theme_group',
      'cms_delete_canned_response','cms_delete_hype_pack_theme_group','cms_delete_marketing_rule','cms_delete_synonym_candidate','cms_delete_theme_group',
      'cms_promote_synonym_candidate','cms_reject_chat_reply_candidate','cms_reject_synonym_candidate','cms_set_default_signature_asset','cms_toggle_marketing_rule',
      'cms_update_banner','cms_update_coupon','cms_update_hype_pack_theme_group','cms_update_theme_group',
      'delete_delivery_fee_discount_tier','toggle_rental_method_delivery_type','upsert_rental_policy_settings'
    ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

-- ROLLBACK(필요 시): 표는 GRANT INSERT, UPDATE, DELETE ON <표> TO anon 등으로 개별 복원, 함수는 GRANT EXECUTE ON FUNCTION <함수> TO anon.
--   백업 표 2개는 임시 마이그레이션 백업이라 RLS 해제를 되돌릴 이유가 없다.
