-- Migration #772: 두발히어로 연동 전용 스위치 분리 — rental_method_options.is_dhero_integration (2026-10-27, Stephen 지시, 4번 작업 ⓪단계)
--
-- 배경: 두발히어로 연동 대상 판정(src/lib/server/isBulkDeliveryMethod.ts)이 장바구니 "요청 A"(배송 수령 시 반납방식 고정·시간선택 숨김) 전용 스위치
--   is_bulk_delivery(Migration #339)를 재사용해, 스위치 하나가 장바구니 UX 와 두발히어로 새 접수·반품 접수·주소 사전 확인을 동시에 제어했다.
--   장바구니 쪽을 만지다 두발히어로 연동이 따라 켜지고 꺼지는 구조였고(운영은 현재 전 방식 꺼짐), CMS 라벨도 "대여옵션(수령/반납) 일괄적용"이라 연동과 연결되지 않았다.
-- 변경: 연동 전용 컬럼 + 켜고 끄는 함수를 신설한다. 장바구니 스위치(is_bulk_delivery)·휴무일(is_courier_dependent)·배송형(is_delivery_type)은 그대로다.
-- ⛔ 초기값은 전부 false 이고 기존 is_bulk_delivery 값을 복사하지 않는다 — 적용 순간 연동(실제 외부 호출)이 켜지는 사고를 막는다. 켜기는 CMS "설정 > 대여관리 > 배송송출연동 관리 > 두발히어로 연동"(배송형 방식 칩만 표시)에서 의식적으로 한다.
-- 권한: 함수는 매니저 이상(is_cms_manager_or_above)만 호출할 수 있다(기존 형제 토글의 is_cms_user 보다 엄격 — 외부 연동 스위치라 파트너 직접 호출을 막는다).
--       anon 실행 불가, authenticated(세션 확인은 함수 내부), service_role 은 기본 권한 유지.
-- 범위 참고: 이 스위치가 제어하는 것은 새 배송 접수·반품 접수·장바구니 주소 사전 확인뿐이다. 이미 운송장(bookId)이 저장된 예약의 배송 취소·상태 동기화(크론)·상태 조회는 스위치와 무관하게 계속된다.
-- 롤백: 코드를 먼저 되돌린 뒤(설정 화면 load 가 이 컬럼을 select 하므로 컬럼을 먼저 지우면 방식 목록이 빈다) DROP FUNCTION public.toggle_rental_method_dhero_integration(UUID); ALTER TABLE rental_method_options DROP COLUMN is_dhero_integration;
--       (판정 유틸은 컬럼이 없으면 연동 꺼짐으로 판정하므로 연동 호출 쪽은 안전하다)

ALTER TABLE rental_method_options
  ADD COLUMN IF NOT EXISTS is_dhero_integration BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN rental_method_options.is_dhero_integration IS
  '두발히어로 연동 대상 방식(수령방식 기준 새 배송 접수, 반납방식 기준 반품 접수, 장바구니 주소 사전 확인). 이미 운송장이 저장된 예약의 취소·상태 동기화는 이 값과 무관. 장바구니 요청 A 스위치(is_bulk_delivery)와 무관. 기본 false — 켜기는 CMS 에서만.';

CREATE OR REPLACE FUNCTION public.toggle_rental_method_dhero_integration(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row rental_method_options;
BEGIN
  IF NOT public.is_cms_manager_or_above() THEN
    RAISE EXCEPTION 'unauthorized: cms manager role required';
  END IF;

  UPDATE rental_method_options
  SET is_dhero_integration = NOT is_dhero_integration
  WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: rental_method_option id %', p_id;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_rental_method_dhero_integration(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.toggle_rental_method_dhero_integration(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.toggle_rental_method_dhero_integration(UUID) TO authenticated;
