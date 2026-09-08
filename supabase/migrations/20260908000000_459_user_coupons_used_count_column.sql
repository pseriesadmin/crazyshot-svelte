-- ★ MIGRATION: 459_user_coupons_used_count_column.sql
-- Description: Production user_coupons 테이블에 used_count 컬럼 누락 결함 수정.
--
-- 배경(2026-09-08 발견): 최초 스키마(Migration #16, 2026-05-29)에 정의된
-- user_coupons.used_count(INT NOT NULL DEFAULT 0)가 Production에는 존재하지 않았다
-- (Production 마이그레이션 이력에 #16 자체가 없음 — 다른 경로로 테이블이 생성된 것으로
-- 추정). Stage(ezyvffjvuwmtuhpxdjrw)에는 정상적으로 존재.
--
-- 영향: cart/+page.server.ts의 쿠폰 조회 쿼리가 `id, coupon_id, used_count, coupons(...)`
-- 를 select하는데, 존재하지 않는 컬럼 select는 PostgREST 400 에러를 유발한다. 코드가
-- `(couponResult.data ?? [])`로 실패를 조용히 빈 배열로 흡수해 콘솔·런타임 로그에 아무
-- 흔적도 남기지 않았다 — 그 결과 Production에서 고객이 쿠폰을 보유해도 장바구니
-- "사용 가능한 쿠폰" 섹션이 단 한 번도 노출된 적이 없었다(실증: user_coupons.used_at
-- IS NOT NULL 0건, Production 오픈 이후 쿠폰이 실제로 사용된 이력 자체가 없음).
--
-- IF NOT EXISTS로 작성 — Stage는 이미 컬럼이 있어 안전하게 no-op, Production만 실제 반영.
-- Author: Stephen Cconzy
-- Date: 2026-09-08

ALTER TABLE public.user_coupons
  ADD COLUMN IF NOT EXISTS used_count INT NOT NULL DEFAULT 0 CHECK (used_count >= 0);

-- ROLLBACK (수동 실행):
-- ALTER TABLE public.user_coupons DROP COLUMN IF EXISTS used_count;
