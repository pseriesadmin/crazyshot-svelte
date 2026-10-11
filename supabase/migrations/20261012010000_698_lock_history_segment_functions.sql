-- Migration #698: 상품 이력·고객 분류 함수 5개 서버 전용 잠금 (보안 후속, 2026-10-12 — #697 점검에서 분리해 둔 건)
--   · upsert_product_history_record / delete_product_history_record : 호출자가 사용자 ID(p_user_id)를 직접 넘겨 로그인한 누구나 임의 상품 이력을 위조·삭제할 수 있었음
--   · get_product_history / get_product_history_multi               : 로그인한 누구나 상품 이력(관리자 이메일 포함)을 조회할 수 있었음
--   · refresh_user_segments                                         : 로그인한 누구나 고객 분류 표를 비우고 재계산시킬 수 있었음
-- ⛔ 적용 순서(중요): 앱 코드(상품 이력 API·분류 새로고침 API가 서버 권한으로 호출하도록 변경)를 먼저 배포한 뒤에 Production에 적용한다.
--    코드 배포 전에 적용하면 CMS 상품 이력 화면·분류 새로고침이 멈춘다(DB 먼저 적용하는 평소 순서와 반대).
-- 앱의 다른 호출(rentalQrTransition의 upsert, 고객용 *_for_customer 함수는 auth.uid 기반)은 영향 없음.
-- 함수 본문 무변경, 권한만 조정. 없는 시그니처는 건너뛴다.
-- 롤백: GRANT EXECUTE ON FUNCTION ... TO authenticated;
DO $$
DECLARE
  sig text;
  sigs text[] := ARRAY[
    'public.upsert_product_history_record(uuid,uuid,date,jsonb,uuid)',
    'public.delete_product_history_record(uuid,uuid)',
    'public.get_product_history(uuid)',
    'public.get_product_history_multi(uuid[])',
    'public.refresh_user_segments()'
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
