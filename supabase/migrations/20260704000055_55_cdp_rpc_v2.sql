-- migration #55: CDP RPC 함수 보정 (Stage 검증 완료 → Production 적용용)
-- 문제: #54의 compute_rfm_scores CTE 컬럼 모호성 + DELETE 미지원
-- 해결: compute_rfm_scores를 LANGUAGE sql로 교체, refresh_user_segments를 TRUNCATE + 강제 재생성

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. compute_rfm_scores — LANGUAGE sql로 교체 (플랜캐시 문제 + 컬럼 모호성 해소)
-- ──────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS compute_rfm_scores();

CREATE FUNCTION compute_rfm_scores()
RETURNS TABLE (
  user_id      UUID,
  recency_days INT,
  frequency    INT,
  monetary     NUMERIC,
  rfm_score    NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  WITH per_user AS (
    SELECT
      rr.user_id,
      EXTRACT(DAY FROM now() - MAX(rr.created_at))::INT          AS recency_days,
      COUNT(CASE WHEN rr.status = 'returned' THEN 1 END)::INT    AS frequency,
      COALESCE(SUM(pt.amount)::NUMERIC, 0::NUMERIC)               AS monetary
    FROM rental_reservations rr
    LEFT JOIN point_transactions pt
      ON pt.user_id = rr.user_id AND pt.type = 'earn'
    WHERE rr.status IN ('confirmed', 'active', 'returned')
    GROUP BY rr.user_id
  ),
  maxvals AS (
    SELECT
      GREATEST(MAX(recency_days), 1)::NUMERIC AS max_r,
      GREATEST(MAX(frequency),    1)::NUMERIC AS max_f,
      GREATEST(MAX(monetary),     1)::NUMERIC AS max_m
    FROM per_user
  )
  SELECT
    p.user_id::UUID,
    p.recency_days::INT,
    p.frequency::INT,
    p.monetary::NUMERIC,
    ROUND(
      (1.0 - LEAST(p.recency_days::NUMERIC / m.max_r, 1.0)) * 40.0 +
      LEAST(p.frequency::NUMERIC            / m.max_f, 1.0) * 30.0 +
      LEAST(p.monetary::NUMERIC             / m.max_m, 1.0) * 30.0
    , 2)::NUMERIC AS rfm_score
  FROM per_user p
  CROSS JOIN maxvals m;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. refresh_user_segments — DELETE → TRUNCATE + 강제 재생성
-- ──────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS refresh_user_segments();

CREATE FUNCTION refresh_user_segments()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT := 0;
  v_now   TIMESTAMPTZ := now();
  v_tmp   INT;
BEGIN
  TRUNCATE TABLE user_segments;

  -- 신규회원: 가입 30일 이내 + 예약 없음
  INSERT INTO user_segments (user_id, segment, score, computed_at)
  SELECT up.id, 'new_member', 100::NUMERIC, v_now
  FROM user_profiles up
  WHERE up.created_at > v_now - INTERVAL '30 days'
    AND NOT EXISTS (
      SELECT 1 FROM rental_reservations rr
      WHERE rr.user_id = up.id AND rr.status <> 'cancelled'
    )
  ON CONFLICT (user_id, segment) DO UPDATE
    SET score = EXCLUDED.score, computed_at = EXCLUDED.computed_at;
  GET DIAGNOSTICS v_tmp = ROW_COUNT;
  v_count := v_count + v_tmp;

  -- VIP: RFM 점수 70 이상
  INSERT INTO user_segments (user_id, segment, score, computed_at)
  SELECT rfm.user_id, 'vip', rfm.rfm_score, v_now
  FROM compute_rfm_scores() rfm
  WHERE rfm.rfm_score >= 70
  ON CONFLICT (user_id, segment) DO UPDATE
    SET score = EXCLUDED.score, computed_at = EXCLUDED.computed_at;
  GET DIAGNOSTICS v_tmp = ROW_COUNT;
  v_count := v_count + v_tmp;

  -- 휴면회원: 마지막 행동 로그 30일 초과 + 가입 30일 초과
  INSERT INTO user_segments (user_id, segment, score, computed_at)
  SELECT up.id, 'dormant', 0::NUMERIC, v_now
  FROM user_profiles up
  WHERE up.created_at < v_now - INTERVAL '30 days'
    AND NOT EXISTS (
      SELECT 1 FROM user_behavior_events ube
      WHERE ube.user_id = up.id
        AND ube.created_at > v_now - INTERVAL '30 days'
    )
  ON CONFLICT (user_id, segment) DO UPDATE
    SET score = EXCLUDED.score, computed_at = EXCLUDED.computed_at;
  GET DIAGNOSTICS v_tmp = ROW_COUNT;
  v_count := v_count + v_tmp;

  -- 장바구니이탈: 48시간 내 cart_add + 미결제
  INSERT INTO user_segments (user_id, segment, score, computed_at)
  SELECT DISTINCT ube.user_id, 'cart_abandon', 80::NUMERIC, v_now
  FROM user_behavior_events ube
  WHERE ube.event_type = 'cart_add'
    AND ube.created_at > v_now - INTERVAL '48 hours'
    AND ube.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM rental_reservations rr
      WHERE rr.user_id = ube.user_id
        AND rr.status = 'confirmed'
        AND rr.created_at > v_now - INTERVAL '48 hours'
    )
  ON CONFLICT (user_id, segment) DO UPDATE
    SET score = EXCLUDED.score, computed_at = EXCLUDED.computed_at;
  GET DIAGNOSTICS v_tmp = ROW_COUNT;
  v_count := v_count + v_tmp;

  -- 첫구매예정: 상품 페이지 조회 + 결제 없음
  INSERT INTO user_segments (user_id, segment, score, computed_at)
  SELECT DISTINCT ube.user_id, 'first_purchase_ready', 60::NUMERIC, v_now
  FROM user_behavior_events ube
  WHERE ube.event_type = 'pageview'
    AND ube.page_path LIKE '/products/%'
    AND ube.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM rental_reservations rr
      WHERE rr.user_id = ube.user_id AND rr.status = 'confirmed'
    )
  ON CONFLICT (user_id, segment) DO UPDATE
    SET score = EXCLUDED.score, computed_at = EXCLUDED.computed_at;
  GET DIAGNOSTICS v_tmp = ROW_COUNT;
  v_count := v_count + v_tmp;

  -- 고가치 고객: monetary 상위 10%
  INSERT INTO user_segments (user_id, segment, score, computed_at)
  SELECT rfm2.user_id, 'high_value', rfm2.rfm_score, v_now
  FROM compute_rfm_scores() rfm2
  WHERE rfm2.monetary > (
    SELECT COALESCE(
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY rfm3.monetary),
      0::NUMERIC
    )
    FROM compute_rfm_scores() rfm3
  )
  ON CONFLICT (user_id, segment) DO UPDATE
    SET score = EXCLUDED.score, computed_at = EXCLUDED.computed_at;
  GET DIAGNOSTICS v_tmp = ROW_COUNT;
  v_count := v_count + v_tmp;

  RETURN jsonb_build_object(
    'success',          true,
    'segments_updated', v_count,
    'computed_at',      v_now
  );
END;
$$;
