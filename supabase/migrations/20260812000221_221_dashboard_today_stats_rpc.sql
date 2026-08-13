-- Migration #221: CMS 대시보드 "오늘 통계" 탭 집계 RPC
--
-- 목적: /cms 대시보드 Phase 2 — 단일 왕복 집계 함수.
--       11개 지표(방문자·결제·고객·상품·대여·리뷰)를 JSONB 한 덩어리로 반환해 N+1 방지.
--
-- 제약:
--   · is_cms_user() 게이트 (Migration 195와 동일 패턴 — manager 등급 무관, CMS 계정 전체 허용)
--   · SECURITY DEFINER: RLS 우회로 service_role 없이도 집계 가능
--   · returns_completed_total: returned_at 컬럼이 rental_reservations에 없어 오늘 기준 스코핑 불가
--     → 현재 누적 스냅샷으로 반환 (COMMENT로 명시)
--   · visits_today_estimate: user_behavior_events pageview 기반 추정치 (실측 세션 트래킹 아님)
--
-- 2026-08-12 재검증 수정(최초 초안이 실제 라이브 스키마와 3곳 어긋나 있던 것을 stage/production
-- information_schema 직접 조회로 발견·수정 — 최초 CREATE FUNCTION은 문법 오류 없이 성공했으나
-- 런타임에 전부 실패했을 것):
--   1) payment_transactions에 amount 컬럼이 없음(실제: total_amount/paid_amount) → paid_amount
--      (실결제액 = total_amount - point_amount - coupon_discount, api/payment/confirm 로직과 일치)
--      로 교체
--   2) payment_transactions.status CHECK 제약이 'completed'가 아니라
--      ('pending','done','cancelled','partial_cancelled','failed') → 'done'으로 교체
--   3) cs_posts 테이블이 stage·production 양쪽 다 존재하지 않음(마이그레이션 24/25 파일은
--      저장소에 있으나 실제 DB에 한 번도 적용된 적 없는 것으로 확인 — get_all_cs_posts 등
--      cs_inquiry_rpcs(157)도 같은 이유로 현재 런타임에 전부 실패하는 상태, 별도 이슈로 분리
--      플래그 완료) → inquiries_today_count/inquiries_pending_count 2개 필드를 이번 함수에서
--      제거. 프론트는 이 2개 지표를 "준비중"으로 표시(이벤트 응모수와 동일 처리)
--
-- 참조 마이그레이션:
--   · #195 is_cms_user_backfill.sql — 게이트 함수 정의
--   · #51  promotion_rpc_v2.sql    — get_coupon_usage_report (동일 패턴)

CREATE OR REPLACE FUNCTION public.get_dashboard_today_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  SELECT jsonb_build_object(
    'visits_today_estimate', (
      SELECT COUNT(*)
      FROM user_behavior_events
      WHERE event_type = 'pageview'
        AND created_at::date = CURRENT_DATE
    ),
    'payment_total_today', (
      SELECT COALESCE(SUM(paid_amount), 0)
      FROM payment_transactions
      WHERE status = 'done'
        AND created_at::date = CURRENT_DATE
    ),
    'customers_new_today', (
      SELECT COUNT(*)
      FROM user_profiles
      WHERE created_at::date = CURRENT_DATE
    ),
    'customers_withdrawn_today', (
      SELECT COUNT(*)
      FROM user_profiles
      WHERE deleted_at::date = CURRENT_DATE
    ),
    'customers_total', (
      SELECT COUNT(*)
      FROM user_profiles
      WHERE deleted_at IS NULL
    ),
    'product_category_count', (
      SELECT COUNT(DISTINCT category)
      FROM products
      WHERE parent_product_id IS NULL
        AND deleted_at IS NULL
    ),
    'product_total_count', (
      SELECT COUNT(*)
      FROM products
      WHERE parent_product_id IS NULL
        AND deleted_at IS NULL
    ),
    'rentals_out_count', (
      SELECT COUNT(*)
      FROM rental_reservations
      WHERE status IN ('confirmed', 'shipped', 'in_use')
    ),
    'returns_pending_count', (
      SELECT COUNT(*)
      FROM rental_reservations
      WHERE status = 'return_requested'
    ),
    'returns_completed_total', (
      SELECT COUNT(*)
      FROM rental_reservations
      WHERE status = 'returned'
    ),
    'reviews_today_count', (
      SELECT COUNT(*)
      FROM product_reviews
      WHERE created_at::date = CURRENT_DATE
    )
  ) INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.get_dashboard_today_stats() IS
  'CMS 대시보드 "오늘 통계" 탭 — 단일 왕복 집계. visits_today_estimate는 user_behavior_events
   pageview 기반 추정치(실측 트래킹 아님). returns_completed_total은 returned_at 컬럼 부재로
   "오늘" 스코핑 불가 — 현재 누적 스냅샷.';
