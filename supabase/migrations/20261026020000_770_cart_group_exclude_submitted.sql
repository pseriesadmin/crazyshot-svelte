-- Migration #770: 장바구니 그룹 판정에서 "이미 제출된(주문에 묶인) 형제 예약" 제외 (2026-10-26, sp3 검수 MAJOR-1)
--
-- 배경: #769 의 private.cart_group_size / private.group_has_delivery_disabled_option 은 "같은 사용자·같은 상태·같은 부모상품(hold 는 같은 날짜)"만 보고
--   그 예약이 이미 주문에 묶였는지(order_items 유무)를 보지 않았다. 그런데 장바구니 화면은 order_items 가 있는 hold 예약(제출 완료·계약/결제 대기)을 목록에서 제외한다
--   (cart/+page.server.ts, 2026-09-10 결함 수정). 그래서 이미 제출한 같은 상품·같은 날짜 예약이 있으면 서버 그룹 크기가 화면보다 커져
--   ① 연동 옵션이 화면보다 큰 수량으로 저장돼 화면 합계 ≠ 서버 금액(결제 거절) ② 이전 주문의 "배송 대여 불가" 옵션 때문에 새 배송형 신청이 오탐 거절될 수 있었다.
-- 변경: 두 함수의 그룹 조인에 "자기 자신이거나 아직 주문에 묶이지 않은 예약" 조건을 추가한다(화면 그룹 규칙과 일치).
--   me(기준 예약) 자신이 이미 주문에 묶인 경우(재제출)에는 자기 자신만 포함되므로 동작이 그대로다.
-- 호출하는 set_reservation_options · create_reservation_order 본문은 변경 없음. 보조 함수 권한(anon·authenticated 실행 불가)은 CREATE OR REPLACE 로 유지되고 REVOKE 를 다시 명시한다.
-- 테스트: src/__tests__/services/followOptionServerCorrection.test.ts FO-13~15 (Stage 라이브)

CREATE OR REPLACE FUNCTION private.cart_group_size(p_reservation_id bigint)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT COUNT(*)::int
    FROM rental_reservations me
    LEFT JOIN products mp ON mp.id = me.product_id
    JOIN rental_reservations g
      ON g.user_id = me.user_id
     AND g.status  = me.status
     AND (me.status <> 'hold' OR (g.start_date = me.start_date AND g.end_date = me.end_date))
     AND (g.id = me.id OR NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.reservation_id = g.id))
    LEFT JOIN products gp ON gp.id = g.product_id
   WHERE me.id = p_reservation_id
     AND COALESCE(gp.parent_product_id, g.product_id) = COALESCE(mp.parent_product_id, me.product_id);
$fn$;

CREATE OR REPLACE FUNCTION private.group_has_delivery_disabled_option(p_reservation_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM rental_reservations me
      LEFT JOIN products mp ON mp.id = me.product_id
      JOIN rental_reservations g
        ON g.user_id = me.user_id
       AND g.status  = me.status
       AND (me.status <> 'hold' OR (g.start_date = me.start_date AND g.end_date = me.end_date))
       AND (g.id = me.id OR NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.reservation_id = g.id))
      LEFT JOIN products gp ON gp.id = g.product_id
      JOIN reservation_options ro
        ON ro.reservation_id = g.id AND ro.qty > 0 AND ro.option_product_id IS NOT NULL
      JOIN product_option_links pol
        ON pol.product_id = COALESCE(mp.parent_product_id, me.product_id)
       AND pol.option_product_id = ro.option_product_id
       AND pol.deleted_at IS NULL
       AND pol.delivery_rental_disabled = true
     WHERE me.id = p_reservation_id
       AND COALESCE(gp.parent_product_id, g.product_id) = COALESCE(mp.parent_product_id, me.product_id)
  );
$fn$;

REVOKE ALL ON FUNCTION private.cart_group_size(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.group_has_delivery_disabled_option(bigint) FROM PUBLIC, anon, authenticated;

-- ROLLBACK: #769 의 두 함수 정의(위에서 "AND (g.id = me.id OR NOT EXISTS ...)" 줄만 뺀 본문)로 CREATE OR REPLACE. 되돌리면 MAJOR-1 증상이 다시 생긴다.
