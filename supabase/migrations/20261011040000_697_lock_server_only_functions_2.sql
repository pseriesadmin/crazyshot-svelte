-- Migration #697: 서버 전용 DB 함수 3개 추가 잠금 (보안 후속, 2026-10-11 — #696의 전수 점검에서 발견)
--   · confirm_payment(bigint,text,jsonb)         : 로그인한 누구나 임의 주문을 '결제 완료'로 바꿀 수 있었음(앱 호출 0건, 구버전 함수)
--   · append_product_image_url(uuid,text)        : 로그인한 누구나 임의 상품에 이미지 주소를 추가할 수 있었음(호출처는 서버 업로드 API의 service_role 뿐)
--   · auto_distribute_eligible_coupons()         : 로그인한 누구나 자동배포 쿠폰 배포를 앞당길 수 있었음(호출처는 pg_cron 뿐 — postgres 권한으로 실행되어 영향 없음)
-- 함수 본문은 변경하지 않고 권한만 조정한다. 없는 시그니처는 건너뛴다.
-- ⚠️ 같은 점검에서 발견했지만 이 마이그레이션에서 잠그지 않은 것: 앱이 로그인 사용자 세션(locals.supabase)으로 호출 중이라 코드 변경이 먼저 필요한 함수
--    (upsert/delete_product_history_record, get_product_history(_multi), refresh_user_segments) — 별도 태스크.
-- 롤백: GRANT EXECUTE ON FUNCTION ... TO authenticated;
DO $$
DECLARE
  sig text;
  sigs text[] := ARRAY[
    'public.confirm_payment(bigint,text,jsonb)',
    'public.append_product_image_url(uuid,text)',
    'public.auto_distribute_eligible_coupons()'
  ];
BEGIN
  FOREACH sig IN ARRAY sigs LOOP
    IF to_regprocedure(sig) IS NULL THEN
      RAISE NOTICE '건너뜀(없는 함수): %', sig;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
  END LOOP;
END $$;
