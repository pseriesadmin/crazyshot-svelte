-- ★ MIGRATION: 461_coupons_discount_type_widen_free_shipping.sql
-- Description: coupons.discount_type CHECK 제약을 실제 사용 중인 'free_shipping' 값을
--   포함하도록 확장 + Stage/Production 양쪽 동일하게 통일.
--
-- 배경(2026-09-08 발견): Stage에는 coupons_discount_type_check
-- (discount_type IN ('fixed','percentage'))가 최초 스키마(Migration #15)부터 존재했으나
-- Production에는 이 제약 자체가 없었다(user_coupons.used_count 컬럼 누락과 동일 계열의
-- Production 스키마 드리프트 — Migration #15 이력 자체가 Production에 없는 것으로 추정).
--
-- Production 실데이터 조회 결과 coupons 전체 2행 모두 discount_type='free_shipping'
-- (무료배송 쿠폰) — CMS(cms/promotion/coupon/+page.svelte discountLabel())와 카트
-- (cart/+page.svelte couponLabel)가 이미 "fixed도 percentage도 아니면 무료배송"으로
-- 정상 취급해온 실사용 값이다. 즉 원래 제약(#15) 자체가 이 값을 허용 목록에서 빠뜨린
-- 설계 공백이었다 — Stephen 확정: 'free_shipping'을 정식 허용값으로 넓혀서 Stage·
-- Production 양쪽 동일하게 통일.
--
-- discount_value>0 / usage_count>=0 제약도 Production에 없으나 이번 스코프는
-- discount_type 통일만 — Stephen 요청 범위 외.
--
-- DROP CONSTRAINT IF EXISTS 후 재생성 — Stage(기존 제약 교체)·Production(신규 생성)
-- 양쪽에 동일하게 안전 적용 가능.
-- Author: Stephen Cconzy
-- Date: 2026-09-08

ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_discount_type_check;

ALTER TABLE public.coupons
  ADD CONSTRAINT coupons_discount_type_check
  CHECK (discount_type IN ('fixed', 'percentage', 'free_shipping'));

-- ROLLBACK (수동 실행 — Stage 원복 시에만, Production은 원래 제약 자체가 없었으므로
-- DROP만 하면 이전 상태로 복귀):
-- ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_discount_type_check;
-- ALTER TABLE public.coupons ADD CONSTRAINT coupons_discount_type_check
--   CHECK (discount_type IN ('fixed', 'percentage'));  -- Stage 전용 원복
