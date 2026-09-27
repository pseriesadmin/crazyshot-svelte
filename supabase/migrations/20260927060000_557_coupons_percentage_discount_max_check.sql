-- Migration #557: coupons — 정률(%) 할인 상한(100%) DB 제약 추가
--
-- 배경(Plan "쿠폰 생성 7건 결함 보완" 1번): coupons_discount_value_check(Migration #462)은
-- discount_value > 0만 검증할 뿐 상한이 없어, discount_type='percentage'인 쿠폰에
-- 100을 초과하는 값(예: 150%)이 그대로 저장될 수 있었다. 화면(coupon/new,
-- CouponDetailPanel)과 서버 액션에서도 100으로 클램프/차단하지만, DB 레벨 최종
-- 방어선으로 CHECK 제약을 추가한다.
--
-- discount_type != 'percentage'인 행(fixed/free_shipping)은 이 제약과 무관 — 정액·
-- 배송비 할인은 원 단위 금액이라 100 상한이 의미 없음.

ALTER TABLE public.coupons
  ADD CONSTRAINT coupons_percentage_discount_max_check
  CHECK (discount_type != 'percentage' OR discount_value <= 100);

-- ─────────────────────────────────────────────────────────
-- ROLLBACK
-- ─────────────────────────────────────────────────────────
-- ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_percentage_discount_max_check;
