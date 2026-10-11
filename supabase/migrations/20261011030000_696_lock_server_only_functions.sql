-- Migration #696: 서버 전용 DB 함수 6개 실행 권한 잠금 (보안, 2026-10-11)
-- 발견: 아래 함수들은 호출자 확인 코드가 없는 SECURITY DEFINER인데 anon·authenticated에 EXECUTE가 직접 부여돼 있어
--       공개 앱 키만으로 누구나 호출할 수 있었다(REVOKE FROM PUBLIC만으로는 Supabase 기본 직접 부여가 남는다 — service-operations.md §23).
--   · send_rental_chat_notification : 임의 예약 번호의 고객 채팅에 관리자 명의 알림 카드(버튼 링크 action_url 포함)를 넣을 수 있음
--   · get_active_rentals            : 고객 이름·이메일·전화번호·예약·결제 금액을 반환(앱 호출 0건)
--   · cms_update_admin_name         : 임의 계정의 이름 변경
--   · cms_set_menu_permission       : 임의 관리자의 메뉴 권한 행 기록(차단 방향 변조 가능)
--   · cms_get_menu_permissions      : 관리자 메뉴 권한 조회
--   · reassign_product_code_series  : 상품 품번 체계 재할당
-- 앱 코드의 호출은 전부 서버 admin(service_role) 클라이언트라 기능 영향 없음(전수 grep 확인).
-- 함수 본문은 변경하지 않고 권한만 조정한다. 존재하지 않는 시그니처는 건너뛴다(환경 차이 방어).
-- 롤백: GRANT EXECUTE ON FUNCTION ... TO anon, authenticated;

DO $$
DECLARE
  sig text;
  sigs text[] := ARRAY[
    'public.send_rental_chat_notification(bigint,text,text)',
    'public.get_active_rentals(integer,text,text,integer)',
    'public.cms_update_admin_name(uuid,text)',
    'public.cms_set_menu_permission(uuid,text,boolean,uuid)',
    'public.cms_get_menu_permissions(uuid)',
    'public.reassign_product_code_series(uuid,text,uuid,text,integer,integer,text)'
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
