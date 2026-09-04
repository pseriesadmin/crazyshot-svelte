-- 440_rental_method_is_delivery_type_column.sql
--
-- "반납 배송선택 제한"(rental_shipping_settings.restrict_return_delivery) 기능이 지금까지
-- is_bulk_delivery("대여옵션(수령/반납) 일괄적용" — "요청 A" 전용 플래그)를 빌려써서 "어느
-- 방식이 배송인지"를 판정하고 있었다. 두 기능은 서로 다른 목적(요청 A=자동복사+시간선택
-- 비활성화 / 반납제한=반납 콤보에서 배송 제외)인데 하나의 플래그를 공유하다보니, 관리자가
-- "반납 배송선택 제한"만 켜고 "일괄적용"은 설정하지 않으면 반납제한이 완전히 무효화되는
-- 결함으로 이어졌다(Stephen 실사용 리포트, 2026-09-04). 이 컬럼으로 판정 기준을 완전히
-- 분리한다 — is_bulk_delivery는 그대로 "요청 A" 전용으로 남긴다.
ALTER TABLE rental_method_options
  ADD COLUMN is_delivery_type BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN rental_method_options.is_delivery_type IS
  '반납 배송선택 제한(rental_shipping_settings.restrict_return_delivery) 판정 전용 — 이 방식이
   "배송"인지 독립적으로 표시. is_bulk_delivery(요청 A 전용)와 완전히 분리된 별개 플래그.';
