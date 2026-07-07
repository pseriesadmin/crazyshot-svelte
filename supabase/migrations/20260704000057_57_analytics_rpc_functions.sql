-- migration #57: get_promotion_analytics RPC
-- Phase 3 — Analytics Dashboard 집계 함수
-- 의존성: marketing_rules (#56), user_coupons, coupons, user_behavior_events (#52),
--          user_segments (#53), rental_reservations (#10)

-- ──────────────────────────────────────────────────────────────────────────────
-- get_promotion_analytics()
-- 반환: JSONB {
--   total_revenue, conversion_rate, ctr,
--   active_campaigns, top_coupons[], segment_performance[]
-- }
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_promotion_analytics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_revenue     NUMERIC := 0;
  v_conversion_rate   NUMERIC := 0;
  v_ctr               NUMERIC := 0;
  v_active_campaigns  INT     := 0;
  v_top_coupons       JSONB   := '[]'::JSONB;
  v_segment_perf      JSONB   := '[]'::JSONB;

  v_pageview_count    BIGINT  := 0;
  v_purchase_count    BIGINT  := 0;
  v_click_count       BIGINT  := 0;
BEGIN
  -- 1. 총 매출 (rental_reservations status='confirmed' 합계)
  --    rental_reservations 없을 수도 있으므로 COALESCE
  BEGIN
    SELECT COALESCE(SUM(total_price), 0)
    INTO v_total_revenue
    FROM rental_reservations
    WHERE status = 'confirmed';
  EXCEPTION WHEN undefined_table THEN
    v_total_revenue := 0;
  END;

  -- 2. 전환율 / CTR (user_behavior_events 기반)
  BEGIN
    SELECT
      COALESCE(COUNT(*) FILTER (WHERE event_type = 'pageview'), 0),
      COALESCE(COUNT(*) FILTER (WHERE event_type = 'purchase'), 0),
      COALESCE(COUNT(*) FILTER (WHERE event_type = 'click'), 0)
    INTO v_pageview_count, v_purchase_count, v_click_count
    FROM user_behavior_events;
  EXCEPTION WHEN undefined_table THEN
    v_pageview_count := 0;
    v_purchase_count := 0;
    v_click_count    := 0;
  END;

  -- 전환율 = purchase / pageview (%)
  IF v_pageview_count > 0 THEN
    v_conversion_rate := ROUND((v_purchase_count::NUMERIC / v_pageview_count) * 100, 2);
  END IF;

  -- CTR = click / pageview (%)
  IF v_pageview_count > 0 THEN
    v_ctr := ROUND((v_click_count::NUMERIC / v_pageview_count) * 100, 2);
  END IF;

  -- 3. 활성 캠페인 수 (marketing_rules WHERE is_active=true)
  SELECT COALESCE(COUNT(*), 0)
  INTO v_active_campaigns
  FROM marketing_rules
  WHERE is_active = true;

  -- 4. 상위 쿠폰 5개 (user_coupons JOIN coupons — 사용 횟수 기준)
  BEGIN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'coupon_id',    c.id,
          'code',         c.code,
          'name',         c.name,
          'used_count',   agg.used_count,
          'issued_count', agg.issued_count,
          'conversion',   CASE WHEN agg.issued_count > 0
                               THEN ROUND((agg.used_count::NUMERIC / agg.issued_count) * 100, 1)
                               ELSE 0 END
        )
      ),
      '[]'::JSONB
    )
    INTO v_top_coupons
    FROM (
      SELECT
        coupon_id,
        COUNT(*) AS issued_count,
        COUNT(*) FILTER (WHERE used_at IS NOT NULL) AS used_count
      FROM user_coupons
      GROUP BY coupon_id
      ORDER BY used_count DESC
      LIMIT 5
    ) agg
    JOIN coupons c ON c.id = agg.coupon_id;
  EXCEPTION WHEN undefined_table THEN
    v_top_coupons := '[]'::JSONB;
  END;

  -- 5. 세그먼트별 성과 (user_segments 별 사용자 수 집계)
  BEGIN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'segment',    segment,
          'user_count', user_count,
          'avg_score',  avg_score
        )
        ORDER BY user_count DESC
      ),
      '[]'::JSONB
    )
    INTO v_segment_perf
    FROM (
      SELECT
        segment,
        COUNT(DISTINCT user_id) AS user_count,
        ROUND(AVG(score), 2)   AS avg_score
      FROM user_segments
      GROUP BY segment
    ) sub;
  EXCEPTION WHEN undefined_table THEN
    v_segment_perf := '[]'::JSONB;
  END;

  RETURN jsonb_build_object(
    'total_revenue',       v_total_revenue,
    'conversion_rate',     v_conversion_rate,
    'ctr',                 v_ctr,
    'active_campaigns',    v_active_campaigns,
    'top_coupons',         v_top_coupons,
    'segment_performance', v_segment_perf
  );
END;
$$;


-- ── ROLLBACK ──
-- DROP FUNCTION IF EXISTS get_promotion_analytics();
