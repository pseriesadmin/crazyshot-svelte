-- Migration #314: products RLS — 본인 예약에 배정된 자식(재고단위) 상품 조회 허용
-- 배경: products_public_read(Migration #196)는 parent_product_id IS NULL(부모)만 허용하는데,
-- rental_reservations.product_id는 항상 자식(재고단위)을 가리킨다(products.md §5). 즉 일반
-- 고객 세션으로는 자기 자신의 예약이라도 배정된 상품 행을 조회할 수 없어, /account 대여
-- 목록·최근 예약 카드의 orders/products 조인에서 상품명이 항상 비어 보일 수 있는 잠재
-- 결함이었음(2026-08-20 QA 검수 중 발견, DB 정책 직접 조회로 실재 확인).
--
-- 조치: 본인 예약(rental_reservations.user_id = auth.uid())에 배정된 product_id 행만
-- 추가로 조회 허용하는 정책 신설(순수 추가 — 기존 products_public_read/products_admin_all
-- 무변경, RLS 정책은 OR로 합산되므로 기존 부모 공개 조회·CMS 전체 조회 범위는 그대로 유지됨).
-- 타 사용자의 예약이나 무관한 상품 행은 노출되지 않음(EXISTS 서브쿼리가 auth.uid() 소유
-- 예약으로만 한정).

CREATE POLICY "products_own_reservation_read" ON public.products
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM rental_reservations rr
      WHERE rr.product_id = products.id
        AND rr.user_id = auth.uid()
    )
  );
