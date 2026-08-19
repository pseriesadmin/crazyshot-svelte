-- Migration 295: 쿠폰 코드 표시 정합성 보완 (프로모션 분석·사용 리포트)
-- 배경: 쿠폰 기준코드 지연채번(Migration 291~294) 도입 이후 sequenced 모드 쿠폰은
--   coupons.code가 NULL일 수 있는데, 이를 그대로 노출하는 두 RPC를 발견해 보완한다.
--   Stephen 요청(2026-08-18) — "/cms/promotion" 전역·쿠폰 화면 로직 정합성 검증" 중 발견.
--
-- 1) get_promotion_analytics: RETURN JSONB의 키가 'code'인데 프론트/서버 타입은
--    'coupon_code'를 읽고 있어 이번 세션 이전부터 TOP5 쿠폰 코드 표시가 항상 비어
--    있었을 가능성이 높은 선행 결함(migration 60에서 처음 도입) — 키 이름 정정.
-- 2) 두 함수 모두 code가 NULL(sequenced 모드, 아직 아무도 채번 전)이면 빈 값 대신
--    code_series 기반 패턴 프리뷰(예: "Z쿠폰코드*")를 보여주도록 COALESCE 추가 —
--    +page.svelte의 codeDisplay() 헬퍼와 동일한 표시 규칙.
-- 2026-08-18

-- ─────────────────────────────────────────────────────────
-- 1) get_promotion_analytics — 'code' → 'coupon_code' 키 정정 + NULL 폴백
-- ─────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_promotion_analytics();

CREATE OR REPLACE FUNCTION public.get_promotion_analytics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  BEGIN
    SELECT COALESCE(SUM(total_amount), 0)
    INTO v_total_revenue
    FROM rental_reservations
    WHERE status = 'confirmed';
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_total_revenue := 0;
  END;

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

  IF v_pageview_count > 0 THEN
    v_conversion_rate := ROUND((v_purchase_count::NUMERIC / v_pageview_count) * 100, 2);
  END IF;

  IF v_pageview_count > 0 THEN
    v_ctr := ROUND((v_click_count::NUMERIC / v_pageview_count) * 100, 2);
  END IF;

  SELECT COALESCE(COUNT(*), 0)
  INTO v_active_campaigns
  FROM marketing_rules
  WHERE is_active = true;

  BEGIN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'coupon_id',    c.id,
          'coupon_code',  COALESCE(                                    -- FIX: 'code' → 'coupon_code'
            c.code,
            CASE WHEN c.code_mode = 'sequenced' AND c.code_series IS NOT NULL
                 THEN COALESCE(c.code_series->>'prefix', 'CS')
                      || COALESCE(c.code_series->>'category_code', '') || '*'
                 ELSE NULL END,
            '—'
          ),
          'name',         c.description,
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

GRANT EXECUTE ON FUNCTION public.get_promotion_analytics() TO authenticated;

-- ─────────────────────────────────────────────────────────
-- 2) get_coupon_usage_report — coupon_code NULL 폴백 추가
--   기존 ORDER BY 모호성·타입 캐스팅 수정(migration 234)은 그대로 유지, coupon_code
--   산출식만 COALESCE 폴백 추가. 시그니처·GROUP BY 대상 컬럼 동일.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_coupon_usage_report(
  p_period TEXT DEFAULT 'day',   -- 'day' | 'month' | 'year'
  p_from   TIMESTAMPTZ DEFAULT NULL,
  p_to     TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  period        TEXT,
  coupon_id     UUID,
  coupon_code   TEXT,
  coupon_type   TEXT,
  issued_count  BIGINT,
  used_count    BIGINT,
  conversion_pct NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  RETURN QUERY
  SELECT
    CASE p_period
      WHEN 'month' THEN to_char(uc.used_at, 'YYYY-MM')
      WHEN 'year'  THEN to_char(uc.used_at, 'YYYY')
      ELSE              to_char(uc.used_at, 'YYYY-MM-DD')
    END AS period,
    c.id                                        AS coupon_id,
    COALESCE(                                                          -- FIX: sequenced 모드 NULL 폴백
      c.code,
      CASE WHEN c.code_mode = 'sequenced' AND c.code_series IS NOT NULL
           THEN COALESCE(c.code_series->>'prefix', 'CS')
                || COALESCE(c.code_series->>'category_code', '') || '*'
           ELSE NULL END,
      '—'
    )::TEXT                                     AS coupon_code,
    c.type::TEXT                                AS coupon_type,
    COUNT(uc.id)                                AS issued_count,
    COUNT(uc.id) FILTER (WHERE uc.used_at IS NOT NULL) AS used_count,
    ROUND(
      COUNT(uc.id) FILTER (WHERE uc.used_at IS NOT NULL)::NUMERIC
        / NULLIF(COUNT(uc.id), 0) * 100, 1
    )                                           AS conversion_pct
  FROM user_coupons uc
  JOIN coupons c ON c.id = uc.coupon_id
  WHERE c.deleted_at IS NULL
    AND (p_from IS NULL OR uc.created_at >= p_from)
    AND (p_to   IS NULL OR uc.created_at <= p_to)
  GROUP BY period, c.id, c.code, c.type, c.code_mode, c.code_series
  ORDER BY period DESC, COUNT(uc.id) FILTER (WHERE uc.used_at IS NOT NULL) DESC;
END;
$$;
